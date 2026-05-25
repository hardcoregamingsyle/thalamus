import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { useQuery, useMutation, useAction } from "convex/react";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { useNavigate, useParams } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import CreditModal from "@/components/CreditModal";
import {
  MessageSquare, Search, BookOpen, Users, Plus, Send, Loader2,
  Trash2, Zap, LogOut, Cpu, ChevronRight,
  ArrowLeft, Paperclip, Settings, Sparkles, Moon, Sun, GraduationCap,
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

const MODES: { id: Mode; label: string; icon: typeof MessageSquare; color: string; bg: string; emoji: string; desc: string; accentColor: string }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare, color: "text-blue-400", bg: "bg-blue-500/15", emoji: "💬", desc: "Ask anything, get instant answers", accentColor: "#60a5fa" },
  { id: "research", label: "Research", icon: Search, color: "text-amber-400", bg: "bg-amber-500/15", emoji: "🔬", desc: "Deep research with live web data", accentColor: "#fbbf24" },
  { id: "study", label: "Study", icon: BookOpen, color: "text-indigo-400", bg: "bg-indigo-500/15", emoji: "📚", desc: "Study smarter with AI grounding", accentColor: "#818cf8" },
  { id: "code", label: "Code", icon: Users, color: "text-violet-400", bg: "bg-violet-500/15", emoji: "⚡", desc: "9-agent software development", accentColor: "#a78bfa" },
];

const VALID_MODES: Mode[] = ["chat", "research", "study", "code"];

