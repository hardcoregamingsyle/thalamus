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
  X, Trash2, Zap, LogOut, Lock, Upload, Cpu, ChevronRight,
  ArrowLeft, MoreVertical, Mic, Paperclip, Smile,
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

const MODES: { id: Mode; label: string; icon: typeof MessageSquare; color: string; bg: string; emoji: string; desc: string; gradient: string }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare, color: "text-blue-400", bg: "bg-blue-500/15", emoji: "💬", desc: "General AI conversation", gradient: "from-blue-500/20 to-blue-600/5" },
  { id: "research", label: "Research", icon: Search, color: "text-amber-400", bg: "bg-amber-500/15", emoji: "🔬", desc: "Deep web research", gradient: "from-amber-500/20 to-amber-600/5" },
  { id: "study", label: "Study", icon: BookOpen, color: "text-indigo-400", bg: "bg-indigo-500/15", emoji: "📚", desc: "Study with resources", gradient: "from-indigo-500/20 to-indigo-600/5" },
  { id: "code", label: "Code", icon: Users, color: "text-violet-400", bg: "bg-violet-500/15", emoji: "⚡", desc: "9-agent dev system", gradient: "from-violet-500/20 to-violet-600/5" },
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

  useEffect(() => {
    if (urlSessionId && conversations && mode !== "code") {
      const conv = conversations.find((c: Conversation) => c.customId === urlSessionId);
      if (conv) setActiveConvId(conv._id);
    }
  }, [urlSessionId, conversations, mode]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

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
  const dailyAB = (typedUser?.dailyAgentBucks ?? typedUser?.agentBucksBalance ?? 0) + (typedUser?.purchasedAgentBucks ?? 0);

  const activeConvTitle = activeConvId && conversations
    ? (conversations.find(c => c._id === activeConvId)?.title ?? modeInfo.label)
    : modeInfo.label;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* WhatsApp-style top bar */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-2 bg-card border-b border-border/50 safe-top" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <button onClick={onBack} className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-muted/50 transition-colors -ml-1">
          <ArrowLeft className="h-5 w-5 text-foreground" />
        </button>
        <div className={`w-10 h-10 rounded-full ${modeInfo.bg} flex items-center justify-center text-xl shrink-0`}>
          {modeInfo.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-foreground leading-tight truncate">{activeConvTitle}</p>
          <p className={`text-[12px] ${modeInfo.color} leading-tight`}>{modeInfo.label} Mode</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setCreditModalOpen(true)} className="flex items-center gap-1.5 bg-amber-400/10 border border-amber-400/20 text-amber-400 px-3 py-1.5 rounded-full text-[12px] font-semibold">
            <Zap className="h-3.5 w-3.5" />
            {(dailyAB / 1_000_000).toFixed(1)}M
          </button>
          <button onClick={() => setShowConvList(true)} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-muted/50 transition-colors">
            <MoreVertical className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Messages area — WhatsApp-style background */}
      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-4 space-y-2" style={{ background: "var(--background)" }}>
        {!activeConvId ? (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center h-full gap-8 pb-8">
            <div className={`w-24 h-24 rounded-3xl bg-gradient-to-br ${modeInfo.gradient} border border-border flex items-center justify-center text-5xl shadow-lg`}>
              {modeInfo.emoji}
            </div>
            <div className="text-center px-6">
              <h2 className="text-2xl font-bold text-foreground mb-2">{modeInfo.label}</h2>
              <p className="text-[15px] text-muted-foreground leading-relaxed">
                {mode === "chat" && "Ask anything — fast, accurate, context-aware AI"}
                {mode === "research" && "Deep research with live web search & synthesis"}
                {mode === "study" && "Study smarter with resource grounding & live search"}
                {mode === "code" && "9-agent system for full software development"}
              </p>
            </div>
            <button onClick={handleNewConversation}
              className={`flex items-center gap-3 px-8 py-4 rounded-2xl bg-gradient-to-r ${modeInfo.gradient} border border-border text-foreground font-semibold text-[15px] shadow-sm active:scale-95 transition-transform`}>
              <Plus className="h-5 w-5" />
              Start New Session
            </button>
            {filteredConvs.length > 0 && (
              <div className="w-full px-4">
                <p className="text-[12px] text-muted-foreground font-semibold mb-3 text-center tracking-wide">RECENT</p>
                <div className="space-y-2">
                  {filteredConvs.slice(0, 4).map((conv: Conversation) => (
                    <motion.button key={conv._id} whileTap={{ scale: 0.98 }}
                      onClick={() => { setActiveConvId(conv._id); if (conv.customId) navigate(`/portal/${mode}/${conv.customId}`); }}
                      className="w-full flex items-center gap-3 px-4 py-3.5 bg-card border border-border/60 rounded-2xl active:bg-muted/50 transition-colors text-left">
                      <div className={`w-10 h-10 rounded-full ${modeInfo.bg} flex items-center justify-center text-lg shrink-0`}>
                        {modeInfo.emoji}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium text-foreground truncate">{conv.title}</p>
                        <p className="text-[12px] text-muted-foreground">Tap to continue</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                    </motion.button>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        ) : messages === undefined ? (
          <div className="space-y-4 px-2 pt-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className={`flex ${i % 2 === 0 ? "justify-end" : "justify-start"}`}>
                <div className={`h-14 rounded-2xl animate-pulse bg-muted/40 ${i % 2 === 0 ? "w-48" : "w-64"}`} />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <p className="text-[14px] text-muted-foreground">Send a message to begin</p>
          </div>
        ) : (
          messages.map((msg: Message, idx: number) => (
            <motion.div key={msg._id}
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.2 }}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} items-end gap-2`}
            >
              {msg.role === "assistant" && (
                <div className={`w-8 h-8 rounded-full ${modeInfo.bg} flex items-center justify-center text-base shrink-0 mb-0.5`}>
                  {modeInfo.emoji}
                </div>
              )}
              <div className={`max-w-[78%] px-4 py-3 text-[14px] leading-relaxed shadow-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-[20px] rounded-br-[6px]"
                  : "bg-card border border-border/60 text-foreground rounded-[20px] rounded-bl-[6px]"
              }`}>
                {msg.role === "assistant" ? (
                  <div className="prose-html text-[14px]" dangerouslySetInnerHTML={{ __html: msg.content.startsWith("<") ? msg.content : msg.content.replace(/\n/g, "<br/>") }} />
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
                <p className={`text-[10px] mt-1.5 text-right ${msg.role === "user" ? "text-primary-foreground/60" : "text-muted-foreground/50"}`}>
                  {new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </motion.div>
          ))
        )}
        {isThinking && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-start items-end gap-2"
          >
            <div className={`w-9 h-9 rounded-full ${modeInfo.bg} flex items-center justify-center text-lg shrink-0 shadow-sm`}>
              {modeInfo.emoji}
            </div>
            <div className="rounded-[20px] rounded-bl-[6px] px-4 py-3.5 shadow-lg max-w-[72%] w-56 space-y-2" style={{ background: "rgba(60,80,140,0.35)", border: "1px solid rgba(100,130,255,0.25)" }}>
              {/* Typing dots + label */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  {[0, 1, 2].map(i => (
                    <motion.div key={i} className={`w-2.5 h-2.5 rounded-full ${modeInfo.color.replace("text-", "bg-")}`}
                      animate={{ y: [0, -6, 0], opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 0.8, delay: i * 0.16, repeat: Infinity }} />
                  ))}
                </div>
                <span className={`text-[10px] ${modeInfo.color} font-medium`}>
                  {mode === "study" ? "searching..." : mode === "research" ? "researching..." : "thinking..."}
                </span>
              </div>
              {/* Skeleton lines */}
              <div className="space-y-2 pt-0.5">
                <motion.div className="h-3 rounded-full w-full" style={{ background: "rgba(255,255,255,0.55)" }}
                  animate={{ opacity: [0.6, 1, 0.6] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0 }} />
                <motion.div className="h-3 rounded-full w-4/5" style={{ background: "rgba(255,255,255,0.40)" }}
                  animate={{ opacity: [0.6, 1, 0.6] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }} />
                <motion.div className="h-3 rounded-full w-3/5" style={{ background: "rgba(255,255,255,0.28)" }}
                  animate={{ opacity: [0.6, 1, 0.6] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }} />
              </div>
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* WhatsApp-style input bar */}
      <div className="shrink-0 px-3 py-3 bg-card border-t border-border/50" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
        <div className="flex items-end gap-2">
          {mode === "study" && (
            <button onClick={() => fileInputRef.current?.click()}
              className="shrink-0 w-12 h-12 rounded-full bg-muted/50 text-muted-foreground flex items-center justify-center active:bg-muted transition-colors">
              <Paperclip className="h-5 w-5" />
            </button>
          )}
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} accept="image/*,.pdf,.txt,.md,.docx" />
          <div className="flex-1 flex items-end bg-background border border-border/60 rounded-[24px] overflow-hidden shadow-sm">
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
              className="flex-1 bg-transparent px-4 py-3.5 text-[15px] text-foreground placeholder:text-muted-foreground/60 resize-none focus:outline-none leading-relaxed"
              style={{ minHeight: "48px", maxHeight: "120px" }}
            />
          </div>
          <motion.button
            onClick={handleSend}
            disabled={!input.trim() || isThinking}
            whileTap={{ scale: 0.9 }}
            className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center shadow-md transition-all ${
              input.trim() && !isThinking
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}>
            {isThinking ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </motion.button>
        </div>
        <div className="flex items-center justify-center gap-1.5 mt-2">
          <Lock className="h-3 w-3 text-muted-foreground/30" />
          <span className="text-[11px] text-muted-foreground/30">End-to-end encrypted</span>
        </div>
      </div>

      {/* Conversation list — slides from right like WhatsApp */}
      <AnimatePresence>
        {showConvList && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
              onClick={() => setShowConvList(false)} />
            <motion.div
              initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
              className="fixed right-0 top-0 bottom-0 w-[88vw] max-w-sm bg-background z-50 flex flex-col shadow-2xl"
            >
              {/* Header */}
              <div className="flex items-center gap-3 px-4 py-4 bg-card border-b border-border/50" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
                <button onClick={() => setShowConvList(false)} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-muted/50 transition-colors">
                  <ArrowLeft className="h-5 w-5 text-foreground" />
                </button>
                <div className="flex-1">
                  <p className="text-[16px] font-semibold text-foreground">{modeInfo.label} Sessions</p>
                  <p className="text-[12px] text-muted-foreground">{filteredConvs.length} conversation{filteredConvs.length !== 1 ? "s" : ""}</p>
                </div>
                <button onClick={handleNewConversation}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-full ${modeInfo.bg} ${modeInfo.color} text-[13px] font-semibold active:opacity-80 transition-opacity`}>
                  <Plus className="h-4 w-4" />
                  New
                </button>
              </div>

              {/* List */}
              <div className="flex-1 overflow-y-auto">
                {filteredConvs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 gap-3">
                    <div className={`w-16 h-16 rounded-full ${modeInfo.bg} flex items-center justify-center text-3xl`}>{modeInfo.emoji}</div>
                    <p className="text-[14px] text-muted-foreground">No sessions yet</p>
                    <button onClick={handleNewConversation} className={`text-[13px] ${modeInfo.color} font-semibold`}>Start one →</button>
                  </div>
                ) : (
                  filteredConvs.map((conv: Conversation) => (
                    <motion.div key={conv._id} whileTap={{ backgroundColor: "var(--muted)" }}
                      className="flex items-center gap-3 px-4 py-3.5 border-b border-border/30 active:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => { setActiveConvId(conv._id); setShowConvList(false); if (conv.customId) navigate(`/portal/${mode}/${conv.customId}`); }}
                    >
                      <div className={`w-12 h-12 rounded-full ${modeInfo.bg} flex items-center justify-center text-xl shrink-0`}>
                        {modeInfo.emoji}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[15px] font-medium text-foreground truncate">{conv.title}</p>
                        <p className="text-[12px] text-muted-foreground mt-0.5">Tap to open</p>
                      </div>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!token) return;
                          try {
                            await deleteConversation({ id: conv._id, token });
                            if (activeConvId === conv._id) setActiveConvId(null);
                            toast.success("Deleted");
                          } catch { toast.error("Failed"); }
                        }}
                        className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </motion.div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Study resources sheet */}
      <AnimatePresence>
        {studyResourcesOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
              onClick={() => setStudyResourcesOpen(false)} />
            <motion.div
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
              className="fixed bottom-0 left-0 right-0 bg-background rounded-t-3xl z-50 flex flex-col shadow-2xl"
              style={{ maxHeight: "75vh" }}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
                <div>
                  <p className="text-[16px] font-semibold text-foreground">Study Resources</p>
                  <p className="text-[12px] text-muted-foreground">{studyResources?.length ?? 0} resources loaded</p>
                </div>
                <button onClick={() => setStudyResourcesOpen(false)} className="w-10 h-10 flex items-center justify-center rounded-full bg-muted/50">
                  <X className="h-5 w-5 text-foreground" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {!studyResources || studyResources.length === 0 ? (
                  <div className="text-center py-12">
                    <BookOpen className="h-12 w-12 text-muted-foreground/20 mx-auto mb-3" />
                    <p className="text-[14px] text-muted-foreground">No resources yet</p>
                    <p className="text-[12px] text-muted-foreground/60 mt-1">Upload files or add text resources</p>
                  </div>
                ) : (
                  studyResources.map((resource: StudyResource) => (
                    <div key={resource._id} className="flex items-start gap-3 p-4 bg-card border border-border/60 rounded-2xl">
                      <div className="w-10 h-10 rounded-xl bg-indigo-400/15 flex items-center justify-center shrink-0">
                        <BookOpen className="h-5 w-5 text-indigo-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium text-foreground truncate">{resource.title}</p>
                        <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2">{resource.content.slice(0, 80)}</p>
                      </div>
                      <button onClick={async () => { if (!token) return; try { await deleteResource({ token, resourceId: resource._id }); toast.success("Deleted"); } catch { toast.error("Failed"); } }}
                        className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="p-4 border-t border-border/50">
                <button onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 py-4 bg-indigo-400/10 border border-indigo-400/20 text-indigo-400 rounded-2xl text-[14px] font-semibold active:opacity-80 transition-opacity">
                  <Upload className="h-5 w-5" />
                  Upload File
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {creditModalOpen && <CreditModal open={creditModalOpen} onClose={() => setCreditModalOpen(false)} token={token} totalAB={totalAB} dailyAB={dailyAB} purchasedAB={0} />}
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
  const conversations = useQuery(api.conversations.list, token ? { token } : "skip") as Conversation[] | undefined;
  const typedUser = user as { email?: string; dailyAgentBucks?: number; purchasedAgentBucks?: number; agentBucksBalance?: number } | null;
  const [creditModalOpen, setCreditModalOpen] = useState(false);
  const dailyAB = typedUser?.dailyAgentBucks ?? typedUser?.agentBucksBalance ?? 0;
  const purchasedAB = typedUser?.purchasedAgentBucks ?? 0;

  const recentConvs = conversations?.slice(0, 5) ?? [];

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto">
      {/* Header */}
      <div className="shrink-0 px-5 pt-safe pb-4 bg-card border-b border-border/50" style={{ paddingTop: "max(20px, env(safe-area-inset-top))" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary/20 border border-primary/30 flex items-center justify-center">
              <Cpu className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-[17px] font-bold text-foreground">Thalamus AI</p>
              <p className="text-[11px] text-muted-foreground">L4.5 Agent System</p>
            </div>
          </div>
          <button onClick={() => setCreditModalOpen(true)}
            className="flex items-center gap-2 bg-amber-400/10 border border-amber-400/20 text-amber-400 px-4 py-2 rounded-full text-[13px] font-semibold active:opacity-80 transition-opacity">
            <Zap className="h-4 w-4" />
            {(totalAB / 1_000_000).toFixed(1)}M AB
          </button>
        </div>
      </div>

      <div className="flex-1 px-4 py-5 space-y-6">
        {/* Mode grid — like Instagram's story circles */}
        <div>
          <p className="text-[13px] font-semibold text-muted-foreground mb-3 px-1">MODES</p>
          <div className="grid grid-cols-2 gap-3">
            {MODES.map((mode) => (
              <motion.button
                key={mode.id}
                whileTap={{ scale: 0.96 }}
                onClick={() => onModeSelect(mode.id)}
                className={`flex flex-col items-start gap-3 p-5 rounded-3xl bg-gradient-to-br ${mode.gradient} border border-border/40 text-left active:opacity-90 transition-opacity shadow-sm`}
              >
                <div className={`w-12 h-12 rounded-2xl ${mode.bg} flex items-center justify-center text-2xl`}>
                  {mode.emoji}
                </div>
                <div>
                  <p className={`text-[15px] font-bold ${mode.color}`}>{mode.label}</p>
                  <p className="text-[12px] text-muted-foreground mt-0.5 leading-snug">{mode.desc}</p>
                </div>
              </motion.button>
            ))}
          </div>
        </div>

        {/* Recent conversations */}
        {recentConvs.length > 0 && (
          <div>
            <p className="text-[13px] font-semibold text-muted-foreground mb-3 px-1">RECENT</p>
            <div className="space-y-2">
              {recentConvs.map((conv: Conversation) => {
                const modeInfo = MODES.find(m => m.id === conv.mode) ?? MODES[0];
                return (
                  <motion.button
                    key={conv._id}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => onModeSelect(conv.mode)}
                    className="w-full flex items-center gap-4 px-4 py-4 bg-card border border-border/50 rounded-2xl active:bg-muted/30 transition-colors text-left shadow-sm"
                  >
                    <div className={`w-12 h-12 rounded-full ${modeInfo.bg} flex items-center justify-center text-xl shrink-0`}>
                      {modeInfo.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-medium text-foreground truncate">{conv.title}</p>
                      <p className={`text-[12px] ${modeInfo.color} mt-0.5`}>{modeInfo.label}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                  </motion.button>
                );
              })}
            </div>
          </div>
        )}

        {/* Sign out */}
        <div className="pt-2 pb-8">
          <button onClick={onSignOut}
            className="w-full flex items-center justify-center gap-2 py-4 text-[14px] text-muted-foreground border border-border/50 rounded-2xl active:bg-muted/30 transition-colors">
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
          {typedUser?.email && (
            <p className="text-[11px] text-muted-foreground/40 text-center mt-3">{typedUser.email}</p>
          )}
        </div>
      </div>

      {creditModalOpen && <CreditModal open={creditModalOpen} onClose={() => setCreditModalOpen(false)} token={token} totalAB={totalAB} dailyAB={dailyAB} purchasedAB={purchasedAB} />}
    </div>
  );
}

// ── Main Mobile Portal ────────────────────────────────────────────────────────
export default function MobilePortal() {
  const { isLoading, isAuthenticated, user, signOut, token } = useAuth();
  const navigate = useNavigate();
  const params = useParams<{ mode?: string; sessionId?: string }>();

  const activeMode: Mode | null = (VALID_MODES.includes(params.mode as Mode) ? params.mode : null) as Mode | null;

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
        <div className="flex flex-col items-center gap-5">
          <div className="w-16 h-16 rounded-3xl bg-primary/20 border border-primary/30 flex items-center justify-center">
            <Cpu className="h-8 w-8 text-primary animate-pulse" />
          </div>
          <p className="text-[15px] text-muted-foreground">Loading Thalamus AI...</p>
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
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {!activeMode ? (
            <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -20 }} className="h-full">
              <MobileHomeScreen
                token={token ?? ""}
                user={user}
                totalAB={totalAB}
                onModeSelect={handleModeSelect}
                onSignOut={signOut}
              />
            </motion.div>
          ) : activeMode === "code" ? (
            <motion.div key="code" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="h-full flex flex-col">
              <div className="shrink-0 flex items-center gap-3 px-3 py-2 bg-card border-b border-border/50" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
                <button onClick={handleBack} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-muted/50 transition-colors">
                  <ArrowLeft className="h-5 w-5 text-foreground" />
                </button>
                <div className="w-10 h-10 rounded-full bg-violet-500/15 flex items-center justify-center text-xl shrink-0">⚡</div>
                <div>
                  <p className="text-[15px] font-semibold text-foreground">Code Mode</p>
                  <p className="text-[12px] text-violet-400">9-agent system</p>
                </div>
              </div>
              <div className="flex-1 overflow-hidden">
                <TeamPortalInline token={token ?? ""} />
              </div>
            </motion.div>
          ) : (
            <motion.div key={activeMode} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="h-full">
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

      {/* Bottom tab bar — only on home screen, like Instagram */}
      {!activeMode && (
        <div className="shrink-0 bg-card border-t border-border/50" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="flex items-center justify-around px-2 py-2">
            {MODES.map((mode) => (
              <motion.button key={mode.id} whileTap={{ scale: 0.9 }} onClick={() => handleModeSelect(mode.id)}
                className="flex flex-col items-center gap-1 py-2 px-4 rounded-2xl active:bg-muted/30 transition-colors min-w-[60px]">
                <span className="text-2xl">{mode.emoji}</span>
                <span className="text-[10px] text-muted-foreground font-semibold tracking-wide">{mode.label.toUpperCase()}</span>
              </motion.button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}