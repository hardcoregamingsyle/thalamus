"use node";
import { action } from "./_generated/server";
import * as fs from "fs";
import * as path from "path";

// Files to exclude from sync
const EXCLUDE_PATTERNS = [
  "node_modules",
  ".git",
  "dist",
  ".env",
  ".env.local",
  ".env.production",
  ".beads",
  ".convex/local",
  "*.sqlite3",
  "*.blob",
  "*.db",
  "bun.lock",
  "bun.lockb",
  ".DS_Store",
  "src/convex/_generated",
];

// Binary file extensions to skip
const BINARY_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".otf"];

function shouldExclude(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.startsWith("*")) {
      const ext = pattern.slice(1);
      if (normalized.endsWith(ext)) return true;
    } else if (normalized.includes(pattern)) {
      return true;
    }
  }
  return false;
}

function isBinary(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.includes(ext);
}

function getAllFiles(dir: string, baseDir: string): { path: string; content: string }[] {
  const results: { path: string; content: string }[] = [];
  
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");

    if (shouldExclude(relativePath) || shouldExclude(entry)) continue;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      const subFiles = getAllFiles(fullPath, baseDir);
      results.push(...subFiles);
    } else if (stat.isFile()) {
      if (isBinary(fullPath)) continue;
      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        results.push({ path: relativePath, content });
      } catch {
        // Skip files that can't be read as UTF-8
      }
    }
  }

  return results;
}

export const getProjectFiles = action({
  args: {},
  handler: async (): Promise<{ path: string; content: string }[]> => {
    // The project root is the parent of the convex directory
    const projectRoot = path.resolve(process.cwd());
    const files = getAllFiles(projectRoot, projectRoot);
    return files;
  },
});