// ── Streaming helper ──────────────────────────────────────────────────────────
async function streamChat(
  siteUrl: string,
  payload: object,
  onChunk: (text: string) => void,
): Promise<string> {
  const response = await fetch(`${siteUrl}/stream-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok || !response.body) throw new Error("Stream failed");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;
      try {
        const parsed = JSON.parse(jsonStr) as { chunk?: string; done?: boolean; fullText?: string };
        if (parsed.chunk) { accumulated += parsed.chunk; onChunk(accumulated); }
        if (parsed.done && parsed.fullText) accumulated = parsed.fullText;
      } catch { /* skip */ }
    }
  }
  return accumulated;
}

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
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const params = useParams<{ mode?: string; sessionId?: string }>();
  const urlSessionId = params.sessionId ?? null;

  const [activeConvId, setActiveConvId] = useState<Id<"conversations"> | null>(null);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [showConvList, setShowConvList] = useState(false);
  const [creditModalOpen, setCreditModalOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const modeInfo = MODES.find(m => m.id === mode)!;

  const conversations = useQuery(api.conversations.list, token ? { token } : "skip") as Conversation[] | undefined;
  const messages = useQuery(api.conversations.getMessages, activeConvId && token ? { conversationId: activeConvId, token } : "skip") as Message[] | undefined;

  const createConversation = useMutation(api.conversations.create);
  const deleteConversation = useMutation(api.conversations.remove);
  const sendMessage = useAction(api.ai.sendMessage);
  const sendStudyMessage = useAction(api.study.sendStudyMessage);
  const generateTitle = useAction(api.ai.generateConversationTitle);
  const processFileResource = useAction(api.study.processFileResource);
  const saveUserMessage = useMutation(api.conversations.saveUserMessage);

  const filteredConvs = conversations?.filter((c: Conversation) => c.mode === mode) || [];

  useEffect(() => {
    if (urlSessionId && conversations && mode !== "code") {
      const conv = conversations.find((c: Conversation) => c.customId === urlSessionId);
      if (conv) setActiveConvId(conv._id);
    }
  }, [urlSessionId, conversations, mode]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking, streamingContent]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  }, [input]);

  const handleNewConversation = async () => {
    if (!token) return;
    try {
      const result = await createConversation({ title: `New ${modeInfo.label}`, mode, token }) as unknown as Id<"conversations">;
      setActiveConvId(result);
      setShowConvList(false);
    } catch { toast.error("Failed to create conversation"); }
  };

  const handleSend = async () => {
    if (!input.trim() || isThinking || !token) return;
    const msg = input.trim();
    setInput("");

    const userContext = {
      datetime: new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    // Create conversation if needed
    let convId = activeConvId;
    if (!convId) {
      try {
        const result = await createConversation({ token, mode, title: msg.slice(0, 50) });
        const r = result as { id: Id<"conversations">; customId: string } | Id<"conversations">;
        const id = typeof r === "object" && "id" in r ? r.id : r as Id<"conversations">;
        const customId = typeof r === "object" && "customId" in r ? r.customId : null;
        convId = id;
        setActiveConvId(id);
        if (customId) navigate(`/portal/${mode}/${customId}`, { replace: true });
      } catch {
        toast.error("Failed to create conversation");
        return;
      }
    }

    // Save user message immediately
    let userMessageSaved = false;
    try {
      await saveUserMessage({ conversationId: convId, content: msg, token });
      userMessageSaved = true;
    } catch { /* non-critical */ }

    const convexUrl = import.meta.env.VITE_CONVEX_URL as string;
    const siteUrl = convexUrl.replace(".convex.cloud", ".convex.site");

    const SYSTEM_PROMPTS: Record<string, string> = {
      chat: `You are Thalamus AI, an advanced AI assistant.\n\nCRITICAL: You MUST respond in clean, semantic HTML only. No markdown. No plain text. Pure HTML.\nUse: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <code>, <pre><code>, <blockquote>\nHeadings: style="font-size:1.2em;font-weight:bold;margin:0.5em 0;color:#e5e7eb"\nParagraphs: style="margin:0.5em 0;line-height:1.6;color:#d1d5db"\nLists: style="margin:0.3em 0 0.3em 1.2em;color:#d1d5db"\nCode blocks: style="background:#111827;color:#34d399;padding:1em;border-radius:8px;overflow-x:auto;display:block;margin:0.5em 0;font-family:monospace;font-size:0.8em"`,
      research: `You are Thalamus AI Research Mode — a deep research assistant. Provide comprehensive, well-structured research reports.\n\nCRITICAL: Respond in clean semantic HTML only. No markdown. Pure HTML.\nUse: <h1>, <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <blockquote>, <table>\nHeadings: style="font-size:1.3em;font-weight:bold;margin:0.8em 0 0.4em;color:#f9fafb"\nParagraphs: style="margin:0.5em 0;line-height:1.7;color:#d1d5db"`,
      study: `You are Thalamus AI Study Mode — a precision study assistant. Give dense, accurate, exam-ready information.\n\nCRITICAL: Respond in clean semantic HTML only. No markdown. Pure HTML.\nUse: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <blockquote>\nHeadings: style="font-size:1.15em;font-weight:bold;margin:0.8em 0 0.4em;color:#e5e7eb;border-left:4px solid #6366f1;padding-left:0.7em"\nParagraphs: style="margin:0.4em 0;line-height:1.7;color:#d1d5db;font-size:0.92em"`,
    };

    const historyMsgs = (messages ?? []).slice(-10).map((m: Message) => ({ role: m.role, content: m.content.slice(0, 1500) }));
    const systemPrompt = SYSTEM_PROMPTS[mode] ?? SYSTEM_PROMPTS.chat;

    setStreamingContent("");

    try {
      const accumulated = await streamChat(siteUrl, {
        content: msg,
        mode,
        history: historyMsgs,
        systemPrompt,
        userContext,
        token,
        conversationId: convId,
        preferClaude: true,
        skipUserSave: userMessageSaved,
      }, (text) => setStreamingContent(text));
      setStreamingContent(null);
      void accumulated; // response saved by server
    } catch {
      setStreamingContent(null);
      setIsThinking(true);
      try {
        if (mode === "study") {
          await sendStudyMessage({ conversationId: convId, content: msg, token, userContext, skipUserSave: userMessageSaved });
        } else {
          await sendMessage({ conversationId: convId, content: msg, mode: mode as "chat" | "research" | "code", token, userContext, skipUserSave: userMessageSaved });
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to send");
      }
    }

    generateTitle({ firstMessage: msg, conversationId: convId, token }).catch(() => {});
    setIsThinking(false);
    setStreamingContent(null);
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
  const purchasedAB = typedUser?.purchasedAgentBucks ?? 0;
  const dailyAB = (typedUser?.dailyAgentBucks ?? typedUser?.agentBucksBalance ?? 0) + purchasedAB;

  const activeConvTitle = activeConvId && conversations
    ? (conversations.find(c => c._id === activeConvId)?.title ?? modeInfo.label)
    : modeInfo.label;

  const allMessages = messages ?? [];
  const showMessages = activeConvId && allMessages.length > 0;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Top bar */}
      <div className="shrink-0 flex items-center gap-2 px-3 border-b border-border/50 bg-card/80 backdrop-blur-sm" style={{ paddingTop: "max(12px, env(safe-area-inset-top))", paddingBottom: "10px" }}>
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-muted/50 active:bg-muted transition-colors">
          <ArrowLeft className="h-5 w-5 text-foreground" />
        </button>
        <div className={`w-8 h-8 rounded-full ${modeInfo.bg} flex items-center justify-center text-base shrink-0`}>
          {modeInfo.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-foreground leading-tight truncate">{activeConvTitle}</p>
          <p className={`text-[11px] ${modeInfo.color} leading-tight`}>{modeInfo.label} · Thalamus AI</p>
        </div>
        <button onClick={() => setCreditModalOpen(true)} className="flex items-center gap-1 bg-amber-400/10 border border-amber-400/20 text-amber-400 px-2.5 py-1 rounded-full text-[11px] font-semibold">
          <Zap className="h-3 w-3" />
          {(dailyAB / 1_000_000).toFixed(1)}M
        </button>
        <button onClick={toggleTheme} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-muted/50 transition-colors" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          {theme === 'dark' ? <Sun className="h-4 w-4 text-muted-foreground" /> : <Moon className="h-4 w-4 text-muted-foreground" />}
        </button>
        <button onClick={() => setShowConvList(true)} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-muted/50 transition-colors">
          <Settings className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-3">
        {!activeConvId ? (
          // Empty state — prompt to start
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center h-full gap-6 pb-16">
            <div className={`w-20 h-20 rounded-3xl ${modeInfo.bg} border border-border flex items-center justify-center text-4xl`}>
              {modeInfo.emoji}
            </div>
            <div className="text-center px-4">
              <h2 className={`text-xl font-bold ${modeInfo.color} mb-1`}>{modeInfo.label} Mode</h2>
              <p className="text-[14px] text-muted-foreground leading-relaxed">{modeInfo.desc}</p>
            </div>
            {/* Recent conversations */}
            {filteredConvs.length > 0 && (
              <div className="w-full space-y-2">
                <p className="text-[11px] text-muted-foreground font-semibold text-center tracking-widest">RECENT</p>
                {filteredConvs.slice(0, 3).map((conv: Conversation) => (
                  <motion.button key={conv._id} whileTap={{ scale: 0.98 }}
                    onClick={() => { setActiveConvId(conv._id); if (conv.customId) navigate(`/portal/${mode}/${conv.customId}`); }}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-card border border-border/60 rounded-2xl active:bg-muted/50 transition-colors text-left">
                    <div className={`w-9 h-9 rounded-full ${modeInfo.bg} flex items-center justify-center text-base shrink-0`}>{modeInfo.emoji}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-foreground truncate">{conv.title}</p>
                      <p className="text-[11px] text-muted-foreground">Tap to continue</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                  </motion.button>
                ))}
              </div>
            )}
          </motion.div>
        ) : messages === undefined ? (
          // Loading skeleton
          <div className="space-y-3 pt-2">
            {[80, 60, 90, 50].map((w, i) => (
              <div key={i} className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}>
                <div className={`h-12 rounded-2xl animate-pulse bg-muted/60`} style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        ) : !showMessages ? (
          <div className="flex flex-col items-center justify-center h-32">
            <p className="text-[13px] text-muted-foreground">Send a message to begin</p>
          </div>
        ) : (
          <>
            {allMessages.map((msg: Message) => (
              <motion.div key={msg._id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} items-end gap-2`}
              >
                {msg.role === "assistant" && (
                  <div className={`w-7 h-7 rounded-full ${modeInfo.bg} flex items-center justify-center text-sm shrink-0 mb-0.5`}>
                    {modeInfo.emoji}
                  </div>
                )}
                <div className={`max-w-[80%] px-3.5 py-2.5 text-[14px] leading-relaxed ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-[18px] rounded-br-[5px]"
                    : "bg-card border border-border/60 text-foreground rounded-[18px] rounded-bl-[5px]"
                }`}>
                  {msg.role === "assistant" ? (
                    <div className="prose-html text-[13px]" dangerouslySetInnerHTML={{ __html: msg.content.startsWith("<") ? msg.content : msg.content.replace(/\n/g, "<br/>") }} />
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </motion.div>
            ))}
            {/* Streaming message */}
            {streamingContent !== null && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start items-end gap-2">
                <div className={`w-7 h-7 rounded-full ${modeInfo.bg} flex items-center justify-center text-sm shrink-0 mb-0.5`}>
                  {modeInfo.emoji}
                </div>
                <div className="max-w-[80%] px-3.5 py-2.5 bg-card border border-border/60 text-foreground rounded-[18px] rounded-bl-[5px]">
                  {streamingContent === "" ? (
                    <div className="flex items-center gap-1.5 py-1">
                      {[0, 1, 2].map(i => (
                        <motion.div key={i} className="w-2 h-2 rounded-full bg-primary"
                          animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                          transition={{ duration: 0.7, delay: i * 0.15, repeat: Infinity }} />
                      ))}
                    </div>
                  ) : (
                    <div className="prose-html text-[13px]" dangerouslySetInnerHTML={{ __html: streamingContent.startsWith("<") ? streamingContent : streamingContent.replace(/\n/g, "<br/>") }} />
                  )}
                </div>
              </motion.div>
            )}
            {/* Thinking indicator (non-streaming modes) */}
            {isThinking && streamingContent === null && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start items-end gap-2">
                <div className={`w-7 h-7 rounded-full ${modeInfo.bg} flex items-center justify-center text-sm shrink-0 mb-0.5`}>
                  {modeInfo.emoji}
                </div>
                <div className="px-3.5 py-3 bg-card border border-border/60 rounded-[18px] rounded-bl-[5px] space-y-2 w-48">
                  <div className="flex items-center gap-1.5">
                    {[0, 1, 2].map(i => (
                      <motion.div key={i} className="w-2 h-2 rounded-full bg-primary"
                        animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 0.7, delay: i * 0.15, repeat: Infinity }} />
                    ))}
                    <span className={`text-[11px] ${modeInfo.color} font-medium ml-1`}>
                      {mode === "study" ? "searching..." : mode === "research" ? "researching..." : "thinking..."}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <motion.div className="h-2.5 rounded-full w-full" style={{ background: "rgba(255,255,255,0.80)" }}
                      animate={{ opacity: [0.6, 1, 0.6] }} transition={{ duration: 1.4, repeat: Infinity, delay: 0 }} />
                    <motion.div className="h-2.5 rounded-full w-4/5" style={{ background: "rgba(255,255,255,0.65)" }}
                      animate={{ opacity: [0.6, 1, 0.6] }} transition={{ duration: 1.4, repeat: Infinity, delay: 0.2 }} />
                    <motion.div className="h-2.5 rounded-full w-3/5" style={{ background: "rgba(255,255,255,0.50)" }}
                      animate={{ opacity: [0.6, 1, 0.6] }} transition={{ duration: 1.4, repeat: Infinity, delay: 0.4 }} />
                  </div>
                </div>
              </motion.div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="shrink-0 px-3 py-2 bg-card/80 backdrop-blur-sm border-t border-border/50" style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
        {mode === "study" && (
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 text-[11px] text-indigo-400 border border-indigo-400/30 bg-indigo-400/10 px-3 py-1.5 rounded-full active:bg-indigo-400/20 transition-colors">
              <Paperclip className="h-3 w-3" />
              Attach file
            </button>
            <button onClick={() => navigate('/portal/study')}
              className="flex items-center gap-1.5 text-[11px] text-indigo-400 border border-indigo-400/30 bg-indigo-400/10 px-3 py-1.5 rounded-full active:bg-indigo-400/20 transition-colors">
              <GraduationCap className="h-3 w-3" />
              Student Suite
            </button>
          </div>
        )}
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} accept="image/*,.pdf,.txt,.md,.docx" />
        <div className="flex items-end gap-2">
          <div className="flex-1 flex items-end bg-background border border-border/60 rounded-[22px] overflow-hidden min-h-[44px]">
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
              className="flex-1 bg-transparent px-4 py-3 text-[15px] text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none leading-relaxed"
              style={{ maxHeight: "120px" }}
            />
          </div>
          <motion.button
            onClick={handleSend}
            disabled={!input.trim() || isThinking}
            whileTap={{ scale: 0.92 }}
            className="w-11 h-11 rounded-full bg-primary flex items-center justify-center shrink-0 disabled:opacity-40 transition-opacity shadow-sm shadow-primary/30"
          >
            {isThinking ? <Loader2 className="h-5 w-5 text-primary-foreground animate-spin" /> : <Send className="h-4.5 w-4.5 text-primary-foreground" />}
          </motion.button>
        </div>
      </div>

      {/* Conversation list drawer */}
      <AnimatePresence>
        {showConvList && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-background/70 backdrop-blur-sm z-40"
              onClick={() => setShowConvList(false)} />
            <motion.div
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border rounded-t-3xl max-h-[75vh] flex flex-col"
              style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-border" />
              </div>
              <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
                <p className="text-[15px] font-bold text-foreground">{modeInfo.label} Sessions</p>
                <button onClick={handleNewConversation}
                  className="flex items-center gap-1.5 text-[13px] text-primary font-semibold">
                  <Plus className="h-4 w-4" />New
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
                {filteredConvs.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-[14px] text-muted-foreground">No sessions yet</p>
                    <button onClick={handleNewConversation} className={`mt-2 text-[13px] ${modeInfo.color} font-semibold`}>Start one →</button>
                  </div>
                ) : filteredConvs.map((conv: Conversation) => (
                  <motion.button key={conv._id} whileTap={{ scale: 0.98 }}
                    onClick={() => { setActiveConvId(conv._id); setShowConvList(false); if (conv.customId) navigate(`/portal/${mode}/${conv.customId}`); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-colors text-left ${activeConvId === conv._id ? `${modeInfo.bg} border border-border` : "hover:bg-muted/40 active:bg-muted/60"}`}
                  >
                    <div className={`w-9 h-9 rounded-full ${modeInfo.bg} flex items-center justify-center text-base shrink-0`}>{modeInfo.emoji}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-foreground truncate">{conv.title}</p>
                    </div>
                    <button onClick={async (e) => { e.stopPropagation(); try { await deleteConversation({ id: conv._id, token }); if (activeConvId === conv._id) setActiveConvId(null); } catch { toast.error("Failed"); } }}
                      className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </motion.button>
                ))}
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
  const [creditModalOpen, setCreditModalOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const typedUser = user as { email?: string; name?: string; dailyAgentBucks?: number; purchasedAgentBucks?: number; agentBucksBalance?: number } | null;
  const dailyAB = typedUser?.dailyAgentBucks ?? typedUser?.agentBucksBalance ?? 0;
  const purchasedAB = typedUser?.purchasedAgentBucks ?? 0;

  const displayName = typedUser?.name ?? typedUser?.email?.split("@")[0] ?? "there";

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      {/* Header */}
      <div className="px-4 pt-5 pb-4">
        <div className="flex items-center justify-between mb-4">
          <img src="/thalamus-logo.png" alt="Thalamus AI" className="h-8 object-contain" />
          <div className="flex items-center gap-2">
            <button onClick={() => setCreditModalOpen(true)}
              className="flex items-center gap-1.5 bg-card border border-border px-3 py-2 rounded-xl text-sm text-foreground">
              <Zap className="h-4 w-4 text-amber-400" />
              <span className="font-medium">{(totalAB / 1_000_000).toFixed(1)}M</span>
            </button>
            <button onClick={toggleTheme} className="w-10 h-10 flex items-center justify-center rounded-xl bg-card border border-border hover:bg-muted/50 transition-colors" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
              {theme === 'dark' ? <Sun className="h-4 w-4 text-muted-foreground" /> : <Moon className="h-4 w-4 text-muted-foreground" />}
            </button>
          </div>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}</p>
          <p className="text-2xl font-semibold text-foreground capitalize mt-0.5">{displayName}</p>
        </div>
      </div>

      {/* Mode cards */}
      <div className="px-4 py-6 flex-1">
        <p className="text-xs text-muted-foreground mb-4 font-medium">Select a mode</p>
        <div className="space-y-3">
          {MODES.map((mode, i) => (
            <motion.button
              key={mode.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onModeSelect(mode.id)}
              className="w-full flex items-center gap-3 p-4 bg-card border border-border rounded-xl text-left active:bg-muted/50 transition-colors"
            >
              <div className={`w-11 h-11 rounded-lg ${mode.bg} flex items-center justify-center text-xl shrink-0`}>
                {mode.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-foreground">{mode.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{mode.desc}</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
            </motion.button>
          ))}
        </div>
      </div>

      {/* Bottom section */}
      <div className="px-4 pb-6 pt-4 border-t border-border bg-card/50">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-medium text-foreground">Thalamus AI</p>
            <p className="text-xs text-muted-foreground">Claude 4.5 Sonnet</p>
          </div>
          <button onClick={onSignOut}
            className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg active:bg-muted/30 transition-colors">
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
        {typedUser?.email && (
          <p className="text-xs text-muted-foreground/60">{typedUser.email}</p>
        )}
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
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-3xl bg-primary/20 border border-primary/30 flex items-center justify-center">
            <Cpu className="h-7 w-7 text-primary animate-pulse" />
          </div>
          <p className="text-[14px] text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  const handleModeSelect = (mode: Mode) => navigate(`/portal/${mode}`);
  const handleBack = () => navigate("/portal");

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <AnimatePresence mode="wait">
        {!activeMode ? (
          <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -20 }} className="flex-1 overflow-hidden h-full">
            <MobileHomeScreen token={token ?? ""} user={user} totalAB={totalAB} onModeSelect={handleModeSelect} onSignOut={signOut} />
          </motion.div>
        ) : activeMode === "code" ? (
          <motion.div key="code" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="flex-1 flex flex-col h-full">
            <div className="shrink-0 flex items-center gap-3 px-3 py-2 bg-card border-b border-border/50" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
              <button onClick={handleBack} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-muted/50 transition-colors">
                <ArrowLeft className="h-5 w-5 text-foreground" />
              </button>
              <div className="w-9 h-9 rounded-full bg-violet-500/15 flex items-center justify-center text-lg shrink-0">⚡</div>
              <div>
                <p className="text-[14px] font-semibold text-foreground">Code Mode</p>
                <p className="text-[11px] text-violet-400">9-agent system</p>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <TeamPortalInline />
            </div>
          </motion.div>
        ) : (
          <motion.div key={activeMode} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="flex-1 h-full">
            <MobileChatView mode={activeMode} token={token ?? ""} user={user} onBack={handleBack} totalAB={totalAB} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
