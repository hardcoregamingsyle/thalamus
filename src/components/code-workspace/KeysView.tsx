// KeysView — project-scoped API keys and MCP servers for a branch.
//
// Reads codeApiKeys.listApiKeys (project-wide) and codeApiKeys
// .watchApiKeyRequests (branch-scoped pending requests), plus mcpServers
// .listServers. Mutations: mcpServers.{addServer, removeServer,
// setServerEnabled, refreshServerTools} and codeApiKeys.fulfillApiKeyRequest.
//
// Pipeline coupling: pending API-key requests are the visible half of the
// {"op":"request-api-key"} pause in codePipeline. When an agent emits that
// op, the branch parks as `paused` and a codeApiKeyRequests row appears
// here; codeApiKeys.fulfillApiKeyRequest writes the value and reschedules
// runPipelineAction, resuming the pipeline. Nothing else here touches the
// pipeline lifecycle.

import { useState } from "react";
import { useAction, useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Key, Plus, AlertCircle, Plug, RefreshCw, Trash2, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { errMsg } from "@/lib/errorMessage";
import { getSessionToken } from "@/lib/session";

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
  const token = getSessionToken() ?? ""; // parent route (CodeWorkspace) is auth-gated
  const keys = useQuery(api.codeApiKeys.listApiKeys, { token, projectId });
  const pendingRequests = useQuery(api.codeApiKeys.watchApiKeyRequests, { branchId });
  const fulfillRequest = useMutation(api.codeApiKeys.fulfillApiKeyRequest);
  const mcpServers = useQuery(api.mcpServers.listServers, token ? { token } : "skip");
  const addMcpServer = useMutation(api.mcpServers.addServer);
  const removeMcpServer = useMutation(api.mcpServers.removeServer);
  const setMcpEnabled = useMutation(api.mcpServers.setServerEnabled);
  const refreshMcpTools = useMutation(api.mcpServers.refreshServerTools);
  const checkBuiltInMcp = useAction(api.codePipeline.checkBuiltInMcpServers);

  // Built-in servers (AgentOverflow, Sketchfab) live in the deployment env, not
  // in the user's table, so they can't be a reactive query — this is an on-
  // demand live handshake. Left un-run on mount: it costs two network
  // round-trips and only matters when someone is asking "is MCP actually on?".
  const [builtIn, setBuiltIn] = useState<Array<{
    name: string; url: string | null; keyed: boolean; ok: boolean; detail: string; tools: string[];
  }> | null>(null);
  const [checkingBuiltIn, setCheckingBuiltIn] = useState(false);

  const handleCheckBuiltIn = async () => {
    setCheckingBuiltIn(true);
    try {
      setBuiltIn(await checkBuiltInMcp({ token }));
    } catch (err) {
      toast.error(errMsg(err, "Built-in MCP check failed"));
    } finally {
      setCheckingBuiltIn(false);
    }
  };

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
      toast.error(errMsg(err, "Failed to add server"));
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
      toast.error(errMsg(err, "Failed to fulfill request"));
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
                {/* The query returns a projection (no `value` field — secrets
                    stay server-side), so the element type is inferred rather
                    than annotated as the full Doc. */}
                {keys.map((key, idx) => (
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
                MCP Servers ({(mcpServers?.length || 0) + 2})
              </CardTitle>
              <CardDescription>
                AgentOverflow and Sketchfab are built in and attached to every run. Connect your own
                Model Context Protocol servers below and agents can call their tools too.
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
        <CardContent className="space-y-4">
          {/* Built-in servers. These used to be invisible here, so a run with
              two working MCP servers attached displayed "MCP Servers (0)" — and
              when a call did fail there was no way to tell a bad env var apart
              from a dead upstream without reading Convex logs. */}
          <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="font-semibold text-sm">Built in — always attached</div>
                <div className="text-xs text-muted-foreground">
                  agentoverflow (corpus search + learnings) · sketchfab (3D model catalogue)
                </div>
              </div>
              <Button size="sm" variant="outline" className="gap-2" onClick={handleCheckBuiltIn} disabled={checkingBuiltIn}>
                {checkingBuiltIn ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {checkingBuiltIn ? "Checking…" : "Check now"}
              </Button>
            </div>
            {builtIn === null ? (
              <div className="text-xs text-muted-foreground">
                Press <strong>Check now</strong> to handshake both servers and list their live tools.
              </div>
            ) : (
              <div className="space-y-2">
                {builtIn.map((s) => (
                  <div key={s.name} className="text-xs">
                    <div className="flex items-center gap-2">
                      {s.ok
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                        : <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                      <span className="font-semibold">{s.name}</span>
                      {s.keyed && <Badge variant="outline" className="text-[10px]">keyed</Badge>}
                    </div>
                    <div className={`ml-5 ${s.ok ? "text-muted-foreground" : "text-destructive"}`}>{s.detail}</div>
                    {s.tools.length > 0 && (
                      <div className="ml-5 text-muted-foreground/70">tools: {s.tools.join(", ")}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {mcpServers === undefined ? (
            <div className="text-center text-muted-foreground py-6">Loading…</div>
          ) : mcpServers.length === 0 ? (
            <div className="text-center text-muted-foreground py-6">
              No servers of your own connected. Add one and agents gain its tools alongside the built-ins.
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
                        <Button size="sm" variant="ghost" title="Refresh tools" aria-label={`Refresh tools for ${server.name}`}
                          onClick={async () => {
                            try {
                              await refreshMcpTools({ token, serverId: server._id });
                              toast.success("Refreshing tools…");
                            } catch (err) {
                              toast.error(errMsg(err, "Refresh failed"));
                            }
                          }}>
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" title={server.enabled ? "Disable" : "Enable"} aria-label={`${server.enabled ? "Disable" : "Enable"} ${server.name}`}
                          onClick={async () => {
                            try {
                              await setMcpEnabled({ token, serverId: server._id, enabled: !server.enabled });
                            } catch (err) {
                              toast.error(errMsg(err, "Update failed"));
                            }
                          }}>
                          <Plug className={`h-4 w-4 ${server.enabled ? "" : "opacity-40"}`} />
                        </Button>
                        <Button size="sm" variant="ghost" title="Remove" aria-label={`Remove ${server.name}`}
                          onClick={async () => {
                            try {
                              await removeMcpServer({ token, serverId: server._id });
                              toast.success(`Removed "${server.name}"`);
                            } catch (err) {
                              toast.error(errMsg(err, "Remove failed"));
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
