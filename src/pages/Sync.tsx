import { useState } from "react";
import { motion } from "framer-motion";
import { Terminal, Github, Loader2, CheckCircle, XCircle, ChevronRight, FolderGit2, Download, ArrowRight, Package, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import JSZip from "jszip";

type SyncStatus = "idle" | "loading" | "success" | "error";
type Step = 1 | 2;

interface LogLine {
  text: string;
  type: "info" | "success" | "error" | "cmd";
}

// Safe base64 encode that handles unicode
function safeBase64(str: string): string {
  try {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  } catch {
    return btoa(unescape(encodeURIComponent(str)));
  }
}

export default function SyncPage() {
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [repoName, setRepoName] = useState("");
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [repoUrl, setRepoUrl] = useState("");
  const [step, setStep] = useState<Step>(1);
  const [collectedFiles, setCollectedFiles] = useState<{ path: string; content: string }[]>([]);
  const [zipBlob, setZipBlob] = useState<Blob | null>(null);
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

  // Step 1: Collect files and build ZIP
  const handleCollect = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setLogs([]);
    setZipBlob(null);
    setCollectedFiles([]);

    try {
      addLog(`$ collecting project files...`, "cmd");
      const files = await fetchAllFiles();
      addLog(`✓ Collected ${files.length} files`, "success");

      addLog(`$ building ZIP archive...`, "cmd");
      const zip = new JSZip();
      for (const file of files) {
        zip.file(file.path, file.content);
      }
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      const sizeMB = (blob.size / 1024 / 1024).toFixed(2);
      addLog(`✓ ZIP created: ${sizeMB} MB (${files.length} files)`, "success");

      setCollectedFiles(files);
      setZipBlob(blob);
      setStatus("success");
      setStep(2);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      addLog(`✗ ERROR: ${msg}`, "error");
      setStatus("error");
    }
  };

  // Download ZIP
  const handleDownloadZip = () => {
    if (!zipBlob) return;
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "thalamus-project.zip";
    a.click();
    URL.revokeObjectURL(url);
    addLog(`✓ ZIP downloaded: thalamus-project.zip`, "success");
  };

  // Download push script
  const handleDownloadScript = () => {
    const cleanRepo = repoName.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "") || "my-project";
    const script = `#!/bin/bash
# Thalamus AI — GitHub Push Script
# Run this after extracting thalamus-project.zip

set -e

REPO_NAME="${cleanRepo}"
GITHUB_TOKEN="${token || "YOUR_GITHUB_TOKEN"}"

echo "→ Unzipping project..."
unzip -q thalamus-project.zip -d "$REPO_NAME"
cd "$REPO_NAME"

echo "→ Initializing git..."
git init
git add .
git commit -m "Sync from Thalamus AI — $(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "→ Creating GitHub repo and pushing..."
gh auth login --with-token <<< "$GITHUB_TOKEN"
gh repo create "$REPO_NAME" --public --source=. --remote=origin --push

echo "✓ Done! Check: https://github.com/$(gh api user --jq .login)/$REPO_NAME"
`;
    const blob = new Blob([script], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "push-to-github.sh";
    a.click();
    URL.revokeObjectURL(url);
    addLog(`✓ Script downloaded: push-to-github.sh`, "success");
  };

  // Step 2: Push to GitHub using collected files
  const handlePush = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim() || !repoName.trim() || collectedFiles.length === 0) return;

    setStatus("loading");
    setLogs(prev => [...prev, { text: `$ starting GitHub push...`, type: "cmd" }]);

    const cleanRepo = repoName.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "");
    const ghHeaders: Record<string, string> = {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    };

    try {
      // Verify token
      addLog(`$ gh auth verify`, "cmd");
      const userRes = await fetch("https://api.github.com/user", { headers: ghHeaders });
      if (!userRes.ok) throw new Error("Invalid GitHub token. Check your token and try again.");
      const user = await userRes.json() as { login: string };
      addLog(`✓ Authenticated as: ${user.login}`, "success");

      // Create or get repo
      addLog(`$ gh repo create ${cleanRepo}`, "cmd");
      const createRes = await fetch("https://api.github.com/user/repos", {
        method: "POST",
        headers: ghHeaders,
        body: JSON.stringify({ name: cleanRepo, description: "Thalamus AI project", private: false, auto_init: true }),
      });

      let repo: { full_name: string; html_url: string; default_branch: string };
      if (createRes.status === 422) {
        addLog(`Repository exists, using it...`, "info");
        const existingRes = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}`, { headers: ghHeaders });
        if (!existingRes.ok) throw new Error("Could not access existing repository");
        repo = await existingRes.json() as typeof repo;
      } else if (!createRes.ok) {
        const err = await createRes.json() as { message?: string };
        throw new Error(err.message || "Failed to create repository");
      } else {
        repo = await createRes.json() as typeof repo;
        addLog(`✓ Repository created: ${repo.full_name}`, "success");
        addLog(`  Waiting for initialization...`, "info");
        await new Promise(r => setTimeout(r, 4000));
      }

      setRepoUrl(repo.html_url);

      // Detect branch with retries
      addLog(`$ detecting branch...`, "cmd");
      let branch = "main";
      let latestCommitSha = "";
      let baseTreeSha = "";

      for (let attempt = 0; attempt < 6; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
        try {
          const repoInfoRes = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}`, { headers: ghHeaders });
          if (repoInfoRes.ok) {
            const info = await repoInfoRes.json() as { default_branch: string };
            branch = info.default_branch || "main";
          }
          const refRes = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/refs/heads/${branch}`, { headers: ghHeaders });
          if (!refRes.ok) continue;
          const refData = await refRes.json() as { object: { sha: string } };
          latestCommitSha = refData.object?.sha ?? "";
          if (!latestCommitSha) continue;
          const commitRes = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/commits/${latestCommitSha}`, { headers: ghHeaders });
          if (!commitRes.ok) continue;
          const commitData = await commitRes.json() as { tree: { sha: string } };
          baseTreeSha = commitData.tree?.sha ?? "";
          if (baseTreeSha) break;
        } catch { /* retry */ }
      }

      if (!latestCommitSha || !baseTreeSha) {
        throw new Error("Could not initialize repository branch. Try downloading the ZIP instead.");
      }
      addLog(`✓ Branch: ${branch}`, "success");

      // Upload blobs in parallel batches
      addLog(`$ uploading ${collectedFiles.length} files...`, "cmd");
      const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
      const BLOB_BATCH = 8;

      for (let i = 0; i < collectedFiles.length; i += BLOB_BATCH) {
        const batch = collectedFiles.slice(i, i + BLOB_BATCH);
        await Promise.all(batch.map(async (file) => {
          try {
            const blobRes = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/blobs`, {
              method: "POST",
              headers: ghHeaders,
              body: JSON.stringify({ content: safeBase64(file.content), encoding: "base64" }),
            });
            if (blobRes.ok) {
              const blob = await blobRes.json() as { sha: string };
              treeItems.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
            } else {
              const errData = await blobRes.json().catch(() => ({})) as { message?: string };
              addLog(`⚠ Skipped ${file.path}: ${errData.message || blobRes.status}`, "info");
            }
          } catch { /* skip */ }
        }));
        addLog(`  ${Math.min(i + BLOB_BATCH, collectedFiles.length)}/${collectedFiles.length} uploaded`, "info");
      }

      if (treeItems.length === 0) throw new Error("No files could be uploaded. Try downloading the ZIP instead.");
      addLog(`✓ Uploaded ${treeItems.length} files`, "success");

      // Build tree
      addLog(`$ building git tree...`, "cmd");
      const treeRes = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/trees`, {
        method: "POST",
        headers: ghHeaders,
        body: JSON.stringify({ tree: treeItems, base_tree: baseTreeSha }),
      });
      if (!treeRes.ok) {
        const treeErr = await treeRes.json().catch(() => ({})) as { message?: string };
        throw new Error(`Tree creation failed: ${treeErr.message || treeRes.status}`);
      }
      const tree = await treeRes.json() as { sha: string };

      // Commit
      addLog(`$ git commit...`, "cmd");
      const commitRes2 = await fetch(`https://api.github.com/repos/${user.login}/${cleanRepo}/git/commits`, {
        method: "POST",
        headers: ghHeaders,
        body: JSON.stringify({
          message: `Sync from Thalamus AI — ${new Date().toISOString()}`,
          tree: tree.sha,
          parents: [latestCommitSha],
        }),
      });
      if (!commitRes2.ok) {
        const commitErr = await commitRes2.json().catch(() => ({})) as { message?: string };
        throw new Error(`Commit failed: ${commitErr.message || commitRes2.status}`);
      }
      const commit = await commitRes2.json() as { sha: string };

      // Update ref
      addLog(`$ updating ${branch} ref...`, "cmd");
      const updateRefRes = await fetch(
        `https://api.github.com/repos/${user.login}/${cleanRepo}/git/refs/heads/${branch}`,
        { method: "PATCH", headers: ghHeaders, body: JSON.stringify({ sha: commit.sha, force: true }) },
      );
      if (!updateRefRes.ok) {
        const refErr = await updateRefRes.json().catch(() => ({})) as { message?: string };
        throw new Error(`Ref update failed: ${refErr.message || updateRefRes.status}`);
      }

      addLog(`✓ Pushed to ${repo.full_name}`, "success");
      addLog(`✓ ${repo.html_url}`, "success");
      setStatus("success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      addLog(`✗ ERROR: ${msg}`, "error");
      addLog(`  → Try downloading the ZIP and using the push script instead`, "info");
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
            <p className="text-xs text-muted-foreground mt-1">Two-step sync: collect files → push to GitHub or download ZIP.</p>
          </div>

          {/* Step indicators */}
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded border transition-colors ${step === 1 ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground"}`}>
              <Package className="h-3 w-3" />STEP 1: COLLECT
            </div>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <div className={`flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded border transition-colors ${step === 2 ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground"}`}>
              <Upload className="h-3 w-3" />STEP 2: PUSH / DOWNLOAD
            </div>
          </div>

          {/* Step 1: Collect files */}
          {step === 1 && (
            <div className="border border-border bg-card">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                <div className="w-2.5 h-2.5 rounded-full bg-destructive" />
                <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                <span className="text-xs text-muted-foreground ml-2">step 1 — collect project files</span>
              </div>
              <form onSubmit={handleCollect} className="p-6 space-y-4">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  First, we'll collect all project files from the server and package them into a ZIP archive. This step doesn't require a GitHub token.
                </p>
                <Button type="submit" disabled={status === "loading"}
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-mono font-bold rounded-none">
                  {status === "loading" ? (
                    <><Loader2 className="h-3 w-3 animate-spin mr-2" />COLLECTING FILES...</>
                  ) : (
                    <><Package className="h-3 w-3 mr-2" />COLLECT PROJECT FILES<ChevronRight className="h-3 w-3 ml-2" /></>
                  )}
                </Button>
              </form>
            </div>
          )}

          {/* Step 2: Push or Download */}
          {step === 2 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              {/* Option A: Download ZIP */}
              <div className="border border-border bg-card">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                  <div className="w-2.5 h-2.5 rounded-full bg-destructive" />
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                  <span className="text-xs text-muted-foreground ml-2">option A — download ZIP</span>
                </div>
                <div className="p-6 space-y-3">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Download the project as a ZIP file. Then extract and push manually, or use the included shell script.
                  </p>
                  <div className="flex gap-2">
                    <Button onClick={handleDownloadZip} disabled={!zipBlob}
                      className="flex-1 bg-primary/15 border border-primary/30 text-primary hover:bg-primary/25 text-xs font-mono font-bold rounded-none">
                      <Download className="h-3 w-3 mr-2" />DOWNLOAD ZIP
                    </Button>
                    <Button onClick={handleDownloadScript}
                      variant="outline"
                      className="flex-1 text-xs font-mono font-bold rounded-none border-border">
                      <Download className="h-3 w-3 mr-2" />PUSH SCRIPT (.sh)
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground/60">
                    The .sh script uses GitHub CLI (<span className="text-primary">gh</span>) to create a repo and push. Run: <span className="text-primary">bash push-to-github.sh</span>
                  </p>
                </div>
              </div>

              {/* Option B: Direct push */}
              <div className="border border-border bg-card">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                  <div className="w-2.5 h-2.5 rounded-full bg-destructive" />
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                  <span className="text-xs text-muted-foreground ml-2">option B — push directly to GitHub</span>
                </div>
                <form onSubmit={handlePush} className="p-6 space-y-4">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">$ github_token</label>
                    <p className="text-xs text-muted-foreground/60 mb-2">
                      Personal access token with <span className="text-primary">repo</span> scope.{" "}
                      <a href="https://github.com/settings/tokens/new?scopes=repo&description=Thalamus+AI+Sync" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Generate one →</a>
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
                    <div className="flex items-center border border-border bg-background focus-within:border-primary transition-colors">
                      <span className="text-primary text-xs px-2 terminal-glow"><Github className="h-3 w-3" /></span>
                      <Input type="text" value={repoName} onChange={(e) => {
                        let val = e.target.value;
                        const urlMatch = val.match(/github\.com\/[^/]+\/([^/\s?#]+)/);
                        if (urlMatch) val = urlMatch[1];
                        setRepoName(val);
                      }} placeholder="my-project"
                        className="border-0 bg-transparent text-xs font-mono focus-visible:ring-0 focus-visible:ring-offset-0 text-foreground placeholder:text-muted-foreground"
                        disabled={status === "loading"} required />
                    </div>
                    {repoName && <p className="text-xs text-muted-foreground/50 mt-1">→ <span className="text-primary">{repoName.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "")}</span></p>}
                  </div>
                  <Button type="submit" disabled={status === "loading" || !token.trim() || !repoName.trim()}
                    className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-mono font-bold rounded-none">
                    {status === "loading" ? (
                      <><Loader2 className="h-3 w-3 animate-spin mr-2" />PUSHING TO GITHUB...</>
                    ) : (
                      <><Github className="h-3 w-3 mr-2" />PUSH TO GITHUB<ChevronRight className="h-3 w-3 ml-2" /></>
                    )}
                  </Button>
                </form>
              </div>

              <button onClick={() => { setStep(1); setStatus("idle"); setLogs([]); }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                ← Re-collect files
              </button>
            </motion.div>
          )}

          {/* Logs */}
          {logs.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="border border-border bg-card">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                <div className="w-2.5 h-2.5 rounded-full bg-destructive" />
                <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                <span className="text-xs text-muted-foreground ml-2">output</span>
                {status === "success" && <CheckCircle className="h-3 w-3 text-primary ml-auto" />}
                {status === "error" && <XCircle className="h-3 w-3 text-destructive ml-auto" />}
              </div>
              <div className="p-4 space-y-1 max-h-64 overflow-y-auto">
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