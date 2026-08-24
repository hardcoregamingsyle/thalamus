// GitSyncView — the branch's GitHub surface: the account connection itself plus
// the repo the branch syncs to.
//
// This tab owns connecting and disconnecting GitHub. There is no separate /sync
// page any more: connecting is only ever meaningful in the context of a branch
// (it is that branch's repo), and a standalone page meant the error messages
// pointing at it sent people somewhere with no idea which branch was broken.
//
// The layout is the product spec, verbatim: not connected → a Connect button;
// connected → Repo name, Repo Status (Private/Public), and a "Sync with
// github" button. The repo lives on the USER's own GitHub account and holds
// ONLY the project's code — no conversation transcript, no workflow files, no
// Thalamus system files (those are filtered server-side in githubSync.ts;
// cloud builds run against the platform-managed build mirror instead, which
// is also why this tab no longer nags about the OAuth `workflow` scope: the
// user's token never writes a workflow file).

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { GitBranch, Github, Download, Upload, Loader2, ExternalLink, CheckCircle2, LogIn, LogOut, RefreshCw, Globe, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { errMsg } from "@/lib/errorMessage";

interface GitSyncViewProps {
  projectId: string;
  branchId: string;
}

// No PAT field here on purpose — cloneRepository/pushToGithub/pullFromGithub
// all resolve a token server-side (the connected GitHub account, falling back
// to the platform's own token), the same as everywhere else repo access
// happens in this app. A manual token box on this one tab would be the exact
// pattern removed from the New Project/Branch import dialog, just reintroduced
// here — and it would also let this tab silently bypass whichever account
// actually owns the branch's repo.
export function GitSyncView({ projectId, branchId }: GitSyncViewProps) {
  const { token } = useAuth();
  const githubStatus = useQuery(api.githubHelpers.getGithubStatus, token ? { token } : "skip");
  const getAuthorizationUrl = useAction(api.github.getAuthorizationUrl);
  const disconnectGithub = useMutation(api.githubHelpers.disconnectGithub);

  // Null means the branch has no repository yet — the tab shows the create
  // form (Repo name + Repo Status + Sync with github), which makes the repo
  // on the user's own account and syncs the project into it in one click.
  const gitConfig = useQuery(api.githubQueries.getGithubConfig, token ? { token, projectId, branchId } : "skip");
  const branch = useQuery(api.codeBranches.getBranch, token ? { token, branchId } : "skip");
  const createRepoWithName = useAction(api.githubAutoCreate.createRepoWithName);
  const setRepoVisibility = useAction(api.githubAutoCreate.setRepoVisibility);

  const [repoName, setRepoName] = useState("");
  const [repoStatus, setRepoStatus] = useState<"public" | "private">("public");
  const [isCreating, setIsCreating] = useState(false);
  const [isVisibilitySaving, setIsVisibilitySaving] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [isCloning, setIsCloning] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const cloneRepo = useAction(api.githubSync.cloneRepository);
  const pushToGithub = useAction(api.githubSync.pushToGithub);
  const pullFromGithub = useAction(api.githubSync.pullFromGithub);

  const handleConnectGithub = async () => {
    if (!token) return;
    setConnecting(true);
    try {
      // Comes back to this exact branch tab, so the user lands where they
      // started rather than on some generic page.
      const url = await getAuthorizationUrl({ token, returnPath: window.location.pathname });
      window.location.href = url;
    } catch (err) {
      toast.error(errMsg(err, "Failed to start GitHub connection"));
      setConnecting(false);
    }
  };

  const handleDisconnectGithub = async () => {
    if (!token) return;
    setDisconnecting(true);
    try {
      await disconnectGithub({ token });
      toast.success("GitHub disconnected.");
    } catch (err) {
      toast.error(errMsg(err, "Failed to disconnect GitHub"));
    } finally {
      setDisconnecting(false);
    }
  };

  // The spec's single button for the no-repo state: take Repo name + Repo
  // Status, create the repo on the user's account, and sync the project code
  // into it (createRepoWithName pushes immediately server-side).
  const handleCreateRepo = async () => {
    if (!token || !repoName.trim()) return;
    setIsCreating(true);
    try {
      const result = await createRepoWithName({
        token,
        projectId,
        branchId,
        repoName: repoName.trim(),
        isPrivate: repoStatus === "private",
      });

      toast.success(`Repository created — https://github.com/${result.owner}/${result.repo}`);
      setRepoName("");
    } catch (err) {
      toast.error(errMsg(err, "Failed to create repository"));
    } finally {
      setIsCreating(false);
    }
  };

  // Repo Status on an existing repo: PATCHes the GitHub repo and mirrors the
  // choice into the config row the query above reads back.
  const handleVisibilityChange = async (value: "public" | "private") => {
    if (!token || isVisibilitySaving) return;
    setIsVisibilitySaving(true);
    try {
      await setRepoVisibility({ token, projectId, branchId, isPrivate: value === "private" });
      toast.success(`Repository is now ${value === "private" ? "Private" : "Public"}`);
    } catch (err) {
      toast.error(errMsg(err, "Failed to update repository visibility"));
    } finally {
      setIsVisibilitySaving(false);
    }
  };

  const handleClone = async () => {
    if (!repoUrl.trim() || !token) {
      toast.error("Please enter a repository URL");
      return;
    }

    setIsCloning(true);
    try {
      const result = await cloneRepo({
        token,
        projectId,
        branchId,
        repoUrl: repoUrl.trim(),
      });

      if (result.success) {
        toast.success(`Cloned ${result.filesCloned} files from ${result.source}`);
        if (result.pushWarning) {
          toast.error(`Imported, but couldn't push to the repo yet: ${result.pushWarning}`);
        }
        setRepoUrl("");
      }
    } catch (err) {
      toast.error(errMsg(err, "Failed to clone repository"));
    } finally {
      setIsCloning(false);
    }
  };

  // The spec's "Sync with github" button: push the branch's project code —
  // nothing else — to the repo's default branch.
  const handlePush = async () => {
    if (!token) return;
    setIsPushing(true);
    try {
      const result = await pushToGithub({
        token,
        projectId,
        branchId,
        commitMessage: "Sync from Thalamus",
      });

      if (result.success) {
        toast.success(`Synced ${result.filesUpdated} files to GitHub`);
      }
    } catch (err) {
      toast.error(errMsg(err, "Failed to sync with GitHub"));
    } finally {
      setIsPushing(false);
    }
  };

  const handlePull = async () => {
    if (!token) return;
    setIsPulling(true);
    try {
      const result = await pullFromGithub({
        token,
        projectId,
        branchId,
      });

      if (result.success) {
        toast.success(`Pulled ${result.filesPulled} files from GitHub`);
      }
    } catch (err) {
      toast.error(errMsg(err, "Failed to pull from GitHub"));
    } finally {
      setIsPulling(false);
    }
  };

  return (
    <div className="h-full flex flex-col p-6 space-y-6 overflow-y-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Github className="h-6 w-6" />
            GitHub Sync
          </h2>
          <p className="text-muted-foreground mt-1">
            Your project code, synced to a repository on your own GitHub account
          </p>
        </div>
        {githubStatus?.connected ? (
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <Badge variant="outline" className="gap-1.5 border-primary/40 text-primary">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Connected as @{githubStatus.username}
            </Badge>
            <Button size="sm" variant="outline" onClick={handleConnectGithub} disabled={connecting} className="gap-2">
              {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Reconnect
            </Button>
            <Button size="sm" variant="outline" onClick={handleDisconnectGithub} disabled={disconnecting} className="gap-2">
              {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
              Disconnect
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={handleConnectGithub} disabled={connecting} className="gap-2 shrink-0">
            {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
            Connect GitHub
          </Button>
        )}
      </div>

      {/* Spec: not connected → the tab is a Connect button and nothing else. */}
      {!githubStatus?.connected && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground space-y-3">
            <p>
              Connect your GitHub account to create this branch's repository on it and sync your
              project code there.
            </p>
            <Button onClick={handleConnectGithub} disabled={connecting} className="gap-2">
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              Connect GitHub
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Connected, no repository yet — the spec's three fields: Repo name,
          Repo Status (Private/Public), and a "Sync with github" button that
          creates the repo on the user's account and pushes the project code.
          Code only: no chat transcript, no workflow files. */}
      {githubStatus?.connected && gitConfig === null && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5" />
              Create Repository
            </CardTitle>
            <CardDescription>
              This branch has no GitHub repository yet. Syncing creates one on your GitHub account
              and pushes the project code into it — only the code, nothing else.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="repo-name">Repo name</Label>
              <Input
                id="repo-name"
                placeholder={branch?.name ?? "my-thalamus-project"}
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                disabled={isCreating}
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="repo-status">Repo Status</Label>
              <Select
                value={repoStatus}
                onValueChange={(v) => setRepoStatus(v as "public" | "private")}
                disabled={isCreating}
              >
                <SelectTrigger id="repo-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">
                    <span className="flex items-center gap-2">
                      <Globe className="h-3.5 w-3.5" />
                      Public — anyone can see this repository
                    </span>
                  </SelectItem>
                  <SelectItem value="private">
                    <span className="flex items-center gap-2">
                      <Lock className="h-3.5 w-3.5" />
                      Private — only you can see this repository
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full gap-2"
              onClick={handleCreateRepo}
              disabled={isCreating || !repoName.trim()}
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <Github className="h-4 w-4" />
                  Sync with github
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground">
              Only your project code is synced. Cloud builds run in a separate public build
              workspace that Thalamus manages — your repository stays clean.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Connected with a repository — the spec's fields against the existing
          repo: Repo name (link), Repo Status toggle, "Sync with github". */}
      {githubStatus?.connected && gitConfig && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Github className="h-5 w-5" />
                Repository
              </CardTitle>
              <CardDescription>
                This branch syncs to the repository below on your GitHub account.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Repo name</Label>
                <div className="flex items-center gap-2">
                  <a
                    href={gitConfig.repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1.5 font-medium"
                  >
                    {gitConfig.owner}/{gitConfig.repo}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  <Badge variant="outline" className="gap-1">
                    {gitConfig.isPrivate ? <Lock className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
                    {gitConfig.isPrivate ? "Private" : "Public"}
                  </Badge>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="repo-status-existing">Repo Status</Label>
                <Select
                  value={gitConfig.isPrivate ? "private" : "public"}
                  onValueChange={(v) => void handleVisibilityChange(v as "public" | "private")}
                  disabled={isVisibilitySaving}
                >
                  <SelectTrigger id="repo-status-existing" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">
                      <span className="flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5" />
                        Public — anyone can see this repository
                      </span>
                    </SelectItem>
                    <SelectItem value="private">
                      <span className="flex items-center gap-2">
                        <Lock className="h-3.5 w-3.5" />
                        Private — only you can see this repository
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                {isVisibilitySaving && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Updating on GitHub...
                  </p>
                )}
              </div>
              <Button
                className="w-full gap-2"
                onClick={handlePush}
                disabled={isPushing}
              >
                {isPushing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Sync with github
                  </>
                )}
              </Button>
              <Button
                className="w-full gap-2"
                variant="outline"
                onClick={handlePull}
                disabled={isPulling}
              >
                {isPulling ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Pulling...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Pull latest changes from GitHub
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground">
                Only your project code is synced — no chat history, no system files. Cloud builds
                run in a separate public build workspace that Thalamus manages.
              </p>
            </CardContent>
          </Card>

          {/* Import — bring an existing repository's code into this branch. */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" />
                Import from GitHub
              </CardTitle>
              <CardDescription>
                Import code from another GitHub repository into this branch (public or private)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="repo-url">Repository URL</Label>
                <Input
                  id="repo-url"
                  placeholder="https://github.com/username/repository"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  disabled={isCloning}
                />
              </div>
              <Button
                className="w-full gap-2"
                variant="outline"
                onClick={handleClone}
                disabled={isCloning || !repoUrl.trim()}
              >
                {isCloning ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Import into this branch
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-blue-500/50 bg-blue-500/5">
            <CardHeader>
              <CardTitle className="text-sm">How it works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>1. <strong>Sync</strong>: the branch's project code lands on your repository's default branch</p>
              <p>2. <strong>Edit</strong>: AI agents modify and create files here; every change syncs automatically too</p>
              <p>3. <strong>Pull</strong>: bring edits made on GitHub back into this branch</p>
              <p className="pt-1">
                {/* Authorized OAuth Apps, not personal access tokens — this app has
                    never used a PAT, and sending people to /settings/tokens sent
                    them somewhere that could not explain or revoke this grant. */}
                <a
                  href="https://github.com/settings/applications"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  Review this authorization on GitHub
                </a>
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
