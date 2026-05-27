import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Database, FileText, Clock } from "lucide-react";
import { motion } from "framer-motion";

interface DataViewProps {
  branchId: string;
}

export function DataView({ branchId }: DataViewProps) {
  const files = useQuery(api.codeBranches.watchFiles, { branchId });
  const messages = useQuery(api.codeBranches.watchMessages, { branchId });

  const formatTimestamp = (ts: number) => {
    return new Date(ts).toLocaleString();
  };

  return (
    <div className="h-full flex flex-col p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Database className="h-6 w-6" />
          Branch Data
        </h2>
        <p className="text-muted-foreground mt-1">
          View all files and messages in this branch
        </p>
      </div>

      {/* Files Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Files ({files?.length || 0})
          </CardTitle>
          <CardDescription>
            All files created and modified by the AI agents
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px]">
            {files === undefined ? (
              <div className="text-center text-muted-foreground py-8">Loading...</div>
            ) : files.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">No files yet</div>
            ) : (
              <div className="space-y-2">
                {files.map((file, idx) => (
                  <motion.div
                    key={file._id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="border rounded-lg p-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-sm font-medium truncate">
                          {file.filepath}
                        </div>
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <span>By: {file.lastModifiedBy}</span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatTimestamp(file.lastModifiedAt)}
                          </span>
                        </div>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {file.content.length} chars
                      </Badge>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Messages Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Messages ({messages?.length || 0})
          </CardTitle>
          <CardDescription>
            All agent communications and user messages
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px]">
            {messages === undefined ? (
              <div className="text-center text-muted-foreground py-8">Loading...</div>
            ) : messages.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">No messages yet</div>
            ) : (
              <div className="space-y-2">
                {messages.map((msg, idx) => (
                  <motion.div
                    key={msg._id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="border rounded-lg p-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold">
                          {msg.agent.slice(0, 2).toUpperCase()}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-sm">{msg.agent}</span>
                          {msg.round !== undefined && (
                            <Badge variant="outline" className="text-xs">R{msg.round}</Badge>
                          )}
                          <span className="text-xs text-muted-foreground ml-auto">
                            {formatTimestamp(msg.createdAt)}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground line-clamp-2">
                          {msg.content}
                        </div>
                      </div>
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
