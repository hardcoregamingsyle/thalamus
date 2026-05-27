import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Plus, GitBranch, Clock, Play, Pause, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

export default function CodeBranches() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const token = localStorage.getItem("agentai_session_token") || "";

  const project = useQuery(api.codeProjects.getProject, token && projectId ? { token, projectId } : "skip");
  const branches = useQuery(api.codeBranches.listBranches, token && projectId ? { token, projectId } : "skip");
  const createBranch = useMutation(api.codeBranches.createBranch);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchDesc, setNewBranchDesc] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateBranch = async () => {
    if (!newBranchName.trim() || !projectId) {
      toast.error("Branch name is required");
      return;
    }

    setIsCreating(true);
    try {
      const result = await createBranch({
        token,
        projectId,
        name: newBranchName.trim(),
        description: newBranchDesc.trim() || undefined,
      });
      toast.success("Branch created!");
      setIsCreateOpen(false);
      setNewBranchName("");
      setNewBranchDesc("");
      navigate(`/portal/code/${projectId}/${result.branchId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create branch");
    } finally {
      setIsCreating(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "running":
        return <Badge className="gap-1 bg-blue-500"><Loader2 className="h-3 w-3 animate-spin" /> Running</Badge>;
      case "paused":
        return <Badge variant="outline" className="gap-1"><Pause className="h-3 w-3" /> Paused</Badge>;
      case "completed":
        return <Badge className="gap-1 bg-green-500"><CheckCircle2 className="h-3 w-3" /> Completed</Badge>;
      default:
        return <Badge variant="secondary" className="gap-1"><Play className="h-3 w-3" /> Ready</Badge>;
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

    return date.toLocaleDateString();
  };

  if (!projectId) {
    return <div className="p-8">Invalid project ID</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center gap-4 mb-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/portal/code")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex-1">
              <h1 className="text-3xl font-bold tracking-tight">
                {project?.name || "Loading..."}
              </h1>
              <p className="text-muted-foreground mt-1">
                {project?.description || "Manage your project branches"}
              </p>
            </div>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button size="lg" className="gap-2">
                  <Plus className="h-5 w-5" />
                  New Branch
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Branch</DialogTitle>
                  <DialogDescription>
                    Create a new development branch with its own codebase
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Branch Name</Label>
                    <Input
                      id="name"
                      placeholder="feature-xyz"
                      value={newBranchName}
                      onChange={(e) => setNewBranchName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleCreateBranch()}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description (Optional)</Label>
                    <Textarea
                      id="description"
                      placeholder="What will you build in this branch?"
                      value={newBranchDesc}
                      onChange={(e) => setNewBranchDesc(e.target.value)}
                      rows={3}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreateBranch} disabled={isCreating}>
                    {isCreating ? "Creating..." : "Create Branch"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <div className="font-mono text-sm text-muted-foreground">
            Project ID: {projectId}
          </div>
        </div>
      </div>

      {/* Branches Grid */}
      <div className="container mx-auto px-6 py-8">
        {branches === undefined ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="h-6 bg-muted rounded w-3/4" />
                  <div className="h-4 bg-muted rounded w-full mt-2" />
                </CardHeader>
                <CardContent>
                  <div className="h-4 bg-muted rounded w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : branches.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-20"
          >
            <div className="rounded-full bg-primary/10 p-6 mb-6">
              <GitBranch className="h-12 w-12 text-primary" />
            </div>
            <h2 className="text-2xl font-semibold mb-2">No branches yet</h2>
            <p className="text-muted-foreground mb-6 text-center max-w-md">
              Create your first branch to start coding
            </p>
            <Button size="lg" onClick={() => setIsCreateOpen(true)} className="gap-2">
              <Plus className="h-5 w-5" />
              Create Your First Branch
            </Button>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {branches.map((branch: any, index: number) => (
              <motion.div
                key={branch._id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Card
                  className="h-full hover:shadow-lg transition-all duration-200 border-2 hover:border-primary/50 cursor-pointer group"
                  onClick={() => navigate(`/portal/code/${projectId}/${branch.branchId}`)}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <GitBranch className="h-5 w-5 text-muted-foreground" />
                          <CardTitle className="group-hover:text-primary transition-colors">
                            {branch.name}
                          </CardTitle>
                        </div>
                        <CardDescription className="line-clamp-2">
                          {branch.description || "No description"}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      {getStatusBadge(branch.status)}
                      {branch.currentAgent && (
                        <Badge variant="outline" className="text-xs">
                          {branch.currentAgent}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {formatDate(branch.lastActivityAt)}
                      </div>
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      ID: {branch.branchId}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
