import { useAuth } from "@/hooks/use-auth";
import { useEffect, useRef, useState, useCallback } from "react";
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
  Hash, Lightbulb, Lock, ArrowRight, Sparkle, Sun, Moon,
} from "lucide-react";
import TeamPortalInline from "./TeamPortalInline";
import MobilePortal from "./MobilePortal";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTheme } from "@/hooks/use-theme";

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

interface AttachedFile {
  name: string;
  content: string;
  size: number;
}

interface SuggestionFile {
  name: string;
  content: string;
  size: number;
}

// ── Guest limit constants ─────────────────────────────────────────────────────
const GUEST_LIMIT = 3;
const GUEST_STORAGE_KEY = "thalamus_guest_session";

interface GuestMessage {
  role: "user" | "assistant";
  content: string;
  id: string;
}

interface GuestSession {
  messages: GuestMessage[];
  promptsUsed: number;
  mode: string;
}

function loadGuestSession(mode: string): GuestSession {
  try {
    const raw = sessionStorage.getItem(GUEST_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as GuestSession;
      if (parsed.mode === mode) return parsed;
    }
  } catch { /* ignore */ }
  return { messages: [], promptsUsed: 0, mode };
}

function saveGuestSession(session: GuestSession) {
  try {
    sessionStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(session));
  } catch { /* ignore */ }
}

// ── Sign Up Prompt Modal ──────────────────────────────────────────────────────
function SignUpPromptModal({
  reason,
  onClose,
  onSignUp,
  pendingMessage,
}: {
  reason: "limit" | "mode";
  onClose: () => void;
  onSignUp: () => void;
  pendingMessage?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        className="relative z-10 bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center"
      >
        <div className="w-14 h-14 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center mx-auto mb-4">
          {reason === "limit" ? <Sparkles className="h-7 w-7 text-primary" /> : <Lock className="h-7 w-7 text-primary" />}
        </div>
        <h3 className="text-xl font-bold text-foreground mb-2">
          {reason === "mode" ? "Sign in to continue" : "Sign in to continue"}
        </h3>
        <p className="text-sm text-muted-foreground mb-1">
          {reason === "mode" ? "Code and Research modes require an account." : "You've used your free prompts. Sign up to keep going — it's free."}
        </p>
        <p className="text-xs text-muted-foreground/60 mb-5">Your conversation is saved and will transfer to your account.</p>
        {pendingMessage && (
          <div className="mb-4 px-3 py-2 bg-muted/30 border border-border rounded-xl text-xs text-muted-foreground text-left line-clamp-2">
            <span className="text-foreground/60 font-bold">Your message: </span>{pendingMessage}
          </div>
        )}
        <button
          onClick={onSignUp}
          className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-bold text-sm hover:bg-primary/90 transition-all flex items-center justify-center gap-2 mb-2"
        >
          <Sparkles className="h-4 w-4" />
          Sign Up Free — Takes 10 seconds
        </button>
        <button
          onClick={onSignUp}
          className="w-full py-2.5 bg-card border border-border text-foreground rounded-xl font-bold text-sm hover:bg-muted/50 transition-all flex items-center justify-center gap-2 mb-3"
        >
          Sign In
        </button>
        <button onClick={onClose} className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
          Maybe later
        </button>
      </motion.div>
    </div>
  );
}

