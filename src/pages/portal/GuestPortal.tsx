// Unauthenticated chat view rendered by the Portal dispatcher for visitors
// who have not signed in yet. Uses the guestSession localStorage store for
// history + counter; the server-side daily cap runs through
// api.ai.guestSendMessage keyed by the persistent guestId.

import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { useAction } from "convex/react";
import { toast } from "sonner";
import {
  ArrowRight, Loader2, Lock, Send, Zap,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { sanitizeAiHtml } from "@/lib/sanitizeHtml";
import { fetchSponsoredAd } from "@/lib/requestAd";
import { errMsg } from "@/lib/errorMessage";
import { SponsoredAdCard, type GravityAd } from "@/components/SponsoredAdCard";
import ThinkingPanel from "@/components/ThinkingPanel";
import SignUpPromptModal from "@/components/SignUpPromptModal";
import {
  GUEST_LIMIT, GUEST_UNLIMITED,
  loadGuestSession, saveGuestSession, todayUTC, getOrCreateGuestId,
  type GuestMessage, type GuestSession,
} from "./guestSession";
import { MODES, MORE_MODES, VALID_MODES, type Mode } from "./modes";
import { SUGGESTIONS_BY_MODE } from "./suggestions";

export default function GuestPortal() {
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

  const currentMode = [...MODES, ...MORE_MODES].find(m => m.id === activeMode)!;
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

    // Check prompt limit (skipped while guests are unlimited)
    if (!GUEST_UNLIMITED && session.promptsUsed >= GUEST_LIMIT) {
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
        mode: activeMode as "chat" | "study" | "designing" | "strategising" | "creative-writing" | "marketing" | "idea-generation" | "naming",
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

      // Nudge sign-up once the free prompts are used up (skipped when unlimited).
      if (!GUEST_UNLIMITED && newSession.promptsUsed >= GUEST_LIMIT) {
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
        toast.error(errMsg(err, "Failed to get response. Try again."));
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
      <div className="flex-1 overflow-auto min-h-0 px-4 py-4 max-w-4xl mx-auto w-full">
        {(thinkingContent || isThinking) && (
          <div className="mb-3 sticky top-0 z-10 bg-background/90 backdrop-blur-sm rounded-xl">
            <ThinkingPanel content={thinkingContent} active={isThinking} />
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
              <p className="text-xs text-muted-foreground/60">{GUEST_UNLIMITED ? "Free · No sign-up required" : `${GUEST_LIMIT} free prompts · No sign-up required`}</p>
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
            <button
              aria-label="Send message"
              onClick={handleSend}
              disabled={!input.trim() || isThinking || !isGuestMode}
              className="px-3 py-2 bg-primary text-primary-foreground rounded-xl disabled:opacity-50 transition-all shrink-0 hover:bg-primary/90"
            >
              {isThinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        )}
        <div className="flex items-center justify-center gap-1 mt-1.5">
          <Lock className="h-2.5 w-2.5 text-muted-foreground/40" />
          <span className="text-[9px] text-muted-foreground/40">{GUEST_UNLIMITED ? "Guest session · Free & unlimited" : `Guest session · ${promptsLeft} of ${GUEST_LIMIT} free prompts remaining`}</span>
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
