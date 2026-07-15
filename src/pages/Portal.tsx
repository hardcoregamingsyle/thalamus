import { useAuth } from "@/hooks/use-auth";
import { memo, useEffect, useRef, useState } from "react";
import CreditModal from "@/components/CreditModal";
import OnboardingModal from "@/components/OnboardingModal";
import StudyProfileModal from "@/components/StudyProfileModal";
import StudentSuite from "@/components/StudentSuite";
import MathRenderer from "@/components/MathRenderer";
import { sanitizeAiHtml } from "@/lib/sanitizeHtml";
import { fetchSponsoredAd } from "@/lib/requestAd";
import ThinkingPanel from "@/components/ThinkingPanel";
import { useNavigate, useParams } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { useQuery, useMutation, useAction } from "convex/react";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  MessageSquare, Search, Plus, Trash2, LogOut,
  Send, Loader2, Menu, X, Users, Zap, BookOpen,
  FileText, Globe, Image, Upload, Sparkles,
  Hash, Lightbulb, Lock, ArrowRight, Sun, Moon, GraduationCap,
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
// Guest history + counter live in localStorage (was sessionStorage) so they
// persist across tab-closes; the server enforces the real 3/day cap keyed by
// GUEST_ID_KEY (see api.ai.guestSendMessage).
const GUEST_STORAGE_KEY = "thalamus_guest_session";
const GUEST_ID_KEY = "thalamus_guest_id";

interface GuestMessage {
  role: "user" | "assistant";
  content: string;
  id: string;
}

