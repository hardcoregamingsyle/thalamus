#!/usr/bin/env node
// Verify every Convex function reference resolves to a real export.
//
// Why this exists: the generated `api`/`internal` objects in a repo this shape
// can hit the TypeScript instantiation-depth cliff (TS2589) and quietly
// degrade to `any`, so `tsc` will happily accept `api.admin.functionThatDoesNotExist`.
// On top of that, several callers reach this deployment by plain string —
// the AgentOverflow frontend via makeFunctionReference, crons, and the new
// Thalamus web app (a different repo, pinned by name, not checked out here) —
// where there was never any type to lose in the first place. A rename that
// looks clean therefore breaks production silently. This script is the only
// thing standing between a refactor and that outage.
//
// Usage: node scripts/check-convex-refs.mjs [--json]
// Exits 1 if any reference is unresolved.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dirname, ".."); // apps/convex/
const CONVEX_DIR = join(ROOT, "convex");
// The AgentOverflow site calls this deployment by string name, so its checkout is
// scanned too: AGENTOVERFLOW_DIR in CI, the sibling checkout locally.
const AO_ROOT = resolve(
  process.env.AGENTOVERFLOW_DIR ?? join(ROOT, "..", "..", "..", "agentoverflow"),
);
if (!existsSync(join(AO_ROOT, "frontend"))) {
  console.error(`agentoverflow checkout not found at ${AO_ROOT}; set AGENTOVERFLOW_DIR`);
  process.exit(1);
}

// frontend/ is the one that matters (frontend/src/lib/thalamusApi.ts pins every
// function the site calls); functions/, api/ and ingestion/ are scanned in case a
// future caller lands there, though today they call HTTP routes, not functions.
const SCAN_DIRS = ["frontend", "functions", "api", "ingestion"]
  .map((d) => join(AO_ROOT, d))
  .filter(existsSync);

const JSON_OUT = process.argv.includes("--json");

function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist" || entry === "_generated")
      continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

// ── 1. Build the set of functions that actually exist ────────────────────────
// Convex addresses a function as "path/to/module:exportName", where the path is
// relative to convex/ and drops the .ts.
const EXPORT_RE =
  /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(query|mutation|action|internalQuery|internalMutation|internalAction|httpAction)\s*\(/g;

const defined = new Map(); // "module:fn" -> { kind, file }
const moduleNames = new Set();

for (const file of walk(CONVEX_DIR, [".ts"])) {
  const mod = relative(CONVEX_DIR, file).replace(/\.ts$/, "").split(sep).join("/");
  moduleNames.add(mod);
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(EXPORT_RE)) {
    defined.set(`${mod}:${m[1]}`, { kind: m[2], file: relative(ROOT, file) });
  }
}

// ── 2. Collect references from every caller ──────────────────────────────────
const refs = []; // { ref, kind, where, style }
const add = (ref, where, style) => refs.push({ ref, where, style });

// 2a. api.<module>.<fn> / internal.<module>.<fn> in TS/TSX inside convex/
// itself — crons.ts, scheduler calls, and every ctx.runQuery/runMutation
// cross-module call. Nested modules read as api.dir.file.fn, so try the
// longest path that matches a known module before falling back to the
// two-segment form.
// The lookbehind matters: without it, every "https://api.github.com" URL in
// the repo reads as a reference to a module called `github`.
const DOTTED_RE = /(?<![/\w.])(api|internal)\.((?:[A-Za-z0-9_]+\.)+[A-Za-z0-9_]+)/g;

// "convex.dir.file.fn" -> "dir/file:fn", preferring the longest path that is a
// real module (nested modules read as api.dir.file.fn).
function resolveDotted(dotted) {
  const parts = dotted.split(".");
  for (let i = parts.length - 1; i >= 1; i--) {
    const mod = parts.slice(0, i).join("/");
    if (moduleNames.has(mod)) return `${mod}:${parts.slice(i).join(".")}`;
  }
  return `${parts.slice(0, -1).join("/")}:${parts[parts.length - 1]}`;
}

