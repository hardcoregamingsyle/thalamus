import { BarChart3 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface UsageViewProps {
  branchId: string;
}

export function UsageView({ branchId }: UsageViewProps) {
  return (
    <div className="h-full flex flex-col p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="h-6 w-6" />
          Convex Usage
        </h2>
        <p className="text-muted-foreground mt-1">
          Database and function execution metrics
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Resource Usage</CardTitle>
          <CardDescription>
            Real-time usage metrics for this branch
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-12">
            <BarChart3 className="h-16 w-16 mx-auto mb-4 opacity-20" />
            <p>Usage analytics coming soon</p>
            <p className="text-sm mt-2">
              Track database reads, writes, and function executions
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
