import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { useQuery, useMutation, useAction } from "convex/react";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  MessageSquare, Search, Plus, Trash2, LogOut,
  Send, Loader2, DollarSign, Menu, X, Users, Cpu,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import TeamPortalInline from "./TeamPortalInline";

type Mode = "chat" | "research" | "code";

interface Conversation {
  _id: Id<"conversations">;
  title: string;
  mode: Mode;
  lastMessageAt?: number;
}

interface Message {
  _id: Id<"messages">;
  role: "user" | "assistant";
  content: string;
  tokensUsed?: number;
  costCents?: number;
}

const MODES: { id: Mode; label: string; icon: typeof MessageSquare; desc: string; color: string }[] = [
  { id: "chat", label: "CHAT", icon: MessageSquare, desc: "General conversation", color: "text-primary" },
  { id: "research", label: "RESEARCH", icon: Search, desc: "Deep research & analysis", color: "text-accent" },
  { id: "code", label: "AGENT TEAMS", icon: Users, desc: "Multi-agent AI system", color: "text-violet-400" },
];

export default function Portal() {
  const { isLoading, isAuthenticated, user, signOut, token } = useAuth();
  const navigate = useNavigate();
  const [activeMode, setActiveMode] = useState<Mode>("chat");
  const [activeConvId, setActiveConvId] = useState<Id<"conversations"> | null>(null);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const conversations = useQuery(
    api.conversations.list,
    token ? { token } : "skip"
  ) as Conversation[] | undefined;
  const messages = useQuery(
    api.conversations.getMessages,
    activeConvId && token ? { conversationId: activeConvId, token } : "skip"
  ) as Message[] | undefined;
  const createConversation = useMutation(api.conversations.create);
  const deleteConversation = useMutation(api.conversations.remove);
  const sendMessage = useAction(api.ai.sendMessage);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate("/auth");
  }, [isLoading, isAuthenticated, navigate]);

  useEffect(() => {
    const el = document.getElementById("messages-end");
    el?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleNewConversation = async () => {
    if (!token) return;
    try {
      const id = await createConversation({
        title: `${activeMode.toUpperCase()}_${Date.now().toString(36).toUpperCase()}`,
        mode: activeMode,
        token,
      });
      setActiveConvId(id);
    } catch {
      toast.error("Failed to create conversation");
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isThinking || !token) return;
    let convId = activeConvId;
    if (!convId) {
      try {
        convId = await createConversation({ title: input.slice(0, 40), mode: activeMode, token });
        setActiveConvId(convId);
      } catch {
        toast.error("Failed to create conversation");
        return;
      }
    }
    const msg = input.trim();
    setInput("");
    setIsThinking(true);
    try {
      await sendMessage({ conversationId: convId, content: msg, mode: activeMode, token });
    } catch {
      toast.error("Agent failed to respond. Try again.");
    } finally {
      setIsThinking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const usageDollars = (((user as { totalUsageCents?: number } | null)?.totalUsageCents || 0) / 100).toFixed(4);
  const filteredConvs = conversations?.filter((c: Conversation) => c.mode === activeMode) || [];

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 text-primary animate-spin" />
          <p className="text-primary font-mono text-xs animate-pulse">INITIALIZING AGENT_AI...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background font-mono overflow-hidden">
      {/* Header */}
      <header className="shrink-0 border-b border-border bg-card/80 backdrop-blur-sm z-20">
        <div className="flex items-center justify-between px-4 h-12">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(o => !o)} className="text-muted-foreground hover:text-primary transition-colors p-1 rounded hover:bg-primary/10 md:hidden">
              {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-primary/20 border border-primary/40 flex items-center justify-center">
                <Cpu className="h-3 w-3 text-primary" />
              </div>
              <span className="text-primary font-bold text-sm tracking-widest amd-glow">AGENT_AI</span>
            </div>
            <span className="hidden sm:block text-[10px] text-muted-foreground border border-border px-1.5 py-0.5 rounded">PORTAL</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground border border-border px-2 py-1 rounded">
              <DollarSign className="h-3 w-3 text-accent" />
              <span>${usageDollars}</span>
            </div>
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors p-1.5 rounded hover:bg-primary/10"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — only show for chat/research modes */}
        <AnimatePresence>
          {sidebarOpen && activeMode !== "code" && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 220, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="shrink-0 border-r border-border bg-card flex flex-col overflow-hidden"
            >
              {/* Mode tabs */}
              <div className="shrink-0 p-3 border-b border-border space-y-1">
                {MODES.map(mode => (
                  <button
                    key={mode.id}
                    onClick={() => { setActiveMode(mode.id); setActiveConvId(null); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded text-xs transition-all ${
                      activeMode === mode.id
                        ? "bg-primary/15 border border-primary/30 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }`}
                  >
                    <mode.icon className={`h-3.5 w-3.5 ${activeMode === mode.id ? mode.color : ""}`} />
                    <span className="font-bold">{mode.label}</span>
                    <span className="text-[10px] opacity-60 ml-auto">{mode.desc.split(" ")[0]}</span>
                  </button>
                ))}
              </div>

              {/* Conversations */}
              <div className="shrink-0 px-3 pt-3 pb-2 flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground font-bold">SESSIONS</span>
                <button
                  onClick={handleNewConversation}
                  className="w-5 h-5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary transition-all flex items-center justify-center"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>

              <ScrollArea className="flex-1">
                <div className="px-2 pb-2 space-y-0.5">
                  {filteredConvs.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground px-2 py-4 text-center">No sessions yet</p>
                  ) : (
                    filteredConvs.map((conv: Conversation) => (
                      <div
                        key={conv._id}
                        onClick={() => setActiveConvId(conv._id)}
                        className={`group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-all ${
                          activeConvId === conv._id
                            ? "bg-primary/15 border border-primary/20 text-primary"
                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                        }`}
                      >
                        <span className="text-[10px] flex-1 truncate">{conv.title}</span>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!token) return;
                            try {
                              await deleteConversation({ id: conv._id, token });
                              if (activeConvId === conv._id) setActiveConvId(null);
                            } catch { toast.error("Failed to delete"); }
                          }}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Agent Teams mode — full inline TeamPortal */}
        {activeMode === "code" && (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {/* Mode switcher strip */}
            <div className="shrink-0 px-4 py-2 border-b border-border bg-card/50 flex items-center gap-3">
              {MODES.map(mode => (
                <button
                  key={mode.id}
                  onClick={() => { setActiveMode(mode.id); setActiveConvId(null); }}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs transition-all ${
                    activeMode === mode.id
                      ? `bg-primary/15 border border-primary/30 ${mode.color} font-bold`
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  <mode.icon className="h-3 w-3" />
                  {mode.label}
                </button>
              ))}
            </div>
            <TeamPortalInline token={token ?? ""} />
          </div>
        )}

        {/* Chat / Research mode */}
        {activeMode !== "code" && (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {/* Mode indicator */}
            <div className="shrink-0 px-4 py-2 border-b border-border bg-card/50 flex items-center gap-3">
              {MODES.filter(m => m.id !== "code").map(mode => (
                <button
                  key={mode.id}
                  onClick={() => { setActiveMode(mode.id); setActiveConvId(null); }}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs transition-all ${
                    activeMode === mode.id
                      ? `bg-primary/15 border border-primary/30 ${mode.color} font-bold`
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  <mode.icon className="h-3 w-3" />
                  {mode.label}
                </button>
              ))}
              <button
                onClick={() => setActiveMode("code")}
                className="flex items-center gap-1.5 px-3 py-1 rounded text-xs text-muted-foreground hover:text-violet-400 hover:bg-muted/50 transition-all ml-auto"
              >
                <Users className="h-3 w-3" />
                AGENT TEAMS
              </button>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4 max-w-4xl mx-auto">
                {!activeConvId ? (
                  <div className="flex flex-col items-center justify-center h-64 gap-4">
                    <motion.div
                      animate={{ scale: [1, 1.05, 1] }}
                      transition={{ duration: 3, repeat: Infinity }}
                      className="w-16 h-16 rounded-2xl border border-primary/30 bg-primary/10 flex items-center justify-center"
                    >
                      <Cpu className="h-8 w-8 text-primary" />
                    </motion.div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-foreground mb-1">AgentAI Portal</p>
                      <p className="text-xs text-muted-foreground">Start a new session or select an existing one</p>
                    </div>
                    <button
                      onClick={handleNewConversation}
                      className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 text-primary text-xs rounded-lg hover:bg-primary/20 transition-all"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      NEW SESSION
                    </button>
                  </div>
                ) : (
                  <>
                    {(messages || []).map((msg: Message) => (
                      <motion.div
                        key={msg._id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
                      >
                        <div className={`w-7 h-7 rounded-lg border flex items-center justify-center text-xs font-bold shrink-0 ${
                          msg.role === "user"
                            ? "bg-primary/20 border-primary/40 text-primary"
                            : "bg-card border-border text-muted-foreground"
                        }`}>
                          {msg.role === "user" ? "U" : <Cpu className="h-3.5 w-3.5" />}
                        </div>
                        <div className={`flex-1 max-w-2xl ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col gap-1`}>
                          <div className={`rounded-xl px-4 py-3 text-xs leading-relaxed ${
                            msg.role === "user"
                              ? "bg-primary/15 border border-primary/30 text-foreground"
                              : "bg-card border border-border text-foreground"
                          }`}>
                            {msg.role === "assistant" ? (
                              <ReactMarkdown
                                components={{
                                  code: ({ children, className }) => {
                                    const isBlock = className?.includes("language-");
                                    return isBlock ? (
                                      <pre className="bg-background border border-border rounded-lg p-3 overflow-x-auto my-2">
                                        <code className="text-[11px] text-primary">{children}</code>
                                      </pre>
                                    ) : (
                                      <code className="bg-background border border-border px-1 py-0.5 rounded text-primary text-[11px]">{children}</code>
                                    );
                                  },
                                }}
                              >
                                {msg.content}
                              </ReactMarkdown>
                            ) : (
                              <span>{msg.content}</span>
                            )}
                          </div>
                          {msg.costCents !== undefined && msg.costCents > 0 && (
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <DollarSign className="h-2.5 w-2.5" />
                              ${(msg.costCents / 100).toFixed(5)}
                            </span>
                          )}
                        </div>
                      </motion.div>
                    ))}
                    {isThinking && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex gap-3"
                      >
                        <div className="w-7 h-7 rounded-lg border border-primary/40 bg-primary/10 flex items-center justify-center">
                          <Cpu className="h-3.5 w-3.5 text-primary animate-pulse" />
                        </div>
                        <div className="bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-2">
                          {[0, 1, 2].map(i => (
                            <motion.div
                              key={i}
                              className="w-1.5 h-1.5 rounded-full bg-primary"
                              animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                              transition={{ duration: 0.8, delay: i * 0.15, repeat: Infinity }}
                            />
                          ))}
                        </div>
                      </motion.div>
                    )}
                    <div id="messages-end" />
                  </>
                )}
              </div>
            </ScrollArea>

            {/* Input */}
            <div className="shrink-0 p-4 border-t border-border bg-card/50">
              <div className="max-w-4xl mx-auto flex gap-3">
                <div className="flex-1 relative">
                  <textarea
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={`Ask AgentAI anything... (${activeMode} mode)`}
                    rows={1}
                    className="w-full bg-background border border-border rounded-xl px-4 py-3 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary/60 transition-colors"
                    style={{ minHeight: "44px", maxHeight: "120px" }}
                  />
                </div>
                <motion.button
                  onClick={handleSend}
                  disabled={!input.trim() || isThinking}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-bold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                >
                  {isThinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  <span className="hidden sm:block">SEND</span>
                </motion.button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}