for (const file of walk(CONVEX_DIR, [".ts", ".tsx"])) {
  if (file.includes(`${sep}_generated${sep}`)) continue;
  const rel = relative(ROOT, file);
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(DOTTED_RE)) {
    refs.push({ ref: resolveDotted(m[2]), where: rel, style: "typed", root: m[1] });
  }
}

// 2a-ii. The same references, but checked for *how* they are invoked.
//
// Two mistakes are invisible to everything else in the toolchain and fail only
// at runtime, in production, usually inside a catch that swallows them:
//   - reaching a public function through `internal.*` (or vice versa), which
//     does not resolve at all;
//   - running a function with the wrong executor — ctx.runQuery against a
//     mutation, useMutation against an action, and so on.
// A convex module that hits the TS2589 depth cliff is @ts-nocheck'd, so tsc
// sees neither.
const INVOKE_RE =
  /\b(runQuery|runMutation|runAction|useQuery|useMutation|useAction)\s*\(\s*(api|internal)\.((?:[A-Za-z0-9_]+\.)+[A-Za-z0-9_]+)/g;
// scheduler.runAfter(delayMs, ref) / runAt(timestamp, ref) — ref is the 2nd arg.
const SCHEDULE_RE =
  /\b(runAfter|runAt)\s*\(\s*[^,]+,\s*(api|internal)\.((?:[A-Za-z0-9_]+\.)+[A-Za-z0-9_]+)/g;

const KINDS_FOR_INVOKE = {
  runQuery: ["query", "internalQuery"],
  useQuery: ["query", "internalQuery"],
  runMutation: ["mutation", "internalMutation"],
  useMutation: ["mutation", "internalMutation"],
  runAction: ["action", "internalAction"],
  useAction: ["action", "internalAction"],
  // The scheduler takes mutations and actions; a query has nothing to schedule.
  runAfter: ["mutation", "internalMutation", "action", "internalAction"],
  runAt: ["mutation", "internalMutation", "action", "internalAction"],
};

const invocations = []; // { ref, where, root, via }
for (const file of walk(CONVEX_DIR, [".ts", ".tsx"])) {
  if (file.includes(`${sep}_generated${sep}`)) continue;
  const rel = relative(ROOT, file);
  const src = readFileSync(file, "utf8");
  for (const re of [INVOKE_RE, SCHEDULE_RE]) {
    for (const m of src.matchAll(re)) {
      invocations.push({ ref: resolveDotted(m[3]), where: rel, root: m[2], via: m[1] });
    }
  }
}

// 2b. The new Thalamus web app's pinned contract (see
// thalamus/docs/architecture.md §4). It lives in a different repo with no
// checkout here, so its references cannot be found by scanning — they are
// hardcoded instead. Keep this list in sync with that repo's apps/web.
const THALAMUS_WEB_CONTRACT = [
  "customAuth:sendOtp",
  "customAuth:verifyOtp",
  "customAuthHelpers:getUserByToken",
  "customAuthHelpers:signOut",
];
for (const ref of THALAMUS_WEB_CONTRACT) {
  add(ref, "thalamus/apps/web (pinned contract, not checked out here)", "thalamus-web-contract");
}

// 2c. makeFunctionReference("module:function") — inside convex/ itself (the
// relay uses this to reach its own backend without waiting on codegen) AND in
// every directory of this repo that calls this deployment by string
// (frontend/, and functions/, api/, ingestion/ if they ever do). All of them
// reach Convex by string, so all of them need checking.
// Hand-scanned rather than matched with a regex, and that is not fussiness.
// A non-greedy `<[\s\S]*?>` for the type arguments stops at the FIRST `>` —
// so `makeFunctionReference<"mutation", { runId: Id<"codeRuns"> }>("x:y")`
// ends at the `>` inside `Id<"codeRuns">`, fails to match, and the reference
// is silently skipped. Depth-tracking cannot be fooled by nesting at any depth.
function findMfrRefs(src) {
  const out = [];
  const token = "makeFunctionReference";
  for (let i = src.indexOf(token); i !== -1; i = src.indexOf(token, i + 1)) {
    let j = i + token.length;
    let depth = 0;
    // Walk to the call's `(`, counting angle brackets so nested generics are
    // stepped over instead of ending the scan early.
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === "<") depth++;
      else if (c === ">") depth--;
      else if (c === "(" && depth <= 0) break;
      else if (depth <= 0 && !/[\s,\w\[\]{}:;."'|?&=>-]/.test(c)) break;
    }
    if (src[j] !== "(") continue;
    // First string literal inside the call is the "module:function" path.
    const m = /^\s*"([^"]+)"/.exec(src.slice(j + 1));
    if (m) out.push(m[1]);
  }
  return out;
}
for (const file of walk(CONVEX_DIR, [".ts", ".tsx"])) {
  if (file.includes(`${sep}_generated${sep}`)) continue;
  const rel = relative(ROOT, file);
  const src = readFileSync(file, "utf8");
  for (const name of findMfrRefs(src)) add(name, rel, "in-repo-string");
}

