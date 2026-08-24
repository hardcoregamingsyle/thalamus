// GitSyncView — the branch's GitHub surface: the account connection itself plus
// the manual clone/push/pull controls for its repo.
//
// This tab owns connecting and disconnecting GitHub. There is no separate /sync
// page any more: connecting is only ever meaningful in the context of a branch
// (it is that branch's repo, that branch's cloud commands), and a standalone
// page meant the error messages pointing at it sent people somewhere with no
// idea which branch was broken.
//
// Drives githubSync.cloneRepository / pushToGithub / pullFromGithub, plus
// github.getAuthorizationUrl and githubHelpers.disconnectGithub, and reads
// githubHelpers.getGithubStatus for the connection state AND the scopes GitHub
// actually granted — a token without `workflow` cannot run cloud commands, and
// saying so here is the only way the user finds out before a build stalls.

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { GitBranch, Github, Download, Upload, Loader2, ExternalLink, CheckCircle2, LogIn, LogOut, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
// actually owns the branch's platform repo.
export function GitSyncView({ projectId, branchId }: GitSyncViewProps) {
  const { token } = useAuth();
  const githubStatus = useQuery(api.githubHelpers.getGithubStatus, token ? { token } : "skip");
  const getAuthorizationUrl = useAction(api.github.getAuthorizationUrl);
  const disconnectGithub = useMutation(api.githubHelpers.disconnectGithub);

  // Null means the branch has no repository yet — the tab swaps the
  // clone/push/pull cards for a single create box that makes one on the
  // user's own account and syncs the project into it.
  const gitConfig = useQuery(api.githubQueries.getGithubConfig, token ? { token, projectId, branchId } : "skip");
  const branch = useQuery(api.codeBranches.getBranch, token ? { token, branchId } : "skip");
  const createRepoWithName = useAction(api.githubAutoCreate.createRepoWithName);

  const [repoName, setRepoName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [isCloning, setIsCloning] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const cloneRepo = useAction(api.githubSync.cloneRepository);
  const pushToGithub = useAction(api.githubSync.pushToGithub);
  const pullFromGithub = useAction(api.githubSync.pullFromGithub);

  // Explicitly false, not falsy: null means "we don't know" (a token saved
  // before scopes were recorded, or a token type GitHub doesn't report scopes
  // for) and must not be shown as a problem.
  const workflowScopeMissing = githubStatus?.hasWorkflowScope === false;

  // The branch repo may live under the PLATFORM's GitHub account (branches
  // created while the user had no GitHub connected). On those, the user's own
  // token is never used at all — server-side resolution deliberately keeps the
  // platform identity — so this tab's Reconnect button cannot heal that branch,
  // and the banner must say so instead of looping the user through OAuth.
  const repoIsPlatformHosted =
    workflowScopeMissing &&
    !!gitConfig?.owner &&
    !!githubStatus?.username &&
    gitConfig.owner.toLowerCase() !== githubStatus.username.toLowerCase();

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
      toast.success("GitHub disconnected. Public clone/push/pull still work off the platform's own access.");
    } catch (err) {
      toast.error(errMsg(err, "Failed to disconnect GitHub"));
    } finally {
      setDisconnecting(false);
    }
  };

  const handleCreateRepo = async () => {
    if (!token || !repoName.trim()) return;
    setIsCreating(true);
    try {
      const result = await createRepoWithName({
        token,
        projectId,
        branchId,
        repoName: repoName.trim(),
      });

      toast.success(`Repository created — https://github.com/${result.owner}/${result.repo}`);
      setRepoName("");
    } catch (err) {
      toast.error(errMsg(err, "Failed to create repository"));
    } finally {
      setIsCreating(false);
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
          toast.error(`Imported, but couldn't push to the platform repo yet: ${result.pushWarning}`);
        }
        setRepoUrl("");
      }
    } catch (err) {
      toast.error(errMsg(err, "Failed to clone repository"));
    } finally {
      setIsCloning(false);
    }
  };

  const handlePush = async () => {
    if (!commitMessage.trim() || !token) {
      toast.error("Please enter a commit message");
      return;
    }

    setIsPushing(true);
    try {
      const result = await pushToGithub({
        token,
        projectId,
        branchId,
        commitMessage: commitMessage.trim(),
      });

      if (result.success) {
        toast.success(`Pushed ${result.filesUpdated} files to GitHub`);
        setCommitMessage("");
      }
    } catch (err) {
      toast.error(errMsg(err, "Failed to push to GitHub"));
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
            Clone, push, and pull code from GitHub repositories
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

      {/* The scope that decides whether cloud commands can run at all. GitHub
          reports what it granted; requesting `workflow` is not the same as
          getting it, and an org policy can refuse it outright — in which case
          reconnecting forever accomplishes nothing and the user needs to hear
          that rather than keep pressing the button. */}
      {workflowScopeMissing && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="pt-6 space-y-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-amber-500">
              <AlertTriangle className="h-4 w-4" />
              This GitHub token has no <code className="text-xs">workflow</code> scope
            </p>
            {repoIsPlatformHosted ? (
              <p className="text-muted-foreground">
                This branch's repo ({gitConfig?.owner}/{gitConfig?.repo}) is hosted under the
                platform's GitHub account, not yours — so reconnecting your own GitHub cannot
                restore cloud commands on it, no matter how many times you approve the request.
                The platform's token is missing the scope and updating it is an admin fix on the
                server. Until then, the desktop app is the working path: it runs commands on your
                own machine instead of in the cloud.
              </p>
            ) : (
              <p className="text-muted-foreground">
              Files still sync, but agents cannot run commands in the cloud: writing the runner
              workflow into the branch repo needs that scope. Press <strong>Reconnect</strong> above
              and approve the request — it now asks for <code className="text-xs">workflow</code> and
              it is a one-time upgrade, not a per-branch ritual: once granted, every branch on your
              account picks it up. If GitHub keeps withholding it, an organisation policy on the
              repo owner is refusing it; build from the desktop app instead, which runs commands on
              your own machine.
              </p>
            )}
            {githubStatus?.scopes && githubStatus.scopes.length > 0 && (
              <p className="text-xs text-muted-foreground/70">
                Granted: {githubStatus.scopes.join(", ")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {!githubStatus?.connected && (
        <Card className="border-blue-500/50 bg-blue-500/5">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Connecting isn't required — clone/push/pull for public repos already work off the platform's
            own access. Connect your account when you want private repos, pushes attributed to you
            instead of the platform, or cloud command execution on this branch.
          </CardContent>
        </Card>
      )}

      {/* No repository yet — one create box instead of clone/push/pull, which
          have nothing to act on. The repo is made on the user's own GitHub
          account with the exact name typed (the branch's Thalamus name for a
          prefilled suggestion), and the project code plus the full chat log
          are pushed into it immediately. */}
      {gitConfig === null ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5" />
              Create Repository
            </CardTitle>
            <CardDescription>
              This branch has no GitHub repository yet. Creating one makes a public repo on your
              GitHub account and immediately syncs the project code and the full chat history to it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="repo-name">Repository name</Label>
              <Input
                id="repo-name"
                placeholder={branch?.name ?? "my-thalamus-project"}
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                disabled={isCreating}
                maxLength={100}
              />
            </div>
            <Button
              className="w-full gap-2"
              onClick={handleCreateRepo}
              disabled={isCreating || !repoName.trim()}
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Github className="h-4 w-4" />
                  Create Repository &amp; Sync Code
                </>
              )}
            </Button>
            {!githubStatus?.connected && (
              <p className="text-xs text-muted-foreground">
                The repo is created on <strong>your</strong> GitHub account — connect GitHub above
                first if this fails with "No GitHub account connected".
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        gitConfig && (
          <>
            {/* Clone Repository */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Clone Repository
          </CardTitle>
          <CardDescription>
            Import code from a GitHub repository into this branch
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
            onClick={handleClone}
            disabled={isCloning || !repoUrl.trim()}
          >
            {isCloning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Cloning...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Clone Repository
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Push Changes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Push to GitHub
          </CardTitle>
          <CardDescription>
            Push all files in this branch to the connected GitHub repository
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="commit-message">Commit Message</Label>
            <Input
              id="commit-message"
              placeholder="Update from Thalamus AI"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              disabled={isPushing}
            />
          </div>
          <Button
            className="w-full gap-2"
            onClick={handlePush}
            disabled={isPushing || !commitMessage.trim()}
          >
            {isPushing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Pushing...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Push to GitHub
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Pull Changes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Pull from GitHub
          </CardTitle>
          <CardDescription>
            Pull latest changes from the connected GitHub repository
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                Pull Latest Changes
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="border-blue-500/50 bg-blue-500/5">
        <CardHeader>
          <CardTitle className="text-sm">How it works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. <strong>Clone</strong>: Import existing code from any GitHub repository (public or private)</p>
          <p>2. <strong>Edit</strong>: AI agents modify and create files in this branch</p>
          <p>3. <strong>Push</strong>: Send all changes back to GitHub with a commit</p>
          <p>4. <strong>Pull</strong>: Get latest changes from GitHub into this branch</p>
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
        )
      )}
    </div>
  );
}
