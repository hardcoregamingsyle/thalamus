import { GitBranch, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface GitSyncViewProps {
  projectId: string;
  branchId: string;
}

export function GitSyncView({ projectId, branchId }: GitSyncViewProps) {
  return (
    <div className="h-full flex flex-col p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Github className="h-6 w-6" />
          GitHub Sync
        </h2>
        <p className="text-muted-foreground mt-1">
          Sync your codebase with GitHub repositories
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connect Repository</CardTitle>
          <CardDescription>
            Link this branch to a GitHub repository
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="repo-url">Repository URL</Label>
            <Input
              id="repo-url"
              placeholder="https://github.com/username/repo"
              disabled
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="branch-name">Branch Name</Label>
            <Input id="branch-name" placeholder="main" disabled />
          </div>
          <Button className="w-full gap-2" disabled>
            <Github className="h-4 w-4" />
            Connect GitHub
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            GitHub sync coming soon
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
