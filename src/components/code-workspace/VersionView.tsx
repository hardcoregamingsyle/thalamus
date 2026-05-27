import { GitBranch, Clock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface VersionViewProps {
  branchId: string;
}

export function VersionView({ branchId }: VersionViewProps) {
  return (
    <div className="h-full flex flex-col p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <GitBranch className="h-6 w-6" />
          Version Control
        </h2>
        <p className="text-muted-foreground mt-1">
          Track changes and manage versions
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Version History</CardTitle>
          <CardDescription>
            View and restore previous versions of your codebase
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-12">
            <Clock className="h-16 w-16 mx-auto mb-4 opacity-20" />
            <p>Version history coming soon</p>
            <p className="text-sm mt-2">
              Automatic snapshots of file changes by AI agents
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
