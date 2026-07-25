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
// this deployment by string. Optional, because CI clones only this repo.
const AO_DIR = resolve(ROOT, "..", "agentoverflow");

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
const DOTTED_RE = /(?<![/\w.])(?:api|internal)\.((?:[A-Za-z0-9_]+\.)+[A-Za-z0-9_]+)/g;
for (const file of walk(join(ROOT, "src"), [".ts", ".tsx"])) {
  if (file.includes(`${sep}_generated${sep}`)) continue;
  const rel = relative(ROOT, file);
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(DOTTED_RE)) {
    const parts = m[1].split(".");
    let matched = null;
    for (let i = parts.length - 1; i >= 1; i--) {
      const mod = parts.slice(0, i).join("/");
      if (moduleNames.has(mod)) {
        matched = `${mod}:${parts.slice(i).join(".")}`;
        break;
      }
    }
    add(matched ?? `${parts.slice(0, -1).join("/")}:${parts[parts.length - 1]}`, rel, "typed");
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

// 2c. makeFunctionReference("module:function") in the AgentOverflow repo.
const MFR_RE = /makeFunctionReference\s*<[\s\S]*?>\s*\(\s*"([^"]+)"\s*\)|makeFunctionReference\s*\(\s*"([^"]+)"\s*\)/g;
if (existsSync(AO_DIR)) {
  for (const file of walk(AO_DIR, [".ts", ".tsx"])) {
    const rel = `../agentoverflow/${relative(AO_DIR, file).split(sep).join("/")}`;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(MFR_RE)) add(m[1] ?? m[2], rel, "agentoverflow");
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
  console.log(JSON.stringify({ defined: defined.size, refs: refs.length, broken: unique }, null, 2));
} else {
  console.log(`convex refs: ${defined.size} functions defined, ${refs.length} references checked`);
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
}

process.exit(unique.length === 0 ? 0 : 1);
