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
import { Key, Plus, AlertCircle, Plug, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

interface KeysViewProps {
  projectId: string;
  branchId: string;
}

// Parse a server's cached toolsJson — an array on success, {error} on failure.
function parseTools(toolsJson: string | undefined): { tools: Array<{ name: string }>; error: string | null } {
  if (!toolsJson) return { tools: [], error: null };
  try {
    const parsed = JSON.parse(toolsJson);
    if (Array.isArray(parsed)) return { tools: parsed, error: null };
    return { tools: [], error: typeof parsed.error === "string" ? parsed.error : null };
  } catch {
    return { tools: [], error: null };
  }
}

export function KeysView({ projectId, branchId }: KeysViewProps) {
  const token = localStorage.getItem("agentai_session_token") || "";
  const keys = useQuery(api.codeApiKeys.listApiKeys, { token, projectId });
  const pendingRequests = useQuery(api.codeApiKeys.watchApiKeyRequests, { branchId });
  const fulfillRequest = useMutation(api.codeApiKeys.fulfillApiKeyRequest);
  const mcpServers = useQuery(api.mcpServers.listServers, token ? { token } : "skip");
  const addMcpServer = useMutation(api.mcpServers.addServer);
  const removeMcpServer = useMutation(api.mcpServers.removeServer);
  const setMcpEnabled = useMutation(api.mcpServers.setServerEnabled);
  const refreshMcpTools = useMutation(api.mcpServers.refreshServerTools);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyValue, setNewKeyValue] = useState("");
  const [isAdding] = useState(false);

  const [isMcpAddOpen, setIsMcpAddOpen] = useState(false);
  const [mcpName, setMcpName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpAuth, setMcpAuth] = useState("");
  const [mcpAdding, setMcpAdding] = useState(false);

  const handleAddKey = async () => {
    toast.info("Manual API key addition coming soon. Use pending requests for now.");
    setIsAddOpen(false);
  };

  const handleAddMcpServer = async () => {
    if (!mcpName.trim() || !mcpUrl.trim()) {
      toast.error("Name and URL are required");
      return;
    }
    setMcpAdding(true);
    try {
      await addMcpServer({
        token,
        name: mcpName.trim(),
        url: mcpUrl.trim(),
        authHeader: mcpAuth.trim() || undefined,
      });
      toast.success(`MCP server "${mcpName.trim()}" connected — fetching tools…`);
      setIsMcpAddOpen(false);
      setMcpName(""); setMcpUrl(""); setMcpAuth("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add server");
    } finally {
      setMcpAdding(false);
    }
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

      {/* MCP Servers */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Plug className="h-5 w-5" />
                MCP Servers ({mcpServers?.length || 0})
              </CardTitle>
              <CardDescription>
                Connect Model Context Protocol servers — pipeline agents can call their tools
              </CardDescription>
            </div>
            <Dialog open={isMcpAddOpen} onOpenChange={setIsMcpAddOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Connect Server
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Connect MCP Server</DialogTitle>
                  <DialogDescription>
                    Streamable HTTP servers only (https URL). The auth header is encrypted at rest.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="mcpName">Name</Label>
                    <Input id="mcpName" placeholder="github" value={mcpName}
                      onChange={(e) => setMcpName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mcpUrl">Server URL</Label>
                    <Input id="mcpUrl" placeholder="https://example.com/mcp" value={mcpUrl}
                      onChange={(e) => setMcpUrl(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mcpAuth">Auth header (optional)</Label>
                    <Input id="mcpAuth" type="password" placeholder="Authorization: Bearer xyz…" value={mcpAuth}
                      onChange={(e) => setMcpAuth(e.target.value)} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsMcpAddOpen(false)}>Cancel</Button>
                  <Button onClick={handleAddMcpServer} disabled={mcpAdding}>
                    {mcpAdding ? "Connecting…" : "Connect"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {mcpServers === undefined ? (
            <div className="text-center text-muted-foreground py-6">Loading…</div>
          ) : mcpServers.length === 0 ? (
            <div className="text-center text-muted-foreground py-6">
              No MCP servers connected. Add one and agents gain its tools.
            </div>
          ) : (
            <div className="space-y-3">
              {mcpServers.map((server: {
                _id: Id<"mcpServers">; name: string; url: string; hasAuth: boolean;
                enabled: boolean; toolsJson?: string; lastRefreshedAt?: number; createdAt: number;
              }, idx: number) => {
                const { tools, error } = parseTools(server.toolsJson);
                return (
                  <motion.div
                    key={server._id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold">{server.name}</span>
                          <Badge variant={server.enabled ? "default" : "secondary"} className="text-xs">
                            {server.enabled ? "enabled" : "disabled"}
                          </Badge>
                          {server.hasAuth && <Badge variant="outline" className="text-xs">auth</Badge>}
                        </div>
                        <div className="text-sm text-muted-foreground truncate mb-1">{server.url}</div>
                        {error ? (
                          <div className="text-xs text-red-500">Tool fetch failed: {error}</div>
                        ) : (
                          <div className="text-xs text-muted-foreground">
                            {tools.length > 0
                              ? `${tools.length} tools: ${tools.slice(0, 6).map((t) => t.name).join(", ")}${tools.length > 6 ? "…" : ""}`
                              : "Tools not fetched yet"}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="sm" variant="ghost" title="Refresh tools"
                          onClick={async () => {
                            try {
                              await refreshMcpTools({ token, serverId: server._id });
                              toast.success("Refreshing tools…");
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : "Refresh failed");
                            }
                          }}>
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" title={server.enabled ? "Disable" : "Enable"}
                          onClick={async () => {
                            try {
                              await setMcpEnabled({ token, serverId: server._id, enabled: !server.enabled });
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : "Update failed");
                            }
                          }}>
                          <Plug className={`h-4 w-4 ${server.enabled ? "" : "opacity-40"}`} />
                        </Button>
                        <Button size="sm" variant="ghost" title="Remove"
                          onClick={async () => {
                            try {
                              await removeMcpServer({ token, serverId: server._id });
                              toast.success(`Removed "${server.name}"`);
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : "Remove failed");
                            }
                          }}>
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