let crossRepoRefCount = 0;
for (const dir of SCAN_DIRS) {
  const label = relative(AO_ROOT, dir).split(sep).join("/");
  for (const file of walk(dir, [".ts", ".tsx"])) {
    const rel = `${label}/${relative(dir, file).split(sep).join("/")}`;
    const src = readFileSync(file, "utf8");
    for (const name of findMfrRefs(src)) {
      add(name, rel, label);
      crossRepoRefCount++;
    }
  }
}

// ── 3. Report ────────────────────────────────────────────────────────────────
// A ref to a module we do not have is only interesting if the module exists —
// otherwise it is a string that merely looks like a function path (a URL scheme,
// a label, a time value). Requiring a known module keeps the false positives out.
// The Thalamus web contract is the one exception: it names no module in this
// repo by construction (the caller is elsewhere), so it is always checked.
const broken = [];
for (const r of refs) {
  if (defined.has(r.ref)) continue;
  const mod = r.ref.split(":")[0];
  if (!moduleNames.has(mod)) {
    if (r.style === "typed" || r.style === "thalamus-web-contract") {
      broken.push({ ...r, why: `no such convex module "${mod}"` });
    }
    continue; // unrelated string literal
  }
  broken.push({ ...r, why: `module "${mod}" has no export "${r.ref.split(":")[1]}"` });
}

const byRef = new Map();
for (const b of broken) {
  if (!byRef.has(b.ref)) byRef.set(b.ref, { ref: b.ref, why: b.why, sites: [] });
  byRef.get(b.ref).sites.push(`${b.where} (${b.style})`);
}
const unique = [...byRef.values()];

// ── 3b. Visibility + executor-kind mismatches ────────────────────────────────
// Both resolve to a real export, so section 3 waves them through — and both
// still blow up at runtime.
const isInternalKind = (k) => k.startsWith("internal");
const mismatches = [];

for (const r of refs) {
  const def = defined.get(r.ref);
  if (!def || !r.root) continue;
  if (def.kind === "httpAction") continue; // routed in http.ts, never referenced this way
  const wantInternal = r.root === "internal";
  if (isInternalKind(def.kind) !== wantInternal) {
    mismatches.push({
      ref: r.ref,
      where: r.where,
      why:
        `declared ${def.kind} but referenced through \`${r.root}.\` — ` +
        `use \`${wantInternal ? "internal" : "api"}\` only for ${wantInternal ? "internal*" : "public"} functions`,
    });
  }
}

for (const inv of invocations) {
  const def = defined.get(inv.ref);
  if (!def) continue;
  const allowed = KINDS_FOR_INVOKE[inv.via];
  if (allowed && !allowed.includes(def.kind)) {
    mismatches.push({
      ref: inv.ref,
      where: inv.where,
      why: `declared ${def.kind} but invoked via ${inv.via}() — expected ${allowed.join(" or ")}`,
    });
  }
}

