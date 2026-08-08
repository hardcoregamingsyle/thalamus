// GitSyncView — the manual clone/push/pull tab for a branch's GitHub repo.
// Drives githubSync.cloneRepository / pushToGithub / pullFromGithub, and
// consults githubHelpers.getGithubStatus so the "Connect GitHub" affordance
// appears only when the account is not linked. Independent of the pipeline —
// it acts directly on the branch's stored files, not on anything in flight.

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { GitBranch, Github, Download, Upload, Loader2, ExternalLink, CheckCircle2, LogIn } from "lucide-react";
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

  const [repoUrl, setRepoUrl] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [isCloning, setIsCloning] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const cloneRepo = useAction(api.githubSync.cloneRepository);
  const pushToGithub = useAction(api.githubSync.pushToGithub);
  const pullFromGithub = useAction(api.githubSync.pullFromGithub);

  const handleConnectGithub = async () => {
    if (!token) return;
    setConnecting(true);
    try {
      const url = await getAuthorizationUrl({ token, returnPath: window.location.pathname });
      window.location.href = url;
    } catch (err) {
      toast.error(errMsg(err, "Failed to start GitHub connection"));
      setConnecting(false);
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
          <Badge variant="outline" className="gap-1.5 border-primary/40 text-primary shrink-0">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Connected as @{githubStatus.username}
          </Badge>
        ) : (
          <Button size="sm" onClick={handleConnectGithub} disabled={connecting} className="gap-2 shrink-0">
            {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
            Connect GitHub
          </Button>
        )}
      </div>

      {!githubStatus?.connected && (
        <Card className="border-blue-500/50 bg-blue-500/5">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Connecting isn't required — clone/push/pull for public repos already work off the platform's
            own access. Connect your account when you want private repos, or pushes attributed to you
            instead of the platform.
          </CardContent>
        </Card>
      )}

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
            <a
              href="https://github.com/settings/tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              <ExternalLink className="h-3 w-3" />
              Manage your GitHub account
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
