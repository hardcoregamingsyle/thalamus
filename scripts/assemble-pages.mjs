#!/usr/bin/env node
// Assembles the Cloudflare Pages deploy directory at the repo root: deletes
// any previous ./dist, copies the web app's static export (apps/web/out,
// from `next build` with output: "export") into it, and writes the
// project's security/cache headers. Run after the web app has been built —
// see the root "build" script.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDir = join(rootDir, "apps", "web", "out");
const distDir = join(rootDir, "dist");

if (!existsSync(sourceDir)) {
  console.error(`Not found: ${sourceDir} — build apps/web (next build) first.`);
  process.exit(1);
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
cpSync(sourceDir, distDir, { recursive: true });

const headersFile = `# Long-cache immutable hashed assets first — most specific match wins.
/_next/static/*
  Cache-Control: public, max-age=31536000, immutable

/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
`;

writeFileSync(join(distDir, "_headers"), headersFile);

console.log(`Assembled ${distDir} from ${sourceDir}`);
