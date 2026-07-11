import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Github, Loader2, GitBranch, Plus, Check } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

interface GitHubAccount {
  id: string;
  username: string;
  token: string;
}

interface GitHubRepo {
  name: string;
  full_name: string;
  description: string | null;
  default_branch: string;
  private: boolean;
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
  onImport: (account: string, repo: string, branches: string[]) => Promise<void>;
  mode: "project" | "branch";
}

export function GitHubImportDialog({ open, onOpenChange, onImport, mode }: GitHubImportDialogProps) {
  const [step, setStep] = useState<"accounts" | "repos" | "branches">("accounts");
  const [accounts, setAccounts] = useState<GitHubAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string>("");
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [selectedBranches, setSelectedBranches] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [newAccountToken, setNewAccountToken] = useState("");
  const [showAddAccount, setShowAddAccount] = useState(false);

  const loadAccounts = () => {
    // Load saved GitHub accounts from localStorage
    const saved = localStorage.getItem("github_accounts");
    if (saved) {
      const parsed = JSON.parse(saved);
      setAccounts(parsed);
      if (parsed.length > 0) {
        setSelectedAccount(parsed[0].id);
      }
    }
  };

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- loads saved accounts from localStorage when the dialog opens; a render-time read would change when accounts refresh
      loadAccounts();
    }
  }, [open]);

  const saveAccounts = (accts: GitHubAccount[]) => {
    localStorage.setItem("github_accounts", JSON.stringify(accts));
    setAccounts(accts);
  };

  const handleAddAccount = async () => {
    if (!newAccountToken.trim()) {
      toast.error("Please enter a GitHub token");
      return;
    }

    setLoading(true);
    try {
      // Verify token and get username
      const response = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${newAccountToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Invalid GitHub token");
      }

      const user = await response.json();

      const newAccount: GitHubAccount = {
        id: user.login,
        username: user.login,
        token: newAccountToken,
      };

      const updated = [...accounts, newAccount];
      saveAccounts(updated);
      setSelectedAccount(newAccount.id);
      setNewAccountToken("");
      setShowAddAccount(false);
      toast.success(`Connected ${user.login}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add account");
    } finally {
      setLoading(false);
    }
  };

  const handleLoadRepos = async () => {
    const account = accounts.find((a) => a.id === selectedAccount);
    if (!account) return;

    setLoading(true);
    try {
      const response = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
        headers: {
          Authorization: `Bearer ${account.token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch repositories");
      }

      const data = await response.json();
      setRepos(data);
      setStep("repos");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load repositories");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectRepo = async (repoFullName: string) => {
    setSelectedRepo(repoFullName);
    const account = accounts.find((a) => a.id === selectedAccount);
    if (!account) return;

    setLoading(true);
    try {
      const response = await fetch(`https://api.github.com/repos/${repoFullName}/branches`, {
        headers: {
          Authorization: `Bearer ${account.token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch branches");
      }

      const data = await response.json();
      setBranches(data);

      if (data.length === 1) {
        // Only one branch, auto-select it
        setSelectedBranches(new Set([data[0].name]));
      } else {
        // Multiple branches, show selection
        setStep("branches");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load branches");
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

    const account = accounts.find((a) => a.id === selectedAccount);
    if (!account) return;

    setLoading(true);
    try {
      await onImport(account.token, selectedRepo, Array.from(selectedBranches));
      onOpenChange(false);
      resetState();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLoading(false);
    }
  };

  const resetState = () => {
    setStep("accounts");
    setSelectedRepo("");
    setBranches([]);
    setSelectedBranches(new Set());
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
          <AnimatePresence mode="wait">
            {/* Step 1: Select Account */}
            {step === "accounts" && (
              <motion.div
                key="accounts"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label>GitHub Account</Label>
                  {accounts.length > 0 ? (
                    <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            <div className="flex items-center gap-2">
                              <Github className="h-4 w-4" />
                              {account.username}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-muted-foreground">No GitHub accounts connected</p>
                  )}
                </div>

                {showAddAccount ? (
                  <div className="space-y-3 border rounded-lg p-4">
                    <Label>GitHub Personal Access Token</Label>
                    <Input
                      type="password"
                      placeholder="ghp_xxxxxxxxxxxx"
                      value={newAccountToken}
                      onChange={(e) => setNewAccountToken(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Create token at: github.com/settings/tokens (needs 'repo' scope)
                    </p>
                    <div className="flex gap-2">
                      <Button onClick={handleAddAccount} disabled={loading} className="flex-1">
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        Add Account
                      </Button>
                      <Button variant="outline" onClick={() => setShowAddAccount(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" onClick={() => setShowAddAccount(true)} className="w-full gap-2">
                    <Plus className="h-4 w-4" />
                    Connect Another Account
                  </Button>
                )}

                <Button
                  onClick={handleLoadRepos}
                  disabled={!selectedAccount || loading}
                  className="w-full"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Next: Select Repository
                </Button>
              </motion.div>
            )}

            {/* Step 2: Select Repository */}
            {step === "repos" && (
              <motion.div
                key="repos"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="flex items-center justify-between">
                  <Label>Select Repository</Label>
                  <Button variant="ghost" size="sm" onClick={() => setStep("accounts")}>
                    Back
                  </Button>
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
                            {repo.description && (
                              <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                                {repo.description}
                              </p>
                            )}
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

            {/* Step 3: Select Branches */}
            {step === "branches" && (
              <motion.div
                key="branches"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="flex items-center justify-between">
                  <Label>Select Branches</Label>
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
                  <Label>Branches to import</Label>
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
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Import {selectedBranches.size} Branch{selectedBranches.size !== 1 ? "es" : ""}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
