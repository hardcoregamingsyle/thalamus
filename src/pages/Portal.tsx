import { useAuth } from "@/hooks/use-auth";
import { useEffect, useRef, useState } from "react";
import CreditModal from "@/components/CreditModal";
import { useNavigate, useParams } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { useQuery, useMutation, useAction } from "convex/react";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  MessageSquare, Search, Plus, Trash2, LogOut,
  Send, Loader2, Menu, X, Users, Cpu, Zap, BookOpen,
  FileText, Globe, Image, Upload, Sparkles, ChevronRight,
  Hash,
} from "lucide-react";
import TeamPortalInline from "./TeamPortalInline";

type Mode = "chat" | "research" | "code" | "study";

interface Conversation {
  _id: Id<"conversations">;
  title: string;
  mode: Mode;
  lastMessageAt?: number;
  customId?: string;
}

interface Message {
  _id: Id<"messages">;
  role: "user" | "assistant";
  content: string;
  tokensUsed?: number;
  costCents?: number;
}

interface StudyResource {
  _id: Id<"studyResources">;
  title: string;
  content: string;
  sourceType: string;
  fileName?: string;
  createdAt: number;
}

const MODES: { id: Mode; label: string; icon: typeof MessageSquare; desc: string; color: string; accent: string }[] = [
  { id: "chat", label: "CHAT", icon: MessageSquare, desc: "General", color: "text-primary", accent: "bg-primary/15 border-primary/30" },
  { id: "research", label: "RESEARCH", icon: Search, desc: "Deep", color: "text-accent", accent: "bg-accent/15 border-accent/30" },
  { id: "study", label: "STUDY", icon: BookOpen, desc: "Study", color: "text-indigo-400", accent: "bg-indigo-400/15 border-indigo-400/30" },
  { id: "code", label: "CODE", icon: Users, desc: "Multi-agent", color: "text-violet-400", accent: "bg-violet-400/15 border-violet-400/30" },
];

const VALID_MODES: Mode[] = ["chat", "research", "study", "code"];

