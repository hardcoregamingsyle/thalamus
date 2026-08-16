// Authenticated desktop portal view. Owns the sidebar / conversation list,
// header controls, the streaming chat area, the study resources panel, and
// the ad rail. Rendered by the Portal dispatcher when the user is signed in
// and the viewport is not mobile.

import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useAction } from "convex/react";
import { toast } from "sonner";
import {
  BookOpen, FileText, Globe, Hash, Image, Lightbulb,
  Loader2, Lock, LogOut, Menu, Moon, Plus,
  Send, Sparkles, Sun, Trash2, Upload,
  X, Zap, GraduationCap,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import CreditModal from "@/components/CreditModal";
import OnboardingModal from "@/components/OnboardingModal";
import StudyProfileModal from "@/components/StudyProfileModal";
import StudentSuite from "@/components/StudentSuite";
import ThinkingPanel from "@/components/ThinkingPanel";
import SuggestionFormModal, { type SuggestionFile } from "@/components/SuggestionFormModal";
import ChatMessageBubble from "@/components/ChatMessageBubble";
import StreamingBubble from "@/components/StreamingBubble";
import { SponsoredAdCard, type GravityAd } from "@/components/SponsoredAdCard";
import { fetchSponsoredAd } from "@/lib/requestAd";
import { getSessionToken } from "@/lib/session";
import { errMsg } from "@/lib/errorMessage";
import { convexSiteUrl } from "@/lib/convexUrls";
import { isProbablyTextFile, fileToBase64, MAX_UPLOAD_BYTES } from "@/lib/fileEncoding";
import ModeSelection from "./ModeSelection";
import { MODES, MORE_MODES, VALID_MODES, type Mode } from "./modes";
import {
  GUEST_STORAGE_KEY,
  type GuestSession,
} from "./guestSession";
import { chatStreamSystemPrompts } from "@/content/systemPrompts";
import type { Conversation, Message } from "./types";

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

export default function PortalDesktop() {
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
  // Tracks whether the user has explicitly toggled the sidebar; once they
  // have, resizes stop overriding their choice.
  const userToggledSidebarRef = useRef(false);
  const [moreModesOpen, setMoreModesOpen] = useState(false);
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ensureDailyBalance = useMutation(api.customAuthHelpers.ensureDailyBalance);
  const completeOnboarding = useMutation(api.users.completeOnboarding);
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    if (token && user !== undefined && user !== null && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      ensureDailyBalance({ token }).catch(() => {});
      // One honest cast for the extra fields useAuth's user carries here —
      // this used to be two shadowed `typedUser` declarations in nested scopes.
      const typedUser = user as { referralSpins?: number; referredBy?: string; hasOnboarded?: boolean };
      const notifKey = `spin_notif_shown_${token.slice(0, 8)}`;
      if (!localStorage.getItem(notifKey)) {
        if (typedUser.referralSpins && typedUser.referralSpins > 0 && typedUser.referredBy) {
          localStorage.setItem(notifKey, "1");
          setTimeout(() => setSpinNotifOpen(true), 1500);
        }
      }
      // Show onboarding if user hasn't completed it
      if (!typedUser.hasOnboarded) {
        setTimeout(() => setShowOnboarding(true), 600);
      }
    }
  }, [token, user, ensureDailyBalance]);

  // Keep the sidebar in step with viewport changes: it was pinned to the
  // width measured at mount, so a window opened narrow (sidebar closed) and
  // then maximised had no visible way to open it on desktop. An explicit
  // user toggle wins over any later resize.
  useEffect(() => {
    const onResize = () => {
      if (!userToggledSidebarRef.current) setSidebarOpen(window.innerWidth >= 768);
    };
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Track user activity for the ad-refresh cadence. Passive listeners, ref
  // writes only — zero re-renders.
  useEffect(() => {
    // One rail slot, on wide screens only. Never a stack.
    //
    // This used to climb to five. Gravity's brand-safety rules name "stacking
    // multiple ads" as a viewability violation outright, and a column of five
    // cards next to a chat is the textbook example — a reviewer looking at
    // this account would read it as impression farming, which is the one thing
    // you cannot afford while approval is still pending. It also would not
    // have earned: a rail nobody looks at drags viewability and CTR down, and
    // eCPM with them. The card under the reply is the placement Gravity's
    // whole product is about; the rail is a bonus, not a wall.
    //
    // The threshold must stay at or above 1280 (the rail's `hidden xl:flex`
    // visibility floor); 1536 is intentionally stricter so the rail only
    // appears when there is comfortable horizontal room next to the chat.
    const calc = () => setRailCount(window.innerWidth >= 1536 ? 1 : 0);
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

  // Ads only ever fired from the tail of a completed send, so opening an
  // existing conversation — or flipping the admin switch and reloading — showed
  // nothing until you typed a brand-new message. Request once per conversation
  // as soon as there's history to match on. Same latch and adContextRef the send
  // path and the refresh cadence use, so this adds an entry point, not a second
  // stream of requests.
  useEffect(() => {
    if (!activeConvId || !token || adRequestedRef.current) return;
    if (!messages || messages.length === 0) return;
    const adMessages = messages.slice(-6).map(m => ({ role: m.role, content: (m.content ?? "").slice(0, 1000) }));
    adRequestedRef.current = true;
    adContextRef.current = { messages: adMessages, sessionId: activeConvId };
    fetchSponsoredAd({ token, messages: adMessages, sessionId: activeConvId, count: 1 + railCount })
      .then(ad => { if (ad) { applyAds(ad); lastAdRefreshRef.current = Date.now(); } })
      .catch(() => {});
  }, [activeConvId, messages, token, railCount]);

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
  //
  // The interval body reads fast-changing state (streaming chunks arrive many
  // times per second) through refs. With those values in the dependency array
  // the 15s timer was torn down and restarted on every chunk, so it could go
  // an entire long stream without ever firing.
  const adTickRef = useRef({ hasAd: false, promptRunning: false, railCount: 0 });
  useEffect(() => {
    adTickRef.current = {
      hasAd: !!sponsoredAd,
      promptRunning: isThinking || streamingContent !== null,
      railCount,
    };
  }, [sponsoredAd, isThinking, streamingContent, railCount]);
  useEffect(() => {
    const id = setInterval(() => {
      const tick = adTickRef.current;
      if (!tick.hasAd || !adContextRef.current) return; // nothing to refresh yet
      if (document.visibilityState !== "visible") return;
      const idleMs = Date.now() - lastActivityRef.current;
      let interval: number | null;
      if (tick.promptRunning) interval = idleMs < 60_000 ? 60_000 : 180_000;
      else interval = idleMs < 120_000 ? 90_000 : null;
      if (interval === null) return;
      if (Date.now() - lastAdRefreshRef.current < interval) return;
      // Mark the attempt up front so a no-fill response doesn't cause hammering.
      lastAdRefreshRef.current = Date.now();
      fetchSponsoredAd({
        token: getSessionToken() ?? undefined,
        messages: adContextRef.current.messages,
        sessionId: adContextRef.current.sessionId,
        count: 1 + tick.railCount,
      })
        .then(ad => { if (ad) applyAds(ad); })
        .catch(() => {});
    }, 15_000);
    return () => clearInterval(id);
  }, []);
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
      if (conv && conv._id !== activeConvId) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs conversation selection from the URL param once data loads; safe refactor not obvious since activeConvId is also set by user actions
        setActiveConvId(conv._id);
        // A URL-driven switch (e.g. browser Back) must clear in-flight chat UI
        // the same way handleSelectConversation does, or a ghost streaming
        // bubble from the previous conversation lingers on the new one.
        setStreamingContent(null);
        setThinkingContent("");
        setIsThinking(false);
        setInFlightUserContent(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activeConvId intentionally omitted: it's the value being synced, adding it would re-run the reset on every selection
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

  // Auto-grow the composer up to a max height.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [input]);

  // Stick to the newest message. High-frequency streaming updates use instant
  // (auto) scroll to avoid smooth-scroll jank; discrete message arrivals get a
  // gentle smooth scroll. Only auto-scroll when the user is already near the
  // bottom so they can scroll up to read without being yanked down.
  useEffect(() => {
    const end = messagesEndRef.current;
    if (!end) return;
    const container = end.closest(".overflow-auto") as HTMLElement | null;
    const nearBottom = container
      ? container.scrollHeight - container.scrollTop - container.clientHeight < 200
      : true;
    if (nearBottom) {
      end.scrollIntoView({ behavior: streamingContent !== null ? "auto" : "smooth", block: "end" });
    }
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
      toast.error(errMsg(err, "Failed to submit suggestion"));
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

    // Chat, research, and study use the streaming HTTP endpoint.
    const siteUrl = convexSiteUrl();

    const SYSTEM_PROMPTS = chatStreamSystemPrompts({ grade: studyGrade, board: studyBoard, language: studyLanguage });

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
          preferHighTier: true,
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
          await sendMessage({ conversationId: convId, content: msg, mode: activeMode as "chat" | "research" | "code" | "designing" | "strategising" | "creative-writing" | "marketing" | "idea-generation" | "naming", token, userContext, skipUserSave: userMessageSaved });
        }
      } catch (err) {
        console.error("Fallback action also failed:", err);
        toast.error(errMsg(err, "Failed to send message"));
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
        token: getSessionToken() ?? undefined,
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
      // Only text files can ride along as inline attachments. `file.text()` on
      // an image/PDF decodes binary as UTF-8 mojibake and used to be sent to
      // the model as if it were readable content.
      const processedFiles: AttachedFile[] = [];
      for (const file of files) {
        if (!isProbablyTextFile(file)) {
          toast.error(`${file.name || "Pasted file"} isn't a text file — use Study mode's upload for PDFs and images.`);
          continue;
        }
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
    } catch (err) { toast.error(errMsg(err, "Failed")); }
    finally { setIsAddingResource(false); }
  };

  const handleSearchResource = async () => {
    if (!token || !studySearchQuery.trim()) return;
    setIsAddingResource(true);
    try {
      const result = await searchAndAddResource({ token, query: studySearchQuery.trim() });
      toast.success(`Added: ${result.title}`);
      setStudySearchQuery(""); setStudyAddMode(null);
    } catch (err) { toast.error(errMsg(err, "Failed")); }
    finally { setIsAddingResource(false); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!token) return;
    const file = e.target.files?.[0];
    if (!file) return;
    setIsAddingResource(true);
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const isImage = file.type.startsWith("image/");
    if (isPdf) setUploadStatus("Reading your PDF — extracting text & images...");
    else if (isImage) setUploadStatus("Analyzing your image...");
    else setUploadStatus(`Processing ${file.name}...`);
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(`${file.name} is too large — the limit is ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`);
      setIsAddingResource(false); setUploadStatus(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    try {
      const base64 = await fileToBase64(file);
      await processFileResource({ token, fileName: file.name, fileType: file.type, fileDataBase64: base64 });
      if (isPdf) toast.success(`PDF processed: ${file.name}`);
      else if (isImage) toast.success(`Image analyzed: ${file.name}`);
      else toast.success(`Processed: ${file.name}`);
    } catch (err) { toast.error(errMsg(err, "Failed to process file")); }
    finally { setIsAddingResource(false); setUploadStatus(null); if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const typedUser = user as { dailyAgentBucks?: number; purchasedAgentBucks?: number; agentBucksBalance?: number } | null;
  const dailyAB = typedUser?.dailyAgentBucks ?? typedUser?.agentBucksBalance ?? 0;
  const purchasedAB = typedUser?.purchasedAgentBucks ?? 0;
  const totalAB = dailyAB + purchasedAB;

  const filteredConvs = conversations?.filter((c: Conversation) => c.mode === activeMode) || [];
  const currentMode = [...MODES, ...MORE_MODES].find(m => m.id === activeMode)!;
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
              <button
                aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
                onClick={() => { userToggledSidebarRef.current = true; setSidebarOpen(o => !o); }}
                className="text-muted-foreground hover:text-primary transition-colors p-1.5 rounded hover:bg-primary/10 md:hidden"
              >
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
              {/* More Modes dropdown */}
              <div className="relative">
                <button onClick={() => setMoreModesOpen(o => !o)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-bold transition-all ${MORE_MODES.some(m => m.id === activeMode) ? "border border-purple-400/30 bg-purple-400/15 text-purple-400" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
                >
                  <Zap className="h-3 w-3" />
                  MORE MODES
                </button>
                {moreModesOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMoreModesOpen(false)} />
                    <div className="absolute left-0 top-full mt-1 z-50 w-[200px] bg-card border border-border rounded-lg shadow-xl overflow-hidden">
                      {MORE_MODES.map(mode => {
                        const isActive = activeMode === mode.id;
                        return (
                          <button key={mode.id} onClick={() => { setActiveMode(mode.id); setMoreModesOpen(false); }}
                            className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-[11px] font-bold transition-all text-left ${isActive ? `${mode.accent} border-l-2 ${mode.color}` : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
                          >
                            <mode.icon className={`h-3.5 w-3.5 shrink-0 ${isActive ? mode.color : ""}`} />
                            <div className="flex-1 min-w-0">
                              <div className="truncate">{mode.label}</div>
                              <div className="text-[9px] opacity-60 font-normal">{mode.desc} · ADHD {mode.adhd}/5</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
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
            <button
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              onClick={toggleTheme}
              className="text-muted-foreground hover:text-primary transition-colors p-1.5 rounded hover:bg-primary/10"
              title="Toggle theme"
            >
              {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
            <button
              aria-label="Sign out"
              onClick={signOut}
              className="text-muted-foreground hover:text-primary transition-colors p-1.5 rounded hover:bg-primary/10"
            >
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
                {/* Mobile More Modes */}
                <div className="pt-1 mt-1 border-t border-border/50">
                  <div className="text-[9px] text-muted-foreground/60 font-bold px-3 pb-1 uppercase tracking-wider">More Modes</div>
                  {MORE_MODES.map(mode => (
                    <button key={mode.id} onClick={() => { setActiveMode(mode.id); setSidebarOpen(typeof window !== "undefined" ? window.innerWidth >= 768 : true); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded text-xs transition-all ${activeMode === mode.id ? `${mode.accent} border ${mode.color}` : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
                    >
                      <mode.icon className={`h-3.5 w-3.5 ${activeMode === mode.id ? mode.color : ""}`} />
                      <span className="font-bold">{mode.label}</span>
                      <span className="text-[10px] opacity-60 ml-auto">{mode.desc} · ADHD {mode.adhd}/5</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Sessions header */}
              <div className="shrink-0 px-3 pt-3 pb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <currentMode.icon className={`h-3 w-3 ${currentMode.color}`} />
                  <span className="text-[10px] text-muted-foreground font-bold">SESSIONS</span>
                </div>
                <button
                  aria-label="New session"
                  onClick={handleNewConversation}
                  className="w-5 h-5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary transition-all flex items-center justify-center"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>

              {/* Conversations list */}
              <div className="flex-1 overflow-auto min-h-0">
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
                        {/* Deletion is permanent and the trash icon sits on a clickable row —
                            confirm so a mis-click can't destroy a conversation. */}
                        <button
                          aria-label={`Delete conversation ${conv.title}`}
                          onClick={async (e) => { e.stopPropagation(); if (!token) return; if (!confirm(`Delete conversation "${conv.title}"? This can't be undone.`)) return; try { await deleteConversation({ id: conv._id, token }); if (activeConvId === conv._id) { setActiveConvId(null); navigate(`/portal/${activeMode}`); } } catch { toast.error("Failed to delete"); } }}
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
              <div className="flex-1 overflow-auto min-h-0">
                <div className="p-4 space-y-4 max-w-4xl mx-auto">
                  {(thinkingContent || isThinking) && (
                    <div className="sticky top-2 z-10">
                      <ThinkingPanel
                        content={thinkingContent}
                        active={isThinking && streamingContent === null}
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
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                      className="flex justify-start"
                    >
                      <div className="max-w-[82%] rounded-2xl px-4 py-3 text-xs leading-relaxed bg-card border border-border/60 text-foreground shadow-sm">
                        <StreamingBubble content={streamingContent} />
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
              {/* railCount > 0 gate matters: between 1280px (xl, where the aside
                  becomes visible) and 1536px (where railCount turns 1) the old
                  condition rendered an empty bordered column with no cards.
                  Index keys — ads at a rail position are interchangeable slots;
                  keying by impUrl remounted every card on each ad refresh. */}
              {railAds.length > 0 && railCount > 0 && activeConvId && (
                <aside className="hidden xl:flex flex-col gap-3 w-64 shrink-0 p-4 overflow-auto border-l border-border/40">
                  {railAds.slice(0, railCount).map((ad, i) => (
                    <SponsoredAdCard key={i} ad={ad} rail />
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
                        <button
                          aria-label={`Remove attachment ${f.name}`}
                          onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))}
                          className="ml-0.5 hover:text-destructive transition-colors"
                        >
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
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder={activeMode === "study" ? "Ask a study question — live web search enabled..." : activeMode === "research" ? "Research topic or question..." : "Type a message..."}
                    rows={1}
                    className="flex-1 bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 transition-all"
                    style={{ minHeight: "38px", maxHeight: "140px" }}
                  />
                  <motion.button
                    aria-label="Send message"
                    onClick={handleSend}
                    whileTap={{ scale: 0.94 }}
                    disabled={(!input.trim() && attachedFiles.length === 0) || isThinking}
                    className={`px-3.5 py-2 rounded-xl disabled:opacity-50 transition-all shrink-0 flex items-center gap-1.5 ${activeMode === "study" ? "bg-indigo-500 text-white hover:bg-indigo-500/90" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
                  >
                    {isThinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </motion.button>
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
                    <button
                      aria-label="Close resources panel"
                      onClick={() => setStudyResourcesOpen(false)}
                      className="text-muted-foreground hover:text-foreground p-1"
                    >
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
                  <div className="flex-1 overflow-auto min-h-0 p-2 space-y-1.5">
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
                            <button
                              aria-label={`Delete resource ${resource.title}`}
                              onClick={async () => { if (!token) return; try { await deleteResource({ token, resourceId: resource._id }); toast.success("Deleted"); } catch { toast.error("Failed"); } }}
                              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0"
                            >
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
