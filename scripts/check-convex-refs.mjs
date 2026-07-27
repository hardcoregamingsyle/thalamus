#!/usr/bin/env node
// Verify every Convex function reference resolves to a real export.
//
// Why this exists: the generated `api`/`internal` objects in this repo hit the
// TypeScript instantiation-depth cliff (TS2589) and quietly degrade to `any`,
// so `tsc` will happily accept `api.admin.functionThatDoesNotExist`. On top of
// that, three separate callers reach Convex by plain string — the shipped WPF
// .exe, the AgentOverflow repo via makeFunctionReference, and crons — where
// there was never any type to lose in the first place. A rename that looks
// clean therefore breaks production silently. This script is the only thing
// standing between a refactor and that outage.
//
// Usage: node scripts/check-convex-refs.mjs [--json]
// Exits 1 if any reference is unresolved.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CONVEX_DIR = join(ROOT, "src", "convex");
// The sibling AgentOverflow checkout holds no backend of its own — it calls
// this deployment by string. Defaults to the sibling directory used locally;
// AGENTOVERFLOW_DIR overrides it, because GitHub Actions can only check a repo
// out underneath the workspace, never as a sibling.
const AO_DIR = process.env.AGENTOVERFLOW_DIR
  ? resolve(process.env.AGENTOVERFLOW_DIR)
  : resolve(ROOT, "..", "agentoverflow");

const JSON_OUT = process.argv.includes("--json");

function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist" || entry === "_generated") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

// ── 1. Build the set of functions that actually exist ────────────────────────
// Convex addresses a function as "path/to/module:exportName", where the path is
// relative to src/convex and drops the .ts.
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

// 2a. api.<module>.<fn> / internal.<module>.<fn> in TS/TSX across this repo.
// Nested modules read as api.dir.file.fn, so try the longest path that matches
// a known module before falling back to the two-segment form.
// The lookbehind matters: without it, every "https://api.github.com" URL in the
// repo reads as a reference to a module called `github`.
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

for (const file of walk(join(ROOT, "src"), [".ts", ".tsx"])) {
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
// Several convex modules are @ts-nocheck'd for TS2589, so tsc sees neither.
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
for (const file of walk(join(ROOT, "src"), [".ts", ".tsx"])) {
  if (file.includes(`${sep}_generated${sep}`)) continue;
  const rel = relative(ROOT, file);
  const src = readFileSync(file, "utf8");
  for (const re of [INVOKE_RE, SCHEDULE_RE]) {
    for (const m of src.matchAll(re)) {
      invocations.push({ ref: resolveDotted(m[3]), where: rel, root: m[2], via: m[1] });
    }
  }
}

// 2b. "module:function" string literals in the shipped desktop app.
// These are the highest-stakes refs in the repo: builds already installed on
// user machines call these names, so they are a public API, not an internal one.
const STRING_RE = /"([a-zA-Z][a-zA-Z0-9_/]*:[a-zA-Z][a-zA-Z0-9_]*)"/g;
for (const file of walk(join(ROOT, "thalamus-native"), [".cs"])) {
  const rel = relative(ROOT, file);
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(STRING_RE)) add(m[1], rel, "desktop-string");
}

// 2c. makeFunctionReference("module:function") — in the AgentOverflow repo AND
// in this one. Both reach Convex by string, so both need checking.
const MFR_RE = /makeFunctionReference\s*<[\s\S]*?>\s*\(\s*"([^"]+)"\s*\)|makeFunctionReference\s*\(\s*"([^"]+)"\s*\)/g;
for (const file of walk(join(ROOT, "src"), [".ts", ".tsx"])) {
  if (file.includes(`${sep}_generated${sep}`)) continue;
  const rel = relative(ROOT, file);
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(MFR_RE)) add(m[1] ?? m[2], rel, "in-repo-string");
}

const aoPresent = existsSync(AO_DIR);
let aoRefCount = 0;
if (aoPresent) {
  for (const file of walk(AO_DIR, [".ts", ".tsx"])) {
    const rel = `../agentoverflow/${relative(AO_DIR, file).split(sep).join("/")}`;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(MFR_RE)) { add(m[1] ?? m[2], rel, "agentoverflow"); aoRefCount++; }
  }
}

// ── 3. Report ────────────────────────────────────────────────────────────────
// A ref to a module we do not have is only interesting if the module exists —
// otherwise it is a string that merely looks like a function path (a URL scheme,
// a label, a time value). Requiring a known module keeps the false positives out.
const broken = [];
for (const r of refs) {
  if (defined.has(r.ref)) continue;
  const mod = r.ref.split(":")[0];
  if (!moduleNames.has(mod)) {
    if (r.style === "typed") broken.push({ ...r, why: `no such convex module "${mod}"` });
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
      why: `declared ${def.kind} but referenced through \`${r.root}.\` — `
        + `use \`${wantInternal ? "internal" : "api"}\` only for ${wantInternal ? "internal*" : "public"} functions`,
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
// verdict — a function can still be reached through an httpAction route, a cron,
// or a caller outside both repos. Opt in with --unused; it never fails the build.
if (process.argv.includes("--unused")) {
  const mentioned = new Set();
  const sources = [
    ...walk(join(ROOT, "src"), [".ts", ".tsx"]),
    ...walk(join(ROOT, "thalamus-native"), [".cs"]),
    ...walk(join(ROOT, "scripts"), [".ts", ".mjs", ".sh"]),
    ...(existsSync(AO_DIR) ? walk(AO_DIR, [".ts", ".tsx", ".py"]) : []),
  ];
  const blobs = sources
    .filter((f) => !f.includes(`${sep}_generated${sep}`))
    .map((f) => ({ file: f, text: readFileSync(f, "utf8") }));
  for (const [ref] of defined) {
    const fn = ref.split(":")[1];
    const mod = ref.split(":")[0];
    const defFile = join(CONVEX_DIR, `${mod}.ts`);
    const re = new RegExp(`\\b${fn}\\b`);
    for (const b of blobs) {
      if (b.file === defFile) {
        // Inside its own module, ignore the export statement itself.
        const others = b.text.split("\n").filter((l) => !l.includes(`export const ${fn} `));
        if (others.some((l) => re.test(l))) { mentioned.add(ref); break; }
        continue;
      }
      if (re.test(b.text)) { mentioned.add(ref); break; }
    }
  }
  const orphans = [...defined.keys()].filter((r) => !mentioned.has(r)).sort();
  console.log(`\npossibly-unused exports (${orphans.length} of ${defined.size}) — verify before deleting:`);
  for (const o of orphans) console.log(`  ${o}  [${defined.get(o).kind}]`);
}

if (JSON_OUT) {
  console.log(JSON.stringify({
    defined: defined.size, refs: refs.length, broken: unique, mismatches: uniqueMismatches,
  }, null, 2));
} else {
  console.log(`convex refs: ${defined.size} functions defined, ${refs.length} references checked`
    + ` (${invocations.length} invocations kind-checked)`);
  if (aoPresent) {
    console.log(`agentoverflow: ${aoRefCount} cross-repo references checked`);
  } else {
    // Never let a missing sibling checkout read as a pass. AgentOverflow reaches
    // this backend by string with no codegen, so those are precisely the names
    // that break silently at runtime — the ones worth checking most.
    console.log("");
    console.log("WARNING: ../agentoverflow is not checked out, so ZERO cross-repo");
    console.log("references were verified. A rename that breaks the AgentOverflow site");
    console.log("would pass this run. Clone it next to this repo for a complete check.");
    console.log("");
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
    console.log(`\n${uniqueMismatches.length} visibility/executor mismatch(es) — these resolve to a real`);
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