// ── Guest Portal (unauthenticated users) ──────────────────────────────────────
function GuestPortal() {
  const navigate = useNavigate();
  const params = useParams<{ mode?: string; sessionId?: string }>();
  const activeMode = (VALID_MODES.includes(params.mode as Mode) ? params.mode : "chat") as Mode;

  const [session, setSession] = useState<GuestSession>(() => loadGuestSession(activeMode));
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [showSignUp, setShowSignUp] = useState<{ reason: "limit" | "mode"; pendingMessage?: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const guestSendMessage = useAction(api.ai.guestSendMessage);

  const currentMode = MODES.find(m => m.id === activeMode)!;
  const isGuestMode = activeMode === "chat" || activeMode === "study";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.messages, isThinking]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  }, [input]);

  const handleSend = async () => {
    if (!input.trim() || isThinking) return;
    const msg = input.trim();

    // Check if mode requires auth
    if (!isGuestMode) {
      setShowSignUp({ reason: "mode", pendingMessage: msg });
      return;
    }

    // Check prompt limit
    if (session.promptsUsed >= GUEST_LIMIT) {
      setShowSignUp({ reason: "limit", pendingMessage: msg });
      return;
    }

    setInput("");
    const userMsg: GuestMessage = { role: "user", content: msg, id: Date.now().toString() };
    const streamingId = (Date.now() + 1).toString();
    const newSession = {
      ...session,
      messages: [...session.messages, userMsg],
      promptsUsed: session.promptsUsed + 1,
    };
    setSession(newSession);
    saveGuestSession(newSession);

    setIsThinking(true);

    // Add a streaming placeholder message
    const streamingMsg: GuestMessage = { role: "assistant", content: "", id: streamingId };
    setSession(s => ({ ...s, messages: [...s.messages, streamingMsg] }));

    try {
      const history = session.messages.map(m => ({ role: m.role, content: m.content }));
      const userContext = {
        datetime: new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };

      const systemPrompts: Record<string, string> = {
        chat: `You are Thalamus AI, an advanced AI assistant. Be helpful, accurate, and concise.\n\nCRITICAL: Respond in clean semantic HTML only. No markdown. Pure HTML.\nUse: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <code>, <pre><code>, <blockquote>\nHeadings: style="font-size:1.2em;font-weight:bold;margin:0.5em 0;color:#e5e7eb"\nParagraphs: style="margin:0.5em 0;line-height:1.6;color:#d1d5db"\nLists: style="margin:0.3em 0 0.3em 1.2em;color:#d1d5db"\nCode blocks: style="background:#111827;color:#34d399;padding:1em;border-radius:8px;overflow-x:auto;display:block;margin:0.5em 0;font-family:monospace;font-size:0.8em"\nInline code: style="background:#1f2937;color:#34d399;padding:0.1em 0.4em;border-radius:4px;font-family:monospace;font-size:0.85em"`,
        study: `You are Thalamus AI Study Mode — a precision study assistant. Give dense, accurate, exam-ready information.\n\nCRITICAL: Respond in clean semantic HTML only. No markdown. Pure HTML.\nUse: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <blockquote>\nHeadings: style="font-size:1.1em;font-weight:bold;margin:0.5em 0 0.3em;color:#e5e7eb;border-left:3px solid #6366f1;padding-left:0.6em"\nLists: style="margin:0.2em 0 0.2em 1em;color:#d1d5db;font-size:0.9em"`,
      };

      const convexUrl = import.meta.env.VITE_CONVEX_URL as string;
      const siteUrl = convexUrl.replace(".convex.cloud", ".convex.site");

      const response = await fetch(`${siteUrl}/stream-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: msg,
          mode: activeMode,
          history,
          systemPrompt: systemPrompts[activeMode] ?? systemPrompts.chat,
          userContext,
        }),
      });

      if (!response.ok || !response.body) throw new Error("Stream failed");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      setIsThinking(false);

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
            if (parsed.chunk) {
              accumulated += parsed.chunk;
              setSession(s => ({
                ...s,
                messages: s.messages.map(m => m.id === streamingId ? { ...m, content: accumulated } : m),
              }));
            }
            if (parsed.done) {
              const finalText = parsed.fullText ?? accumulated;
              const finalSession: GuestSession = {
                ...newSession,
                messages: [...newSession.messages, { role: "assistant", content: finalText, id: streamingId }],
              };
              setSession(finalSession);
              saveGuestSession(finalSession);
            }
          } catch { /* skip */ }
        }
      }

      // Show sign up prompt after last free message
      if (newSession.promptsUsed >= GUEST_LIMIT) {
        setTimeout(() => setShowSignUp({ reason: "limit" }), 1500);
      }
    } catch {
      // Fallback to non-streaming
      setIsThinking(true);
      try {
        const history = session.messages.map(m => ({ role: m.role, content: m.content }));
        const userContext = {
          datetime: new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
        const response = await guestSendMessage({ content: msg, mode: activeMode as "chat" | "study", history, userContext });
        const finalSession: GuestSession = {
          ...newSession,
          messages: [...newSession.messages, { role: "assistant", content: response, id: streamingId }],
        };
        setSession(finalSession);
        saveGuestSession(finalSession);
      } catch {
        toast.error("Failed to get response. Try again.");
        setSession(s => ({ ...s, messages: s.messages.filter(m => m.id !== streamingId) }));
      }
    } finally {
      setIsThinking(false);
    }
  };

  const handleSignUp = () => {
    // Store pending message in sessionStorage for transfer after auth
    if (showSignUp?.pendingMessage) {
      sessionStorage.setItem("thalamus_pending_message", showSignUp.pendingMessage);
    }
    navigate("/auth");
  };

  const promptsLeft = Math.max(0, GUEST_LIMIT - session.promptsUsed);

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
            <Cpu className="h-3.5 w-3.5 text-primary" />
          </div>
          <span className="text-primary font-bold text-xs tracking-widest">THALAMUS_AI</span>
        </div>
        {/* Mode tabs */}
        <div className="flex items-center gap-1">
          {MODES.map(m => (
            <button key={m.id} onClick={() => {
              if (m.id === "code" || m.id === "research") {
                setShowSignUp({ reason: "mode" });
                return;
              }
              navigate(`/portal/${m.id}`);
              setSession(loadGuestSession(m.id));
            }}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${activeMode === m.id ? `${m.accent} ${m.color} border` : "text-muted-foreground hover:text-foreground"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground border border-border/50 px-2 py-1 rounded-lg">
            <Zap className="h-3 w-3 text-amber-400" />
            <span className={promptsLeft === 0 ? "text-destructive" : promptsLeft === 1 ? "text-amber-400" : ""}>{promptsLeft} free left</span>
          </div>
          <button onClick={() => navigate("/auth")} className="px-3 py-1.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-lg hover:bg-primary/90 transition-all">
            Sign In
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4 max-w-4xl mx-auto w-full">
        {session.messages.length === 0 ? (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center h-full gap-6 pb-20">
            <div className={`w-16 h-16 rounded-2xl ${currentMode.accent} border flex items-center justify-center`}>
              <currentMode.icon className={`h-8 w-8 ${currentMode.color}`} />
            </div>
            <div className="text-center">
              <h2 className={`text-xl font-bold ${currentMode.color} mb-2`}>{currentMode.label} Mode</h2>
              <p className="text-sm text-muted-foreground mb-1">
                {activeMode === "chat" && "Ask anything — fast, accurate, context-aware"}
                {activeMode === "study" && "Study with AI-powered explanations"}
                {activeMode === "research" && "Deep research with live web search"}
                {activeMode === "code" && "9-agent system for full software development"}
              </p>
              <p className="text-xs text-muted-foreground/60">{GUEST_LIMIT} free prompts · No sign-up required</p>
            </div>
            {/* Quick suggestions */}
            <div className="grid grid-cols-2 gap-2 w-full max-w-md">
              {(SUGGESTIONS_BY_MODE[activeMode] || SUGGESTIONS_BY_MODE.chat).slice(0, 4).map((s, i) => (
                <button key={i} onClick={() => setInput(s.prompt)}
                  className="text-left px-3 py-2.5 bg-card border border-border rounded-xl hover:border-primary/30 hover:bg-primary/5 transition-all group">
                  <p className="text-[10px] font-bold text-foreground group-hover:text-primary transition-colors">{s.icon} {s.title}</p>
                  <p className="text-[9px] text-muted-foreground mt-0.5 line-clamp-1">{s.prompt}</p>
                </button>
              ))}
            </div>
          </motion.div>
        ) : (
          <div className="space-y-4 pb-4">
            {session.messages.map((msg) => {
              const isStreaming = msg.role === "assistant" && msg.content === "" && !isThinking;
              const isStreamingContent = msg.role === "assistant" && msg.content !== "" && isThinking === false;
              return (
                <motion.div key={msg.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.role === "assistant" && (
                    <div className={`w-7 h-7 rounded-xl ${currentMode.accent} border flex items-center justify-center shrink-0 mr-2 mt-1`}>
                      <currentMode.icon className={`h-3.5 w-3.5 ${currentMode.color}`} />
                    </div>
                  )}
                  {msg.role === "assistant" && isStreaming ? (
                    // Empty streaming placeholder — show dots
                    <div className="rounded-2xl rounded-bl-sm px-4 py-3.5 w-48 bg-card border border-border shadow-sm">
                      <div className="flex items-center gap-1">
                        {[0, 1, 2].map(i => (
                          <motion.div key={i} className="w-2 h-2 rounded-full bg-primary"
                            animate={{ y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
                            transition={{ duration: 0.7, delay: i * 0.15, repeat: Infinity }} />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-card border border-border text-foreground rounded-bl-sm"
                    }`}>
                      {msg.role === "assistant" ? (
                        <div className="prose-html text-sm">
                          <span dangerouslySetInnerHTML={{ __html: msg.content.startsWith("<") ? msg.content : msg.content.replace(/\n/g, "<br/>") }} />
                          {isStreamingContent && <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse align-middle" />}
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })}
            {isThinking && (
              <div className="flex justify-start">
                <div className={`w-7 h-7 rounded-xl ${currentMode.accent} border flex items-center justify-center shrink-0 mr-2 mt-1`}>
                  <currentMode.icon className={`h-3.5 w-3.5 ${currentMode.color}`} />
                </div>
                <div className="rounded-2xl rounded-bl-sm px-4 py-3.5 w-64 shadow-sm" style={{ background: "#5a5e7a", border: "1px solid #6a6e8a" }}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex items-center gap-1">
                      {[0, 1, 2].map(i => (
                        <motion.div key={i} className="w-2 h-2 rounded-full" style={{ background: "rgba(255,255,255,0.75)" }}
                          animate={{ y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
                          transition={{ duration: 0.7, delay: i * 0.15, repeat: Infinity }} />
                      ))}
                    </div>
                    <span className="text-[11px] font-medium" style={{ color: "#d0d4ec" }}>Thinking...</span>
                  </div>
                  <div className="space-y-2">
                    <motion.div className="h-3 rounded-full w-full" style={{ background: "rgba(255,255,255,0.80)" }} animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0 }} />
                    <motion.div className="h-3 rounded-full w-5/6" style={{ background: "rgba(255,255,255,0.65)" }} animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }} />
                    <motion.div className="h-3 rounded-full w-4/6" style={{ background: "rgba(255,255,255,0.50)" }} animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 p-3 border-t border-border bg-card/30 max-w-4xl mx-auto w-full">
        {promptsLeft === 0 && !isThinking ? (
          <div className="flex items-center justify-between px-4 py-3 bg-primary/10 border border-primary/30 rounded-xl">
            <div>
              <p className="text-xs font-bold text-foreground">Free prompts used up</p>
              <p className="text-[10px] text-muted-foreground">Sign up free to continue — your chat is saved</p>
            </div>
            <button onClick={() => navigate("/auth")} className="px-4 py-2 bg-primary text-primary-foreground text-xs font-bold rounded-lg hover:bg-primary/90 transition-all flex items-center gap-1.5">
              Sign Up Free <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={
                activeMode === "study" ? "Ask a study question..." :
                activeMode === "research" ? "Sign in to use Research mode..." :
                activeMode === "code" ? "Sign in to use Code mode..." :
                "Message Thalamus AI..."
              }
              disabled={!isGuestMode}
              rows={1}
              className="flex-1 bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ minHeight: "36px", maxHeight: "120px" }}
            />
            <button onClick={handleSend} disabled={!input.trim() || isThinking || !isGuestMode}
              className="px-3 py-2 bg-primary text-primary-foreground rounded-xl disabled:opacity-50 transition-all shrink-0 hover:bg-primary/90">
              {isThinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        )}
        <div className="flex items-center justify-center gap-1 mt-1.5">
          <Lock className="h-2.5 w-2.5 text-muted-foreground/40" />
          <span className="text-[9px] text-muted-foreground/40">Guest session · {promptsLeft} of {GUEST_LIMIT} free prompts remaining</span>
        </div>
      </div>

      {/* Sign Up Modal */}
      <AnimatePresence>
        {showSignUp && (
          <SignUpPromptModal
            reason={showSignUp.reason}
            pendingMessage={showSignUp.pendingMessage}
            onClose={() => setShowSignUp(null)}
            onSignUp={handleSignUp}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

const MODES: { id: Mode; label: string; icon: typeof MessageSquare; desc: string; color: string; accent: string }[] = [
  { id: "chat", label: "CHAT", icon: MessageSquare, desc: "General", color: "text-primary", accent: "bg-primary/15 border-primary/30" },
  { id: "research", label: "RESEARCH", icon: Search, desc: "Deep", color: "text-accent", accent: "bg-accent/15 border-accent/30" },
  { id: "study", label: "STUDY", icon: BookOpen, desc: "Study", color: "text-indigo-400", accent: "bg-indigo-400/15 border-indigo-400/30" },
  { id: "code", label: "CODE", icon: Users, desc: "Multi-agent", color: "text-violet-400", accent: "bg-violet-400/15 border-violet-400/30" },
];

const VALID_MODES: Mode[] = ["chat", "research", "study", "code"];

// ── Suggestions Panel ─────────────────────────────────────────────────────────
const SUGGESTIONS_BY_MODE: Record<string, { icon: string; title: string; prompt: string }[]> = {
  chat: [
    { icon: "💡", title: "Explain a concept", prompt: "Explain quantum computing in simple terms" },
    { icon: "✍️", title: "Write something", prompt: "Write a professional email declining a meeting" },
    { icon: "🔍", title: "Analyze text", prompt: "Analyze the pros and cons of remote work" },
    { icon: "🧮", title: "Solve a problem", prompt: "Help me debug this logic: if I have 3 apples and give away 2, why do I feel sad?" },
    { icon: "🌍", title: "Translate", prompt: "Translate 'Hello, how are you?' into 5 languages" },
    { icon: "📊", title: "Compare options", prompt: "Compare React vs Vue vs Angular for a new project" },
  ],
  research: [
    { icon: "🔬", title: "Deep dive topic", prompt: "Research the latest advancements in CRISPR gene editing" },
    { icon: "📈", title: "Market analysis", prompt: "Research the current state of the AI chip market" },
    { icon: "🏛️", title: "Historical research", prompt: "Research the causes and effects of the 2008 financial crisis" },
    { icon: "🧬", title: "Science topic", prompt: "Research how mRNA vaccines work and their long-term safety data" },
    { icon: "🌐", title: "Tech trends", prompt: "Research the current state of quantum computing and timeline to practical use" },
    { icon: "📚", title: "Academic topic", prompt: "Research the psychological effects of social media on teenagers" },
  ],
  study: [
    { icon: "📖", title: "Explain a topic", prompt: "Explain Newton's laws of motion with examples" },
    { icon: "🧪", title: "Science concept", prompt: "How does photosynthesis work step by step?" },
    { icon: "📐", title: "Math help", prompt: "Explain the concept of derivatives in calculus" },
    { icon: "🗺️", title: "History", prompt: "What were the main causes of World War I?" },
    { icon: "💻", title: "Programming", prompt: "Explain object-oriented programming concepts with examples" },
    { icon: "🔤", title: "Language", prompt: "Explain the difference between active and passive voice" },
  ],
  code: [
    { icon: "🌐", title: "Full-stack web app", prompt: "Build a full-stack todo app with React, Node.js, and PostgreSQL" },
    { icon: "📱", title: "Mobile-first app", prompt: "Build a responsive expense tracker with charts and local storage" },
    { icon: "🤖", title: "AI-powered app", prompt: "Build a chatbot interface with streaming responses and conversation history" },
    { icon: "🛒", title: "E-commerce", prompt: "Build a product catalog with cart, checkout, and payment integration" },
    { icon: "📊", title: "Dashboard", prompt: "Build an analytics dashboard with real-time data visualization" },
    { icon: "🔐", title: "Auth system", prompt: "Build a secure authentication system with JWT, refresh tokens, and 2FA" },
  ],
};

function SuggestionsPanel({
  mode,
  onClose,
  onSelect,
}: {
  mode: string;
  onClose: () => void;
  onSelect: (prompt: string) => void;
}) {
  const suggestions = SUGGESTIONS_BY_MODE[mode] || SUGGESTIONS_BY_MODE.chat;
  const modeColors: Record<string, string> = {
    chat: "text-primary border-primary/30 bg-primary/10",
    research: "text-accent border-accent/30 bg-accent/10",
    study: "text-indigo-400 border-indigo-400/30 bg-indigo-400/10",
    code: "text-violet-400 border-violet-400/30 bg-violet-400/10",
  };
  const color = modeColors[mode] || modeColors.chat;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end p-3 pt-14 pointer-events-none">
      <motion.div
        initial={{ opacity: 0, x: 20, scale: 0.95 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        exit={{ opacity: 0, x: 20, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="pointer-events-auto w-80 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-400" />
            <span className="text-xs font-bold text-foreground">SUGGESTIONS</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${color}`}>
              {mode.toUpperCase()}
            </span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Suggestions list */}
        <div className="p-2 space-y-1 max-h-[70vh] overflow-y-auto">
          {suggestions.map((s, i) => (
            <motion.button
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => { onSelect(s.prompt); onClose(); }}
              className="w-full text-left px-3 py-2.5 rounded-xl border border-border hover:border-primary/40 hover:bg-primary/5 transition-all group"
            >
              <div className="flex items-start gap-2.5">
                <span className="text-base shrink-0 mt-0.5">{s.icon}</span>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold text-foreground group-hover:text-primary transition-colors">{s.title}</p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed mt-0.5 line-clamp-2">{s.prompt}</p>
                </div>
                <ChevronRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-primary/60 shrink-0 mt-1 transition-colors" />
              </div>
            </motion.button>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-border">
          <p className="text-[9px] text-muted-foreground/60 text-center">Click any suggestion to use it as your prompt</p>
        </div>
      </motion.div>
    </div>
  );
}

// ── Suggestion Form Modal ─────────────────────────────────────────────────────
interface SuggestionFile {
  name: string;
  content: string;
  size: number;
}

function SuggestionFormModal({
  onClose,
  onSubmit,
  isSubmitting,
}: {
  onClose: () => void;
  onSubmit: (title: string, description: string, files: SuggestionFile[]) => Promise<void>;
  isSubmitting: boolean;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<SuggestionFile[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileAdd = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    for (const file of selected) {
      const text = await file.text().catch(() => `[Binary file: ${file.name}]`);
      setFiles(prev => [...prev, { name: file.name, content: text.slice(0, 50000), size: file.size }]);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) {
      toast.error("Please fill in Title and Description");
      return;
    }
    await onSubmit(title.trim(), description.trim(), files);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        className="relative z-10 bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-400/20 border border-amber-400/30 flex items-center justify-center">
              <Lightbulb className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <div>
              <p className="text-xs font-bold text-foreground">SUBMIT SUGGESTION</p>
              <p className="text-[9px] text-muted-foreground">Help us improve Thalamus AI</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Title */}
          <div>
            <label className="text-[10px] font-bold text-muted-foreground block mb-1.5">TITLE <span className="text-destructive">*</span></label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Brief title for your suggestion..."
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-amber-400/60 transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-[10px] font-bold text-muted-foreground block mb-1.5">DESCRIPTION <span className="text-destructive">*</span></label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe your suggestion, bug report, or feature request in detail..."
              rows={5}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-amber-400/60 transition-colors resize-none"
            />
          </div>

          {/* File attachments */}
          <div>
            <label className="text-[10px] font-bold text-muted-foreground block mb-1.5">ATTACHMENTS (optional)</label>
            <input ref={fileRef} type="file" multiple onChange={handleFileAdd} className="hidden" accept=".txt,.md,.json,.csv,.log,.ts,.tsx,.js,.jsx,.py,.html,.css,.xml,.yaml,.yml" />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full py-2 border border-dashed border-border rounded-lg text-[10px] text-muted-foreground hover:border-amber-400/40 hover:text-amber-400 transition-all flex items-center justify-center gap-2"
            >
              <Upload className="h-3 w-3" />
              Click to attach files (text, code, logs)
            </button>
            {files.length > 0 && (
              <div className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center justify-between px-2 py-1.5 bg-background border border-border rounded-lg">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-[10px] text-foreground truncate">{f.name}</span>
                      <span className="text-[9px] text-muted-foreground shrink-0">({(f.size / 1024).toFixed(1)}KB)</span>
                    </div>
                    <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive transition-colors shrink-0 ml-2">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !title.trim() || !description.trim()}
            className="w-full py-2.5 bg-amber-400/15 border border-amber-400/30 text-amber-400 text-xs rounded-xl hover:bg-amber-400/25 disabled:opacity-50 transition-all font-bold flex items-center justify-center gap-2"
          >
            {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {isSubmitting ? "Submitting..." : "Submit Suggestion"}
          </button>

          <p className="text-[9px] text-muted-foreground/60 text-center">
            Your feedback goes directly to the Thalamus AI team. We read every submission.
          </p>
        </div>
      </motion.div>
    </div>
  );
}

function PortalDesktop() {
  const { isLoading, isAuthenticated, user, signOut, token } = useAuth();
  const { theme, toggleTheme } = useTheme();
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
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [auditorOpen, setAuditorOpen] = useState(false);
  const [auditorAnswer, setAuditorAnswer] = useState("");
  const [auditorContext, setAuditorContext] = useState("");
  const [auditorResult, setAuditorResult] = useState<string | null>(null);
  const [isAuditing, setIsAuditing] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const attachFileInputRef = useRef<HTMLInputElement>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [isSubmittingSuggestion, setIsSubmittingSuggestion] = useState(false);
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
  const auditAnswer = useAction(api.study.auditAnswer);
  const submitSuggestionMutation = useMutation(api.admin.submitSuggestion);
  const [isSuggestionSubmitting, setIsSuggestionSubmitting] = useState(false);

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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  const handleSubmitSuggestion = async (title: string, description: string, files: SuggestionFile[]) => {
    setIsSuggestionSubmitting(true);
    try {
      const typedUserForSuggestion = user as { email?: string } | null;
      await submitSuggestionMutation({
        userEmail: typedUserForSuggestion?.email,
        title,
        description,
        files: files.length > 0 ? files : undefined,
      });
      toast.success("Suggestion submitted! Thank you for your feedback.");
      setSuggestionsOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit suggestion");
    } finally {
      setIsSuggestionSubmitting(false);
    }
  };

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

  const handleAttachFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const MAX_SIZE = 500 * 1024; // 500KB per file
    const newFiles: AttachedFile[] = [];
    for (const file of files) {
      if (file.size > MAX_SIZE) { toast.error(`${file.name} is too large (max 500KB)`); continue; }
      try {
        const content = await file.text();
        newFiles.push({ name: file.name, content: content.slice(0, 20000), size: file.size });
      } catch { toast.error(`Failed to read ${file.name}`); }
    }
    setAttachedFiles(prev => [...prev, ...newFiles]);
    if (e.target) e.target.value = "";
    toast.success(`${newFiles.length} file(s) attached`);
  };

  const handleSend = async () => {
    if ((!input.trim() && attachedFiles.length === 0) || isThinking || !token) return;
    const fileContext = attachedFiles.length > 0
      ? "\n\n[ATTACHED FILES]\n" + attachedFiles.map(f => `--- ${f.name} ---\n${f.content}`).join("\n\n")
      : "";
    const msg = (input.trim() || "(See attached files)") + fileContext;
    setInput("");
    setAttachedFiles([]);

    // For code/research modes, use existing Convex actions (multi-agent)
    if (activeMode === "code" || activeMode === "research") {
      // ... keep existing code (code/research mode handling)
    }

    // For chat/study modes, use streaming
    let convId: Id<"conversations"> | null = activeConvId;
    if (!convId) {
      try {
        const newConv = await createConversation({ token, mode: activeMode, title: msg.slice(0, 50) });
        const newConvId = (typeof newConv === "object" && newConv !== null && "id" in newConv) ? (newConv as { id: Id<"conversations"> }).id : newConv as Id<"conversations">;
        convId = newConvId;
        setActiveConvId(newConvId);
        navigate(`/portal/${activeMode}/${newConvId}`, { replace: true });
      } catch {
        toast.error("Failed to create conversation");
        return;
      }
    }

    setIsThinking(true);
    const streamingMsgId = `streaming-${Date.now()}`;

    try {
      const userContext = {
        datetime: new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };

      const convexUrl = import.meta.env.VITE_CONVEX_URL as string;
      const siteUrl = convexUrl.replace(".convex.cloud", ".convex.site");

      const CHAT_SYSTEM = `You are AgentAI, an advanced AI assistant powered by AMD MI300X GPUs.\n\nCRITICAL: You MUST respond in clean, semantic HTML only. No markdown. No plain text. Pure HTML.\nUse: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <code>, <pre><code>, <blockquote>, <table>\nHeadings: style="font-size:1.2em;font-weight:bold;margin:0.5em 0;color:#e5e7eb"\nParagraphs: style="margin:0.5em 0;line-height:1.6;color:#d1d5db"\nLists: style="margin:0.3em 0 0.3em 1.2em;color:#d1d5db"\nCode blocks: style="background:#111827;color:#34d399;padding:1em;border-radius:8px;overflow-x:auto;display:block;margin:0.5em 0;font-family:monospace;font-size:0.8em"\nInline code: style="background:#1f2937;color:#34d399;padding:0.1em 0.4em;border-radius:4px;font-family:monospace;font-size:0.85em"`;

      const STUDY_SYSTEM = `You are Aether — the world's most effective study companion. Your mission: make students genuinely understand concepts so deeply that they could explain them to anyone.\n\nCRITICAL: Respond in clean semantic HTML only. No markdown. Pure HTML.\nUse: <h2>, <h3>, <h4>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <blockquote>, <code>\nHeadings: style="font-size:1.15em;font-weight:bold;margin:0.8em 0 0.4em;color:#e5e7eb;border-left:4px solid #6366f1;padding-left:0.7em"\nSub-headings: style="font-size:1em;font-weight:bold;margin:0.7em 0 0.3em;color:#c4b5fd"\nParagraphs: style="margin:0.4em 0;line-height:1.7;color:#d1d5db;font-size:0.92em"\nLists: style="margin:0.3em 0 0.3em 1.2em;color:#d1d5db;font-size:0.9em;line-height:1.6"\nKey facts box: style="border-left:4px solid #f59e0b;padding:0.6em 1em;color:#fcd34d;margin:0.6em 0;background:rgba(245,158,11,0.08);border-radius:0 8px 8px 0;font-size:0.88em"\nCode: style="background:#1f2937;color:#34d399;padding:0.15em 0.5em;border-radius:4px;font-family:monospace;font-size:0.88em"`;

      const systemPrompt = activeMode === "study" ? STUDY_SYSTEM : CHAT_SYSTEM;
      const historyMsgs = (messages ?? []).slice(-10).map((m: Message) => ({ role: m.role, content: m.content.slice(0, 1500) }));

      // Save user message first via Convex
      await sendMessage({ conversationId: convId, content: msg, mode: activeMode as "chat" | "research" | "code", token, userContext });
      setIsThinking(false);

      // Now stream the response
      const response = await fetch(`${siteUrl}/stream-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: msg,
          mode: activeMode,
          history: historyMsgs,
          systemPrompt,
          userContext,
          token,
          conversationId: convId,
          preferClaude: true,
        }),
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
            const parsed = JSON.parse(jsonStr) as { chunk?: string; done?: boolean };
            if (parsed.chunk) {
              accumulated += parsed.chunk;
              // Update the streaming message in real-time
              // (Convex will update via subscription when saved)
            }
          } catch { /* skip */ }
        }
      }
    } catch {
      // Fallback to existing Convex actions
      try {
        const userContext = {
          datetime: new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
        if (activeMode === "study") {
          await sendStudyMessage({ conversationId: convId!, content: msg, token, userContext });
        } else {
          await sendMessage({ conversationId: convId!, content: msg, mode: activeMode as "chat" | "research" | "code", token, userContext });
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to send message");
      }
    } finally {
      setIsThinking(false);
    }
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
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const isImage = file.type.startsWith("image/");
    if (isPdf) setUploadStatus("Claude Vision is reading your PDF — extracting text & images...");
    else if (isImage) setUploadStatus("Claude Vision is analyzing your image...");
    else setUploadStatus(`Processing ${file.name}...`);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      await processFileResource({ token, fileName: file.name, fileType: file.type, fileDataBase64: base64 });
      if (isPdf) toast.success(`PDF processed by Claude Vision: ${file.name}`);
      else if (isImage) toast.success(`Image analyzed by Claude Vision: ${file.name}`);
      else toast.success(`Processed: ${file.name}`);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to process file"); }
    finally { setIsAddingResource(false); setUploadStatus(null); if (fileInputRef.current) fileInputRef.current.value = ""; }
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
              <span className="text-primary font-bold text-xs tracking-widest hidden sm:block">THALAMUS_AI</span>
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
            {/* Suggestions button — visible everywhere */}
            <button
              onClick={() => setSuggestionsOpen(o => !o)}
              title="Suggestions"
              className={`flex items-center gap-1.5 text-[11px] border px-2 py-1 rounded-lg font-bold transition-all ${suggestionsOpen ? "border-amber-400/50 bg-amber-400/15 text-amber-400" : "border-border text-muted-foreground hover:border-amber-400/40 hover:bg-amber-400/10 hover:text-amber-400"}`}
            >
              <Lightbulb className="h-3 w-3" />
              <span className="hidden sm:block">IDEAS</span>
            </button>
            <button onClick={() => setCreditModalOpen(true)} className="flex items-center gap-1.5 text-[11px] border border-amber-400/30 bg-amber-400/10 text-amber-400 px-2 py-1 rounded-lg font-bold hover:bg-amber-400/20 transition-all">
              <Zap className="h-3 w-3" />
              <span className="hidden sm:block">{totalAB.toLocaleString()}</span>
              <span className="sm:hidden">{(totalAB / 1_000_000).toFixed(1)}M</span>
              <span className="text-[9px] opacity-70">AB</span>
            </button>
            <button onClick={toggleTheme} className="text-muted-foreground hover:text-primary transition-colors p-1.5 rounded hover:bg-primary/10" title="Toggle theme">
              {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
            <button onClick={signOut} className="text-muted-foreground hover:text-primary transition-colors p-1.5 rounded hover:bg-primary/10">
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Suggestions Panel — rendered outside header, always on top */}
      <AnimatePresence>
        {suggestionsOpen && (
          <SuggestionFormModal
            onClose={() => setSuggestionsOpen(false)}
            onSubmit={handleSubmitSuggestion}
            isSubmitting={isSuggestionSubmitting}
          />
        )}
      </AnimatePresence>

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
                  <div className="ml-auto flex items-center gap-1.5">
                    <button onClick={() => { setAuditorOpen(o => !o); if (studyResourcesOpen) setStudyResourcesOpen(false); }}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] border transition-all ${auditorOpen ? "bg-amber-400/15 border-amber-400/30 text-amber-400 font-bold" : "border-border text-muted-foreground hover:text-amber-400 hover:border-amber-400/30"}`}
                    >
                      <Lightbulb className="h-3 w-3" />
                      Mark Auditor
                    </button>
                    <button onClick={() => { setStudyResourcesOpen(o => !o); if (auditorOpen) setAuditorOpen(false); }}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] border transition-all ${studyResourcesOpen ? "bg-indigo-400/15 border-indigo-400/30 text-indigo-400 font-bold" : "border-border text-muted-foreground hover:text-indigo-400 hover:border-indigo-400/30"}`}
                    >
                      <BookOpen className="h-3 w-3" />
                      Resources {studyResources ? `(${studyResources.length})` : ""}
                    </button>
                  </div>
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
                    <div className="p-4 space-y-3 max-w-4xl mx-auto">
                      {[1, 2, 3].map(i => (
                        <div key={i} className={`flex ${i % 2 === 0 ? "justify-end" : "justify-start"}`}>
                          <div className={`rounded-2xl px-4 py-3 space-y-2 ${i % 2 === 0 ? "w-48" : "w-72"}`}>
                            <div className="h-3 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.15)" }} />
                            <div className="h-3 rounded animate-pulse w-4/5" style={{ background: "rgba(255,255,255,0.10)" }} />
                            {i % 2 !== 0 && <div className="h-3 rounded animate-pulse w-3/5" style={{ background: "rgba(255,255,255,0.07)" }} />}
                          </div>
                        </div>
                      ))}
                    </div>
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
                            <div className="prose-html" dangerouslySetInnerHTML={{ __html: msg.content.startsWith("<") ? msg.content : msg.content.replace(/\n/g, "<br/>") }} />
                          ) : (
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                          )}
                          {msg.costCents !== undefined && msg.costCents > 0 && (
                            <p className="text-[9px] opacity-40 mt-1.5 text-right">{Math.ceil(msg.costCents * 15000).toLocaleString()} AB</p>
                          )}
                        </div>
                      </motion.div>
                    ))
                  )}
                  {isThinking && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex justify-start"
                    >
                      <div className="rounded-2xl px-4 py-3.5 max-w-[75%] w-72 shadow-lg" style={{ background: "#5a5e7a", border: "1px solid #6a6e8a" }}>
                        {/* Typing dots + label */}
                        <div className="flex items-center gap-2 mb-3">
                          <div className="flex items-center gap-1">
                            {[0, 1, 2].map(i => (
                              <motion.div key={i} className="w-2 h-2 rounded-full" style={{ background: "rgba(255,255,255,0.75)" }}
                                animate={{ y: [0, -5, 0], opacity: [0.5, 1, 0.5] }}
                                transition={{ duration: 0.7, delay: i * 0.15, repeat: Infinity }} />
                            ))}
                          </div>
                          <span className="text-[11px] font-medium" style={{ color: "#d0d4ec" }}>
                            {activeMode === "study" ? "Searching & thinking..." : activeMode === "research" ? "Researching..." : "Thinking..."}
                          </span>
                        </div>
                        {/* Skeleton lines */}
                        <div className="space-y-2">
                          <motion.div className="h-3 rounded-full w-full" style={{ background: "rgba(255,255,255,0.80)" }} animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0 }} />
                          <motion.div className="h-3 rounded-full w-5/6" style={{ background: "rgba(255,255,255,0.65)" }} animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }} />
                          <motion.div className="h-3 rounded-full w-4/6" style={{ background: "rgba(255,255,255,0.50)" }} animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }} />
                        </div>
                      </div>
                    </motion.div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Input */}
              <div className="shrink-0 p-3 border-t border-border bg-card/30">
                {/* Attached files chips */}
                {attachedFiles.length > 0 && (
                  <div className="max-w-4xl mx-auto mb-2 flex flex-wrap gap-1.5">
                    {attachedFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-1 bg-primary/10 border border-primary/20 rounded-lg px-2 py-1 text-[10px] text-primary">
                        <FileText className="h-3 w-3 shrink-0" />
                        <span className="max-w-[120px] truncate">{f.name}</span>
                        <button onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))} className="ml-0.5 hover:text-destructive transition-colors">
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="max-w-4xl mx-auto flex gap-2">
                  {/* File upload button */}
                  <label className="shrink-0 flex items-center justify-center w-9 h-9 rounded-xl border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-all cursor-pointer bg-background">
                    <Upload className="h-3.5 w-3.5" />
                    <input ref={attachFileInputRef} type="file" multiple className="hidden"
                      accept=".txt,.md,.csv,.json,.js,.ts,.py,.html,.css,.xml,.yaml,.yml,.pdf,.doc,.docx"
                      onChange={handleAttachFiles} />
                  </label>
                  <textarea
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={activeMode === "study" ? "Ask a study question — live web search enabled..." : activeMode === "research" ? "Research topic or question..." : "Type a message..."}
                    rows={1}
                    className="flex-1 bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary/60 transition-colors"
                    style={{ minHeight: "36px", maxHeight: "120px" }}
                  />
                  <button onClick={handleSend} disabled={(!input.trim() && attachedFiles.length === 0) || isThinking}
                    className={`px-3 py-2 rounded-xl disabled:opacity-50 transition-all shrink-0 ${activeMode === "study" ? "bg-indigo-500 text-white hover:bg-indigo-500/90" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}>
                    {isThinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
                <div className="max-w-4xl mx-auto mt-1.5 flex items-center justify-center gap-1.5">
                  <Lock className="h-2.5 w-2.5 text-muted-foreground/40" />
                  <span className="text-[9px] text-muted-foreground/40">End-to-End Encrypted Node. Your data is private to this session.</span>
                </div>
              </div>
            </div>

            {/* ── Mark Auditor Panel ────────────────────────────────────── */}
            <AnimatePresence>
              {activeMode === "study" && auditorOpen && (
                <motion.div
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 320, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="shrink-0 border-l border-border bg-card flex flex-col overflow-hidden"
                  style={{ width: 320 }}
                >
                  {/* Header */}
                  <div className="shrink-0 px-3 py-2.5 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Lightbulb className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-[11px] font-bold text-foreground">MARK AUDITOR</span>
                      <span className="text-[9px] text-amber-400 border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 rounded-full">BETA</span>
                    </div>
                    <button onClick={() => setAuditorOpen(false)} className="text-muted-foreground hover:text-foreground p-1">
                      <X className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Input area */}
                  <div className="shrink-0 p-3 border-b border-border space-y-2">
                    <div>
                      <label className="text-[9px] font-bold text-muted-foreground mb-1 block">QUESTION / TOPIC (optional)</label>
                      <input
                        value={auditorContext}
                        onChange={e => setAuditorContext(e.target.value)}
                        placeholder="e.g. Newton's second law, 3 marks"
                        className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-[10px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-amber-400/60 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-muted-foreground mb-1 block">YOUR WRITTEN ANSWER</label>
                      <textarea
                        value={auditorAnswer}
                        onChange={e => setAuditorAnswer(e.target.value)}
                        placeholder="Paste your answer here for step-by-step mark analysis..."
                        rows={5}
                        className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-[10px] text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-amber-400/60 transition-colors"
                      />
                    </div>
                    <button
                      onClick={async () => {
                        if (!auditorAnswer.trim() || isAuditing || !token) return;
                        setIsAuditing(true);
                        setAuditorResult(null);
                        try {
                          const result = await auditAnswer({
                            token,
                            userAnswer: auditorAnswer.trim(),
                            questionContext: auditorContext.trim() || undefined,
                          });
                          setAuditorResult(result);
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Audit failed");
                        } finally {
                          setIsAuditing(false);
                        }
                      }}
                      disabled={!auditorAnswer.trim() || isAuditing}
                      className="w-full py-1.5 bg-amber-400/15 border border-amber-400/30 text-amber-400 text-[10px] rounded-lg hover:bg-amber-400/25 disabled:opacity-50 transition-all font-bold flex items-center justify-center gap-1.5"
                    >
                      {isAuditing ? <><Loader2 className="h-3 w-3 animate-spin" />Auditing...</> : <><Zap className="h-3 w-3" />Audit My Answer</>}
                    </button>
                  </div>

                  {/* Result area */}
                  <div className="flex-1 overflow-y-auto min-h-0 p-3">
                    {isAuditing && (
                      <div className="flex flex-col items-center justify-center py-10 gap-3">
                        <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
                        <p className="text-[10px] text-muted-foreground">Analysing your answer...</p>
                      </div>
                    )}
                    {!isAuditing && auditorResult && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-background border border-amber-400/20 rounded-xl p-3 overflow-x-auto"
                      >
                        <div className="text-[10px] leading-relaxed" dangerouslySetInnerHTML={{ __html: auditorResult.startsWith("<") ? auditorResult : auditorResult.replace(/\n/g, "<br/>") }} />
                        <button
                          onClick={() => { setAuditorResult(null); setAuditorAnswer(""); setAuditorContext(""); }}
                          className="mt-3 text-[9px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Clear & audit another →
                        </button>
                      </motion.div>
                    )}
                    {!isAuditing && !auditorResult && (
                      <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
                        <Lightbulb className="h-8 w-8 text-amber-400/30" />
                        <p className="text-[10px] text-muted-foreground">Paste your answer above</p>
                        <p className="text-[9px] text-muted-foreground/60">Get a step-by-step mark breakdown with a verdict on what you got right and where you lost marks.</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

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
                      <label className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg text-[10px] border transition-all cursor-pointer ${isAddingResource ? "opacity-50 pointer-events-none" : "border-border text-muted-foreground hover:border-indigo-400/30 hover:text-indigo-400"}`}>
                        {isAddingResource ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                        PDF/File
                        <input ref={fileInputRef} type="file" className="hidden" accept="image/*,.pdf,.txt,.md,.csv,.json,.js,.ts,.py,.html,.css" onChange={handleFileUpload} disabled={isAddingResource} />
                      </label>
                    </div>

                    <AnimatePresence>
                      {uploadStatus && (
                        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                          className="flex items-center gap-2 px-2.5 py-2 bg-indigo-400/10 border border-indigo-400/30 rounded-lg">
                          <Loader2 className="h-3 w-3 animate-spin text-indigo-400 shrink-0" />
                          <span className="text-[10px] text-indigo-300 leading-tight">{uploadStatus}</span>
                        </motion.div>
                      )}
                    </AnimatePresence>

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

export default function Portal() {
  const isMobile = useIsMobile();
  const { isLoading, isAuthenticated } = useAuth();

  if (isMobile) return <MobilePortal />;
  if (!isLoading && !isAuthenticated) return <GuestPortal />;
  return <PortalDesktop />;
}