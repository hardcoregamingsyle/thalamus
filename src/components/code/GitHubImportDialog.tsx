// GitHubImportDialog — shared repo/branch picker for the new-project and
// new-branch flows. Requires a linked GitHub account (githubHelpers
// .getGithubStatus); otherwise it offers a Connect button that hands off to
// github.getAuthorizationUrl. Once connected, github.listUserRepos populates
// step one and github.listRepoBranches populates step two. The dialog itself
// only reports the chosen repo + branches through onImport — the caller does
// the actual cloneRepository work.

import { useState, useEffect } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Github, Loader2, GitBranch, Check } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { errMsg } from "@/lib/errorMessage";

interface GitHubRepo {
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
}

interface GitHubBranch {
  name: string;
  commit: {
    sha: string;
  };
}

interface GitHubImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (repo: string, branches: string[]) => Promise<void>;
  mode: "project" | "branch";
}

export function GitHubImportDialog({ open, onOpenChange, onImport, mode }: GitHubImportDialogProps) {
  const { token } = useAuth();
  const githubStatus = useQuery(api.githubHelpers.getGithubStatus, token ? { token } : "skip");
  const getAuthorizationUrl = useAction(api.github.getAuthorizationUrl);
  const listUserRepos = useAction(api.github.listUserRepos);
  const listRepoBranches = useAction(api.github.listRepoBranches);

  const [step, setStep] = useState<"repos" | "branches">("repos");
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [reposLoaded, setReposLoaded] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string>("");
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [selectedBranches, setSelectedBranches] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const resetState = () => {
    setStep("repos");
    setRepos([]);
    setReposLoaded(false);
    setSelectedRepo("");
    setBranches([]);
    setSelectedBranches(new Set());
  };

  const handleLoadRepos = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await listUserRepos({ token });
      setRepos(data);
      setReposLoaded(true);
    } catch (err) {
      toast.error(errMsg(err, "Failed to load repositories"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && githubStatus?.connected && !reposLoaded) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off the repo fetch the moment we know the account is connected; a render-time fetch can't do this
      void handleLoadRepos();
    }
    if (!open) {
      resetState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the dialog opens or connection status changes, not on every repo/loading state change
  }, [open, githubStatus?.connected]);

  const handleConnectGithub = async () => {
    if (!token) return;
    setConnecting(true);
    try {
      const returnPath = window.location.pathname;
      const url = await getAuthorizationUrl({ token, returnPath });
      window.location.href = url;
    } catch (err) {
      toast.error(errMsg(err, "Failed to start GitHub connection"));
      setConnecting(false);
    }
  };

  const handleSelectRepo = async (repoFullName: string) => {
    if (!token) return;
    setSelectedRepo(repoFullName);
    setLoading(true);
    try {
      const data = await listRepoBranches({ token, repo: repoFullName });
      setBranches(data);
      setSelectedBranches(data.length === 1 ? new Set([data[0].name]) : new Set());
      setStep("branches");
    } catch (err) {
      toast.error(errMsg(err, "Failed to load branches"));
    } finally {
      setLoading(false);
    }
  };

  const toggleBranch = (branchName: string) => {
    const newSet = new Set(selectedBranches);
    if (newSet.has(branchName)) {
      newSet.delete(branchName);
    } else {
      newSet.add(branchName);
    }
    setSelectedBranches(newSet);
  };

  const toggleAllBranches = () => {
    if (selectedBranches.size === branches.length) {
      setSelectedBranches(new Set());
    } else {
      setSelectedBranches(new Set(branches.map((b) => b.name)));
    }
  };

  const handleImport = async () => {
    if (selectedBranches.size === 0) {
      toast.error("Please select at least one branch");
      return;
    }

    setLoading(true);
    try {
      await onImport(selectedRepo, Array.from(selectedBranches));
      onOpenChange(false);
      resetState();
    } catch (err) {
      toast.error(errMsg(err, "Import failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            Import from GitHub
          </DialogTitle>
          <DialogDescription>
            {mode === "project"
              ? "Import a GitHub repository as a new project"
              : "Import a GitHub branch into this project"}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[500px] pr-4">
          {githubStatus === undefined ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !githubStatus?.connected ? (
            <div className="flex flex-col items-center gap-4 text-center py-12">
              <div className="rounded-full bg-primary/10 p-4">
                <Github className="h-8 w-8 text-primary" />
              </div>
              <div>
                <p className="font-medium">Connect your GitHub account</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  Sign in with GitHub via OAuth to browse and import your repositories — no personal access token needed.
                </p>
              </div>
              <Button onClick={handleConnectGithub} disabled={connecting} className="gap-2">
                {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Github className="h-4 w-4" />}
                Connect GitHub
              </Button>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              {/* Step 1: Select Repository */}
              {step === "repos" && (
                <motion.div
                  key="repos"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      Connected as <span className="font-medium text-foreground">@{githubStatus?.username}</span>
                    </p>
                  </div>

                  {loading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : repos.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No repositories found</p>
                  ) : (
                    <div className="space-y-2">
                      {repos.map((repo) => (
                        <button
                          key={repo.full_name}
                          onClick={() => handleSelectRepo(repo.full_name)}
                          className="w-full text-left border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{repo.name}</p>
                              <div className="flex items-center gap-2 mt-2">
                                <Badge variant="outline" className="text-xs">
                                  {repo.default_branch}
                                </Badge>
                                {repo.private && (
                                  <Badge variant="secondary" className="text-xs">
                                    Private
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {/* Step 2: Select Branches */}
              {step === "branches" && (
                <motion.div
                  key="branches"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-medium">Select Branches</p>
                    <Button variant="ghost" size="sm" onClick={() => setStep("repos")}>
                      Back
                    </Button>
                  </div>

                  <div className="border rounded-lg p-4 bg-muted/30">
                    <p className="font-medium">{selectedRepo}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {branches.length} branch{branches.length !== 1 ? "es" : ""} available
                    </p>
                  </div>

                  <div className="flex items-center justify-between border-b pb-2">
                    <p className="text-sm font-medium">Branches to import</p>
                    <Button variant="ghost" size="sm" onClick={toggleAllBranches}>
                      {selectedBranches.size === branches.length ? "Deselect All" : "Select All"}
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {branches.map((branch) => (
                      <div
                        key={branch.name}
                        className="flex items-center gap-3 border rounded-lg p-3 hover:bg-muted/50 cursor-pointer"
                        onClick={() => toggleBranch(branch.name)}
                      >
                        <Checkbox
                          checked={selectedBranches.has(branch.name)}
                          onCheckedChange={() => toggleBranch(branch.name)}
                        />
                        <GitBranch className="h-4 w-4 text-muted-foreground" />
                        <span className="flex-1">{branch.name}</span>
                      </div>
                    ))}
                  </div>

                  <Button
                    onClick={handleImport}
                    disabled={selectedBranches.size === 0 || loading}
                    className="w-full"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                    Import {selectedBranches.size} Branch{selectedBranches.size !== 1 ? "es" : ""}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
