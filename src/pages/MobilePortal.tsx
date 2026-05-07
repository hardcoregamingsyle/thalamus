import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { useQuery, useMutation, useAction } from "convex/react";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { useNavigate, useParams } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import CreditModal from "@/components/CreditModal";
import {
  MessageSquare, Search, BookOpen, Users, Plus, Send, Loader2,
  X, ChevronLeft, Trash2, Zap, LogOut, Lock, FileText, Globe,
  Image, Upload, Cpu, Settings, Lightbulb, ArrowLeft,
} from "lucide-react";
import TeamPortalInline from "./TeamPortalInline";

type Mode = "chat" | "research" | "study" | "code";

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

const MODES: { id: Mode; label: string; icon: typeof MessageSquare; color: string; bg: string; emoji: string }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare, color: "text-primary", bg: "bg-primary/15", emoji: "💬" },
  { id: "research", label: "Research", icon: Search, color: "text-amber-400", bg: "bg-amber-400/15", emoji: "🔬" },
  { id: "study", label: "Study", icon: BookOpen, color: "text-indigo-400", bg: "bg-indigo-400/15", emoji: "📚" },
  { id: "code", label: "Code", icon: Users, color: "text-violet-400", bg: "bg-violet-400/15", emoji: "⚡" },
];

const VALID_MODES: Mode[] = ["chat", "research", "study", "code"];

