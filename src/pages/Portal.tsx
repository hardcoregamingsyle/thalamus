import { useAuth } from "@/hooks/use-auth";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { useQuery, useMutation, useAction } from "convex/react";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  MessageSquare, Search, Plus, Trash2, LogOut,
  Send, Loader2, Menu, X, Users, Cpu, Zap,
} from "lucide-react";
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
  { id: "code", label: "CODE", icon: Users, desc: "Multi-agent AI system", color: "text-violet-400" },
];

// Detect if content is HTML
function isHtml(content: string): boolean {
  return /<[a-z][\s\S]*>/i.test(content);
}

export default function Portal() {
  const { isLoading, isAuthenticated, user, signOut, token } = useAuth();
  const navigate = useNavigate();
  const [activeMode, setActiveMode] = useState<Mode>("chat");
  const [activeConvId, setActiveConvId] = useState<Id<"conversations"> | null>(null);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const ensureDailyBalance = useMutation(api.customAuthHelpers.ensureDailyBalance);

  // Initialize daily balance for existing users (one-time migration: only when unset or zero)
  useEffect(() => {
    if (token && user !== undefined && user !== null) {
      const typedU = user as { dailyAgentBucks?: number };
      const daily = typedU.dailyAgentBucks;
      if (daily === undefined || daily === null || daily === 0) {
        ensureDailyBalance({ token }).catch(() => {});
      }
    }
  }, [token, user, ensureDailyBalance]);

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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

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

  // Total balance = daily + purchased
  const typedUser = user as { dailyAgentBucks?: number; purchasedAgentBucks?: number; agentBucksBalance?: number } | null;
  const dailyAB = typedUser?.dailyAgentBucks ?? typedUser?.agentBucksBalance ?? 0;
  const purchasedAB = typedUser?.purchasedAgentBucks ?? 0;
  const totalAB = dailyAB + purchasedAB;

  const filteredConvs = conversations?.filter((c: Conversation) => c.mode === activeMode) || [];

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 text-primary animate-spin" />
          <p className="text-primary font-mono text-xs animate-pulse">INITIALIZING APHANTIC_AI...</p>
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
              <span className="text-primary font-bold text-sm tracking-widest amd-glow">APHANTIC_AI</span>
            </div>
            <span className="hidden sm:block text-[10px] text-muted-foreground border border-border px-1.5 py-0.5 rounded">PORTAL</span>
          </div>
          <div className="flex items-center gap-2">
            {/* AgentBucks balance — display only, no pricing modal */}
            <div className="flex items-center gap-1.5 text-xs border border-amber-400/30 bg-amber-400/10 text-amber-400 px-2.5 py-1 rounded-lg font-bold">
              <Zap className="h-3 w-3" />
              <span>{totalAB.toLocaleString()} AB</span>
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

      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile overlay */}
        <AnimatePresence>
          {sidebarOpen && activeMode !== "code" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="md:hidden fixed inset-0 bg-background/80 backdrop-blur-sm z-30"
              onClick={() => setSidebarOpen(false)}
            />
          )}
        </AnimatePresence>

        {/* Sidebar — only show for chat/research modes */}
        <AnimatePresence>
          {sidebarOpen && activeMode !== "code" && (
            <motion.aside
              initial={{ x: -220, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -220, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed md:relative left-0 top-0 bottom-0 z-40 md:z-auto w-[220px] shrink-0 border-r border-border bg-card flex flex-col overflow-hidden"
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

              {/* Native scrollable conversation list */}
              <div className="flex-1 overflow-y-auto min-h-0">
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
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Agent Teams / CODE mode — full inline TeamPortal */}
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
            {/* Mode indicator bar */}
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
                CODE
              </button>
            </div>

            {/* Messages — native scrollable */}
            <div className="flex-1 overflow-y-auto min-h-0">
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
                      <p className="text-sm font-bold text-foreground">APHANTIC_AI</p>
                      <p className="text-xs text-muted-foreground mt-1">Start a new session or select one from the sidebar</p>
                    </div>
                  </div>
                ) : messages === undefined ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="h-4 w-4 text-primary animate-spin" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 gap-2">
                    <p className="text-xs text-muted-foreground">Send a message to begin</p>
                  </div>
                ) : (
                  messages.map((msg: Message) => (
                    <motion.div
                      key={msg._id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-card border border-border text-foreground"
                      }`}>
                        {msg.role === "assistant" && isHtml(msg.content) ? (
                          <div dangerouslySetInnerHTML={{ __html: msg.content }} />
                        ) : (
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        )}
                          {msg.costCents !== undefined && msg.costCents > 0 && (
                          <p className="text-[9px] opacity-50 mt-1 text-right">
                            {Math.ceil(msg.costCents * 15_000).toLocaleString()} AB
                          </p>
                        )}
                      </div>
                    </motion.div>
                  ))
                )}
                {isThinking && (
                  <div className="flex justify-start">
                    <div className="bg-card border border-border rounded-2xl px-4 py-3">
                      <div className="flex items-center gap-1">
                        {[0, 1, 2].map(i => (
                          <motion.div
                            key={i}
                            className="w-1.5 h-1.5 rounded-full bg-primary"
                            animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                            transition={{ duration: 0.8, delay: i * 0.15, repeat: Infinity }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Input */}
            <div className="shrink-0 border-t border-border bg-card/80 backdrop-blur-sm p-3">
              <div className="max-w-4xl mx-auto flex gap-2">
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Message ${activeMode === "research" ? "Researcher" : "APHANTIC_AI"}...`}
                  rows={1}
                  className="flex-1 bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 resize-none transition-colors"
                  style={{ minHeight: "36px", maxHeight: "120px" }}
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isThinking}
                  className="px-3 py-2 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center gap-1.5 text-xs font-bold"
                >
                  {isThinking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}