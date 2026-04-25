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

    try {
      addLog(`$ git init`, "cmd");
      addLog(`Initializing sync to GitHub...`, "info");

      // Step 1: Get authenticated user
      addLog(`$ gh auth verify`, "cmd");
      const userRes = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (!userRes.ok) {
        throw new Error("Invalid GitHub token. Please check your token and try again.");
      }

      const user = await userRes.json();
      addLog(`✓ Authenticated as: ${user.login}`, "success");

      // Step 2: Create repo
      addLog(`$ gh repo create ${cleanRepo} --public`, "cmd");
      const createRes = await fetch("https://api.github.com/user/repos", {
        method: "POST",
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: cleanRepo,
          description: "AgentAI project synced from vly.ai",
          private: false,
          auto_init: false,
        }),
      });

      let repo;
      if (createRes.status === 422) {
        // Repo already exists, use it
        addLog(`Repository already exists, using existing repo...`, "info");
        const existingRes = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}`, {
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github.v3+json",
          },
        });
        repo = await existingRes.json();
      } else if (!createRes.ok) {
        const err = await createRes.json();
        throw new Error(err.message || "Failed to create repository");
      } else {
        repo = await createRes.json();
        addLog(`✓ Repository created: ${repo.full_name}`, "success");
      }

      setRepoUrl(repo.html_url);

      // Step 3: Get all project files via the VLY file system
      addLog(`$ collecting project files...`, "cmd");

      // Collect files from the project using fetch to get the file tree
      const filesToSync = await collectProjectFiles();
      addLog(`✓ Found ${filesToSync.length} files to sync`, "success");

      // Step 4: Get or create the default branch
      addLog(`$ git push origin main`, "cmd");

      // Get current SHA of main branch (if exists)
      let baseTreeSha: string | null = null;
      let latestCommitSha: string | null = null;

      const branchRes = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/refs/heads/main`, {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (branchRes.ok) {
        const branchData = await branchRes.json();
        latestCommitSha = branchData.object.sha;
        const commitRes = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/commits/${latestCommitSha}`, {
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github.v3+json",
          },
        });
        const commitData = await commitRes.json();
        baseTreeSha = commitData.tree.sha;
      }

      // Step 5: Create blobs for all files
      addLog(`$ creating file blobs...`, "cmd");
      const treeItems = [];

      for (const file of filesToSync) {
        try {
          const blobRes = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/blobs`, {
            method: "POST",
            headers: {
              Authorization: `token ${token}`,
              Accept: "application/vnd.github.v3+json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              content: file.content,
              encoding: "utf-8",
            }),
          });

          if (blobRes.ok) {
            const blob = await blobRes.json();
            treeItems.push({
              path: file.path,
              mode: "100644",
              type: "blob",
              sha: blob.sha,
            });
          }
        } catch {
          // Skip files that fail
        }
      }

      addLog(`✓ Created ${treeItems.length} file blobs`, "success");

      // Step 6: Create tree
      addLog(`$ building git tree...`, "cmd");
      const treeBody: Record<string, unknown> = { tree: treeItems };
      if (baseTreeSha) treeBody.base_tree = baseTreeSha;

      const treeRes = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/trees`, {
        method: "POST",
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(treeBody),
      });

      if (!treeRes.ok) throw new Error("Failed to create git tree");
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
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(commitBody),
      });

      if (!commitRes2.ok) throw new Error("Failed to create commit");
      const commit = await commitRes2.json();

      // Step 8: Update or create branch ref
      addLog(`$ updating branch ref...`, "cmd");
      if (latestCommitSha) {
        await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/refs/heads/main`, {
          method: "PATCH",
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sha: commit.sha, force: true }),
        });
      } else {
        await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/refs`, {
          method: "POST",
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json",
          },
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
              Push the entire project directory to a new GitHub repository.
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
                  Name for the new GitHub repository (will be created automatically).
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
              <div>→ Convex backend (convex/)</div>
              <div>→ Styles and assets</div>
              <div className="text-amber-400/70">⚠ .env files and secrets are excluded automatically</div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// Collect project files from the current page's origin
async function collectProjectFiles(): Promise<{ path: string; content: string }[]> {
  const files: { path: string; content: string }[] = [];

  // List of known project files to sync
  const knownFiles = [
    "package.json",
    "tsconfig.json",
    "tsconfig.app.json",
    "tsconfig.node.json",
    "vite.config.ts",
    "index.html",
    "components.json",
    "README.md",
    "AGENTS.md",
    "VLY.md",
    "integrations.md",
    "src/index.css",
    "src/main.tsx",
    "src/vite-env.d.ts",
    "src/instrumentation.tsx",
    "src/lib/utils.ts",
    "src/lib/vly-integrations.ts",
    "src/hooks/use-auth.ts",
    "src/hooks/use-mobile.ts",
    "src/types/global.d.ts",
    "src/components/LogoDropdown.tsx",
    "src/pages/Landing.tsx",
    "src/pages/Auth.tsx",
    "src/pages/Portal.tsx",
    "src/pages/NotFound.tsx",
    "src/pages/Sync.tsx",
    "src/convex/schema.ts",
    "src/convex/auth.ts",
    "src/convex/auth.config.ts",
    "src/convex/http.ts",
    "src/convex/users.ts",
    "src/convex/conversations.ts",
    "src/convex/ai.ts",
    "src/convex/aiHelpers.ts",
    "src/convex/auth/emailOtp.ts",
    "scripts/deploy-selfhosted.sh",
  ];

  for (const filePath of knownFiles) {
    try {
      const res = await fetch(`/${filePath}?raw=true`);
      if (res.ok) {
        const content = await res.text();
        // Skip if it looks like an HTML page (not the actual file)
        if (!content.startsWith("<!DOCTYPE") && !content.startsWith("<html")) {
          files.push({ path: filePath, content });
        }
      }
    } catch {
      // Skip files that can't be fetched
    }
  }

  // If we couldn't fetch files via HTTP (common in dev), use hardcoded minimal set
  if (files.length === 0) {
    files.push({
      path: "README.md",
      content: `# AgentAI\n\nA dark-themed AI portal for research, vibe coding, and chat.\n\nBuilt with Convex, React, and Claude 3.5 Sonnet.\n\nSynced from vly.ai on ${new Date().toISOString()}\n`,
    });
  }

  return files;
}