interface GuestSession {
  messages: GuestMessage[];
  promptsUsed: number;
  mode: string;
  date: string; // YYYY-MM-DD (UTC) the counter belongs to
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

// Stable per-browser guest identifier. Persisted in localStorage so it survives
// tab-closes and reloads — this is what makes the server-side daily cap stick.
function getOrCreateGuestId(): string {
  try {
    let id = localStorage.getItem(GUEST_ID_KEY);
    if (!id) {
      id = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(GUEST_ID_KEY, id);
    }
    return id;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function loadGuestSession(mode: string): GuestSession {
  const today = todayUTC();
  try {
    const raw = localStorage.getItem(GUEST_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as GuestSession;
      if (parsed.mode === mode) {
        // Mirror the server's per-UTC-day reset: a returning guest keeps their
        // prior conversation but gets their free prompts back the next day.
        if (parsed.date !== today) return { ...parsed, promptsUsed: 0, date: today };
        return parsed;
      }
    }
  } catch { /* ignore */ }
  return { messages: [], promptsUsed: 0, mode, date: today };
}

function saveGuestSession(session: GuestSession) {
  try {
    localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(session));
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
  const [thinkingContent, setThinkingContent] = useState("");
  const [showSignUp, setShowSignUp] = useState<{ reason: "limit" | "mode"; pendingMessage?: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const guestSendMessage = useAction(api.ai.guestSendMessage);
  // One sponsored card for guests (no rail — the guest layout is a single
  // centered column). Requested once per session after the first reply; the
  // server still gates on the admin `showToGuests` toggle.
  const [sponsoredAd, setSponsoredAd] = useState<GravityAd | null>(null);
  const adRequestedRef = useRef(false);

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
    const newSession: GuestSession = {
      ...session,
      messages: [...session.messages, userMsg],
      promptsUsed: session.promptsUsed + 1,
      date: todayUTC(),
    };
    setSession(newSession);
    saveGuestSession(newSession);

    setIsThinking(true);
    setThinkingContent("");

    // Add a placeholder assistant message (renders the typing dots)
    const streamingMsg: GuestMessage = { role: "assistant", content: "", id: streamingId };
    setSession(s => ({ ...s, messages: [...s.messages, streamingMsg] }));

    try {
      const history = session.messages.map(m => ({ role: m.role, content: m.content }));
      const userContext = {
        datetime: new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };

      // Route through the enforced action so the server (not just the client
      // counter) caps guests at 3 prompts/day, keyed by the persistent guestId.
      const response = await guestSendMessage({
        content: msg,
        mode: activeMode as "chat" | "study",
        history,
        userContext,
        guestId: getOrCreateGuestId(),
      });
      const finalSession: GuestSession = {
        ...newSession,
        messages: [...newSession.messages, { role: "assistant", content: response, id: streamingId }],
      };
      setSession(finalSession);
      saveGuestSession(finalSession);

      // Request one sponsored card for this guest session (fire-and-forget —
      // ads must never break chat). Guests carry no token, so the server keys
      // gating on `showToGuests`. Only the first successful reply triggers it.
      if (!adRequestedRef.current) {
        adRequestedRef.current = true;
        const adMessages = [...history, { role: "user", content: msg }, { role: "assistant", content: response }]
          .map(m => ({ role: m.role, content: m.content.slice(0, 1000) }));
        fetchSponsoredAd({ messages: adMessages, count: 1 })
          .then(ad => { if (ad) setSponsoredAd(Array.isArray(ad) ? ad[0] as GravityAd : ad as GravityAd); })
          .catch(() => {});
      }

      // Nudge sign-up once the free prompts are used up.
      if (newSession.promptsUsed >= GUEST_LIMIT) {
        setTimeout(() => setShowSignUp({ reason: "limit" }), 1500);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("GUEST_LIMIT_REACHED")) {
        // Server rejected — roll back the optimistic message + counter, pin the
        // local counter to the cap, and surface the sign-up modal.
        const reverted: GuestSession = { ...session, promptsUsed: GUEST_LIMIT, date: todayUTC() };
        setSession(reverted);
        saveGuestSession(reverted);
        setInput(msg);
        setShowSignUp({ reason: "limit", pendingMessage: msg });
      } else {
        // Generation failed — roll back to the pre-send state (the server only
        // counts successful prompts) and let the user retry.
        toast.error("Failed to get response. Try again.");
        setSession(session);
        saveGuestSession(session);
        setInput(msg);
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
          <div className="w-7 h-7 rounded-lg border border-primary/30 overflow-hidden bg-card">
            <img src="/thalamus-logo.png" alt="Thalamus AI" className="h-full w-full object-cover" />
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
        {(thinkingContent || isThinking) && (
          <div className="mb-3 sticky top-0 z-10 bg-background/90 backdrop-blur-sm rounded-xl">
            <ThinkingPanel
              title={`${currentMode.label} thinking`}
              content={thinkingContent}
              active={isThinking}
              accentClassName={`${currentMode.accent} ${currentMode.color}`}
            />
          </div>
        )}
        {session.messages.length === 0 ? (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center h-full gap-6 pb-20">
            <div className={`w-16 h-16 rounded-2xl ${currentMode.accent} border flex items-center justify-center`}>
              <currentMode.icon className={`h-8 w-8 ${currentMode.color}`} />
            </div>
            <div className="text-center">
              <h2 className={`text-xl font-bold ${currentMode.color} mb-2`}>{currentMode.label} Mode</h2>
              <p className="text-sm text-muted-foreground mb-1">
                {activeMode === "chat" && "Ask anything and get clear, accurate answers"}
                {activeMode === "study" && "Study with clear explanations and practice"}
                {activeMode === "research" && "Research with live web search"}
                {activeMode === "code" && "A dispatcher routes your task through up to 9 agents that build software"}
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
              const isStreaming = msg.role === "assistant" && msg.content === "" && isThinking;
              const isStreamingContent = msg.role === "assistant" && msg.content !== "" && isThinking;
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
                          <span dangerouslySetInnerHTML={{ __html: sanitizeAiHtml(msg.content.startsWith("<") ? msg.content : msg.content.replace(/\n/g, "<br/>")) }} />
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
            {sponsoredAd && !isThinking && <SponsoredAdCard ad={sponsoredAd} />}
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

// ── Suggestion Form Modal ─────────────────────────────────────────────────────
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

// ── Mode Selection Screen ─────────────────────────────────────────────────────
function ModeSelection({ signOut, theme, toggleTheme }: { user: unknown; signOut: () => void; theme: string; toggleTheme: () => void }) {
  const navigate = useNavigate();

  const modeCards = [
    {
      id: "chat",
      title: "Chat",
      description: "General conversation and quick questions",
      icon: MessageSquare,
      color: "from-blue-500/20 to-cyan-500/20",
      borderColor: "border-blue-500/30",
      textColor: "text-blue-400",
      features: ["Fast responses", "General knowledge", "Helpful & concise"]
    },
    {
      id: "research",
      title: "Research",
      description: "Deep analysis with web search capabilities",
      icon: Search,
      color: "from-violet-500/20 to-purple-500/20",
      borderColor: "border-violet-500/30",
      textColor: "text-violet-400",
      features: ["Web search", "Citations", "In-depth analysis"]
    },
    {
      id: "study",
      title: "Study",
      description: "Upload materials and get study help",
      icon: BookOpen,
      color: "from-indigo-500/20 to-blue-500/20",
      borderColor: "border-indigo-500/30",
      textColor: "text-indigo-400",
      features: ["Upload files", "RAG-powered", "Answer auditor"]
    },
    {
      id: "code",
      title: "Code",
      description: "Multi-agent system for software development",
      icon: Users,
      color: "from-emerald-500/20 to-teal-500/20",
      borderColor: "border-emerald-500/30",
      textColor: "text-emerald-400",
      features: ["9 specialized agents", "Full stack dev", "GitHub sync"]
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/40 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Thalamus AI</h1>
              <p className="text-xs text-muted-foreground">Choose your mode</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
            >
              {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <button
              onClick={signOut}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="text-center mb-8 sm:mb-12">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl sm:text-4xl font-bold text-foreground mb-3"
          >
            What would you like to do?
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-muted-foreground max-w-2xl mx-auto"
          >
            Select a mode to get started. Each mode is built for a different kind of task.
          </motion.p>
        </div>

        {/* Mode Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 max-w-5xl mx-auto">
          {modeCards.map((mode, idx) => (
            <motion.button
              key={mode.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              onClick={() => navigate(`/portal/${mode.id}`)}
              className={`group relative bg-gradient-to-br ${mode.color} border ${mode.borderColor} rounded-2xl p-6 text-left hover:scale-[1.02] transition-all duration-300 overflow-hidden`}
            >
              {/* Background glow effect */}
              <div className={`absolute inset-0 bg-gradient-to-br ${mode.color} opacity-0 group-hover:opacity-100 transition-opacity blur-xl`} />

              {/* Content */}
              <div className="relative z-10">
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-14 h-14 rounded-xl bg-background/50 border ${mode.borderColor} flex items-center justify-center backdrop-blur-sm`}>
                    <mode.icon className={`h-7 w-7 ${mode.textColor}`} />
                  </div>
                  <ArrowRight className={`h-5 w-5 ${mode.textColor} opacity-0 group-hover:opacity-100 transition-opacity`} />
                </div>

                <h3 className={`text-xl font-bold ${mode.textColor} mb-2`}>{mode.title}</h3>
                <p className="text-sm text-muted-foreground mb-4">{mode.description}</p>

                <div className="space-y-2">
                  {mode.features.map((feature, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className={`w-1.5 h-1.5 rounded-full ${mode.textColor.replace('text-', 'bg-')}`} />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.button>
          ))}
        </div>
      </main>
    </div>
  );
}

// ── Sponsored ad card (Gravity) ───────────────────────────────────────────────
interface GravityAd {
  adText?: string;
  title?: string;
  brandName?: string;
  cta?: string;
  url?: string;
  favicon?: string;
  clickUrl?: string;
  impUrl?: string;
}

function SponsoredAdCard({ ad, rail = false }: { ad: GravityAd; rail?: boolean }) {
  // Fire the impression pixel exactly once PER AD — the card stays mounted
  // across timed refreshes, so track the last-fired impUrl rather than a
  // lifetime boolean (which would swallow refreshed ads' impressions).
  const firedImpUrlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ad.impUrl || firedImpUrlRef.current === ad.impUrl) return;
    firedImpUrlRef.current = ad.impUrl;
    // window.Image — the DOM constructor (lucide-react's Image icon shadows the global here)
    new window.Image().src = ad.impUrl;
  }, [ad.impUrl]);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start">
      <a
        href={ad.clickUrl ?? ad.url}
        target="_blank"
        rel="noopener noreferrer sponsored"
        className={`block rounded-2xl px-4 py-3 text-xs leading-relaxed bg-card border border-border text-foreground hover:border-primary/40 transition-colors ${rail ? "w-full" : "max-w-[82%]"}`}
      >
        <p className="text-[9px] font-bold text-muted-foreground/60 tracking-widest uppercase mb-1">Sponsored</p>
        <div className="flex items-start gap-2">
          {ad.favicon && <img src={ad.favicon} alt="" className="w-4 h-4 rounded shrink-0 mt-0.5" />}
          <div className="min-w-0">
            <p className="font-bold text-foreground">{ad.title ?? ad.brandName}</p>
            {ad.adText && <p className="text-muted-foreground mt-0.5">{ad.adText}</p>}
            {ad.cta && <span className="inline-block mt-1.5 text-primary font-bold">{ad.cta} →</span>}
          </div>
        </div>
      </a>
    </motion.div>
  );
}

// ── Completed message bubble ──────────────────────────────────────────────────
// Memoized so per-chunk streaming updates don't re-render the whole history
// (MathRenderer re-processing every completed message on each chunk caused lag).
const ChatMessageBubble = memo(function ChatMessageBubble({ msg }: { msg: Message }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
    >
      <div className={`max-w-[82%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border border-border text-foreground"}`}>
        {msg.role === "assistant" ? (
          <MathRenderer html={msg.content.startsWith("<") ? msg.content : msg.content.replace(/\n/g, "<br/>")} />
        ) : (
          <p className="whitespace-pre-wrap">{msg.content}</p>
        )}
        {msg.costCents !== undefined && msg.costCents > 0 && (
          <p className="text-[9px] opacity-40 mt-1.5 text-right">{Math.ceil(msg.costCents * 15000).toLocaleString()} AB</p>
        )}
      </div>
    </motion.div>
  );
});

function PortalDesktop() {
  const { isLoading, isAuthenticated, user, signOut, token } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const params = useParams<{ mode?: string; sessionId?: string }>();

  // Compute these before hooks so they're stable
  const activeMode: Mode | null = (params.mode && VALID_MODES.includes(params.mode as Mode) ? params.mode as Mode : null);
  const urlSessionId = params.sessionId ?? null;

  const [activeConvId, setActiveConvId] = useState<Id<"conversations"> | null>(null);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingContent, setThinkingContent] = useState("");
  const [inFlightUserContent, setInFlightUserContent] = useState<string | null>(null);
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
  const [suiteOpen, setSuiteOpen] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const attachFileInputRef = useRef<HTMLInputElement>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showStudyProfile, setShowStudyProfile] = useState(false);
  const [sponsoredAd, setSponsoredAd] = useState<GravityAd | null>(null);
  const [railAds, setRailAds] = useState<GravityAd[]>([]);
  // Rail slots by viewport (see calc below): up to 4 on 1920+, scaling down to
  // 0 under 1024. Total ads = 1 in-chat + rail (max ~5 on wide screens).
  const [railCount, setRailCount] = useState(0);
  const adRequestedRef = useRef(false);
  // Ad refresh machinery: context of the latest completed exchange (so
  // refreshed ads stay contextual), when we last swapped the ad, and the
  // user's last interaction (for the activity-based cadence).
  const adContextRef = useRef<{ messages: Array<{ role: string; content: string }>; sessionId?: string } | null>(null);
  const lastAdRefreshRef = useRef(0);
  const lastActivityRef = useRef(0); // stamped on mount by the activity effect
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ensureDailyBalance = useMutation(api.customAuthHelpers.ensureDailyBalance);
  const completeOnboarding = useMutation(api.users.completeOnboarding);
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
      // Show onboarding if user hasn't completed it
      const typedUser = user as { hasOnboarded?: boolean };
      if (!typedUser.hasOnboarded) {
        setTimeout(() => setShowOnboarding(true), 600);
      }
    }
  }, [token, user, ensureDailyBalance]);

  // Track user activity for the ad-refresh cadence. Passive listeners, ref
  // writes only — zero re-renders.
  useEffect(() => {
    // Rail ad slots by viewport width. Total ads = 1 in-chat + rail, so wide
    // screens show up to 5. Narrow screens stay light (in-chat card only).
    const calc = () => setRailCount(window.innerWidth >= 1920 ? 4 : window.innerWidth >= 1536 ? 3 : window.innerWidth >= 1280 ? 2 : window.innerWidth >= 1024 ? 1 : 0);
    calc();
    window.addEventListener("resize", calc, { passive: true });
    return () => window.removeEventListener("resize", calc);
  }, []);

  // Split a requestAd result (single ad or array) into in-chat + rail slots.
  const applyAds = (result: unknown) => {
    const list = (Array.isArray(result) ? result : [result]).filter(Boolean) as GravityAd[];
    if (list.length === 0) return;
    setSponsoredAd(list[0]);
    setRailAds(list.slice(1));
  };

  useEffect(() => {
    const mark = () => { lastActivityRef.current = Date.now(); };
    mark(); // opening the portal counts as activity
    const opts = { passive: true } as const;
    window.addEventListener("pointermove", mark, opts);
    window.addEventListener("keydown", mark, opts);
    window.addEventListener("scroll", mark, opts);
    window.addEventListener("touchstart", mark, opts);
    window.addEventListener("click", mark, opts);
    return () => {
      window.removeEventListener("pointermove", mark);
      window.removeEventListener("keydown", mark);
      window.removeEventListener("scroll", mark);
      window.removeEventListener("touchstart", mark);
      window.removeEventListener("click", mark);
    };
  }, []);

  const handleOnboardingComplete = async () => {
    setShowOnboarding(false);
    if (token) {
      try {
        await completeOnboarding({ token });
      } catch {
        // non-critical, ignore
      }
    }
  };

  const conversations = useQuery(api.conversations.list, token ? { token } : "skip") as Conversation[] | undefined;
  const messages = useQuery(api.conversations.getMessages, activeConvId && token ? { conversationId: activeConvId, token } : "skip") as Message[] | undefined;
  const studyResources = useQuery(api.studyHelpers.listResources, token ? { token } : "skip") as StudyResource[] | undefined;

  const createConversation = useMutation(api.conversations.create);
  const deleteConversation = useMutation(api.conversations.remove);
  const sendMessage = useAction(api.ai.sendMessage);
  const sendStudyMessage = useAction(api.study.sendStudyMessage);
  const generateTitle = useAction(api.ai.generateConversationTitle);

  // Ad refresh cadence. Tab must be visible for ANY refresh (background
  // impressions are how publisher accounts get banned):
  //   prompt running + active input (<60s)  → every 60s
  //   prompt running + passively watching   → every 180s
  //   idle + active input                   → every 90s
  //   idle + no input for 2+ minutes        → paused until next activity
  useEffect(() => {
    const id = setInterval(() => {
      if (!sponsoredAd || !adContextRef.current) return; // nothing to refresh yet
      if (document.visibilityState !== "visible") return;
      const idleMs = Date.now() - lastActivityRef.current;
      const promptRunning = isThinking || streamingContent !== null;
      let interval: number | null;
      if (promptRunning) interval = idleMs < 60_000 ? 60_000 : 180_000;
      else interval = idleMs < 120_000 ? 90_000 : null;
      if (interval === null) return;
      if (Date.now() - lastAdRefreshRef.current < interval) return;
      // Mark the attempt up front so a no-fill response doesn't cause hammering.
      lastAdRefreshRef.current = Date.now();
      fetchSponsoredAd({
        token: localStorage.getItem("agentai_session_token") ?? undefined,
        messages: adContextRef.current.messages,
        sessionId: adContextRef.current.sessionId,
        count: 1 + railCount,
      })
        .then(ad => { if (ad) applyAds(ad); })
        .catch(() => {});
    }, 15_000);
    return () => clearInterval(id);

  }, [sponsoredAd, isThinking, streamingContent, railCount]);
  const addTextResource = useMutation(api.studyHelpers.addTextResource);
  const deleteResource = useMutation(api.studyHelpers.deleteResource);
  const searchAndAddResource = useAction(api.study.searchAndAddResource);
  const processFileResource = useAction(api.study.processFileResource);
  const submitSuggestionMutation = useMutation(api.admin.submitSuggestion);
  const [isSuggestionSubmitting, setIsSuggestionSubmitting] = useState(false);
  const saveUserMessage = useMutation(api.conversations.saveUserMessage);
  const saveStudyProfile = useMutation(api.users.saveStudyProfile);
  const importGuestConversation = useMutation(api.conversations.importGuestConversation);
  const guestMigratedRef = useRef(false);

  // Resolve conversation from URL session ID
  useEffect(() => {
    if (urlSessionId && conversations && activeMode !== "code") {
      const conv = conversations.find((c: Conversation) => c.customId === urlSessionId);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs conversation selection from the URL param once data loads; safe refactor not obvious since activeConvId is also set by user actions
      if (conv) setActiveConvId(conv._id);
    }
  }, [urlSessionId, conversations, activeMode]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate("/auth");
  }, [isLoading, isAuthenticated, navigate]);

  // Migrate a guest's local conversation into the account on the guest→authed
  // transition. Runs once: the guest session is cleared up front so a refresh
  // (or React re-invocation) can't re-import.
  useEffect(() => {
    if (!token || !isAuthenticated || guestMigratedRef.current) return;
    let raw: string | null = null;
    try { raw = localStorage.getItem(GUEST_STORAGE_KEY); } catch { return; }
    if (!raw) return;
    guestMigratedRef.current = true;

    let parsed: GuestSession | null = null;
    try { parsed = JSON.parse(raw) as GuestSession; } catch { parsed = null; }
    const guestMsgs = (parsed?.messages ?? []).filter(m => m.content.trim().length > 0);
    // Clear immediately — whether or not there's anything to migrate.
    try { localStorage.removeItem(GUEST_STORAGE_KEY); } catch { /* ignore */ }
    if (!parsed || guestMsgs.length === 0) return;

    const mode = (VALID_MODES.includes(parsed.mode as Mode) ? parsed.mode : "chat") as Mode;
    importGuestConversation({
      token,
      mode,
      messages: guestMsgs.map(m => ({ role: m.role, content: m.content })),
    })
      .then((res) => {
        const r = res as { conversationId: Id<"conversations">; customId: string };
        setActiveConvId(r.conversationId);
        navigate(`/portal/${mode}/${r.customId}`, { replace: true });
      })
      .catch(() => { /* best-effort — a failed migration just leaves a fresh account */ });
  }, [token, isAuthenticated, importGuestConversation, navigate]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking, streamingContent]);

  // Track how many messages existed before sending, so we only clear streaming
  // content when a NEW assistant message arrives (not a pre-existing one)
  const prevMessageCountRef = useRef<number>(0);
  useEffect(() => {
    const count = messages?.length ?? 0;
    // Only clear streamingContent when a NEW assistant message arrives from DB
    // (count increased AND last message is assistant)
    if (
      streamingContent !== null &&
      streamingContent !== "" &&
      count > prevMessageCountRef.current &&
      count > 0
    ) {
      const lastMsg = messages?.[messages.length - 1];
      if (lastMsg?.role === "assistant") {
        // Small delay to avoid flash — let the DB message render first
        setTimeout(() => setStreamingContent(null), 50);
      }
    }
    prevMessageCountRef.current = count;
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const typedUserForProfile = user as { studyGrade?: string; studyBoard?: string; studyLanguage?: string } | null;
  const studyGrade = typedUserForProfile?.studyGrade ?? null;
  const studyBoard = typedUserForProfile?.studyBoard ?? null;
  const studyLanguage = typedUserForProfile?.studyLanguage ?? null;

  const handleSaveStudyProfile = async (grade: string, board: string, language: string) => {
    if (!token) return;
    try {
      await saveStudyProfile({ token, grade, board, language });
      setShowStudyProfile(false);
      toast.success("Study profile saved!");
    } catch {
      toast.error("Failed to save profile");
    }
  };

  const setActiveMode = (mode: Mode) => {
    setActiveConvId(null);
    setStreamingContent(null);
    setThinkingContent("");
    setInFlightUserContent(null);
    prevMessageCountRef.current = 0;
    adRequestedRef.current = false;
    setSponsoredAd(null);
    setRailAds([]);
    navigate(`/portal/${mode}`, { replace: false });
    // Show study profile setup if entering study mode without a profile
    if (mode === "study" && !studyGrade && !studyBoard) {
      setTimeout(() => setShowStudyProfile(true), 400);
    }
  };

  const handleNewConversation = async () => {
    if (!token) return;
    adRequestedRef.current = false;
    setSponsoredAd(null);
    setRailAds([]);
    try {
      const result = await createConversation({ title: `${(activeMode ?? "chat").toUpperCase()}_${Date.now().toString(36).toUpperCase()}`, mode: activeMode ?? "chat", token }) as { id: Id<"conversations">; customId: string } | Id<"conversations">;
      const id = typeof result === "object" && "id" in result ? result.id : result as Id<"conversations">;
      const customId = typeof result === "object" && "customId" in result ? result.customId : null;
      setActiveConvId(id);
      if (customId) navigate(`/portal/${activeMode}/${customId}`, { replace: false });
    } catch { toast.error("Failed to create conversation"); }
  };

  const handleSelectConversation = (conv: Conversation) => {
    setStreamingContent(null);
    setThinkingContent("");
    setInFlightUserContent(null);
    prevMessageCountRef.current = 0;
    adRequestedRef.current = false;
    setSponsoredAd(null);
    setRailAds([]);
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
    setInFlightUserContent(msg);

    const userContext = {
      datetime: new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    // Create conversation if needed
    let convId: Id<"conversations"> | null = activeConvId;
    if (!convId) {
      try {
        const newConv = await createConversation({ token, mode: activeMode ?? "chat", title: msg.slice(0, 50) });
        const newConvResult = newConv as { id: Id<"conversations">; customId: string } | Id<"conversations">;
        const id = typeof newConvResult === "object" && "id" in newConvResult ? newConvResult.id : newConvResult as Id<"conversations">;
        const customId = typeof newConvResult === "object" && "customId" in newConvResult ? newConvResult.customId : null;
        convId = id;
        setActiveConvId(id);
        if (customId) navigate(`/portal/${activeMode}/${customId}`, { replace: true });
      } catch {
        toast.error("Failed to create conversation");
        return;
      }
    }

    // Save user message to DB immediately (so refresh preserves it)
    let userMessageSaved = false;
    try {
      await saveUserMessage({ conversationId: convId, content: msg, token });
      userMessageSaved = true;
    } catch { /* non-critical */ }

    // Code mode: handled entirely by TeamPortalInline — do not send here
    if (activeMode === "code") {
      return;
    }

    // Chat, research, and study use the streaming HTTP endpoint.
    const convexUrl = import.meta.env.VITE_CONVEX_URL as string;
    const siteUrl = convexUrl.replace(".convex.cloud", ".convex.site");

    const SYSTEM_PROMPTS: Record<string, string> = {
      chat: `You are Thalamus AI, an advanced AI assistant.\n\nCRITICAL: You MUST respond in clean, semantic HTML only. No markdown. No plain text. Pure HTML.\nUse: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <code>, <pre><code>, <blockquote>, <table>\nHeadings: style="font-size:1.2em;font-weight:bold;margin:0.5em 0;color:#e5e7eb"\nParagraphs: style="margin:0.5em 0;line-height:1.6;color:#d1d5db"\nLists: style="margin:0.3em 0 0.3em 1.2em;color:#d1d5db"\nCode blocks: style="background:#111827;color:#34d399;padding:1em;border-radius:8px;overflow-x:auto;display:block;margin:0.5em 0;font-family:monospace;font-size:0.8em"\nInline code: style="background:#1f2937;color:#34d399;padding:0.1em 0.4em;border-radius:4px;font-family:monospace;font-size:0.85em"`,
      research: `You are Thalamus AI Research Mode — a deep research assistant. Synthesize comprehensive, well-structured reports.\n\nCRITICAL: You MUST respond in clean, semantic HTML only. No markdown. No plain text. Pure HTML.\n\nSTRUCTURE:\n- <h1 style="font-size:1.5em;font-weight:800;margin:0.5em 0 0.8em;color:#f9fafb;border-bottom:2px solid rgba(99,102,241,0.4);padding-bottom:0.4em"> for main title\n- <h2 style="font-size:1.2em;font-weight:700;margin:1em 0 0.4em;color:#e5e7eb;border-left:4px solid #6366f1;padding-left:0.7em"> for sections\n- <h3 style="font-size:1em;font-weight:700;margin:0.8em 0 0.3em;color:#c4b5fd"> for sub-sections\n- <p style="margin:0.5em 0;line-height:1.7;color:#d1d5db;font-size:0.9em"> for paragraphs\n- <ul style="margin:0.4em 0 0.4em 1.5em;color:#d1d5db;font-size:0.9em"> and <li style="margin:0.2em 0"> for lists\n- <blockquote style="border-left:4px solid #6366f1;padding:0.5em 1em;background:rgba(99,102,241,0.08);border-radius:0 8px 8px 0;margin:0.6em 0;color:#c4b5fd;font-style:italic"> for key insights\n- <strong style="color:#f9fafb;font-weight:700"> for emphasis\n\nTABLES (CRITICAL — always use this exact format):\n<table style="width:100%;border-collapse:collapse;margin:0.8em 0;font-size:0.85em">\n  <thead>\n    <tr>\n      <th style="background:rgba(99,102,241,0.2);color:#e5e7eb;font-weight:700;padding:0.6em 0.8em;text-align:left;border:1px solid rgba(99,102,241,0.3)">Header</th>\n    </tr>\n  </thead>\n  <tbody>\n    <tr>\n      <td style="padding:0.5em 0.8em;border:1px solid rgba(255,255,255,0.08);color:#d1d5db;vertical-align:top">Data</td>\n    </tr>\n    <tr style="background:rgba(255,255,255,0.03)">\n      <td style="padding:0.5em 0.8em;border:1px solid rgba(255,255,255,0.08);color:#d1d5db;vertical-align:top">Data</td>\n    </tr>\n  </tbody>\n</table>\n\nSECTION DIVIDERS: <hr style="border:none;border-top:1px solid rgba(99,102,241,0.2);margin:1em 0">\n\nBe comprehensive, analytical, and well-structured. Minimum 600 words for research reports.`,
      study: `You are Thalamus AI Study Mode — the world's best study companion.${studyGrade ? ` This student is in ${studyGrade}${studyBoard ? `, studying under ${studyBoard}` : ""}${studyLanguage && studyLanguage !== "English" ? `, and prefers ${studyLanguage}` : ""}.` : ""} You have deep knowledge of ALL school and college curricula worldwide, especially Indian education (NCERT, CBSE, ICSE, State Boards, JEE, NEET, UPSC). You know every textbook chapter, poem, story, lesson, and concept by name.\n\n${studyGrade ? `STUDENT PROFILE: Grade/Level: ${studyGrade}${studyBoard ? ` | Board: ${studyBoard}` : ""}${studyLanguage ? ` | Language: ${studyLanguage}` : ""}. Always tailor your answers to this exact grade and board. Reference the correct textbook chapters, exam patterns, and marking schemes for this board.\n\n` : ""}When a student mentions ANY topic — a chapter name, poem title, story name, concept, or subject — you IMMEDIATELY know what it is and explain it thoroughly WITHOUT asking for clarification. If a student says "Reed ki Hadi" you know it's a Hindi story/poem from NCERT. If they say "Mijbaan" or "Kabir ke Dohe" you know exactly what it is. NEVER ask "which book?" or "which class?" — just answer comprehensively.\n\nYour job: explain concepts so deeply the student could teach it to someone else. Give:\n- Complete summary and key points\n- Important themes, characters, meanings\n- Exam-ready notes with likely questions\n- Memory tricks and mnemonics\n- Real examples and analogies\n\nCRITICAL: Respond in clean semantic HTML only. No markdown. Pure HTML.\nUse: <h2>, <h3>, <h4>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <blockquote>, <code>\nHeadings: style="font-size:1.15em;font-weight:bold;margin:0.8em 0 0.4em;color:#e5e7eb;border-left:4px solid #6366f1;padding-left:0.7em"\nSub-headings: style="font-size:1em;font-weight:bold;margin:0.7em 0 0.3em;color:#c4b5fd"\nParagraphs: style="margin:0.4em 0;line-height:1.7;color:#d1d5db;font-size:0.92em"\nLists: style="margin:0.3em 0 0.3em 1.2em;color:#d1d5db;font-size:0.9em;line-height:1.6"\nKey facts: style="border-left:4px solid #f59e0b;padding:0.6em 1em;color:#fcd34d;margin:0.6em 0;background:rgba(245,158,11,0.08);border-radius:0 8px 8px 0;font-size:0.88em"`,
    };

    const historyMsgs = (messages ?? []).slice(-10).map((m: Message) => ({ role: m.role, content: m.content.slice(0, 1500) }));
    const systemPrompt = SYSTEM_PROMPTS[activeMode ?? "chat"] ?? SYSTEM_PROMPTS.chat;

    setIsThinking(true);
    setThinkingContent("");
    setStreamingContent(null);

    let finalAssistantText = "";
    let accumulated = "";
    let thinkingAccumulated = "";
    // Batch chunk-driven state updates to one per animation frame — a setState
    // per SSE chunk re-renders the whole conversation and causes visible lag.
    let rafId: number | null = null;
    const scheduleFlush = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (thinkingAccumulated) setThinkingContent(thinkingAccumulated);
        if (accumulated) setStreamingContent(accumulated);
      });
    };
    const cancelFlush = () => {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    };
    try {
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
          skipUserSave: userMessageSaved,
        }),
      });

      if (!response.ok || !response.body) {
        console.error("Stream response not OK:", response.status, response.statusText);
        throw new Error("Stream failed");
      }

      console.log("Stream started successfully");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log("Stream completed. Total accumulated:", accumulated.length, "chars");
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          try {
            const parsed = JSON.parse(jsonStr) as { type?: string; chunk?: string; done?: boolean; fullText?: string };
            if (parsed.type === "thinking" && parsed.chunk) {
              thinkingAccumulated += parsed.chunk;
              scheduleFlush();
            }
            if (parsed.type === "answer_start") {
              setIsThinking(false);
              setStreamingContent("");
            }
            if ((!parsed.type || parsed.type === "answer") && parsed.chunk) {
              setIsThinking(false);
              accumulated += parsed.chunk;
              scheduleFlush();
            }
            if (parsed.done && parsed.fullText) {
              cancelFlush();
              setIsThinking(false);
              accumulated = parsed.fullText;
              console.log("Stream done signal received. Final text length:", accumulated.length);
              if (thinkingAccumulated) setThinkingContent(thinkingAccumulated);
              setStreamingContent(accumulated);
            }
          } catch (e) {
            console.error("Failed to parse SSE line:", jsonStr, e);
          }
        }
      }
      console.log("Stream read complete. accumulated length:", accumulated.length);
      cancelFlush();
      finalAssistantText = accumulated;
      // The stream endpoint saves the assistant response before streaming it
      // back for UX, so clear the temporary bubble after the stream finishes.
      setStreamingContent(null);
    } catch (streamError) {
      console.error("Streaming failed, falling back to action:", streamError);
      cancelFlush();
      setStreamingContent(null);
      // Fallback to Convex action
      setIsThinking(true);
      try {
        if (activeMode === "study") {
          await sendStudyMessage({ conversationId: convId, content: msg, token, userContext, skipUserSave: userMessageSaved });
        } else {
          await sendMessage({ conversationId: convId, content: msg, mode: activeMode as "chat" | "research" | "code", token, userContext, skipUserSave: userMessageSaved });
        }
      } catch (err) {
        console.error("Fallback action also failed:", err);
        toast.error(err instanceof Error ? err.message : "Failed to send message");
      } finally {
        setIsThinking(false);
      }
    }

    // Keep the ad context tracking the latest completed exchange, then request
    // the first sponsored card of this conversation session. Timed refreshes
    // (see the cadence effect) reuse the stored context. Fire-and-forget —
    // ads must never break chat.
    const adMessages = [
      ...historyMsgs,
      { role: "user", content: msg },
      ...(finalAssistantText ? [{ role: "assistant", content: finalAssistantText }] : []),
    ].map(m => ({ role: m.role, content: m.content.slice(0, 1000) }));
    adContextRef.current = { messages: adMessages, sessionId: convId ?? undefined };
    if (!adRequestedRef.current) {
      adRequestedRef.current = true;
      fetchSponsoredAd({
        token: localStorage.getItem("agentai_session_token") ?? undefined,
        messages: adMessages,
        sessionId: convId ?? undefined,
        count: 1 + railCount,
      })
        .then(ad => { if (ad) { applyAds(ad); lastAdRefreshRef.current = Date.now(); } })
        .catch(() => {});
    }

    if (!activeConvId) {
      generateTitle({ firstMessage: msg, conversationId: convId, token }).catch(() => {});
    }

    setIsThinking(false);
    setStreamingContent(null);
    setInFlightUserContent(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length > 0) {
      e.preventDefault();
      // Process files and add to attachedFiles
      const processedFiles: AttachedFile[] = [];
      for (const file of files) {
        try {
          const text = await file.text();
          processedFiles.push({
            name: file.name,
            content: text,
            size: file.size
          });
        } catch {
          toast.error(`Failed to read ${file.name}`);
        }
      }
      if (processedFiles.length > 0) {
        setAttachedFiles(prev => [...prev, ...processedFiles]);
        toast.success(`Added ${processedFiles.length} file${processedFiles.length > 1 ? 's' : ''}`);
      }
    }
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
  const visibleMessages = (() => {
    const list = messages ?? [];
    if (!inFlightUserContent || (!isThinking && streamingContent === null)) return list;
    const currentTurnIndex = [...list].reverse().findIndex(m => m.role === "user" && m.content === inFlightUserContent);
    if (currentTurnIndex === -1) return list;
    const userIndex = list.length - 1 - currentTurnIndex;
    return list.filter((m, index) => index <= userIndex || m.role !== "assistant");
  })();

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

  // Show mode selection screen when no mode is in the URL (/portal)
  if (!activeMode) {
    return <ModeSelection user={user} signOut={signOut} theme={theme} toggleTheme={toggleTheme} />;
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
              <div className="w-5 h-5 rounded border border-primary/40 overflow-hidden bg-card">
                <img src="/thalamus-logo.png" alt="Thalamus AI" className="h-full w-full object-cover" />
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
            <TeamPortalInline />
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
                    <button onClick={() => setShowStudyProfile(true)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] border transition-all ${studyGrade ? "border-indigo-400/30 text-indigo-400 bg-indigo-400/10" : "border-amber-400/30 text-amber-400 bg-amber-400/10 animate-pulse"}`}
                      title={studyGrade ? `${studyGrade} · ${studyBoard}` : "Set your study profile for better answers"}
                    >
                      <span className="text-[10px]">🎓</span>
                      {studyGrade ? `${studyGrade.replace("Class ", "Cls ")}` : "Set Profile"}
                    </button>
                    <button onClick={() => setSuiteOpen(true)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] border transition-all border-indigo-400/30 text-indigo-400 bg-indigo-400/10 hover:bg-indigo-400/20"
                    >
                      <GraduationCap className="h-3 w-3" />
                      Student Suite
                    </button>
                    <button onClick={() => setStudyResourcesOpen(o => !o)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] border transition-all ${studyResourcesOpen ? "bg-indigo-400/15 border-indigo-400/30 text-indigo-400 font-bold" : "border-border text-muted-foreground hover:text-indigo-400 hover:border-indigo-400/30"}`}
                    >
                      <BookOpen className="h-3 w-3" />
                      Resources {studyResources ? `(${studyResources.length})` : ""}
                    </button>
                  </div>
                )}
              </div>

              {/* Messages + sponsored rail (rail only on 1280px+ viewports) */}
              <div className="flex-1 min-h-0 flex">
              <div className="flex-1 overflow-y-auto min-h-0">
                <div className="p-4 space-y-4 max-w-4xl mx-auto">
                  {(thinkingContent || isThinking) && (
                    <div className="sticky top-2 z-10">
                      <ThinkingPanel
                        title={`${currentMode.label} thinking`}
                        content={thinkingContent}
                        active={isThinking && streamingContent === null}
                        accentClassName={`${currentMode.accent} ${currentMode.color}`}
                      />
                    </div>
                  )}
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
                  ) : visibleMessages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 gap-2">
                      <p className="text-xs text-muted-foreground">Send a message to begin</p>
                    </div>
                  ) : (
                    visibleMessages.map((msg: Message) => (
                      <ChatMessageBubble key={msg._id} msg={msg} />
                    ))
                  )}
                  {streamingContent !== null && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start">
                      <div className="max-w-[82%] rounded-2xl px-4 py-3 text-xs leading-relaxed bg-card border border-border text-foreground">
                        {streamingContent === "" ? (
                          <div className="flex items-center gap-1">
                            {[0, 1, 2].map(i => (
                              <motion.div key={i} className="w-2 h-2 rounded-full bg-primary"
                                animate={{ y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
                                transition={{ duration: 0.7, delay: i * 0.15, repeat: Infinity }} />
                            ))}
                          </div>
                        ) : (
                          <MathRenderer html={streamingContent.startsWith("<") ? streamingContent : streamingContent.replace(/\n/g, "<br/>")} />
                        )}
                      </div>
                    </motion.div>
                  )}
                  {sponsoredAd && activeConvId && streamingContent === null && !isThinking && (
                    <SponsoredAdCard ad={sponsoredAd} />
                  )}
                  {isThinking && streamingContent === null && (
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
              {railAds.length > 0 && activeConvId && (
                <aside className="hidden xl:flex flex-col gap-3 w-64 shrink-0 p-4 overflow-y-auto border-l border-border/40">
                  {railAds.slice(0, railCount).map((ad, i) => (
                    <SponsoredAdCard key={ad.impUrl ?? `rail-${i}`} ad={ad} rail />
                  ))}
                </aside>
              )}
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
                    onPaste={handlePaste}
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

      {/* Onboarding Modal */}
      <AnimatePresence>
        {showOnboarding && (
          <OnboardingModal
            onComplete={handleOnboardingComplete}
            userName={(user as { name?: string } | null)?.name}
          />
        )}
      </AnimatePresence>

      {/* Study Profile Modal */}
      <AnimatePresence>
        {suiteOpen && token && (
          <StudentSuite
            token={token}
            chatHistory={(messages ?? []).map(m => ({ role: m.role, content: m.content }))}
            studyGrade={studyGrade}
            studyBoard={studyBoard}
            studyLanguage={studyLanguage}
            onClose={() => setSuiteOpen(false)}
          />
        )}

        {showStudyProfile && (
          <StudyProfileModal
            onSave={handleSaveStudyProfile}
            onSkip={() => setShowStudyProfile(false)}
            existingGrade={studyGrade}
            existingBoard={studyBoard}
            existingLanguage={studyLanguage}
          />
        )}
      </AnimatePresence>

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

  return (
    <>
      <meta name="robots" content="noindex" />
      {isMobile ? <MobilePortal /> : !isLoading && !isAuthenticated ? <GuestPortal /> : <PortalDesktop />}
    </>
  );
}
