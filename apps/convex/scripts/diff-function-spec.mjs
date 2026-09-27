// Prints which Convex functions and HTTP routes a deploy added or removed, given the
// `convex function-spec` output from before and after it.
import { readFileSync } from "node:fs";

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error("usage: node diff-function-spec.mjs <before.json> <after.json>");
  process.exit(2);
}

function names(path) {
  const spec = JSON.parse(readFileSync(path, "utf8"));
  const out = new Set();
  for (const fn of spec.functions ?? []) {
    if (fn.functionType === "HttpAction") out.add(`http ${fn.method} ${fn.path}`);
    else out.add(`${fn.visibility?.kind ?? "?"} ${fn.functionType} ${fn.identifier}`);
  }
  return out;
}

const before = names(beforePath);
const after = names(afterPath);
const removed = [...before].filter((n) => !after.has(n)).sort();
const added = [...after].filter((n) => !before.has(n)).sort();

console.log(`before: ${before.size}  after: ${after.size}`);
console.log(`removed (${removed.length}):`);
for (const n of removed) console.log(`  - ${n}`);
console.log(`added (${added.length}):`);
for (const n of added) console.log(`  + ${n}`);
