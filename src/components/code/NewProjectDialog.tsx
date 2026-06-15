import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { FileCode, Github, Loader2, Unlock } from "lucide-react";
import { toast } from "sonner";
import { GitHubImportDialog } from "./GitHubImportDialog";
import { motion } from "framer-motion";

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateScratch: (name: string, description?: string) => Promise<void>;
  onImportGitHub: (token: string, repo: string, branches: string[]) => Promise<void>;
}

export function NewProjectDialog({
  open,
  onOpenChange,
  onCreateScratch,
  onImportGitHub,
}: NewProjectDialogProps) {
  const [step, setStep] = useState<"choice" | "scratch">("choice");
  const [showGitHubDialog, setShowGitHubDialog] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDesc, setProjectDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const [autoCreateGithub, setAutoCreateGithub] = useState(true);

  const handleCreateScratch = async () => {
    if (!projectName.trim()) {
      toast.error("Project name is required");
      return;
    }

    setLoading(true);
    try {
      await onCreateScratch(projectName.trim(), projectDesc.trim() || undefined);
      onOpenChange(false);
      resetState();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create project");
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
    setProjectName("");
    setProjectDesc("");
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogDescription>
              Choose how you want to start your project
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
                    Create an empty project and build with AI
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
                    Clone an existing repository
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
                <Label htmlFor="name">Project Name</Label>
                <Input
                  id="name"
                  placeholder="my-awesome-project"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
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
                  placeholder="What will you build?"
                  value={projectDesc}
                  onChange={(e) => setProjectDesc(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="border rounded-lg p-4 bg-green-500/10 border-green-500/20 space-y-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="auto-github"
                    checked={autoCreateGithub}
                    onCheckedChange={(checked) => setAutoCreateGithub(checked as boolean)}
                  />
                  <div className="flex-1">
                    <Label htmlFor="auto-github" className="cursor-pointer font-medium text-green-700 dark:text-green-300">
                      🎉 Auto-create GitHub repository (100% FREE)
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Creates <strong>public repo</strong> with 256-char random name • Effectively private, impossible to discover
                    </p>
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1 font-medium">
                      Saves $4/month • Discovery probability: &lt; 1 in 10^450
                    </p>
                  </div>
                </div>
                {autoCreateGithub && (
                  <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400 bg-green-500/5 p-2 rounded">
                    <Unlock className="h-3 w-3" />
                    <span>Public = FREE forever • Name so random it's effectively private</span>
                  </div>
                )}
              </div>

              <Button
                onClick={handleCreateScratch}
                disabled={!projectName.trim() || loading}
                className="w-full"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Create Project {autoCreateGithub && "(+ Free GitHub Repo)"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <GitHubImportDialog
        open={showGitHubDialog}
        onOpenChange={setShowGitHubDialog}
        onImport={handleImportGitHub}
        mode="project"
      />
    </>
  );
}