// Same ref reported from several files collapses to one entry per reason.
const mismatchKey = (m) => `${m.ref}|${m.why}`;
const uniqueMismatches = [];
const seenMismatch = new Map();
for (const m of mismatches) {
  const k = mismatchKey(m);
  if (!seenMismatch.has(k)) {
    seenMismatch.set(k, { ...m, sites: [] });
    uniqueMismatches.push(seenMismatch.get(k));
  }
  if (!seenMismatch.get(k).sites.includes(m.where)) seenMismatch.get(k).sites.push(m.where);
}

// Reverse direction: functions nothing appears to call. This is a HINT, not a
// verdict — a function can still be reached through an httpAction route, a
// cron, or the Thalamus web app's pinned contract. Opt in with --unused; it
// never fails the build.
if (process.argv.includes("--unused")) {
  const mentioned = new Set(THALAMUS_WEB_CONTRACT);
  const sources = [
    ...walk(CONVEX_DIR, [".ts", ".tsx"]),
    ...walk(join(ROOT, "scripts"), [".ts", ".mjs", ".sh"]),
    ...SCAN_DIRS.flatMap((dir) => walk(dir, [".ts", ".tsx", ".py", ".js"])),
  ];
  const blobs = sources
    .filter((f) => !f.includes(`${sep}_generated${sep}`))
    .map((f) => ({ file: f, text: readFileSync(f, "utf8") }));
  for (const [ref] of defined) {
    if (mentioned.has(ref)) continue;
    const fn = ref.split(":")[1];
    const mod = ref.split(":")[0];
    const defFile = join(CONVEX_DIR, `${mod}.ts`);
    const re = new RegExp(`\\b${fn}\\b`);
    for (const b of blobs) {
      if (b.file === defFile) {
        // Inside its own module, ignore the export statement itself.
        const others = b.text.split("\n").filter((l) => !l.includes(`export const ${fn} `));
        if (others.some((l) => re.test(l))) {
          mentioned.add(ref);
          break;
        }
        continue;
      }
      if (re.test(b.text)) {
        mentioned.add(ref);
        break;
      }
    }
  }
  const orphans = [...defined.keys()].filter((r) => !mentioned.has(r)).sort();
  console.log(
    `\npossibly-unused exports (${orphans.length} of ${defined.size}) — verify before deleting:`,
  );
  for (const o of orphans) console.log(`  ${o}  [${defined.get(o).kind}]`);
}

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        defined: defined.size,
        refs: refs.length,
        broken: unique,
        mismatches: uniqueMismatches,
      },
      null,
      2,
    ),
  );
} else {
  console.log(
    `convex refs: ${defined.size} functions defined, ${refs.length} references checked` +
      ` (${invocations.length} invocations kind-checked)`,
  );
  console.log(
    `cross-repo (frontend/functions/api/ingestion): ${crossRepoRefCount} string references checked` +
      ` across ${SCAN_DIRS.length} of 4 expected directories`,
  );
  if (SCAN_DIRS.length < 4) {
    console.log("(missing directories are skipped, not failed — see SCAN_DIRS above)");
  }
  if (unique.length === 0) {
    console.log("all references resolve");
  } else {
    console.log(`\n${unique.length} unresolved reference(s):\n`);
    for (const b of unique) {
      console.log(`  ${b.ref}`);
      console.log(`    ${b.why}`);
      for (const s of b.sites) console.log(`    called from ${s}`);
      console.log("");
    }
  }

  if (uniqueMismatches.length === 0) {
    console.log("all references use the right visibility and executor");
  } else {
    console.log(
      `\n${uniqueMismatches.length} visibility/executor mismatch(es) — these resolve to a real`,
    );
    console.log("export but still fail at runtime:\n");
    for (const m of uniqueMismatches) {
      console.log(`  ${m.ref}`);
      console.log(`    ${m.why}`);
      for (const s of m.sites) console.log(`    called from ${s}`);
      console.log("");
    }
  }
}

process.exit(unique.length === 0 && uniqueMismatches.length === 0 ? 0 : 1);
