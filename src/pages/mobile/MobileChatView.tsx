// Mobile chat view — the per-mode chat screen surfaced after the user picks
// a mode from MobileHomeScreen. Handles the streaming send loop, the
// bottom-sheet session picker, and the mobile-specific study attach button.

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useAction } from "convex/react";
import { toast } from "sonner";
import { useNavigate, useParams } from "react-router";
import {
  ArrowLeft, ChevronRight, GraduationCap, Loader2, Moon, Paperclip,
  Plus, Send, Settings, Sun, Trash2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useTheme } from "@/hooks/use-theme";
import { sanitizeAiHtml } from "@/lib/sanitizeHtml";
import { fetchSponsoredAd } from "@/lib/requestAd";
import { fileToBase64, MAX_UPLOAD_BYTES } from "@/lib/fileEncoding";
import { errMsg } from "@/lib/errorMessage";
import { convexSiteUrl } from "@/lib/convexUrls";
import { streamChat } from "@/lib/streamChat";
import ThinkingPanel from "@/components/ThinkingPanel";
import { SponsoredAdCard, type GravityAd } from "@/components/SponsoredAdCard";
import { ALL_MODES, type Mode } from "@/pages/portal/modes";
import type { Conversation, Message } from "@/pages/portal/types";
import MobileMessageBubble from "./MobileMessageBubble";
import { useStudyTask } from "@/hooks/use-study-task";
import { useGamification } from "@/hooks/use-gamification";
import { StudyTaskProvider } from "@/components/chat/StudyTaskContext";
import StudyScoreBar from "@/components/chat/StudyScoreBar";
import StudyCelebration from "@/components/chat/StudyCelebration";
import { StudyComposerQuestion } from "@/components/chat/StudyQuestionHydrator";
import { extractStudyQuestionPrompts, findPendingStudyQuestion } from "@/lib/studyComposerQuestion";

// Mobile-specific system prompts. Deliberately terser than the desktop set
// (see src/content/systemPrompts.ts) because mobile screens can't fit the
// long research/study framing — kept local so the trims stay explicit.
const MOBILE_SYSTEM_PROMPTS: Record<string, string> = {
  chat: `You are Thalamus AI, an advanced AI assistant.\n\nCRITICAL: You MUST respond in clean, semantic HTML only. No markdown. No plain text. Pure HTML.\nUse: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <code>, <pre><code>, <blockquote>\nIMPORTANT: Do NOT hardcode text or background colors in inline styles — the app themes them automatically (light and dark themes). Use only layout styles (font-size, font-weight, margin, line-height).\nHeadings: style="font-size:1.2em;font-weight:bold;margin:0.5em 0"\nParagraphs: style="margin:0.5em 0;line-height:1.6"\nLists: style="margin:0.3em 0 0.3em 1.2em"\nCode blocks: style="background:#111827;color:#34d399;padding:1em;border-radius:8px;overflow-x:auto;display:block;margin:0.5em 0;font-family:monospace;font-size:0.8em"`,
  research: `You are Thalamus AI Research Mode — a deep research assistant. Provide comprehensive, well-structured research reports.\n\nCRITICAL: Respond in clean semantic HTML only. No markdown. Pure HTML.\nUse: <h1>, <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <blockquote>, <table>\nIMPORTANT: Do NOT hardcode text or background colors in inline styles — the app themes them automatically (light and dark themes). Use only layout styles.\nHeadings: style="font-size:1.3em;font-weight:bold;margin:0.8em 0 0.4em"\nParagraphs: style="margin:0.5em 0;line-height:1.7"`,
  study: `You are Thalamus AI Study Mode — a precision study assistant. Give dense, accurate, exam-ready information.\n\nCRITICAL: Respond in clean semantic HTML only. No markdown. Pure HTML.\nUse: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <blockquote>\nIMPORTANT: Do NOT hardcode text or background colors in inline styles — the app themes them automatically (light and dark themes). Use only layout styles.\nHeadings: style="font-size:1.15em;font-weight:bold;margin:0.8em 0 0.4em;border-left:4px solid #6366f1;padding-left:0.7em"\nParagraphs: style="margin:0.4em 0;line-height:1.7;font-size:0.95em"`,
};

