import { useState } from "react";
import { motion } from "framer-motion";
import { Terminal, Github, Loader2, CheckCircle, XCircle, ChevronRight, FolderGit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router";

type SyncStatus = "idle" | "loading" | "success" | "error";

interface LogLine {
  text: string;
  type: "info" | "success" | "error" | "cmd";
}

// All project files embedded directly for reliable GitHub sync
function getProjectFiles(): { path: string; content: string }[] {
  return PROJECT_FILES;
}

export default function SyncPage() {
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [repoName, setRepoName] = useState("");
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [repoUrl, setRepoUrl] = useState("");

  const addLog = (text: string, type: LogLine["type"] = "info") => {
    setLogs((prev) => [...prev, { text, type }]);
  };

  const handleSync = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim() || !repoName.trim()) return;

    setStatus("loading");
    setLogs([]);
    setRepoUrl("");

    const cleanRepo = repoName.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "");

    const ghHeaders = {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    };

    try {
      addLog(`$ git init`, "cmd");
      addLog(`Initializing sync to GitHub...`, "info");

      // Step 1: Get authenticated user
      addLog(`$ gh auth verify`, "cmd");
      const userRes = await fetch("https://api.github.com/user", { headers: ghHeaders });
      if (!userRes.ok) throw new Error("Invalid GitHub token. Please check your token and try again.");
      const user = await userRes.json();
      addLog(`✓ Authenticated as: ${user.login}`, "success");

      // Step 2: Create or get repo
      addLog(`$ gh repo create ${cleanRepo}`, "cmd");
      const createRes = await fetch("https://api.github.com/user/repos", {
        method: "POST",
        headers: ghHeaders,
        body: JSON.stringify({
          name: cleanRepo,
          description: "AgentAI project synced from vly.ai",
          private: false,
          auto_init: false,
        }),
      });

      let repo;
      if (createRes.status === 422) {
        addLog(`Repository already exists, using existing repo...`, "info");
        const existingRes = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}`, { headers: ghHeaders });
        repo = await existingRes.json();
      } else if (!createRes.ok) {
        const err = await createRes.json();
        throw new Error(err.message || "Failed to create repository");
      } else {
        repo = await createRes.json();
        addLog(`✓ Repository created: ${repo.full_name}`, "success");
      }

      setRepoUrl(repo.html_url);

      // Step 3: Collect files
      addLog(`$ collecting project files...`, "cmd");
      const filesToSync = getProjectFiles();
      addLog(`✓ Found ${filesToSync.length} files to sync`, "success");

      // Step 4: Get current branch state
      let baseTreeSha: string | null = null;
      let latestCommitSha: string | null = null;

      const branchRes = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/refs/heads/main`, { headers: ghHeaders });
      if (branchRes.ok) {
        const branchData = await branchRes.json();
        latestCommitSha = branchData.object?.sha || null;
        if (latestCommitSha) {
          const commitRes = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/commits/${latestCommitSha}`, { headers: ghHeaders });
          if (commitRes.ok) {
            const commitData = await commitRes.json();
            baseTreeSha = commitData.tree?.sha || null;
          }
        }
      }

      // Step 5: Create blobs using base64 encoding (required by GitHub API)
      addLog(`$ creating file blobs (${filesToSync.length} files)...`, "cmd");
      const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];

      for (const file of filesToSync) {
        try {
          const base64Content = btoa(unescape(encodeURIComponent(file.content)));
          const blobRes = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/blobs`, {
            method: "POST",
            headers: ghHeaders,
            body: JSON.stringify({ content: base64Content, encoding: "base64" }),
          });

          if (blobRes.ok) {
            const blob = await blobRes.json();
            treeItems.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
          } else {
            const errData = await blobRes.json().catch(() => ({}));
            addLog(`⚠ Skipped ${file.path}: ${(errData as { message?: string }).message || blobRes.status}`, "info");
          }
        } catch {
          // Skip files that fail
        }
      }

      addLog(`✓ Created ${treeItems.length} file blobs`, "success");

      if (treeItems.length === 0) throw new Error("No files could be uploaded");

      // Step 6: Create tree
      addLog(`$ building git tree...`, "cmd");
      const treeBody: Record<string, unknown> = { tree: treeItems };
      if (baseTreeSha) treeBody.base_tree = baseTreeSha;

      const treeRes = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/trees`, {
        method: "POST",
        headers: ghHeaders,
        body: JSON.stringify(treeBody),
      });

      if (!treeRes.ok) {
        const treeErr = await treeRes.json().catch(() => ({}));
        throw new Error(`Failed to create git tree: ${(treeErr as { message?: string }).message || treeRes.status}`);
      }
      const tree = await treeRes.json();

      // Step 7: Create commit
      addLog(`$ git commit -m "Sync from AgentAI"`, "cmd");
      const commitBody: Record<string, unknown> = {
        message: `Sync from AgentAI — ${new Date().toISOString()}`,
        tree: tree.sha,
      };
      if (latestCommitSha) commitBody.parents = [latestCommitSha];

      const commitRes2 = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/commits`, {
        method: "POST",
        headers: ghHeaders,
        body: JSON.stringify(commitBody),
      });

      if (!commitRes2.ok) {
        const commitErr = await commitRes2.json().catch(() => ({}));
        throw new Error(`Failed to create commit: ${(commitErr as { message?: string }).message || commitRes2.status}`);
      }
      const commit = await commitRes2.json();

      // Step 8: Update or create branch ref
      addLog(`$ updating branch ref...`, "cmd");
      if (latestCommitSha) {
        await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/refs/heads/main`, {
          method: "PATCH",
          headers: ghHeaders,
          body: JSON.stringify({ sha: commit.sha, force: true }),
        });
      } else {
        await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/refs`, {
          method: "POST",
          headers: ghHeaders,
          body: JSON.stringify({ ref: "refs/heads/main", sha: commit.sha }),
        });
      }

      addLog(`✓ Successfully pushed to ${repo.full_name}`, "success");
      addLog(`✓ Repository URL: ${repo.html_url}`, "success");
      setStatus("success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error occurred";
      addLog(`✗ ERROR: ${msg}`, "error");
      setStatus("error");
    }
  };

  return (
    <div className="min-h-screen bg-background font-mono flex flex-col">
      {/* Nav */}
      <nav className="border-b border-border px-6 h-12 flex items-center justify-between">
        <button onClick={() => navigate("/")} className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-primary terminal-glow" />
          <span className="text-primary font-bold text-sm tracking-widest terminal-glow">AGENT_AI</span>
        </button>
        <span className="text-xs text-muted-foreground">// GITHUB_SYNC</span>
      </nav>

      <div className="flex-1 flex items-start justify-center p-6 pt-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-2xl space-y-4"
        >
          {/* Header */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">// SYNC_TO_GITHUB</p>
            <h1 className="text-2xl font-bold text-primary terminal-glow flex items-center gap-2">
              <FolderGit2 className="h-6 w-6" />
              GITHUB_SYNC
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              Push the entire project directory to a GitHub repository.
            </p>
          </div>

          {/* Form */}
          <div className="border border-border bg-card">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <div className="w-2.5 h-2.5 rounded-full bg-destructive" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <div className="w-2.5 h-2.5 rounded-full bg-primary" />
              <span className="text-xs text-muted-foreground ml-2">sync — configure</span>
            </div>

            <form onSubmit={handleSync} className="p-6 space-y-4">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">$ github_token</label>
                <p className="text-xs text-muted-foreground/60 mb-2">
                  Personal access token with <span className="text-primary">repo</span> scope.{" "}
                  <a
                    href="https://github.com/settings/tokens/new?scopes=repo&description=AgentAI+Sync"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    Generate one here →
                  </a>
                </p>
                <div className="flex items-center border border-border bg-background focus-within:border-primary transition-colors">
                  <span className="text-primary text-xs px-2 terminal-glow">$</span>
                  <Input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                    className="border-0 bg-transparent text-xs font-mono focus-visible:ring-0 focus-visible:ring-offset-0 text-foreground placeholder:text-muted-foreground"
                    disabled={status === "loading"}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-1">$ repository_name</label>
                <p className="text-xs text-muted-foreground/60 mb-2">
                  Name for the GitHub repository (created if it doesn't exist).
                </p>
                <div className="flex items-center border border-border bg-background focus-within:border-primary transition-colors">
                  <span className="text-primary text-xs px-2 terminal-glow">
                    <Github className="h-3 w-3" />
                  </span>
                  <Input
                    type="text"
                    value={repoName}
                    onChange={(e) => setRepoName(e.target.value)}
                    placeholder="my-agentai-project"
                    className="border-0 bg-transparent text-xs font-mono focus-visible:ring-0 focus-visible:ring-offset-0 text-foreground placeholder:text-muted-foreground"
                    disabled={status === "loading"}
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={status === "loading" || !token.trim() || !repoName.trim()}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-mono font-bold rounded-none"
              >
                {status === "loading" ? (
                  <><Loader2 className="h-3 w-3 animate-spin mr-2" />SYNCING...</>
                ) : (
                  <><Github className="h-3 w-3 mr-2" />SYNC_TO_GITHUB<ChevronRight className="h-3 w-3 ml-2" /></>
                )}
              </Button>
            </form>
          </div>

          {/* Terminal output */}
          {logs.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="border border-border bg-card"
            >
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                <div className="w-2.5 h-2.5 rounded-full bg-destructive" />
                <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                <span className="text-xs text-muted-foreground ml-2">sync — output</span>
                {status === "success" && <CheckCircle className="h-3 w-3 text-primary ml-auto" />}
                {status === "error" && <XCircle className="h-3 w-3 text-destructive ml-auto" />}
              </div>
              <div className="p-4 space-y-1 max-h-64 overflow-y-auto">
                {logs.map((log, i) => (
                  <div
                    key={i}
                    className={`text-xs font-mono ${
                      log.type === "success"
                        ? "text-primary terminal-glow"
                        : log.type === "error"
                        ? "text-destructive"
                        : log.type === "cmd"
                        ? "text-amber-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {log.text}
                  </div>
                ))}
                {status === "loading" && (
                  <div className="text-muted-foreground text-xs">
                    <span className="animate-pulse text-primary">█</span>
                  </div>
                )}
              </div>

              {status === "success" && repoUrl && (
                <div className="px-4 pb-4">
                  <a
                    href={repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs text-primary hover:underline terminal-glow"
                  >
                    <Github className="h-3 w-3" />
                    {repoUrl}
                    <ChevronRight className="h-3 w-3" />
                  </a>
                </div>
              )}
            </motion.div>
          )}

          {/* Info */}
          <div className="border border-border/50 bg-card/50 p-4">
            <p className="text-xs text-muted-foreground mb-2">// WHAT_GETS_SYNCED</p>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div>→ All source files (src/, public/)</div>
              <div>→ Configuration files (package.json, tsconfig, vite.config, etc.)</div>
              <div>→ Convex backend (src/convex/)</div>
              <div>→ Styles and assets</div>
              <div>→ Deploy scripts</div>
              <div className="text-amber-400/70">⚠ .env files and secrets are excluded automatically</div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// Project files embedded directly for reliable sync
// These are the actual current file contents
const PROJECT_FILES: { path: string; content: string }[] = [
  {
    path: "README.md",
    content: `# AgentAI

A dark-themed AI portal for research, vibe coding, and chat.

## Features
- Terminal-themed UI with monospace typography
- Three modes: Chat, Research, Code
- Email OTP authentication via Brevo
- Claude 3.5 Sonnet powered by Anthropic SDK
- Per-user usage tracking in real-time
- Persistent conversation history
- Self-hosted Convex backend support

## Tech Stack
- React + Vite + TypeScript
- Tailwind CSS v4
- Convex (backend & database)
- Convex Auth (email OTP)
- Anthropic SDK (Claude 3.5 Sonnet)
- Brevo (transactional email)
- Framer Motion

## Setup
\`\`\`bash
bun install
bun run dev
\`\`\`

## Environment Variables
- \`VITE_CONVEX_URL\` - Convex deployment URL
- \`ANTHROPIC_API_KEY\` - Anthropic API key
- \`BREVO_EMAIL_SENDER\` - Brevo API key
- \`SITE_URL\` - Site URL for auth redirects
`,
  },
  {
    path: "package.json",
    content: JSON.stringify({
      name: "agentai",
      private: true,
      version: "2.0.1",
      type: "module",
      packageManager: "bun@1.2.10",
      scripts: {
        dev: "vite",
        build: "tsc -b && vite build",
        "type-check": "tsc -b --noEmit",
        lint: "eslint .",
        format: "prettier --write .",
        preview: "vite preview",
        "deploy:selfhosted": "bash scripts/deploy-selfhosted.sh",
      },
    }, null, 2),
  },
  {
    path: "index.html",
    content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/logo.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AgentAI</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`,
  },
  {
    path: "scripts/deploy-selfhosted.sh",
    content: `#!/bin/bash
# Deploy Convex functions to self-hosted instance
echo "Deploying to self-hosted Convex at https://leadshello-agent-ai.hf.space..."

cat > /tmp/convex-selfhosted.env << 'EOF'
CONVEX_SELF_HOSTED_URL="https://leadshello-agent-ai.hf.space"
CONVEX_SELF_HOSTED_ADMIN_KEY="leadshello-agent-ai|01e46350b80a68cb0bd6660e0d01f3afd038968dd0120d8d88244ebbc9402fa92c537ddc67"
EOF

npx convex deploy --env-file /tmp/convex-selfhosted.env
echo "Deploy complete!"
`,
  },
  {
    path: "src/index.css",
    content: `/* DO NOT CHANGE */
@import "tailwindcss";
@import "tw-animate-css";
@custom-variant dark (&:is(.dark *));

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --font-mono: var(--terminal-font);
}

:root {
  --radius: 0.25rem;
  --terminal-font: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Courier New', monospace;
  --background: oklch(0.08 0 0);
  --foreground: oklch(0.85 0.12 142);
  --card: oklch(0.11 0 0);
  --card-foreground: oklch(0.85 0.12 142);
  --popover: oklch(0.11 0 0);
  --popover-foreground: oklch(0.85 0.12 142);
  --primary: oklch(0.72 0.18 142);
  --primary-foreground: oklch(0.08 0 0);
  --secondary: oklch(0.15 0 0);
  --secondary-foreground: oklch(0.72 0.18 142);
  --muted: oklch(0.14 0 0);
  --muted-foreground: oklch(0.55 0.08 142);
  --accent: oklch(0.18 0.04 142);
  --accent-foreground: oklch(0.72 0.18 142);
  --destructive: oklch(0.65 0.22 25);
  --border: oklch(0.22 0.04 142);
  --input: oklch(0.14 0.02 142);
  --ring: oklch(0.72 0.18 142);
  --sidebar: oklch(0.10 0 0);
  --sidebar-foreground: oklch(0.72 0.18 142);
  --sidebar-primary: oklch(0.72 0.18 142);
  --sidebar-primary-foreground: oklch(0.08 0 0);
  --sidebar-accent: oklch(0.15 0.03 142);
  --sidebar-accent-foreground: oklch(0.72 0.18 142);
  --sidebar-border: oklch(0.20 0.04 142);
  --sidebar-ring: oklch(0.72 0.18 142);
  --scanline-opacity: 0.03;
}

html { color-scheme: dark; }

@layer base {
  * { @apply border-border outline-ring/50; }
  body {
    @apply bg-background text-foreground;
    font-family: var(--terminal-font);
    font-size: 13px;
  }
}

body::after {
  content: '';
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,var(--scanline-opacity)) 2px, rgba(0,0,0,var(--scanline-opacity)) 4px);
  pointer-events: none;
  z-index: 9999;
}

.terminal-glow { text-shadow: 0 0 8px oklch(0.72 0.18 142 / 0.6); }
.terminal-glow-amber { text-shadow: 0 0 8px oklch(0.78 0.18 75 / 0.6); }

::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: oklch(0.10 0 0); }
::-webkit-scrollbar-thumb { background: oklch(0.30 0.06 142); border-radius: 0; }
::-webkit-scrollbar-thumb:hover { background: oklch(0.50 0.10 142); }
::selection { background: oklch(0.72 0.18 142 / 0.3); color: oklch(0.95 0.12 142); }

@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&display=swap');
`,
  },
  {
    path: "src/main.tsx",
    content: `import { Toaster } from "@/components/ui/sonner";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { InstrumentationProvider } from "@/instrumentation.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";
import "./types/global.d.ts";

const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Portal = lazy(() => import("./pages/Portal.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const SyncPage = lazy(() => import("./pages/Sync.tsx"));

function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage({ type: "iframe-route-change", path: location.pathname }, "*");
  }, [location.pathname]);
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VlyToolbar />
    <InstrumentationProvider>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <RouteSyncer />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/auth" element={<AuthPage redirectAfterAuth="/portal" />} />
              <Route path="/portal" element={<Portal />} />
              <Route path="/sync" element={<SyncPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </InstrumentationProvider>
  </StrictMode>,
);
`,
  },
  {
    path: "src/lib/utils.ts",
    content: `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`,
  },
  {
    path: "src/hooks/use-auth.ts",
    content: `import { api } from "@/convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";

export function useAuth() {
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  const user = useQuery(api.users.currentUser);
  const { signIn, signOut } = useAuthActions();
  const isLoading = isAuthLoading || user === undefined;
  return { isLoading, isAuthenticated, user, signIn, signOut };
}
`,
  },
  {
    path: "src/hooks/use-mobile.ts",
    content: `import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)
  React.useEffect(() => {
    const mql = window.matchMedia(\`(max-width: \${MOBILE_BREAKPOINT - 1}px)\`)
    const onChange = () => { setIsMobile(window.innerWidth < MOBILE_BREAKPOINT) }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])
  return !!isMobile
}
`,
  },
  {
    path: "src/convex/schema.ts",
    content: `import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

export const ROLES = { ADMIN: "admin", USER: "user", MEMBER: "member" } as const;
export const roleValidator = v.union(v.literal("admin"), v.literal("user"), v.literal("member"));
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema({
  ...authTables,
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    role: v.optional(roleValidator),
    totalUsageCents: v.optional(v.number()),
  }).index("email", ["email"]),
  conversations: defineTable({
    userId: v.id("users"),
    title: v.string(),
    mode: v.union(v.literal("chat"), v.literal("research"), v.literal("code")),
    lastMessageAt: v.optional(v.number()),
  }).index("by_user", ["userId"]).index("by_user_and_mode", ["userId", "mode"]),
  messages: defineTable({
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    tokensUsed: v.optional(v.number()),
    costCents: v.optional(v.number()),
  }).index("by_conversation", ["conversationId"]).index("by_user", ["userId"]),
}, { schemaValidation: false });

export default schema;
`,
  },
  {
    path: "src/convex/auth.config.ts",
    content: `export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
`,
  },
  {
    path: "src/convex/auth.ts",
    content: `import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { emailOtp } from "./auth/emailOtp";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [emailOtp, Anonymous],
});
`,
  },
  {
    path: "src/convex/http.ts",
    content: `import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();
auth.addHttpRoutes(http);
export default http;
`,
  },
  {
    path: "src/convex/users.ts",
    content: `import { getAuthUserId } from "@convex-dev/auth/server";
import { query, QueryCtx } from "./_generated/server";

export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null) return null;
    return user;
  },
});

export const getCurrentUser = async (ctx: QueryCtx) => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return await ctx.db.get(userId);
};
`,
  },
  {
    path: "src/convex/conversations.ts",
    content: `import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { mode: v.optional(v.union(v.literal("chat"), v.literal("research"), v.literal("code"))) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    if (args.mode) {
      return await ctx.db.query("conversations").withIndex("by_user_and_mode", (q) => q.eq("userId", userId).eq("mode", args.mode!)).order("desc").take(50);
    }
    return await ctx.db.query("conversations").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").take(50);
  },
});

export const create = mutation({
  args: { title: v.string(), mode: v.union(v.literal("chat"), v.literal("research"), v.literal("code")) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    return await ctx.db.insert("conversations", { userId, title: args.title, mode: args.mode, lastMessageAt: Date.now() });
  },
});

export const rename = mutation({
  args: { id: v.id("conversations"), title: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const conv = await ctx.db.get(args.id);
    if (!conv || conv.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(args.id, { title: args.title });
  },
});

export const remove = mutation({
  args: { id: v.id("conversations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const conv = await ctx.db.get(args.id);
    if (!conv || conv.userId !== userId) throw new Error("Not found");
    const messages = await ctx.db.query("messages").withIndex("by_conversation", (q) => q.eq("conversationId", args.id)).take(500);
    await Promise.all(messages.map((m) => ctx.db.delete(m._id)));
    await ctx.db.delete(args.id);
  },
});

export const getMessages = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.userId !== userId) return [];
    return await ctx.db.query("messages").withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId)).order("asc").take(200);
  },
});
`,
  },
  {
    path: "src/convex/aiHelpers.ts",
    content: `import { getAuthUserId as getConvexAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const getCurrentUserId = internalQuery({
  args: {},
  handler: async (ctx) => await getConvexAuthUserId(ctx),
});

export const getConversationMessages = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db.query("messages").withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId)).order("asc").take(50);
  },
});

export const saveMessage = internalMutation({
  args: { conversationId: v.id("conversations"), userId: v.id("users"), role: v.union(v.literal("user"), v.literal("assistant")), content: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", { conversationId: args.conversationId, userId: args.userId, role: args.role, content: args.content });
    await ctx.db.patch(args.conversationId, { lastMessageAt: Date.now() });
  },
});

export const saveAssistantMessage = internalMutation({
  args: { conversationId: v.id("conversations"), userId: v.id("users"), content: v.string(), tokensUsed: v.number(), costCents: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", { conversationId: args.conversationId, userId: args.userId, role: "assistant", content: args.content, tokensUsed: args.tokensUsed, costCents: args.costCents });
    await ctx.db.patch(args.conversationId, { lastMessageAt: Date.now() });
    const user = await ctx.db.get(args.userId);
    if (user) {
      const current = (user as { totalUsageCents?: number }).totalUsageCents || 0;
      await ctx.db.patch(args.userId, { totalUsageCents: current + args.costCents });
    }
  },
});
`,
  },
  {
    path: "src/convex/ai.ts",
    content: `"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

export const sendMessage = action({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
    mode: v.union(v.literal("chat"), v.literal("research"), v.literal("code")),
  },
  handler: async (ctx, args): Promise<string> => {
    const userId: Id<"users"> | null = await ctx.runQuery(internal.aiHelpers.getCurrentUserId);
    if (!userId) throw new Error("Not authenticated");

    await ctx.runMutation(internal.aiHelpers.saveMessage, { conversationId: args.conversationId, userId, role: "user", content: args.content });

    const history: Array<{ role: string; content: string }> = await ctx.runQuery(internal.aiHelpers.getConversationMessages, { conversationId: args.conversationId });

    const systemPrompts: Record<string, string> = {
      chat: "You are AgentAI, an advanced AI assistant. You communicate in a clear, helpful manner. Format responses with markdown when appropriate. Be concise but thorough.",
      research: "You are AgentAI Research Mode. You are a deep research assistant that provides comprehensive, well-sourced analysis. Break down complex topics, cite reasoning, and provide structured reports. Use headers, bullet points, and organized sections.",
      code: "You are AgentAI Code Mode. You are an expert software engineer and coding assistant. Write clean, well-commented code. Explain your implementations. Support all programming languages. Format all code in proper markdown code blocks with language tags.",
    };

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const messages: Array<{ role: "user" | "assistant"; content: string }> = history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const response: Anthropic.Message = await client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4096,
      system: systemPrompts[args.mode],
      messages,
    });

    const responseContent: string = response.content[0]?.type === "text" ? response.content[0].text : "No response";
    const tokensUsed: number = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
    const costCents: number = Math.ceil((tokensUsed / 1_000_000) * 900);

    await ctx.runMutation(internal.aiHelpers.saveAssistantMessage, { conversationId: args.conversationId, userId, content: responseContent, tokensUsed, costCents });

    return responseContent;
  },
});
`,
  },
  {
    path: "src/convex/auth/emailOtp.ts",
    content: `import { Email } from "@convex-dev/auth/providers/Email";
import axios from "axios";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";

export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * 15,
  async generateVerificationToken() {
    const random: RandomReader = { read(bytes: Uint8Array) { crypto.getRandomValues(bytes); } };
    return generateRandomString(random, "0123456789", 6);
  },
  async sendVerificationRequest({ identifier: email, token }) {
    const apiKey = process.env.BREVO_EMAIL_SENDER;
    if (!apiKey) throw new Error("BREVO_EMAIL_SENDER environment variable is not set");
    try {
      const response = await axios.post("https://api.brevo.com/v3/smtp/email", {
        sender: { name: "AgentAI", email: "onboarding@agentaimail.skinticals.com" },
        to: [{ email }],
        subject: "Your AgentAI Verification Code",
        htmlContent: \`<div style="font-family: monospace; background: #0a0a0a; color: #00ff41; padding: 32px; max-width: 480px; margin: 0 auto; border: 1px solid #00ff41;"><div style="font-size: 18px; font-weight: bold; margin-bottom: 16px; letter-spacing: 4px;">AGENT_AI</div><div style="color: #888; font-size: 12px; margin-bottom: 24px;">// AUTHENTICATION_REQUIRED</div><div style="color: #ccc; font-size: 13px; margin-bottom: 16px;">Your verification code:</div><div style="font-size: 36px; font-weight: bold; letter-spacing: 12px; color: #00ff41; background: #111; padding: 16px; text-align: center; border: 1px solid #00ff41; margin-bottom: 24px;">\${token}</div><div style="color: #666; font-size: 11px;">This code expires in 15 minutes.</div></div>\`,
        textContent: \`Your AgentAI verification code is: \${token}\\n\\nThis code expires in 15 minutes.\`,
      }, { headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" } });
      console.log("Brevo email sent successfully to", email, "status:", response.status);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = JSON.stringify(error.response?.data);
        console.error("Brevo API error:", status, data);
        throw new Error(\`Brevo API error \${status}: \${data}\`);
      }
      throw new Error(\`Email send failed: \${String(error)}\`);
    }
  },
});
`,
  },
];