export default function Portal() {
  const { isLoading, isAuthenticated, user, signOut, token } = useAuth();
  const navigate = useNavigate();
  const params = useParams<{ mode?: string; sessionId?: string }>();

  const activeMode: Mode = (VALID_MODES.includes(params.mode as Mode) ? params.mode : "chat") as Mode;
  const urlSessionId = params.sessionId ?? null;

  const [activeConvId, setActiveConvId] = useState<Id<"conversations"> | null>(null);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(typeof window !== "undefined" ? window.innerWidth >= 768 : true);
  const [creditModalOpen, setCreditModalOpen] = useState(false);
  const [spinNotifOpen, setSpinNotifOpen] = useState(false);
  const [studyResourcesOpen, setStudyResourcesOpen] = useState(false);
  const [studyAddMode, setStudyAddMode] = useState<"text" | "search" | null>(null);
  const [studyTextTitle, setStudyTextTitle] = useState("");
  const [studyTextContent, setStudyTextContent] = useState("");
  const [studySearchQuery, setStudySearchQuery] = useState("");
  const [isAddingResource, setIsAddingResource] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ensureDailyBalance = useMutation(api.customAuthHelpers.ensureDailyBalance);
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    if (token && user !== undefined && user !== null && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      ensureDailyBalance({ token }).catch(() => {});
      const notifKey = `spin_notif_shown_${token.slice(0, 8)}`;
      if (!localStorage.getItem(notifKey)) {
        const typedUser = user as { referralSpins?: number; referredBy?: string };
        if (typedUser.referralSpins && typedUser.referralSpins > 0 && typedUser.referredBy) {
          localStorage.setItem(notifKey, "1");
          setTimeout(() => setSpinNotifOpen(true), 1500);
        }
      }
    }
  }, [token, user, ensureDailyBalance]);

  const conversations = useQuery(api.conversations.list, token ? { token } : "skip") as Conversation[] | undefined;
  const messages = useQuery(api.conversations.getMessages, activeConvId && token ? { conversationId: activeConvId, token } : "skip") as Message[] | undefined;
  const studyResources = useQuery(api.studyHelpers.listResources, token ? { token } : "skip") as StudyResource[] | undefined;

  const createConversation = useMutation(api.conversations.create);
  const deleteConversation = useMutation(api.conversations.remove);
  const sendMessage = useAction(api.ai.sendMessage);
  const sendStudyMessage = useAction(api.study.sendStudyMessage);
  const generateTitle = useAction(api.ai.generateConversationTitle);
  const addTextResource = useMutation(api.studyHelpers.addTextResource);
  const deleteResource = useMutation(api.studyHelpers.deleteResource);
  const searchAndAddResource = useAction(api.study.searchAndAddResource);
  const processFileResource = useAction(api.study.processFileResource);

  // Resolve conversation from URL session ID
  useEffect(() => {
    if (urlSessionId && conversations && activeMode !== "code") {
      const conv = conversations.find((c: Conversation) => c.customId === urlSessionId);
      if (conv) setActiveConvId(conv._id);
    }
  }, [urlSessionId, conversations, activeMode]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate("/auth");
  }, [isLoading, isAuthenticated, navigate]);

  useEffect(() => {
    if (activeConvId && conversations) {
      const conv = conversations.find((c: Conversation) => c._id === activeConvId);
      if (conv) { document.title = `${conv.title} | Thalamus AI`; return; }
    }
    document.title = "Thalamus AI";
    return () => { document.title = "Thalamus AI"; };
  }, [activeConvId, conversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  const setActiveMode = (mode: Mode) => {
    setActiveConvId(null);
    navigate(`/portal/${mode}`, { replace: false });
  };

  const handleNewConversation = async () => {
    if (!token) return;
    try {
      const result = await createConversation({ title: `${activeMode.toUpperCase()}_${Date.now().toString(36).toUpperCase()}`, mode: activeMode, token }) as { id: Id<"conversations">; customId: string } | Id<"conversations">;
      const id = typeof result === "object" && "id" in result ? result.id : result as Id<"conversations">;
      const customId = typeof result === "object" && "customId" in result ? result.customId : null;
      setActiveConvId(id);
      if (customId) navigate(`/portal/${activeMode}/${customId}`, { replace: false });
    } catch { toast.error("Failed to create conversation"); }
  };

  const handleSelectConversation = (conv: Conversation) => {
    setActiveConvId(conv._id);
    if (conv.customId) navigate(`/portal/${activeMode}/${conv.customId}`, { replace: false });
  };

  const handleSend = async () => {
    if (!input.trim() || isThinking || !token) return;
    let convId = activeConvId;
    const isFirstMessage = !convId;
    if (!convId) {
      try {
        const result = await createConversation({ title: input.slice(0, 40), mode: activeMode, token }) as { id: Id<"conversations">; customId: string } | Id<"conversations">;
        const id = typeof result === "object" && "id" in result ? result.id : result as Id<"conversations">;
        const customId = typeof result === "object" && "customId" in result ? result.customId : null;
        convId = id;
        setActiveConvId(id);
        if (customId) navigate(`/portal/${activeMode}/${customId}`, { replace: false });
      } catch { toast.error("Failed to create conversation"); return; }
    }
    const msg = input.trim();
    setInput("");
    setIsThinking(true);
    // Build user context with current datetime and timezone
    const userContext = {
      datetime: new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      location: undefined as string | undefined,
    };

    try {
      if (activeMode === "study") {
        await sendStudyMessage({ conversationId: convId, content: msg, token, userContext });
      } else {
        await sendMessage({ conversationId: convId, content: msg, mode: activeMode as "chat" | "research" | "code", token, userContext });
      }
      if (isFirstMessage && convId) {
        generateTitle({ firstMessage: msg, conversationId: convId, token }).catch(() => {});
      }
    } catch { toast.error("Agent failed to respond. Try again."); }
    finally { setIsThinking(false); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleAddTextResource = async () => {
    if (!token || !studyTextTitle.trim() || !studyTextContent.trim()) return;
    setIsAddingResource(true);
    try {
      await addTextResource({ token, title: studyTextTitle.trim(), content: studyTextContent.trim() });
      toast.success("Resource added");
      setStudyTextTitle(""); setStudyTextContent(""); setStudyAddMode(null);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setIsAddingResource(false); }
  };

  const handleSearchResource = async () => {
    if (!token || !studySearchQuery.trim()) return;
    setIsAddingResource(true);
    try {
      const result = await searchAndAddResource({ token, query: studySearchQuery.trim() });
      toast.success(`Added: ${result.title}`);
      setStudySearchQuery(""); setStudyAddMode(null);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setIsAddingResource(false); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!token) return;
    const file = e.target.files?.[0];
    if (!file) return;
    setIsAddingResource(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      await processFileResource({ token, fileName: file.name, fileType: file.type, fileDataBase64: base64 });
      toast.success(`Processed: ${file.name}`);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to process file"); }
    finally { setIsAddingResource(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const typedUser = user as { dailyAgentBucks?: number; purchasedAgentBucks?: number; agentBucksBalance?: number } | null;
  const dailyAB = typedUser?.dailyAgentBucks ?? typedUser?.agentBucksBalance ?? 0;
  const purchasedAB = typedUser?.purchasedAgentBucks ?? 0;
  const totalAB = dailyAB + purchasedAB;

  const filteredConvs = conversations?.filter((c: Conversation) => c.mode === activeMode) || [];
  const currentMode = MODES.find(m => m.id === activeMode)!;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 text-primary animate-spin" />
          <p className="text-primary font-mono text-xs animate-pulse">INITIALIZING THALAMUS_AI...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background font-mono overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-border bg-card/80 backdrop-blur-sm z-20">
        <div className="flex items-center justify-between px-3 h-11">
          <div className="flex items-center gap-2">
            {activeMode !== "code" && (
              <button onClick={() => setSidebarOpen(o => !o)} className="text-muted-foreground hover:text-primary transition-colors p-1.5 rounded hover:bg-primary/10 md:hidden">
                {sidebarOpen ? <X className="h-3.5 w-3.5" /> : <Menu className="h-3.5 w-3.5" />}
              </button>
            )}
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-primary/20 border border-primary/40 flex items-center justify-center">
                <Cpu className="h-2.5 w-2.5 text-primary" />
              </div>
              <span className="text-primary font-bold text-xs tracking-widest amd-glow hidden sm:block">THALAMUS_AI</span>
            </div>
            {/* Mode pills — desktop */}
            <div className="hidden md:flex items-center gap-1 ml-2">
              {MODES.map(mode => (
                <button key={mode.id} onClick={() => setActiveMode(mode.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-bold transition-all ${activeMode === mode.id ? `${mode.accent} border ${mode.color}` : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
                >
                  <mode.icon className="h-3 w-3" />
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Session ID display */}
            {urlSessionId && activeMode !== "code" && (
              <div className="hidden sm:flex items-center gap-1 text-[9px] text-muted-foreground/60 border border-border/50 px-2 py-0.5 rounded font-mono">
                <Hash className="h-2.5 w-2.5" />
                {urlSessionId}
              </div>
            )}
            <button onClick={() => setCreditModalOpen(true)} className="flex items-center gap-1.5 text-[11px] border border-amber-400/30 bg-amber-400/10 text-amber-400 px-2 py-1 rounded-lg font-bold hover:bg-amber-400/20 transition-all">
              <Zap className="h-3 w-3" />
              <span className="hidden sm:block">{totalAB.toLocaleString()}</span>
              <span className="sm:hidden">{(totalAB / 1_000_000).toFixed(1)}M</span>
              <span className="text-[9px] opacity-70">AB</span>
            </button>
            <button onClick={signOut} className="text-muted-foreground hover:text-primary transition-colors p-1.5 rounded hover:bg-primary/10">
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile overlay */}
        <AnimatePresence>
          {sidebarOpen && activeMode !== "code" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="md:hidden fixed inset-0 bg-background/80 backdrop-blur-sm z-30"
              onClick={() => setSidebarOpen(false)} />
          )}
        </AnimatePresence>

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <AnimatePresence>
          {sidebarOpen && activeMode !== "code" && (
            <motion.aside
              initial={{ x: -220, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -220, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed md:relative left-0 top-0 bottom-0 z-40 md:z-auto w-[220px] shrink-0 border-r border-border bg-card flex flex-col overflow-hidden"
            >
              {/* Mode tabs — mobile only */}
              <div className="shrink-0 p-2 border-b border-border space-y-0.5 md:hidden">
                {MODES.map(mode => (
                  <button key={mode.id} onClick={() => { setActiveMode(mode.id); setSidebarOpen(typeof window !== "undefined" ? window.innerWidth >= 768 : true); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded text-xs transition-all ${activeMode === mode.id ? `${mode.accent} border ${mode.color}` : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
                  >
                    <mode.icon className={`h-3.5 w-3.5 ${activeMode === mode.id ? mode.color : ""}`} />
                    <span className="font-bold">{mode.label}</span>
                    <span className="text-[10px] opacity-60 ml-auto">{mode.desc}</span>
                  </button>
                ))}
              </div>

              {/* Sessions header */}
              <div className="shrink-0 px-3 pt-3 pb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <currentMode.icon className={`h-3 w-3 ${currentMode.color}`} />
                  <span className="text-[10px] text-muted-foreground font-bold">SESSIONS</span>
                </div>
                <button onClick={handleNewConversation} className="w-5 h-5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary transition-all flex items-center justify-center">
                  <Plus className="h-3 w-3" />
                </button>
              </div>

              {/* Conversations list */}
              <div className="flex-1 overflow-y-auto min-h-0">
                <div className="px-2 pb-2 space-y-0.5">
                  {filteredConvs.length === 0 ? (
                    <div className="text-center py-6">
                      <p className="text-[10px] text-muted-foreground">No sessions yet</p>
                      <button onClick={handleNewConversation} className={`mt-2 text-[10px] ${currentMode.color} hover:underline`}>
                        + New session
                      </button>
                    </div>
                  ) : (
                    filteredConvs.map((conv: Conversation) => (
                      <div key={conv._id} onClick={() => handleSelectConversation(conv)}
                        className={`group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-all ${activeConvId === conv._id ? `${currentMode.accent} border ${currentMode.color}` : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-[10px] block truncate">{conv.title}</span>
                          {conv.customId && <span className="text-[8px] text-muted-foreground/40 font-mono">{conv.customId}</span>}
                        </div>
                        <button onClick={async (e) => { e.stopPropagation(); if (!token) return; try { await deleteConversation({ id: conv._id, token }); if (activeConvId === conv._id) { setActiveConvId(null); navigate(`/portal/${activeMode}`); } } catch { toast.error("Failed to delete"); } }}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0">
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

        {/* ── CODE mode ───────────────────────────────────────────────────── */}
        {activeMode === "code" && (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <TeamPortalInline
              token={token ?? ""}
              initialSessionCustomId={urlSessionId}
              onSessionChange={(customId) => {
                if (customId) navigate(`/portal/code/${customId}`, { replace: true });
                else navigate(`/portal/code`, { replace: true });
              }}
            />
          </div>
        )}

        {/* ── Chat / Research / Study mode ────────────────────────────────── */}
        {activeMode !== "code" && (
          <div className="flex-1 flex overflow-hidden min-w-0">
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
              {/* Sub-header: mode indicator + study resources toggle */}
              <div className="shrink-0 px-3 py-1.5 border-b border-border bg-card/30 flex items-center gap-2">
                <div className={`flex items-center gap-1.5 text-[11px] font-bold ${currentMode.color}`}>
                  <currentMode.icon className="h-3 w-3" />
                  {currentMode.label}
                </div>
                <span className="text-muted-foreground/40 text-[10px]">/portal/{activeMode}{urlSessionId ? `/${urlSessionId}` : ""}</span>
                {activeMode === "study" && (
                  <button onClick={() => setStudyResourcesOpen(o => !o)}
                    className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] border transition-all ${studyResourcesOpen ? "bg-indigo-400/15 border-indigo-400/30 text-indigo-400 font-bold" : "border-border text-muted-foreground hover:text-indigo-400 hover:border-indigo-400/30"}`}
                  >
                    <BookOpen className="h-3 w-3" />
                    Resources {studyResources ? `(${studyResources.length})` : ""}
                  </button>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto min-h-0">
                <div className="p-4 space-y-4 max-w-4xl mx-auto">
                  {!activeConvId ? (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      className="flex flex-col items-center justify-center h-64 gap-4">
                      <div className={`w-14 h-14 rounded-2xl border flex items-center justify-center ${currentMode.accent} border`}>
                        <currentMode.icon className={`h-7 w-7 ${currentMode.color}`} />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold text-foreground">{currentMode.label} MODE</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {activeMode === "study"
                            ? `${studyResources?.length ? `${studyResources.length} resource(s) loaded · ` : ""}Ask anything — live web search enabled`
                            : "Start a new session or select one from the sidebar"}
                        </p>
                        <button onClick={handleNewConversation} className={`mt-3 flex items-center gap-1.5 mx-auto text-[11px] ${currentMode.color} border ${currentMode.accent} border px-3 py-1.5 rounded-lg hover:opacity-80 transition-all font-bold`}>
                          <Plus className="h-3 w-3" />
                          New Session
                        </button>
                      </div>
                    </motion.div>
                  ) : messages === undefined ? (
                    <div className="flex items-center justify-center h-32"><Loader2 className="h-4 w-4 text-primary animate-spin" /></div>
                  ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 gap-2">
                      <p className="text-xs text-muted-foreground">Send a message to begin</p>
                    </div>
                  ) : (
                    messages.map((msg: Message) => (
                      <motion.div key={msg._id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div className={`max-w-[82%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border border-border text-foreground"}`}>
                          {msg.role === "assistant" ? (
                            <div className="prose-html" dangerouslySetInnerHTML={{ __html: msg.content }} />
                          ) : (
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                          )}
                          {msg.costCents !== undefined && msg.costCents > 0 && (
                            <p className="text-[9px] opacity-40 mt-1.5 text-right">{Math.ceil(msg.costCents * 15_000).toLocaleString()} AB</p>
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
                            <motion.div key={i} className={`w-1.5 h-1.5 rounded-full ${currentMode.color.replace("text-", "bg-")}`}
                              animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                              transition={{ duration: 0.8, delay: i * 0.15, repeat: Infinity }} />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Input */}
              <div className="shrink-0 p-3 border-t border-border bg-card/30">
                <div className="max-w-4xl mx-auto flex gap-2">
                  <textarea
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={activeMode === "study" ? "Ask a study question — live web search enabled..." : activeMode === "research" ? "Research topic or question..." : "Type a message..."}
                    rows={1}
                    className="flex-1 bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary/60 transition-colors"
                    style={{ minHeight: "36px", maxHeight: "120px" }}
                  />
                  <button onClick={handleSend} disabled={!input.trim() || isThinking}
                    className={`px-3 py-2 rounded-xl disabled:opacity-50 transition-all shrink-0 ${activeMode === "study" ? "bg-indigo-500 text-white hover:bg-indigo-500/90" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}>
                    {isThinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* ── Study Resources Panel ──────────────────────────────────── */}
            <AnimatePresence>
              {activeMode === "study" && studyResourcesOpen && (
                <motion.div
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 260, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="shrink-0 border-l border-border bg-card flex flex-col overflow-hidden"
                  style={{ width: 260 }}
                >
                  <div className="shrink-0 px-3 py-2.5 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-3.5 w-3.5 text-indigo-400" />
                      <span className="text-[11px] font-bold text-foreground">RESOURCES</span>
                      {studyResources && <span className="text-[9px] text-indigo-400 border border-indigo-400/30 bg-indigo-400/10 px-1.5 py-0.5 rounded-full">{studyResources.length}</span>}
                    </div>
                    <button onClick={() => setStudyResourcesOpen(false)} className="text-muted-foreground hover:text-foreground p-1">
                      <X className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Add resource buttons */}
                  <div className="shrink-0 p-2.5 border-b border-border space-y-2">
                    <div className="grid grid-cols-3 gap-1.5">
                      <button onClick={() => setStudyAddMode(studyAddMode === "text" ? null : "text")}
                        className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg text-[10px] border transition-all ${studyAddMode === "text" ? "bg-indigo-400/15 border-indigo-400/30 text-indigo-400" : "border-border text-muted-foreground hover:border-indigo-400/30 hover:text-indigo-400"}`}
                      >
                        <FileText className="h-3.5 w-3.5" />Text
                      </button>
                      <button onClick={() => setStudyAddMode(studyAddMode === "search" ? null : "search")}
                        className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg text-[10px] border transition-all ${studyAddMode === "search" ? "bg-indigo-400/15 border-indigo-400/30 text-indigo-400" : "border-border text-muted-foreground hover:border-indigo-400/30 hover:text-indigo-400"}`}
                      >
                        <Sparkles className="h-3.5 w-3.5" />AI
                      </button>
                      <label className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg text-[10px] border transition-all cursor-pointer ${isAddingResource ? "opacity-50" : "border-border text-muted-foreground hover:border-indigo-400/30 hover:text-indigo-400"}`}>
                        {isAddingResource ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                        File
                        <input ref={fileInputRef} type="file" className="hidden" accept="image/*,.pdf,.txt,.md,.csv,.json,.js,.ts,.py,.html,.css" onChange={handleFileUpload} disabled={isAddingResource} />
                      </label>
                    </div>

                    <AnimatePresence>
                      {studyAddMode === "text" && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden space-y-1.5">
                          <input value={studyTextTitle} onChange={e => setStudyTextTitle(e.target.value)} placeholder="Title..." className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-[10px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-indigo-400/60 transition-colors" />
                          <textarea value={studyTextContent} onChange={e => setStudyTextContent(e.target.value)} placeholder="Paste notes or content..." rows={3} className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-[10px] text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-indigo-400/60 transition-colors" />
                          <button onClick={handleAddTextResource} disabled={isAddingResource || !studyTextTitle.trim() || !studyTextContent.trim()}
                            className="w-full py-1.5 bg-indigo-400/15 border border-indigo-400/30 text-indigo-400 text-[10px] rounded-lg hover:bg-indigo-400/25 disabled:opacity-50 transition-all font-bold">
                            {isAddingResource ? <Loader2 className="h-3 w-3 animate-spin mx-auto" /> : "Add Resource"}
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <AnimatePresence>
                      {studyAddMode === "search" && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden space-y-1.5">
                          <input value={studySearchQuery} onChange={e => setStudySearchQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleSearchResource(); }} placeholder="Topic to research..." className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-[10px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-indigo-400/60 transition-colors" />
                          <button onClick={handleSearchResource} disabled={isAddingResource || !studySearchQuery.trim()}
                            className="w-full py-1.5 bg-indigo-400/15 border border-indigo-400/30 text-indigo-400 text-[10px] rounded-lg hover:bg-indigo-400/25 disabled:opacity-50 transition-all font-bold">
                            {isAddingResource ? <><Loader2 className="h-3 w-3 animate-spin inline mr-1" />Researching...</> : "Research & Add"}
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Resources list */}
                  <div className="flex-1 overflow-y-auto min-h-0 p-2 space-y-1.5">
                    {!studyResources ? (
                      <div className="flex items-center justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                    ) : studyResources.length === 0 ? (
                      <div className="text-center py-8">
                        <BookOpen className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                        <p className="text-[10px] text-muted-foreground">No resources yet</p>
                        <p className="text-[9px] text-muted-foreground/60 mt-1">Add text, files, or AI-researched topics</p>
                      </div>
                    ) : (
                      studyResources.map((resource: StudyResource) => (
                        <div key={resource._id} className="group bg-background border border-border rounded-lg p-2 hover:border-indigo-400/30 transition-all">
                          <div className="flex items-start justify-between gap-1.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {resource.sourceType === "image" ? <Image className="h-3 w-3 text-indigo-400 shrink-0" /> :
                               resource.sourceType === "web" ? <Globe className="h-3 w-3 text-indigo-400 shrink-0" /> :
                               <FileText className="h-3 w-3 text-indigo-400 shrink-0" />}
                              <p className="text-[10px] font-bold text-foreground truncate">{resource.title}</p>
                            </div>
                            <button onClick={async () => { if (!token) return; try { await deleteResource({ token, resourceId: resource._id }); toast.success("Deleted"); } catch { toast.error("Failed"); } }}
                              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                          <p className="text-[9px] text-muted-foreground mt-1 line-clamp-2">{resource.content.slice(0, 80)}</p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className={`text-[8px] px-1.5 py-0.5 rounded-full border font-bold ${resource.sourceType === "image" ? "bg-purple-400/10 text-purple-400 border-purple-400/20" : resource.sourceType === "web" ? "bg-blue-400/10 text-blue-400 border-blue-400/20" : "bg-indigo-400/10 text-indigo-400 border-indigo-400/20"}`}>
                              {resource.sourceType.toUpperCase()}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Credit Modal */}
      {creditModalOpen && <CreditModal open={creditModalOpen} onClose={() => setCreditModalOpen(false)} token={token ?? ""} totalAB={totalAB} dailyAB={dailyAB} purchasedAB={purchasedAB} />}
      {spinNotifOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setSpinNotifOpen(false)} />
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="relative z-10 bg-card border border-border rounded-2xl p-6 max-w-sm w-full text-center shadow-2xl">
            <div className="text-4xl mb-3">🎰</div>
            <h3 className="text-lg font-bold text-foreground mb-2">You have a free spin!</h3>
            <p className="text-xs text-muted-foreground mb-4">You signed up via a referral link. Claim your free spin in the Credits section.</p>
            <button onClick={() => { setSpinNotifOpen(false); setCreditModalOpen(true); }} className="w-full bg-primary text-primary-foreground py-2 rounded-xl text-sm font-bold hover:bg-primary/90 transition-all">Claim Spin</button>
          </motion.div>
        </div>
      )}
    </div>
  );
}