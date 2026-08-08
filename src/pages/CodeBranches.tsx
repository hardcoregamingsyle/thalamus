import { useState, useEffect } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc } from "@/convex/_generated/dataModel";
import { useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Plus, GitBranch, Clock, Play, Pause, CheckCircle2, Loader2, LayoutDashboard, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { NewBranchDialog } from "@/components/code/NewBranchDialog";
import { useAuth } from "@/hooks/use-auth";

export default function CodeBranches() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  // useAuth (not a raw localStorage read) so an expired or revoked session
  // redirects to /auth instead of surfacing as a failed Convex query.
  const { token: authToken, isLoading, isAuthenticated } = useAuth();
  const token = authToken ?? "";
  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate("/auth", { replace: true });
  }, [isLoading, isAuthenticated, navigate]);

  const project = useQuery(api.codeProjects.getProject, token && projectId ? { token, projectId } : "skip");
  const branches = useQuery(api.codeBranches.listBranches, token && projectId ? { token, projectId } : "skip");
  const createBranch = useMutation(api.codeBranches.createBranch);
  const cloneRepository = useAction(api.githubSync.cloneRepository);
  const deleteBranch = useMutation(api.codeBranches.deleteBranch);

  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const handleCreateScratch = async (name: string, description?: string) => {
    if (!projectId) return;

    const result = await createBranch({
      token,
      projectId,
      name,
      description,
    });
    toast.success("Branch created!");
    navigate(`/portal/code/${projectId}/${result.branchId}`);
  };

  const handleImportGitHub = async (repo: string, branches: string[]) => {
    if (!projectId) return;

    // Import each selected branch. autoCreateRepo:false — cloneRepository
    // makes the platform repo once the files are in, so it can seed it with
    // real code instead of an empty README.
    let imported = 0;
    for (const branchName of branches) {
      try {
        const result = await createBranch({
          token,
          projectId,
          name: branchName,
          description: `Imported from GitHub: ${repo}/${branchName}`,
          autoCreateRepo: false,
        });

        await cloneRepository({
          token,
          projectId,
          branchId: result.branchId,
          repoUrl: `https://github.com/${repo}`,
          sourceBranch: branchName,
          projectName: project?.name,
        });
        imported++;
      } catch (err) {
        toast.error(`Failed to import ${branchName}: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }

    if (imported > 0) {
      toast.success(`Imported ${imported} branch${imported === 1 ? "" : "es"} from ${repo}`);
      navigate(`/portal/code/${projectId}`);
    }
  };

  const handleDeleteBranch = async (e: React.MouseEvent, branch: Doc<"codeBranches">) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete "${branch.name}"? This deletes all branch data and its GitHub repo.`)) {
      return;
    }
    try {
      await deleteBranch({ token, branchId: branch.branchId });
      toast.success("Branch deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete branch");
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

  // Captured once so render stays pure (react-hooks/purity)
  const [now] = useState(() => Date.now());
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
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
      <meta name="robots" content="noindex" />
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
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate("/portal/chat")}>
                <LayoutDashboard className="h-4 w-4" />
                Portal
              </Button>
              <Button size="lg" className="gap-2" onClick={() => setIsCreateOpen(true)}>
                <Plus className="h-5 w-5" />
                New Branch
              </Button>
            </div>

            <NewBranchDialog
              open={isCreateOpen}
              onOpenChange={setIsCreateOpen}
              projectId={projectId}
              onCreateScratch={handleCreateScratch}
              onImportGitHub={handleImportGitHub}
            />
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
            {branches.map((branch: Doc<"codeBranches">, index: number) => (
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
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 shrink-0"
                        onClick={(e) => handleDeleteBranch(e, branch)}
                        aria-label={`Delete ${branch.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
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
