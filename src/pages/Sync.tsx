import { useState } from "react";
import { motion } from "framer-motion";
import { Terminal, Github, Loader2, CheckCircle, XCircle, ChevronRight, FolderGit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";

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
  const getProjectFilesBatch = useAction(api.fileSync.getProjectFilesBatch);

  const addLog = (text: string, type: LogLine["type"] = "info") => {
    setLogs((prev) => [...prev, { text, type }]);
  };

  const fetchAllFiles = async (): Promise<{ path: string; content: string }[]> => {
    const allFiles: { path: string; content: string }[] = [];
    const BATCH_SIZE = 20;
    let offset = 0;
    let done = false;
    let total = 0;

    while (!done) {
      const result = await getProjectFilesBatch({ offset, batchSize: BATCH_SIZE });
      allFiles.push(...result.files);
      total = result.total;
      done = result.done;
      offset += BATCH_SIZE;
      addLog(`  Fetched ${Math.min(offset, total)}/${total} files...`, "info");
    }

    return allFiles;
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

      addLog(`$ gh auth verify`, "cmd");
      const userRes = await fetch("https://api.github.com/user", { headers: ghHeaders });
      if (!userRes.ok) throw new Error("Invalid GitHub token. Please check your token and try again.");
      const user = await userRes.json();
      addLog(`✓ Authenticated as: ${user.login}`, "success");

      addLog(`$ gh repo create ${cleanRepo}`, "cmd");
      const createRes = await fetch("https://api.github.com/user/repos", {
        method: "POST",
        headers: ghHeaders,
        body: JSON.stringify({ name: cleanRepo, description: "Thalamus AI project synced", private: false, auto_init: true }),
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

      addLog(`$ collecting project files from server...`, "cmd");
      const filesToSync = await fetchAllFiles();
      addLog(`✓ Found ${filesToSync.length} files to sync`, "success");

      // Find the default branch (main or master)
      addLog(`$ checking repository state...`, "cmd");
      let branchRes = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/refs/heads/main`, { headers: ghHeaders });
      if (!branchRes.ok) {
        // Try master branch
        branchRes = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/refs/heads/master`, { headers: ghHeaders });
      }
      if (!branchRes.ok) {
        // Wait a moment and retry (GitHub sometimes takes a second to initialize)
        await new Promise(r => setTimeout(r, 2000));
        branchRes = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/refs/heads/main`, { headers: ghHeaders });
        if (!branchRes.ok) {
          branchRes = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/refs/heads/master`, { headers: ghHeaders });
        }
      }
      if (!branchRes.ok) {
        throw new Error("Could not find repository branch. Please try again.");
      }

      // For repos with existing commits: use Git Data API (batch commit)
      const branchData = await branchRes.json();
      const latestCommitSha: string = branchData.object?.sha;
      const commitRes = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/commits/${latestCommitSha}`, { headers: ghHeaders });
      const commitData = await commitRes.json();
      const baseTreeSha: string = commitData.tree?.sha;

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
        } catch { /* skip */ }
      }

      addLog(`✓ Created ${treeItems.length} file blobs`, "success");
      if (treeItems.length === 0) throw new Error("No files could be uploaded");

      addLog(`$ building git tree...`, "cmd");
      const treeRes = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/trees`, {
        method: "POST",
        headers: ghHeaders,
        body: JSON.stringify({ tree: treeItems, base_tree: baseTreeSha }),
      });
      if (!treeRes.ok) {
        const treeErr = await treeRes.json().catch(() => ({}));
        throw new Error(`Failed to create git tree: ${(treeErr as { message?: string }).message || treeRes.status}`);
      }
      const tree = await treeRes.json();

      addLog(`$ git commit -m "Sync from Thalamus AI"`, "cmd");
      const commitRes2 = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/commits`, {
        method: "POST",
        headers: ghHeaders,
        body: JSON.stringify({ message: `Sync from Thalamus AI — ${new Date().toISOString()}`, tree: tree.sha, parents: [latestCommitSha] }),
      });
      if (!commitRes2.ok) {
        const commitErr = await commitRes2.json().catch(() => ({}));
        throw new Error(`Failed to create commit: ${(commitErr as { message?: string }).message || commitRes2.status}`);
      }
      const commit = await commitRes2.json();

      addLog(`$ updating branch ref...`, "cmd");
      await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/refs/heads/main`, {
        method: "PATCH",
        headers: ghHeaders,
        body: JSON.stringify({ sha: commit.sha, force: true }),
      });

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
      <nav className="border-b border-border px-6 h-12 flex items-center justify-between">
        <button onClick={() => navigate("/")} className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-primary terminal-glow" />
                  <span className="text-primary font-bold text-sm tracking-widest terminal-glow">THALAMUS_AI</span>
        </button>
        <span className="text-xs text-muted-foreground">// GITHUB_SYNC</span>
      </nav>

      <div className="flex-1 flex items-start justify-center p-6 pt-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-2xl space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">// SYNC_TO_GITHUB</p>
            <h1 className="text-2xl font-bold text-primary terminal-glow flex items-center gap-2">
              <FolderGit2 className="h-6 w-6" />
              GITHUB_SYNC
            </h1>
            <p className="text-xs text-muted-foreground mt-1">Push the entire project directory to a GitHub repository.</p>
          </div>

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
                  <a href="https://github.com/settings/tokens/new?scopes=repo&description=Thalamus+AI+Sync" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Generate one here →</a>
                </p>
                <div className="flex items-center border border-border bg-background focus-within:border-primary transition-colors">
                  <span className="text-primary text-xs px-2 terminal-glow">$</span>
                  <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                    className="border-0 bg-transparent text-xs font-mono focus-visible:ring-0 focus-visible:ring-offset-0 text-foreground placeholder:text-muted-foreground"
                    disabled={status === "loading"} required />
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-1">$ repository_name</label>
                <p className="text-xs text-muted-foreground/60 mb-2">Name for the GitHub repository (created if it doesn't exist).</p>
                <div className="flex items-center border border-border bg-background focus-within:border-primary transition-colors">
                  <span className="text-primary text-xs px-2 terminal-glow"><Github className="h-3 w-3" /></span>
                  <Input type="text" value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="my-agentai-project"
                    className="border-0 bg-transparent text-xs font-mono focus-visible:ring-0 focus-visible:ring-offset-0 text-foreground placeholder:text-muted-foreground"
                    disabled={status === "loading"} required />
                </div>
              </div>

              <Button type="submit" disabled={status === "loading" || !token.trim() || !repoName.trim()}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-mono font-bold rounded-none">
                {status === "loading" ? (
                  <><Loader2 className="h-3 w-3 animate-spin mr-2" />SYNCING...</>
                ) : (
                  <><Github className="h-3 w-3 mr-2" />SYNC_TO_GITHUB<ChevronRight className="h-3 w-3 ml-2" /></>
                )}
              </Button>
            </form>
          </div>

          {logs.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="border border-border bg-card">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                <div className="w-2.5 h-2.5 rounded-full bg-destructive" />
                <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                <span className="text-xs text-muted-foreground ml-2">sync — output</span>
                {status === "success" && <CheckCircle className="h-3 w-3 text-primary ml-auto" />}
                {status === "error" && <XCircle className="h-3 w-3 text-destructive ml-auto" />}
              </div>
              <div className="p-4 space-y-1 max-h-72 overflow-y-auto">
                {logs.map((log, i) => (
                  <div key={i} className={`text-xs font-mono ${
                    log.type === "success" ? "text-primary terminal-glow" :
                    log.type === "error" ? "text-destructive" :
                    log.type === "cmd" ? "text-amber-400" : "text-muted-foreground"
                  }`}>{log.text}</div>
                ))}
                {status === "loading" && <div className="text-muted-foreground text-xs"><span className="animate-pulse text-primary">█</span></div>}
              </div>
              {status === "success" && repoUrl && (
                <div className="px-4 pb-4">
                  <a href={repoUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-primary hover:underline terminal-glow">
                    <Github className="h-3 w-3" />{repoUrl}<ChevronRight className="h-3 w-3" />
                  </a>
                </div>
              )}
            </motion.div>
          )}

          <div className="border border-border/50 bg-card/50 p-4">
            <p className="text-xs text-muted-foreground mb-2">// WHAT_GETS_SYNCED</p>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div>→ All source files (src/, public/)</div>
              <div>→ Configuration files (package.json, tsconfig, vite.config, etc.)</div>
              <div>→ Convex backend (src/convex/)</div>
              <div>→ All UI components (src/components/ui/)</div>
              <div>→ Styles, hooks, pages, and scripts</div>
              <div className="text-amber-400/70">⚠ .env files and secrets are excluded automatically</div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}