import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, FolderGit2, Clock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { NewProjectDialog } from "@/components/code/NewProjectDialog";

export default function CodeProjects() {
  const navigate = useNavigate();
  const token = localStorage.getItem("agentai_session_token") || "";
  const projects = useQuery(api.codeProjects.listProjects, token ? { token } : "skip");
  const createProject = useMutation(api.codeProjects.createProject);
  const deleteProject = useMutation(api.codeProjects.deleteProject);
  const cloneRepository = useAction(api.githubSync.cloneRepository);

  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const handleCreateScratch = async (name: string, description?: string) => {
    const result = await createProject({
      token,
      name,
      description,
    });
    toast.success("Project created!");
    navigate(`/portal/code/${result.projectId}`);
  };

  const handleImportGitHub = async (githubToken: string, repo: string, branches: string[]) => {
    // Create project first
    const projectName = repo.split("/")[1] || repo;
    const result = await createProject({
      token,
      name: projectName,
      description: `Imported from GitHub: ${repo}`,
    });

    const projectId = result.projectId;

    // Import each branch
    for (const branch of branches) {
      try {
        await cloneRepository({
          token,
          projectId,
          branchId: result.mainBranchId, // Will create branches dynamically
          repoUrl: `https://github.com/${repo}`,
          githubToken,
        });
        toast.success(`Imported branch: ${branch}`);
      } catch (err) {
        toast.error(`Failed to import ${branch}: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }

    navigate(`/portal/code/${projectId}`);
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!confirm("Are you sure you want to delete this project? This will delete all branches and data.")) {
      return;
    }

    try {
      await deleteProject({ token, projectId });
      toast.success("Project deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete project");
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Thalamus Code</h1>
              <p className="text-muted-foreground mt-1">Build anything with AI-powered development</p>
            </div>
            <Button size="lg" className="gap-2" onClick={() => setIsCreateOpen(true)}>
              <Plus className="h-5 w-5" />
              New Project
            </Button>

            <NewProjectDialog
              open={isCreateOpen}
              onOpenChange={setIsCreateOpen}
              onCreateScratch={handleCreateScratch}
              onImportGitHub={handleImportGitHub}
            />
          </div>
        </div>
      </div>

      {/* Projects Grid */}
      <div className="container mx-auto px-6 py-8">
        {projects === undefined ? (
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
        ) : projects.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-20"
          >
            <div className="rounded-full bg-primary/10 p-6 mb-6">
              <FolderGit2 className="h-12 w-12 text-primary" />
            </div>
            <h2 className="text-2xl font-semibold mb-2">No projects yet</h2>
            <p className="text-muted-foreground mb-6 text-center max-w-md">
              Create your first project to start building with AI-powered development
            </p>
            <Button size="lg" onClick={() => setIsCreateOpen(true)} className="gap-2">
              <Plus className="h-5 w-5" />
              Create Your First Project
            </Button>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project: any, index: number) => (
              <motion.div
                key={project._id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="h-full hover:shadow-lg transition-all duration-200 border-2 hover:border-primary/50 cursor-pointer group">
                  <div onClick={() => navigate(`/portal/code/${project.projectId}`)}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="group-hover:text-primary transition-colors">
                            {project.name}
                          </CardTitle>
                          <CardDescription className="mt-2 line-clamp-2">
                            {project.description || "No description"}
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {formatDate(project.lastActivityAt)}
                        </div>
                        <div className="font-mono text-xs bg-muted px-2 py-1 rounded">
                          {project.projectId}
                        </div>
                      </div>
                    </CardContent>
                  </div>
                  <CardFooter className="border-t pt-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteProject(project.projectId);
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </Button>
                  </CardFooter>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
