import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Key, Plus, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

interface KeysViewProps {
  projectId: string;
  branchId: string;
}

export function KeysView({ projectId, branchId }: KeysViewProps) {
  const token = localStorage.getItem("agentai_session_token") || "";
  const keys = useQuery(api.codeApiKeys.listApiKeys, { token, projectId });
  const pendingRequests = useQuery(api.codeApiKeys.watchApiKeyRequests, { branchId });
  const fulfillRequest = useMutation(api.codeApiKeys.fulfillApiKeyRequest);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyValue, setNewKeyValue] = useState("");
  const [isAdding] = useState(false);

  const handleAddKey = async () => {
    toast.info("Manual API key addition coming soon. Use pending requests for now.");
    setIsAddOpen(false);
  };

  const handleFulfillRequest = async (requestId: Id<"codeApiKeyRequests">, variableName: string) => {
    const value = prompt(`Enter value for ${variableName}:`);
    if (!value) return;

    try {
      await fulfillRequest({ token, requestId, value });
      toast.success(`${variableName} added!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fulfill request");
    }
  };

  return (
    <div className="h-full flex flex-col p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Key className="h-6 w-6" />
            API Keys
          </h2>
          <p className="text-muted-foreground mt-1">
            Manage API keys for this project
          </p>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Add Key
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add API Key</DialogTitle>
              <DialogDescription>
                Add a new API key for your project
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="keyName">Key Name</Label>
                <Input
                  id="keyName"
                  placeholder="OPENAI_API_KEY"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="keyValue">Key Value</Label>
                <Input
                  id="keyValue"
                  type="password"
                  placeholder="sk-..."
                  value={newKeyValue}
                  onChange={(e) => setNewKeyValue(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddKey} disabled={isAdding}>
                {isAdding ? "Adding..." : "Add Key"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Pending Requests */}
      {pendingRequests && pendingRequests.length > 0 && (
        <Card className="border-orange-500/50 bg-orange-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-600">
              <AlertCircle className="h-5 w-5" />
              Pending Requests ({pendingRequests.length})
            </CardTitle>
            <CardDescription>
              The AI agents are waiting for these API keys
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingRequests.map((req: Doc<"codeApiKeyRequests">, idx: number) => (
                <motion.div
                  key={req._id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="flex items-center justify-between p-3 border rounded-lg bg-background"
                >
                  <div>
                    <div className="font-semibold">{req.variableName}</div>
                    <div className="text-sm text-muted-foreground">
                      Requested by {req.agent}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleFulfillRequest(req._id, req.variableName)}
                  >
                    Fulfill
                  </Button>
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Existing Keys */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Stored Keys ({keys?.length || 0})
          </CardTitle>
          <CardDescription>
            API keys available across all branches in this project
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            {keys === undefined ? (
              <div className="text-center text-muted-foreground py-8">Loading...</div>
            ) : keys.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No API keys yet. Add one to get started.
              </div>
            ) : (
              <div className="space-y-3">
                {keys.map((key: Doc<"codeApiKeys">, idx: number) => (
                  <motion.div
                    key={key._id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-semibold">{key.variableName}</span>
                          <Badge variant="outline" className="text-xs">
                            {new Date(key.createdAt).toLocaleDateString()}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground mb-2">
                          {key.description || "No description"}
                        </div>
                        <div className="font-mono text-sm bg-muted/50 rounded px-3 py-2">
                          <code className="flex-1 truncate">
                            ••••••••••••••••
                          </code>
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
