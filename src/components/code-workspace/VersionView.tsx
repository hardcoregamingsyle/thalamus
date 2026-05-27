import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { GitBranch, FileText, Clock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { motion } from "framer-motion";

interface VersionViewProps {
  branchId: string;
}

export function VersionView({ branchId }: VersionViewProps) {
  const files = useQuery(api.codeBranches.watchFiles, { branchId });

  // Group files by last modified time to simulate snapshots
  const snapshots = files?.reduce((acc: any[], file) => {
    const existing = acc.find(s => Math.abs(s.timestamp - file.lastModifiedAt) < 60000); // Within 1 minute
    if (existing) {
      existing.files.push(file);
    } else {
      acc.push({
        timestamp: file.lastModifiedAt,
        agent: file.lastModifiedBy,
        files: [file],
      });
    }
    return acc;
  }, []).sort((a, b) => b.timestamp - a.timestamp) || [];

  return (
    <div className="h-full flex flex-col p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <GitBranch className="h-6 w-6" />
            Version History
          </h2>
          <p className="text-muted-foreground mt-1">
            Track file changes over time
          </p>
        </div>
        <Badge variant="outline">{snapshots.length} snapshots</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Change History</CardTitle>
          <CardDescription>
            All file modifications grouped by time
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[600px]">
            {files === undefined ? (
              <div className="text-center text-muted-foreground py-8">Loading...</div>
            ) : snapshots.length === 0 ? (
              <div className="text-center text-muted-foreground py-12">
                <GitBranch className="h-16 w-16 mx-auto mb-4 opacity-20" />
                <p>No versions yet</p>
                <p className="text-sm mt-2">
                  File versions will appear here after agents create files
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {snapshots.map((snapshot, idx) => (
                  <motion.div
                    key={snapshot.timestamp}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="border rounded-lg p-4"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <span className="font-semibold">
                            {new Date(snapshot.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Modified by {snapshot.agent}
                        </div>
                      </div>
                      <Badge variant="outline">{snapshot.files.length} files</Badge>
                    </div>
                    <div className="space-y-2">
                      {snapshot.files.map((file: any) => (
                        <div
                          key={file._id}
                          className="flex items-center gap-3 text-sm bg-muted/30 rounded px-3 py-2"
                        >
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="font-mono flex-1 truncate">{file.filepath}</span>
                          <Badge variant="secondary" className="text-xs">
                            {(file.content.length / 1024).toFixed(1)} KB
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
