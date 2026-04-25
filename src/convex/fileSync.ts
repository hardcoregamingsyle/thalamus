"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";
import * as fs from "fs";
import * as path from "path";

const EXCLUDE_PATTERNS = [
  "node_modules", ".git", "dist", ".env", ".env.local", ".env.production",
  ".beads", ".convex/local", "*.sqlite3", "*.blob", "*.db", "bun.lock",
  "bun.lockb", ".DS_Store", "src/convex/_generated",
];

const BINARY_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".otf"];

function shouldExclude(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.startsWith("*")) {
      if (normalized.endsWith(pattern.slice(1))) return true;
    } else if (normalized.includes(pattern)) {
      return true;
    }
  }
  return false;
}

function isBinary(filePath: string): boolean {
  return BINARY_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

function getAllFiles(dir: string, baseDir: string): { path: string; content: string }[] {
  const results: { path: string; content: string }[] = [];
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return results; }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
    if (shouldExclude(relativePath) || shouldExclude(entry)) continue;
    let stat: fs.Stats;
    try { stat = fs.statSync(fullPath); } catch { continue; }
    if (stat.isDirectory()) {
      results.push(...getAllFiles(fullPath, baseDir));
    } else if (stat.isFile() && !isBinary(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        results.push({ path: relativePath, content });
      } catch { /* skip */ }
    }
  }
  return results;
}

// Returns a batch of files starting at offset, with batchSize files per call
export const getProjectFilesBatch = action({
  args: { offset: v.number(), batchSize: v.number() },
  handler: async (_ctx, args): Promise<{ files: { path: string; content: string }[]; total: number; done: boolean }> => {
    const projectRoot = path.resolve(process.cwd());
    const allFiles = getAllFiles(projectRoot, projectRoot);
    const batch = allFiles.slice(args.offset, args.offset + args.batchSize);
    return {
      files: batch,
      total: allFiles.length,
      done: args.offset + args.batchSize >= allFiles.length,
    };
  },
});