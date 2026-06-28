import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FileCode, Github, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { GitHubImportDialog } from "./GitHubImportDialog";
import { motion } from "framer-motion";

interface NewBranchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onCreateScratch: (name: string, description?: string) => Promise<void>;
  onImportGitHub: (token: string, repo: string, branches: string[]) => Promise<void>;
}

export function NewBranchDialog({
  open,
  onOpenChange,
  projectId,
  onCreateScratch,
  onImportGitHub,
}: NewBranchDialogProps) {
  const [step, setStep] = useState<"choice" | "scratch">("choice");
  const [showGitHubDialog, setShowGitHubDialog] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [branchDesc, setBranchDesc] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreateScratch = async () => {
    if (!branchName.trim()) {
      toast.error("Branch name is required");
      return;
    }

    setLoading(true);
    try {
      await onCreateScratch(branchName.trim(), branchDesc.trim() || undefined);
      onOpenChange(false);
      resetState();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create branch");
    } finally {
      setLoading(false);
    }
  };

  const handleImportGitHub = async (token: string, repo: string, branches: string[]) => {
    setLoading(true);
    try {
      await onImportGitHub(token, repo, branches);
      setShowGitHubDialog(false);
      onOpenChange(false);
      resetState();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to import from GitHub");
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const resetState = () => {
    setStep("choice");
    setBranchName("");
    setBranchDesc("");
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Branch</DialogTitle>
            <DialogDescription>
              Choose how you want to create your branch
            </DialogDescription>
          </DialogHeader>

          {step === "choice" && (
            <div className="grid gap-4 py-4">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setStep("scratch")}
                className="flex items-start gap-4 p-6 border-2 rounded-lg hover:border-primary transition-colors text-left"
              >
                <div className="rounded-lg bg-primary/10 p-3">
                  <FileCode className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">Start from Scratch</h3>
                  <p className="text-sm text-muted-foreground">
                    Create an empty branch and build with AI
                  </p>
                </div>
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowGitHubDialog(true)}
                className="flex items-start gap-4 p-6 border-2 rounded-lg hover:border-primary transition-colors text-left"
              >
                <div className="rounded-lg bg-primary/10 p-3">
                  <Github className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">Import from GitHub</h3>
                  <p className="text-sm text-muted-foreground">
                    Import specific branch from a repository
                  </p>
                </div>
              </motion.button>
            </div>
          )}

          {step === "scratch" && (
            <div className="space-y-4 py-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep("choice")}
                className="mb-2"
              >
                ← Back
              </Button>

              <div className="space-y-2">
                <Label htmlFor="name">Branch Name</Label>
                <Input
                  id="name"
                  placeholder="feature/new-feature"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleCreateScratch();
                    }
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Textarea
                  id="description"
                  placeholder="What will this branch contain?"
                  value={branchDesc}
                  onChange={(e) => setBranchDesc(e.target.value)}
                  rows={3}
                />
              </div>

              <Button
                onClick={handleCreateScratch}
                disabled={!branchName.trim() || loading}
                className="w-full"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Create Branch
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <GitHubImportDialog
        open={showGitHubDialog}
        onOpenChange={setShowGitHubDialog}
        onImport={handleImportGitHub}
        mode="branch"
      />
    </>
  );
}
