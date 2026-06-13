import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { GitBranch, Github, Download, Upload, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface GitSyncViewProps {
  projectId: string;
  branchId: string;
}

export function GitSyncView({ projectId, branchId }: GitSyncViewProps) {
  const token = localStorage.getItem("agentai_session_token") || "";
  const [repoUrl, setRepoUrl] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [isCloning, setIsCloning] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);

  const cloneRepo = useAction(api.githubSync.cloneRepository);
  const pushToGithub = useAction(api.githubSync.pushToGithub);
  const pullFromGithub = useAction(api.githubSync.pullFromGithub);

  const handleClone = async () => {
    if (!repoUrl.trim()) {
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
        githubToken: githubToken.trim() || undefined,
      });

      if (result.success) {
        toast.success(`Cloned ${result.filesCloned} files from ${result.repo}`);
        setRepoUrl("");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clone repository");
    } finally {
      setIsCloning(false);
    }
  };

  const handlePush = async () => {
    if (!commitMessage.trim()) {
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
        githubToken: githubToken.trim() || undefined,
      });

      if (result.success) {
        toast.success(`Pushed ${result.filesUpdated} files to GitHub`);
        setCommitMessage("");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to push to GitHub");
    } finally {
      setIsPushing(false);
    }
  };

  const handlePull = async () => {
    setIsPulling(true);
    try {
      const result = await pullFromGithub({
        token,
        projectId,
        branchId,
        githubToken: githubToken.trim() || undefined,
      });

      if (result.success) {
        toast.success(`Pulled ${result.filesPulled} files from GitHub`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to pull from GitHub");
    } finally {
      setIsPulling(false);
    }
  };

  return (
    <div className="h-full flex flex-col p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Github className="h-6 w-6" />
            GitHub Sync
          </h2>
          <p className="text-muted-foreground mt-1">
            Clone, push, and pull code from GitHub repositories
          </p>
        </div>
        <a
          href="https://github.com/settings/tokens/new?scopes=repo"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary hover:underline flex items-center gap-1"
        >
          <ExternalLink className="h-3 w-3" />
          Get GitHub Token
        </a>
      </div>

      {/* GitHub Token (Optional) */}
      <Card>
        <CardHeader>
          <CardTitle>GitHub Personal Access Token (Optional)</CardTitle>
          <CardDescription>
            Required for private repositories. Public repos don't need a token.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="github-token">Token (leave empty for public repos)</Label>
            <Input
              id="github-token"
              type="password"
              placeholder="ghp_xxxxxxxxxxxx"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Create a token with "repo" scope at{" "}
              <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                github.com/settings/tokens
              </a>
            </p>
          </div>
        </CardContent>
      </Card>

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
        </CardContent>
      </Card>
    </div>
  );
}
