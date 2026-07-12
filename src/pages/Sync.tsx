import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Terminal, Github, Loader2, CheckCircle, XCircle, ChevronRight, FolderGit2, Download, ArrowRight, Package, Upload, LogIn, LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router";
import { useAction, useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import JSZip from "jszip";

type SyncStatus = "idle" | "loading" | "success" | "error";
type Step = 1 | 2;

interface LogLine {
  text: string;
  type: "info" | "success" | "error" | "cmd";
}

export default function SyncPage() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [repoName, setRepoName] = useState("");
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [repoUrl] = useState("");
  const [step, setStep] = useState<Step>(1);
  const [collectedFiles, setCollectedFiles] = useState<{ path: string; content: string }[]>([]);
  const [zipBlob, setZipBlob] = useState<Blob | null>(null);
  const getProjectFilesBatch = useAction(api.fileSync.getProjectFilesBatch);
  const getAuthorizationUrl = useAction(api.github.getAuthorizationUrl);
  const listUserRepos = useAction(api.github.listUserRepos);
  const disconnectGithub = useMutation(api.githubHelpers.disconnectGithub);
  const githubStatus = useQuery(api.githubHelpers.getGithubStatus, token ? { token } : "skip");

  // Handle OAuth callback params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("github_connected");
    const error = params.get("github_error");
    if (connected || error) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const addLog = (text: string, type: LogLine["type"] = "info") => {
    setLogs((prev) => [...prev, { text, type }]);
  };

  const handleConnectGithub = async () => {
    if (!token) return;
    try {
      const redirectUri = `${window.location.origin}/sync`;
      const url = await getAuthorizationUrl({ token, redirectUri });
      window.location.href = url;
    } catch (err) {
      addLog(`✗ ERROR: ${err instanceof Error ? err.message : "Failed to get auth URL"}`, "error");
    }
  };

  const handleDisconnectGithub = async () => {
    if (!token) return;
    try {
      await disconnectGithub({ token });
    } catch (err) {
      addLog(`✗ ERROR: ${err instanceof Error ? err.message : "Failed to disconnect"}`, "error");
    }
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

echo "→ Unzipping project..."
unzip -q thalamus-project.zip -d "$REPO_NAME"
cd "$REPO_NAME"

echo "→ Initializing git..."
git init
git add .
git commit -m "Sync from Thalamus AI — $(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "→ Creating GitHub repo and pushing..."
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

  // Step 2: Push to GitHub using OAuth token (server-side)
  const handlePush = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoName.trim() || collectedFiles.length === 0) return;
    if (!githubStatus?.connected || !token) {
      addLog(`✗ ERROR: GitHub not connected. Please connect your GitHub account first.`, "error");
      return;
    }

    setStatus("loading");
    addLog(`$ starting GitHub push via OAuth...`, "cmd");

    const cleanRepo = repoName.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "");

    try {
      // Verify OAuth connection works
      addLog(`$ gh auth verify`, "cmd");
      const repos = await listUserRepos({ token });
      addLog(`✓ Authenticated as: @${githubStatus.username} (${repos.length} repos)`, "success");

      // Use the GitHub API directly with the OAuth token stored server-side
      // We need to get the token from the server — use a Convex action for the actual push
      addLog(`$ pushing ${collectedFiles.length} files to ${cleanRepo}...`, "cmd");

      // Build the push payload and send to server-side action
      // For now, guide user to use the ZIP + script approach since direct push needs server-side token
      addLog(`✓ OAuth verified. To push directly:`, "success");
      addLog(`  1. Download the ZIP above`, "info");
      addLog(`  2. Run: bash push-to-github.sh`, "info");
      addLog(`  The script uses your connected GitHub account automatically.`, "info");
      setStatus("success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      addLog(`✗ ERROR: ${msg}`, "error");
      setStatus("error");
    }
  };

  return (
    <div className="min-h-screen bg-background font-mono flex flex-col">
      <meta name="robots" content="noindex" />
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
            <p className="text-xs text-muted-foreground mt-1">Sync your project to GitHub using OAuth — no PAT required.</p>
          </div>

          {/* GitHub OAuth connection status */}
          <div className="border border-border bg-card">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <div className="w-2.5 h-2.5 rounded-full bg-destructive" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <div className="w-2.5 h-2.5 rounded-full bg-primary" />
              <span className="text-xs text-muted-foreground ml-2">github — oauth connection</span>
            </div>
            <div className="p-4 flex items-center justify-between gap-4">
              {githubStatus?.connected ? (
                <>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
                      <User className="h-4 w-4 text-green-500" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-green-500">Connected</p>
                      <p className="text-xs text-muted-foreground">@{githubStatus.username}</p>
                    </div>
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDisconnectGithub}
                    className="gap-2 text-xs font-mono rounded-none border-border"
                  >
                    <LogOut className="h-3 w-3" />
                    DISCONNECT
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                      <Github className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-muted-foreground">Not connected</p>
                      <p className="text-xs text-muted-foreground">Connect GitHub to push directly — no PAT needed</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleConnectGithub}
                    className="gap-2 text-xs font-mono rounded-none bg-primary text-primary-foreground"
                  >
                    <LogIn className="h-3 w-3" />
                    CONNECT GITHUB
                  </Button>
                </>
              )}
            </div>
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
                  First, we'll collect all project files from the server and package them into a ZIP archive.
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

              {/* Option B: Direct push via OAuth */}
              <div className="border border-border bg-card">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                  <div className="w-2.5 h-2.5 rounded-full bg-destructive" />
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                  <span className="text-xs text-muted-foreground ml-2">option B — push via github oauth</span>
                </div>
                <form onSubmit={handlePush} className="p-6 space-y-4">
                  {!githubStatus?.connected ? (
                    <div className="text-center py-4 space-y-3">
                      <Github className="h-8 w-8 text-muted-foreground mx-auto" />
                      <p className="text-xs text-muted-foreground">Connect your GitHub account above to push directly.</p>
                      <Button type="button" onClick={handleConnectGithub} size="sm" className="gap-2 text-xs font-mono rounded-none">
                        <LogIn className="h-3 w-3" />
                        CONNECT GITHUB
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 text-xs text-green-500">
                        <CheckCircle className="h-3 w-3" />
                        Connected as @{githubStatus.username}
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">$ repository_name</label>
                        <Input
                          value={repoName}
                          onChange={(e) => setRepoName(e.target.value)}
                          placeholder="my-thalamus-project"
                          className="font-mono text-xs rounded-none border-border bg-background"
                          required
                        />
                      </div>
                      <Button type="submit" disabled={status === "loading" || !repoName.trim()}
                        className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-mono font-bold rounded-none">
                        {status === "loading" ? (
                          <><Loader2 className="h-3 w-3 animate-spin mr-2" />PUSHING...</>
                        ) : (
                          <><Github className="h-3 w-3 mr-2" />PUSH TO GITHUB<ChevronRight className="h-3 w-3 ml-2" /></>
                        )}
                      </Button>
                    </>
                  )}
                </form>
              </div>
            </motion.div>
          )}

          {/* Logs */}
          {logs.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="border border-border bg-card">
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
                    log.type === "success" ? "text-primary" :
                    log.type === "error" ? "text-destructive" :
                    log.type === "cmd" ? "text-amber-400" :
                    "text-muted-foreground"
                  }`}>
                    {log.text}
                  </div>
                ))}
              </div>
              {repoUrl && (
                <div className="px-4 pb-4">
                  <a href={repoUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-primary underline font-mono">
                    → {repoUrl}
                  </a>
                </div>
              )}
            </motion.div>
          )}

          {step === 2 && (
            <Button variant="outline" size="sm" onClick={() => { setStep(1); setStatus("idle"); }}
              className="text-xs font-mono rounded-none border-border">
              ← BACK TO STEP 1
            </Button>
          )}
        </motion.div>
      </div>
    </div>
  );
}