// ── Mobile Chat View ──────────────────────────────────────────────────────────
function MobileChatView({
  mode,
  token,
  user,
  onBack,
  totalAB,
}: {
  mode: Mode;
  token: string;
  user: unknown;
  onBack: () => void;
  totalAB: number;
}) {
  const navigate = useNavigate();
  const params = useParams<{ mode?: string; sessionId?: string }>();
  const urlSessionId = params.sessionId ?? null;

  const [activeConvId, setActiveConvId] = useState<Id<"conversations"> | null>(null);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [showConvList, setShowConvList] = useState(false);
  const [creditModalOpen, setCreditModalOpen] = useState(false);
  const [studyResourcesOpen, setStudyResourcesOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const modeInfo = MODES.find(m => m.id === mode)!;

  const conversations = useQuery(api.conversations.list, token ? { token } : "skip") as Conversation[] | undefined;
  const messages = useQuery(api.conversations.getMessages, activeConvId && token ? { conversationId: activeConvId, token } : "skip") as Message[] | undefined;
  const studyResources = useQuery(api.studyHelpers.listResources, token ? { token } : "skip") as StudyResource[] | undefined;

  const createConversation = useMutation(api.conversations.create);
  const deleteConversation = useMutation(api.conversations.remove);
  const sendMessage = useAction(api.ai.sendMessage);
  const sendStudyMessage = useAction(api.study.sendStudyMessage);
  const generateTitle = useAction(api.ai.generateConversationTitle);
  const deleteResource = useMutation(api.studyHelpers.deleteResource);
  const processFileResource = useAction(api.study.processFileResource);

  const filteredConvs = conversations?.filter((c: Conversation) => c.mode === mode) || [];

  // Resolve conversation from URL session ID
  useEffect(() => {
    if (urlSessionId && conversations && mode !== "code") {
      const conv = conversations.find((c: Conversation) => c.customId === urlSessionId);
      if (conv) setActiveConvId(conv._id);
    }
  }, [urlSessionId, conversations, mode]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  }, [input]);

  const handleNewConversation = async () => {
    if (!token) return;
    try {
      const result = await createConversation({ title: `${mode.toUpperCase()}_${Date.now().toString(36).toUpperCase()}`, mode, token }) as { id: Id<"conversations">; customId: string } | Id<"conversations">;
      const id = typeof result === "object" && "id" in result ? result.id : result as Id<"conversations">;
      const customId = typeof result === "object" && "customId" in result ? result.customId : null;
      setActiveConvId(id);
      setShowConvList(false);
      if (customId) navigate(`/portal/${mode}/${customId}`, { replace: false });
    } catch { toast.error("Failed to create conversation"); }
  };

  const handleSend = async () => {
    if (!input.trim() || isThinking || !token) return;
    let convId = activeConvId;
    const isFirstMessage = !convId;
    if (!convId) {
      try {
        const result = await createConversation({ title: input.slice(0, 40), mode, token }) as { id: Id<"conversations">; customId: string } | Id<"conversations">;
        const id = typeof result === "object" && "id" in result ? result.id : result as Id<"conversations">;
        const customId = typeof result === "object" && "customId" in result ? result.customId : null;
        convId = id;
        setActiveConvId(id);
        if (customId) navigate(`/portal/${mode}/${customId}`, { replace: false });
      } catch { toast.error("Failed to create conversation"); return; }
    }
    const msg = input.trim();
    setInput("");
    setIsThinking(true);
    const userContext = {
      datetime: new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    try {
      if (mode === "study") {
        await sendStudyMessage({ conversationId: convId, content: msg, token, userContext });
      } else {
        await sendMessage({ conversationId: convId, content: msg, mode: mode as "chat" | "research" | "code", token, userContext });
      }
      if (isFirstMessage && convId) {
        generateTitle({ firstMessage: msg, conversationId: convId, token }).catch(() => {});
      }
    } catch { toast.error("Failed to respond. Try again."); }
    finally { setIsThinking(false); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!token) return;
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      await processFileResource({ token, fileName: file.name, fileType: file.type, fileDataBase64: base64 });
      toast.success(`Added: ${file.name}`);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const typedUser = user as { dailyAgentBucks?: number; purchasedAgentBucks?: number; agentBucksBalance?: number } | null;
  const dailyAB = typedUser?.dailyAgentBucks ?? typedUser?.agentBucksBalance ?? 0;
  const purchasedAB = typedUser?.purchasedAgentBucks ?? 0;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Mobile top bar */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-border bg-card/80 backdrop-blur-sm">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors p-1 -ml-1">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className={`w-8 h-8 rounded-xl ${modeInfo.bg} flex items-center justify-center text-base shrink-0`}>
            {modeInfo.emoji}
          </div>
          <div className="min-w-0">
            <p className={`text-sm font-bold ${modeInfo.color} truncate`}>
              {activeConvId && conversations ? (conversations.find(c => c._id === activeConvId)?.title ?? modeInfo.label) : modeInfo.label}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {filteredConvs.length} session{filteredConvs.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {mode === "study" && (
            <button onClick={() => setStudyResourcesOpen(true)} className="text-indigo-400 p-1.5 rounded-lg bg-indigo-400/10">
              <BookOpen className="h-4 w-4" />
            </button>
          )}
          <button onClick={() => setShowConvList(true)} className="text-muted-foreground p-1.5 rounded-lg hover:bg-muted/50 transition-colors">
            <MessageSquare className="h-4 w-4" />
          </button>
          <button onClick={() => setCreditModalOpen(true)} className="flex items-center gap-1 text-amber-400 bg-amber-400/10 px-2 py-1 rounded-lg text-[10px] font-bold">
            <Zap className="h-3 w-3" />
            {(totalAB / 1_000_000).toFixed(1)}M
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4 space-y-4">
        {!activeConvId ? (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center h-full gap-6 pb-20">
            <div className={`w-20 h-20 rounded-3xl ${modeInfo.bg} flex items-center justify-center text-4xl`}>
              {modeInfo.emoji}
            </div>
            <div className="text-center">
              <h2 className={`text-xl font-bold ${modeInfo.color} mb-2`}>{modeInfo.label} Mode</h2>
              <p className="text-sm text-muted-foreground mb-6 max-w-xs">
                {mode === "chat" && "Ask anything — fast, accurate, context-aware"}
                {mode === "research" && "Deep research with live web search"}
                {mode === "study" && "Study with resource grounding & live search"}
                {mode === "code" && "9-agent system for full software development"}
              </p>
              <button onClick={handleNewConversation} className={`flex items-center gap-2 mx-auto px-6 py-3 rounded-2xl ${modeInfo.bg} ${modeInfo.color} font-bold text-sm border border-current/20`}>
                <Plus className="h-4 w-4" />
                New Session
              </button>
            </div>
            {filteredConvs.length > 0 && (
              <div className="w-full max-w-sm">
                <p className="text-[11px] text-muted-foreground font-bold mb-2 text-center">RECENT SESSIONS</p>
                <div className="space-y-2">
                  {filteredConvs.slice(0, 3).map((conv: Conversation) => (
                    <button key={conv._id} onClick={() => { setActiveConvId(conv._id); if (conv.customId) navigate(`/portal/${mode}/${conv.customId}`); }}
                      className="w-full text-left px-4 py-3 bg-card border border-border rounded-2xl hover:border-primary/30 transition-all">
                      <p className="text-sm font-medium text-foreground truncate">{conv.title}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        ) : messages === undefined ? (
          <div className="flex items-center justify-center h-32">
            <div className="space-y-3 w-full max-w-xs">
              {[1, 2, 3].map(i => (
                <div key={i} className={`h-12 bg-muted/40 rounded-2xl animate-pulse ${i % 2 === 0 ? "ml-8" : "mr-8"}`} />
              ))}
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <p className="text-sm text-muted-foreground">Send a message to begin</p>
          </div>
        ) : (
          messages.map((msg: Message) => (
            <motion.div key={msg._id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className={`w-7 h-7 rounded-xl ${modeInfo.bg} flex items-center justify-center text-sm shrink-0 mr-2 mt-1`}>
                  {modeInfo.emoji}
                </div>
              )}
              <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-card border border-border text-foreground rounded-bl-sm"
              }`}>
                {msg.role === "assistant" ? (
                  <div className="prose-html text-sm" dangerouslySetInnerHTML={{ __html: msg.content }} />
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </motion.div>
          ))
        )}
        {isThinking && (
          <div className="flex justify-start">
            <div className={`w-7 h-7 rounded-xl ${modeInfo.bg} flex items-center justify-center text-sm shrink-0 mr-2 mt-1`}>
              {modeInfo.emoji}
            </div>
            <div className="bg-card border border-border rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex items-center gap-1.5">
                {[0, 1, 2].map(i => (
                  <motion.div key={i} className={`w-2 h-2 rounded-full ${modeInfo.color.replace("text-", "bg-")}`}
                    animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 0.8, delay: i * 0.15, repeat: Infinity }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="shrink-0 px-4 pb-4 pt-2 bg-background border-t border-border">
        <div className="flex items-end gap-2">
          {mode === "study" && (
            <button onClick={() => fileInputRef.current?.click()} className="shrink-0 w-10 h-10 rounded-xl bg-indigo-400/10 text-indigo-400 flex items-center justify-center">
              <Upload className="h-4 w-4" />
            </button>
          )}
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} accept="image/*,.pdf,.txt,.md,.docx" />
          <div className="flex-1 bg-card border border-border rounded-2xl flex items-end overflow-hidden">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={
                mode === "study" ? "Ask a study question..." :
                mode === "research" ? "Research a topic..." :
                mode === "code" ? "Describe what to build..." :
                "Message Thalamus AI..."
              }
              rows={1}
              className="flex-1 bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none"
              style={{ minHeight: "44px", maxHeight: "120px" }}
            />
          </div>
          <button onClick={handleSend} disabled={!input.trim() || isThinking}
            className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
              input.trim() && !isThinking
                ? `${modeInfo.bg} ${modeInfo.color}`
                : "bg-muted text-muted-foreground"
            }`}>
            {isThinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        <div className="flex items-center justify-center gap-1 mt-2">
          <Lock className="h-2.5 w-2.5 text-muted-foreground/40" />
          <span className="text-[9px] text-muted-foreground/40">End-to-End Encrypted · Private Session</span>
        </div>
      </div>

      {/* Conversation list drawer */}
      <AnimatePresence>
        {showConvList && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40"
              onClick={() => setShowConvList(false)} />
            <motion.div
              initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed right-0 top-0 bottom-0 w-[85vw] max-w-sm bg-card border-l border-border z-50 flex flex-col"
            >
              <div className="flex items-center justify-between px-4 py-4 border-b border-border">
                <div>
                  <p className="text-sm font-bold text-foreground">{modeInfo.label} Sessions</p>
                  <p className="text-[10px] text-muted-foreground">{filteredConvs.length} total</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={handleNewConversation} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl ${modeInfo.bg} ${modeInfo.color} text-xs font-bold`}>
                    <Plus className="h-3.5 w-3.5" />
                    New
                  </button>
                  <button onClick={() => setShowConvList(false)} className="text-muted-foreground p-1.5 rounded-lg hover:bg-muted/50">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {filteredConvs.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-sm text-muted-foreground">No sessions yet</p>
                    <button onClick={handleNewConversation} className={`mt-3 text-xs ${modeInfo.color} hover:underline`}>Start one →</button>
                  </div>
                ) : (
                  filteredConvs.map((conv: Conversation) => (
                    <div key={conv._id}
                      onClick={() => { setActiveConvId(conv._id); setShowConvList(false); if (conv.customId) navigate(`/portal/${mode}/${conv.customId}`); }}
                      className={`group flex items-center gap-3 px-3 py-3 rounded-2xl cursor-pointer transition-all ${activeConvId === conv._id ? `${modeInfo.bg} border border-current/20` : "hover:bg-muted/50"}`}
                    >
                      <div className={`w-8 h-8 rounded-xl ${modeInfo.bg} flex items-center justify-center text-sm shrink-0`}>
                        {modeInfo.emoji}
                      </div>
                      <p className={`flex-1 text-sm font-medium truncate ${activeConvId === conv._id ? modeInfo.color : "text-foreground"}`}>
                        {conv.title}
                      </p>
                      <button onClick={async (e) => {
                        e.stopPropagation();
                        if (!token) return;
                        try { await deleteConversation({ id: conv._id, token }); if (activeConvId === conv._id) setActiveConvId(null); }
                        catch { toast.error("Failed to delete"); }
                      }} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Study Resources drawer */}
      <AnimatePresence>
        {studyResourcesOpen && mode === "study" && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40"
              onClick={() => setStudyResourcesOpen(false)} />
            <motion.div
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50 rounded-t-3xl max-h-[70vh] flex flex-col"
            >
              <div className="flex items-center justify-between px-4 py-4 border-b border-border">
                <div>
                  <p className="text-sm font-bold text-foreground">Study Resources</p>
                  <p className="text-[10px] text-muted-foreground">{studyResources?.length ?? 0} loaded</p>
                </div>
                <button onClick={() => setStudyResourcesOpen(false)} className="text-muted-foreground p-1.5 rounded-lg hover:bg-muted/50">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {!studyResources || studyResources.length === 0 ? (
                  <div className="text-center py-8">
                    <BookOpen className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No resources yet</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">Upload files using the attachment button</p>
                  </div>
                ) : (
                  studyResources.map((resource: StudyResource) => (
                    <div key={resource._id} className="flex items-start gap-3 p-3 bg-background border border-border rounded-2xl">
                      <div className="w-8 h-8 rounded-xl bg-indigo-400/10 flex items-center justify-center shrink-0">
                        {resource.sourceType === "image" ? <Image className="h-4 w-4 text-indigo-400" /> :
                         resource.sourceType === "web" ? <Globe className="h-4 w-4 text-indigo-400" /> :
                         <FileText className="h-4 w-4 text-indigo-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{resource.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{resource.content.slice(0, 80)}</p>
                      </div>
                      <button onClick={async () => { if (!token) return; try { await deleteResource({ token, resourceId: resource._id }); toast.success("Deleted"); } catch { toast.error("Failed"); } }}
                        className="text-muted-foreground hover:text-destructive transition-colors p-1 shrink-0">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {creditModalOpen && <CreditModal open={creditModalOpen} onClose={() => setCreditModalOpen(false)} token={token} totalAB={totalAB} dailyAB={dailyAB} purchasedAB={purchasedAB} />}
    </div>
  );
}

// ── Mobile Home Screen ────────────────────────────────────────────────────────
function MobileHomeScreen({
  token,
  user,
  totalAB,
  onModeSelect,
  onSignOut,
}: {
  token: string;
  user: unknown;
  totalAB: number;
  onModeSelect: (mode: Mode) => void;
  onSignOut: () => void;
}) {
  const typedUser = user as { email?: string; name?: string } | null;
  const conversations = useQuery(api.conversations.list, token ? { token } : "skip") as Conversation[] | undefined;

  const recentConvs = conversations?.slice(0, 5) ?? [];

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto">
      {/* Header */}
      <div className="shrink-0 px-5 pt-12 pb-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary/20 border border-primary/30 flex items-center justify-center">
              <Cpu className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-base font-bold text-foreground">Thalamus AI</p>
              <p className="text-[10px] text-muted-foreground">L4.5 Agent System</p>
            </div>
          </div>
          <button onClick={() => {}} className="flex items-center gap-1.5 bg-amber-400/10 text-amber-400 px-3 py-1.5 rounded-xl text-xs font-bold border border-amber-400/20">
            <Zap className="h-3.5 w-3.5" />
            {(totalAB / 1_000_000).toFixed(1)}M AB
          </button>
        </div>

        {/* Greeting */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Hello{typedUser?.name ? `, ${typedUser.name.split(" ")[0]}` : ""} 👋
          </h1>
          <p className="text-sm text-muted-foreground mt-1">What would you like to do today?</p>
        </div>
      </div>

      {/* Mode cards */}
      <div className="px-5 mb-6">
        <p className="text-[11px] font-bold text-muted-foreground mb-3 tracking-widest">MODES</p>
        <div className="grid grid-cols-2 gap-3">
          {MODES.map((mode) => (
            <motion.button
              key={mode.id}
              whileTap={{ scale: 0.96 }}
              onClick={() => onModeSelect(mode.id)}
              className={`flex flex-col items-start gap-3 p-4 rounded-2xl border border-border ${mode.bg} hover:border-current/30 transition-all text-left`}
            >
              <div className="text-2xl">{mode.emoji}</div>
              <div>
                <p className={`text-sm font-bold ${mode.color}`}>{mode.label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {mode.id === "chat" && "General AI"}
                  {mode.id === "research" && "Deep research"}
                  {mode.id === "study" && "Study helper"}
                  {mode.id === "code" && "9 agents"}
                </p>
              </div>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Recent sessions */}
      {recentConvs.length > 0 && (
        <div className="px-5 mb-6">
          <p className="text-[11px] font-bold text-muted-foreground mb-3 tracking-widest">RECENT</p>
          <div className="space-y-2">
            {recentConvs.map((conv: Conversation) => {
              const modeInfo = MODES.find(m => m.id === conv.mode)!;
              return (
                <motion.button
                  key={conv._id}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onModeSelect(conv.mode)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-card border border-border rounded-2xl hover:border-primary/20 transition-all text-left"
                >
                  <div className={`w-9 h-9 rounded-xl ${modeInfo.bg} flex items-center justify-center text-base shrink-0`}>
                    {modeInfo.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{conv.title}</p>
                    <p className={`text-[10px] ${modeInfo.color} mt-0.5`}>{modeInfo.label}</p>
                  </div>
                  <ChevronLeft className="h-4 w-4 text-muted-foreground/40 rotate-180" />
                </motion.button>
              );
            })}
          </div>
        </div>
      )}

      {/* Sign out */}
      <div className="px-5 pb-8 mt-auto">
        <button onClick={onSignOut} className="w-full flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground hover:text-destructive transition-colors border border-border rounded-2xl hover:border-destructive/30">
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
        <p className="text-[10px] text-muted-foreground/40 text-center mt-3">
          {typedUser?.email}
        </p>
      </div>
    </div>
  );
}

// ── Main Mobile Portal ────────────────────────────────────────────────────────
export default function MobilePortal() {
  const { isLoading, isAuthenticated, user, signOut, token } = useAuth();
  const navigate = useNavigate();
  const params = useParams<{ mode?: string; sessionId?: string }>();

  const activeMode: Mode = (VALID_MODES.includes(params.mode as Mode) ? params.mode : "chat") as Mode;

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate("/auth");
  }, [isLoading, isAuthenticated, navigate]);

  const ensureDailyBalance = useMutation(api.customAuthHelpers.ensureDailyBalance);
  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (token && user !== undefined && user !== null && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      ensureDailyBalance({ token }).catch(() => {});
    }
  }, [token, user, ensureDailyBalance]);

  const typedUser = user as { dailyAgentBucks?: number; purchasedAgentBucks?: number; agentBucksBalance?: number } | null;
  const dailyAB = typedUser?.dailyAgentBucks ?? typedUser?.agentBucksBalance ?? 0;
  const purchasedAB = typedUser?.purchasedAgentBucks ?? 0;
  const totalAB = dailyAB + purchasedAB;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-3xl bg-primary/20 border border-primary/30 flex items-center justify-center">
            <Cpu className="h-7 w-7 text-primary animate-pulse" />
          </div>
          <p className="text-sm text-muted-foreground">Loading Thalamus AI...</p>
        </div>
      </div>
    );
  }

  const handleModeSelect = (mode: Mode) => {
    navigate(`/portal/${mode}`);
  };

  const handleBack = () => {
    navigate("/portal");
  };

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Bottom navigation bar */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {!activeMode ? (
            <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <MobileHomeScreen
                token={token ?? ""}
                user={user}
                totalAB={totalAB}
                onModeSelect={handleModeSelect}
                onSignOut={signOut}
              />
            </motion.div>
          ) : activeMode === "code" ? (
            <motion.div key="code" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="h-full flex flex-col">
              <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-border bg-card/80">
                <button onClick={handleBack} className="text-muted-foreground p-1 -ml-1">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-violet-400/15 flex items-center justify-center text-base">⚡</div>
                  <div>
                    <p className="text-sm font-bold text-violet-400">Code Mode</p>
                    <p className="text-[10px] text-muted-foreground">9-agent system</p>
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-hidden">
                <TeamPortalInline token={token ?? ""} />
              </div>
            </motion.div>
          ) : (
            <motion.div key={activeMode} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="h-full">
              <MobileChatView
                mode={activeMode}
                token={token ?? ""}
                user={user}
                onBack={handleBack}
                totalAB={totalAB}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom nav — only show on home screen */}
      {!activeMode && (
        <div className="shrink-0 border-t border-border bg-card/80 backdrop-blur-sm">
          <div className="flex items-center justify-around px-4 py-2 pb-safe">
            {MODES.map((mode) => (
              <button key={mode.id} onClick={() => handleModeSelect(mode.id)}
                className="flex flex-col items-center gap-1 py-2 px-3 rounded-xl transition-all">
                <span className="text-xl">{mode.emoji}</span>
                <span className="text-[9px] text-muted-foreground font-bold">{mode.label.toUpperCase()}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
