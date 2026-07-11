import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { BarChart3, Database, FileText, MessageSquare, Terminal, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "framer-motion";

interface UsageViewProps {
  branchId: string;
}

export function UsageView({ branchId }: UsageViewProps) {
  const files = useQuery(api.codeBranches.watchFiles, { branchId });
  const messages = useQuery(api.codeBranches.watchMessages, { branchId });
  const commands = useQuery(api.codeCommands.watchCommands, { branchId });

  const totalFiles = files?.length || 0;
  const totalMessages = messages?.length || 0;
  const totalCommands = commands?.length || 0;
  const totalChars = files?.reduce((sum: number, f: Doc<"codeFiles">) => sum + f.content.length, 0) || 0;
  const storageKB = (totalChars / 1024).toFixed(1);

  const stats = [
    { icon: FileText, label: "Files Created", value: totalFiles, color: "text-blue-500" },
    { icon: MessageSquare, label: "Agent Messages", value: totalMessages, color: "text-green-500" },
    { icon: Terminal, label: "Commands Run", value: totalCommands, color: "text-purple-500" },
    { icon: Database, label: "Storage Used", value: `${storageKB} KB`, color: "text-orange-500" },
  ];

  return (
    <div className="h-full flex flex-col p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="h-6 w-6" />
          Branch Usage
        </h2>
        <p className="text-muted-foreground mt-1">
          Database operations and resource usage
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, idx) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.1 }}>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-sm text-muted-foreground mt-1">{stat.label}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Database Records</CardTitle>
            <CardDescription>Record counts by table</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Files</span>
                <span className="text-sm text-muted-foreground">{totalFiles} records</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Messages</span>
                <span className="text-sm text-muted-foreground">{totalMessages} records</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Commands</span>
                <span className="text-sm text-muted-foreground">{totalCommands} records</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Storage Breakdown</CardTitle>
            <CardDescription>Data usage by category</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Code Files</span>
                <span className="text-sm text-muted-foreground">{storageKB} KB</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Message Content</span>
                <span className="text-sm text-muted-foreground">
                  {((messages?.reduce((sum: number, m: Doc<"codeMessages">) => sum + m.content.length, 0) || 0) / 1024).toFixed(1)} KB
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