export interface MobileChatViewProps {
  mode: Mode;
  token: string;
  user: unknown;
  onBack: () => void;
}

export default function MobileChatView({
  mode,
  token,
  user,
  onBack,
}: MobileChatViewProps) {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const params = useParams<{ mode?: string; sessionId?: string }>();
  const urlSessionId = params.sessionId ?? null;

  const [activeConvId, setActiveConvId] = useState<Id<"conversations"> | null>(null);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingContent, setThinkingContent] = useState("");
  const [inFlightUserContent, setInFlightUserContent] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [completedStreamContent, setCompletedStreamContent] = useState<string | null>(null);
  const streamBaseMessageCountRef = useRef(0);
  const [showConvList, setShowConvList] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Interactive study-task lock (persisted server-side). Blocks sending a new
  // prompt until every question/flashcard/pathway step is complete.
  const studyTask = useStudyTask(mode === "study" ? token : null, activeConvId);
  const studyLocked = mode === "study" && studyTask.locked;
  const studyTaskProgress =
    studyTask.task && studyTask.task.total > 0
      ? `${studyTask.task.completed}/${studyTask.task.total}`
      : "";

  // Mobile treats all 10 modes as first-class cards (unlike desktop, which
  // hides the "MORE MODES" set behind a dropdown), so we look up in ALL_MODES.
  const modeInfo = ALL_MODES.find(m => m.id === mode) ?? ALL_MODES[0];

  const conversations = useQuery(api.conversations.list, token ? { token } : "skip") as Conversation[] | undefined;
  const messages = useQuery(api.conversations.getMessages, activeConvId && token ? { conversationId: activeConvId, token } : "skip") as Message[] | undefined;

  // Mobile had no ad slot at all — every viewport under 768px routes here
  // instead of PortalDesktop, so the majority surface was serving nothing.
  // One card only: this is a single narrow column, so there is no rail to fill.
  const [sponsoredAd, setSponsoredAd] = useState<GravityAd | null>(null);
  const adRequestedRef = useRef(false);
  useEffect(() => {
    if (!activeConvId || !token || adRequestedRef.current) return;
    if (!messages || messages.length === 0) return;
    adRequestedRef.current = true;
    const adMessages = messages.slice(-6).map(m => ({ role: m.role, content: (m.content ?? "").slice(0, 1000) }));
    fetchSponsoredAd({ token, messages: adMessages, sessionId: activeConvId, count: 1 })
      .then(ad => { if (ad) setSponsoredAd(Array.isArray(ad) ? ad[0] as GravityAd : ad as GravityAd); })
      .catch(() => {});
  }, [activeConvId, messages, token]);

  const createConversation = useMutation(api.conversations.create);
  const deleteConversation = useMutation(api.conversations.remove);
  const sendMessage = useAction(api.ai.sendMessage);
  const sendStudyMessage = useAction(api.study.sendStudyMessage);
  const gradeStudyAnswerAction = useAction(api.study.gradeStudyAnswer);
  const generateTitle = useAction(api.ai.generateConversationTitle);
  const processFileResource = useAction(api.study.processFileResource);
  const saveUserMessage = useMutation(api.conversations.saveUserMessage);

  const typedUserForProfile = user as { studyGrade?: string; studyBoard?: string; studyLanguage?: string } | null;
  const studyGrade = typedUserForProfile?.studyGrade ?? null;
  const studyBoard = typedUserForProfile?.studyBoard ?? null;
  const studyLanguage = typedUserForProfile?.studyLanguage ?? null;

  const handleGradeAnswer = async (question: string, answer: string, attempt: number) => {
    if (!token || !activeConvId) throw new Error("Not in a study conversation");
    return await gradeStudyAnswerAction({
      token,
      conversationId: activeConvId,
      question,
      answer,
      studyGrade: studyGrade ?? undefined,
      studyBoard: studyBoard ?? undefined,
      studyLanguage: studyLanguage ?? undefined,
      attempt,
    });
  };

  // Session-local gamification + full-screen celebration on task completion.
  const gamification = useGamification();
  const [celebration, setCelebration] = useState(false);
  const prevTaskCompleteRef = useRef<boolean | null>(null);
  useEffect(() => {
    const complete = studyTask.task?.complete === true;
    if (studyTask.task && complete && prevTaskCompleteRef.current === false) {
      setCelebration(true);
    }
    if (studyTask.task) prevTaskCompleteRef.current = complete;
  }, [studyTask.task]);

  const filteredConvs = conversations?.filter((c: Conversation) => c.mode === mode) || [];

  useEffect(() => {
    if (urlSessionId && conversations && mode !== "code") {
      const conv = conversations.find((c: Conversation) => c.customId === urlSessionId);
      if (conv) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs conversation selection from the URL param once data loads; safe refactor not obvious since activeConvId is also set by user actions
        setActiveConvId(conv._id);
        setStreamingContent(null);
        setCompletedStreamContent(null);
        setInFlightUserContent(null);
        streamBaseMessageCountRef.current = 0;
      }
    }
  }, [urlSessionId, conversations, mode]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking, streamingContent]);

  // Do not discard a completed stream until its saved assistant message reaches
  // the reactive query. If the save fails, leaving the received answer visible
  // is safer than replacing it with an empty chat.
  useEffect(() => {
    if (streamingContent === null || completedStreamContent === null) return;
    const hasPersistedAssistant = (messages ?? [])
      .slice(streamBaseMessageCountRef.current)
      .some((message) => message.role === "assistant");
    if (!hasPersistedAssistant) return;
    const timeout = window.setTimeout(() => {
      setStreamingContent(null);
      setCompletedStreamContent(null);
    }, 50);
    return () => window.clearTimeout(timeout);
  }, [messages, streamingContent, completedStreamContent]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  }, [input]);

  const handleNewConversation = async () => {
    if (!token) return;
    setStreamingContent(null);
    setCompletedStreamContent(null);
    setInFlightUserContent(null);
    streamBaseMessageCountRef.current = 0;
    try {
      // create returns { id, customId } — storing the whole object made the very
      // next getMessages call fail argument validation and dumped the user on the
      // error screen. The cast was hiding it from tsc.
      const result = await createConversation({ title: `New ${modeInfo.mobileLabel}`, mode, token }) as { id: Id<"conversations">; customId: string };
      setActiveConvId(result.id);
      setShowConvList(false);
    } catch { toast.error("Failed to create conversation"); }
  };

  const handleSelectConversation = (conv: Conversation) => {
    setStreamingContent(null);
    setCompletedStreamContent(null);
    setInFlightUserContent(null);
    streamBaseMessageCountRef.current = 0;
    setActiveConvId(conv._id);
    setShowConvList(false);
    if (conv.customId) navigate(`/portal/${mode}/${conv.customId}`);
  };

  // Explicit text lets the transformed study composer submit an answer without
  // staging it through React state first (which previously sent a stale value).
  const sendPrompt = async (rawText: string) => {
    if (!rawText.trim() || isThinking || !token) return;
    streamBaseMessageCountRef.current = messages?.length ?? 0;
    setCompletedStreamContent(null);
    const msg = rawText.trim();
    setInput("");
    setInFlightUserContent(msg);

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

    const siteUrl = convexSiteUrl();
    const systemPrompt = MOBILE_SYSTEM_PROMPTS[mode] ?? MOBILE_SYSTEM_PROMPTS.chat;
    const historyMsgs = (messages ?? []).slice(-10).map((m: Message) => ({ role: m.role, content: m.content.slice(0, 1500) }));

    setIsThinking(true);
    setThinkingContent("");
    setStreamingContent(null);

    // Batch chunk-driven state updates to one per animation frame — a setState
    // per SSE chunk re-renders the whole conversation and causes visible lag.
    let finalAssistantText = "";
    let streamAccumulated = "";
    let thinkingAccumulated = "";
    let rafId: number | null = null;
    const scheduleFlush = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (thinkingAccumulated) setThinkingContent(thinkingAccumulated);
        if (streamAccumulated) setStreamingContent(streamAccumulated);
      });
    };
    const cancelFlush = () => {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    };
    try {
      const accumulated = await streamChat(siteUrl, {
        content: msg,
        mode,
        history: historyMsgs,
        systemPrompt,
        userContext,
        token,
        conversationId: convId,
        preferHighTier: true,
        skipUserSave: userMessageSaved,
      }, {
        onChunk: (text) => {
          setIsThinking(false);
          streamAccumulated = text;
          scheduleFlush();
        },
        onThinking: (chunk) => {
          thinkingAccumulated += chunk;
          scheduleFlush();
        },
        onAnswerStart: () => {
          setIsThinking(false);
          setStreamingContent("");
        },
        onDone: (fullText) => {
          streamAccumulated = fullText;
          setStreamingContent(fullText);
          setCompletedStreamContent(fullText);
        },
      });
      cancelFlush();
      finalAssistantText = accumulated;
      if (accumulated) {
        setStreamingContent(accumulated);
        setCompletedStreamContent(accumulated);
      }
    } catch {
      cancelFlush();
      setStreamingContent(null);
      setCompletedStreamContent(null);
      setIsThinking(true);
      try {
        if (mode === "study") {
          await sendStudyMessage({ conversationId: convId, content: msg, token, userContext, skipUserSave: userMessageSaved });
        } else {
          await sendMessage({ conversationId: convId, content: msg, mode: mode as "chat" | "research" | "code" | "designing" | "strategising" | "creative-writing" | "marketing" | "idea-generation" | "naming", token, userContext, skipUserSave: userMessageSaved });
        }
      } catch (err) {
        toast.error(errMsg(err, "Failed to send"));
      }
    }

    generateTitle({ firstMessage: msg, conversationId: convId, token }).catch(() => {});
    setIsThinking(false);
    if (!finalAssistantText) {
      setStreamingContent(null);
      setCompletedStreamContent(null);
    }
    setInFlightUserContent(null);
  };

  const handleSend = () => {
    if (studyLocked) {
      toast.error(`Finish your study task (${studyTaskProgress}) before sending a new message.`);
      return;
    }
    void sendPrompt(input);
  };

  const handleStudyAnswer = (question: string, answer: string) => {
    if (!answer.trim()) return;
    void sendPrompt(`[Answer to: ${question}]\n${answer}`);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!token) return;
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(`${file.name} is too large — the limit is ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`);
      return;
    }
    try {
      // FileReader converts in native code — the old per-byte string loop
      // stalled low-end phones for seconds on a large PDF.
      const base64 = await fileToBase64(file);
      await processFileResource({ token, fileName: file.name, fileType: file.type, fileDataBase64: base64 });
      toast.success(`Added: ${file.name}`);
    } catch (err) { toast.error(errMsg(err, "Failed")); }
    finally { if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const activeConvTitle = activeConvId && conversations
    ? (conversations.find(c => c._id === activeConvId)?.title ?? modeInfo.mobileLabel)
    : modeInfo.mobileLabel;

  const allMessages = messages ?? [];
  const visibleMessages = (() => {
    if (!inFlightUserContent || (!isThinking && streamingContent === null)) return allMessages;
    const currentTurnIndex = [...allMessages].reverse().findIndex(m => m.role === "user" && m.content === inFlightUserContent);
    if (currentTurnIndex === -1) return allMessages;
    const userIndex = allMessages.length - 1 - currentTurnIndex;
    return allMessages.filter((m, index) => index <= userIndex || m.role !== "assistant");
  })();
  const completedStreamQuestion = mode === "study" && completedStreamContent
    ? extractStudyQuestionPrompts(completedStreamContent, "completed-stream")[0] ?? null
    : null;
  const pendingStudyQuestion = mode === "study"
    ? completedStreamQuestion ??
      findPendingStudyQuestion(visibleMessages, studyTask.task, isThinking || streamingContent !== null)
    : null;
  const showMessages = activeConvId && allMessages.length > 0;

  return (
    <StudyTaskProvider value={{
      completeItem: studyTask.completeItem,
      gradeAnswer: mode === "study" ? handleGradeAnswer : undefined,
      xp: gamification.xp,
      level: gamification.level,
      levelProgress: gamification.levelProgress,
      streak: gamification.streak,
      bestStreak: gamification.bestStreak,
      stars: gamification.stars,
      correctCount: gamification.correctCount,
      wrongCount: gamification.wrongCount,
      report: gamification.report,
      resetProgress: gamification.reset,
    }}>
    <div className="flex flex-col h-full bg-background">
      {/* Top bar */}
      <div className="shrink-0 flex items-center gap-2 px-3 border-b border-border/50 bg-card/80 backdrop-blur-sm" style={{ paddingTop: "max(12px, env(safe-area-inset-top))", paddingBottom: "10px" }}>
        <button
          aria-label="Back"
          onClick={onBack}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-muted/50 active:bg-muted transition-colors"
        >
          <ArrowLeft className="h-5 w-5 text-foreground" />
        </button>
        <div className={`w-8 h-8 rounded-full ${modeInfo.bg} flex items-center justify-center text-base shrink-0`}>
          {modeInfo.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-foreground leading-tight truncate">{activeConvTitle}</p>
          <p className={`text-[11px] ${modeInfo.mobileColor} leading-tight`}>{modeInfo.mobileLabel} · Thalamus AI</p>
        </div>
        <button
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          onClick={toggleTheme}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-muted/50 transition-colors"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4 text-muted-foreground" /> : <Moon className="h-4 w-4 text-muted-foreground" />}
        </button>
        <button
          aria-label="Open sessions"
          onClick={() => setShowConvList(true)}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-muted/50 transition-colors"
        >
          <Settings className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto min-h-0 px-3 py-3 space-y-3">
        {(thinkingContent || isThinking) && (
          <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-sm rounded-xl">
            <ThinkingPanel
              content={thinkingContent}
              active={isThinking && streamingContent === null}
            />
          </div>
        )}
        {!activeConvId ? (
          // Empty state — prompt to start
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center h-full gap-6 pb-16">
            <div className={`w-20 h-20 rounded-3xl ${modeInfo.bg} border border-border flex items-center justify-center text-4xl`}>
              {modeInfo.emoji}
            </div>
            <div className="text-center px-4">
              <h2 className={`text-xl font-bold ${modeInfo.mobileColor} mb-1`}>{modeInfo.mobileLabel} Mode</h2>
              <p className="text-[14px] text-muted-foreground leading-relaxed">{modeInfo.mobileDesc}</p>
            </div>
            {/* Recent conversations */}
            {filteredConvs.length > 0 && (
              <div className="w-full space-y-2">
                <p className="text-[11px] text-muted-foreground font-semibold text-center tracking-widest">RECENT</p>
                {filteredConvs.slice(0, 3).map((conv: Conversation) => (
                  <motion.button key={conv._id} whileTap={{ scale: 0.98 }}
                    onClick={() => handleSelectConversation(conv)}
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
            {visibleMessages.map((msg: Message) => (
              <MobileMessageBubble
                key={msg._id}
                msg={msg}
                modeInfo={modeInfo}
                onStudyAnswer={mode === "study" ? handleStudyAnswer : undefined}
                studyQuestionsInComposer={mode === "study" && pendingStudyQuestion !== null}
              />
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
                    <div className="prose-html text-[13px]" dangerouslySetInnerHTML={{ __html: sanitizeAiHtml(streamingContent.startsWith("<") ? streamingContent : streamingContent.replace(/\n/g, "<br/>")) }} />
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
                    <span className={`text-[11px] ${modeInfo.mobileColor} font-medium ml-1`}>
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
        {sponsoredAd && !isThinking && (
          <div className="px-3 pb-2"><SponsoredAdCard ad={sponsoredAd} /></div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="shrink-0 px-3 py-2 bg-card/80 backdrop-blur-sm border-t border-border/50" style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
        {mode === "study" && (gamification.xp > 0 || !!studyTask.task) && (
          <div className="mb-2">
            <StudyScoreBar
              xp={gamification.xp}
              level={gamification.level}
              levelProgress={gamification.levelProgress}
              streak={gamification.streak}
              stars={gamification.stars}
              bestStreak={gamification.bestStreak}
              task={studyTask.task ? { completed: studyTask.task.completed, total: studyTask.task.total } : null}
            />
          </div>
        )}
        {mode === "study" && !pendingStudyQuestion && (
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
        {pendingStudyQuestion ? (
          <StudyComposerQuestion
            key={`${pendingStudyQuestion.itemId ?? "question"}:${pendingStudyQuestion.question}`}
            prompt={pendingStudyQuestion}
            onAnswer={handleStudyAnswer}
          />
        ) : (
          <div className="flex items-end gap-2">
            <div className="flex-1 flex items-end bg-background border border-border/60 rounded-[22px] overflow-hidden min-h-[44px]">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder={
                  studyLocked ? "Complete the activity above..." :
                  mode === "study" ? "Ask a study question..." :
                  mode === "research" ? "Research a topic..." :
                  mode === "code" ? "Describe what to build..." :
                  "Message Thalamus AI..."
                }
                rows={1}
                className="flex-1 bg-transparent px-4 py-3 text-[15px] text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none leading-relaxed disabled:opacity-60"
                style={{ maxHeight: "120px" }}
                disabled={studyLocked || isThinking}
              />
            </div>
            <motion.button
              aria-label="Send message"
              onClick={handleSend}
              disabled={!input.trim() || isThinking || studyLocked}
              whileTap={{ scale: 0.92 }}
              className="w-11 h-11 rounded-full bg-primary flex items-center justify-center shrink-0 disabled:opacity-40 transition-opacity shadow-sm shadow-primary/30"
            >
              {isThinking ? <Loader2 className="h-5 w-5 text-primary-foreground animate-spin" /> : <Send className="h-4.5 w-4.5 text-primary-foreground" />}
            </motion.button>
          </div>
        )}
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
                <p className="text-[15px] font-bold text-foreground">{modeInfo.mobileLabel} Sessions</p>
                <button onClick={handleNewConversation}
                  className="flex items-center gap-1.5 text-[13px] text-primary font-semibold">
                  <Plus className="h-4 w-4" />New
                </button>
              </div>
              <div className="flex-1 overflow-auto px-3 py-2 space-y-1">
                {filteredConvs.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-[14px] text-muted-foreground">No sessions yet</p>
                    <button onClick={handleNewConversation} className={`mt-2 text-[13px] ${modeInfo.mobileColor} font-semibold`}>Start one →</button>
                  </div>
                ) : filteredConvs.map((conv: Conversation) => (
                  <motion.button key={conv._id} whileTap={{ scale: 0.98 }}
                    onClick={() => handleSelectConversation(conv)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-colors text-left ${activeConvId === conv._id ? `${modeInfo.bg} border border-border` : "hover:bg-muted/40 active:bg-muted/60"}`}
                  >
                    <div className={`w-9 h-9 rounded-full ${modeInfo.bg} flex items-center justify-center text-base shrink-0`}>{modeInfo.emoji}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-foreground truncate">{conv.title}</p>
                    </div>
                    {/* Deletion is permanent — confirm before firing. */}
                    <button
                      aria-label={`Delete conversation ${conv.title}`}
                      onClick={async (e) => { e.stopPropagation(); if (!confirm(`Delete conversation "${conv.title}"? This can't be undone.`)) return; try { await deleteConversation({ id: conv._id, token }); if (activeConvId === conv._id) setActiveConvId(null); } catch { toast.error("Failed"); } }}
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

      {/* Gamified study-task celebration */}
      <StudyCelebration
        open={celebration}
        xp={gamification.xp}
        stars={gamification.stars}
        streak={gamification.streak}
        bestStreak={gamification.bestStreak}
        onClose={() => setCelebration(false)}
        onPlayAgain={() => {
          setCelebration(false);
          gamification.reset();
          void handleNewConversation();
        }}
      />
    </div>
    </StudyTaskProvider>
  );
}
