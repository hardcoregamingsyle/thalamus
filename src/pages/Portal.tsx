import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { useQuery, useMutation, useAction } from "convex/react";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  MessageSquare,
  Search,
  Code2,
  Plus,
  Trash2,
  LogOut,
  Terminal,
  Send,
  ChevronRight,
  Loader2,
  DollarSign,
  Menu,
  X,
  Users,
  Database,
  FileText,
  Zap,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";

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

const MODES: { id: Mode; label: string; icon: typeof MessageSquare; desc: string; prompt: string }[] = [
  { id: "chat", label: "CHAT", icon: MessageSquare, desc: "General conversation", prompt: "> chat_mode --active" },
  { id: "research", label: "RESEARCH", icon: Search, desc: "Deep research & analysis", prompt: "> research_mode --active" },
  { id: "code", label: "CODE", icon: Code2, desc: "Vibe coding assistant", prompt: "> code_mode --active" },
];

export default function Portal() {
  const { isLoading, isAuthenticated, user, signOut, token } = useAuth();
  const navigate = useNavigate();
  const [activeMode, setActiveMode] = useState<Mode>("chat");
  const [activeConvId, setActiveConvId] = useState<Id<"conversations"> | null>(null);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showKnowledgeBase, setShowKnowledgeBase] = useState(false);

  // RAG actions
  const ragAddDocument = useAction(api.agentTeam.ragAddDocument);
  const ragRunIndex = useAction(api.agentTeam.ragRunIndex);
  const ragQueryVector = useAction(api.agentTeam.ragQueryVector);

  // RAG state
  const [ragDocId, setRagDocId] = useState("");
  const [ragDocText, setRagDocText] = useState("");
  const [ragQuery, setRagQuery] = useState("");
  const [ragResults, setRagResults] = useState<unknown>(null);
  const [ragLoading, setRagLoading] = useState(false);
  const [ragIndexing, setRagIndexing] = useState(false);

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
    if (!isLoading && !isAuthenticated) {
      navigate("/auth");
    }
  }, [isLoading, isAuthenticated, navigate]);

  useEffect(() => {
    const el = document.getElementById("messages-end");
    el?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
        convId = await createConversation({
          title: input.slice(0, 40),
          mode: activeMode,
          token,
        });
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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleRagAddDoc = async () => {
    if (!ragDocId.trim() || !ragDocText.trim() || !token) return;
    setRagLoading(true);
    try {
      const result = await ragAddDocument({ id: ragDocId.trim(), text: ragDocText.trim(), token });
      toast.success("Document added to knowledge base");
      setRagDocId("");
      setRagDocText("");
      console.log("RAG add result:", result);
    } catch (err) {
      toast.error(`Failed to add document: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRagLoading(false);
    }
  };

  const handleRagIndex = async () => {
    if (!token) return;
    setRagIndexing(true);
    try {
      const result = await ragRunIndex({ token });
      toast.success("GraphRAG indexing triggered successfully");
      console.log("RAG index result:", result);
    } catch (err) {
      toast.error(`Indexing failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRagIndexing(false);
    }
  };

  const handleRagQuery = async () => {
    if (!ragQuery.trim() || !token) return;
    setRagLoading(true);
    try {
      const result = await ragQueryVector({ query: ragQuery.trim(), nResults: 3, token });
      setRagResults(result);
    } catch (err) {
      toast.error(`Query failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRagLoading(false);
    }
  };

  const usageDollars = (((user as { totalUsageCents?: number } | null)?.totalUsageCents || 0) / 100).toFixed(4);
  const filteredConvs = conversations?.filter((c: Conversation) => c.mode === activeMode) || [];

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-primary font-mono text-sm terminal-glow">
          <span className="terminal-cursor">INITIALIZING AGENT_AI</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background font-mono">
      {/* Header */}
      <header className="border-b border-border bg-card flex items-center justify-between px-4 h-12 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-muted-foreground hover:text-primary transition-colors"
          >
            {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <Terminal className="h-4 w-4 text-primary" />
          <span className="text-primary font-bold text-sm terminal-glow tracking-widest">AGENT_AI</span>
          <span className="text-muted-foreground text-xs hidden sm:block">v2.0.1</span>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-1">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => { setActiveMode(m.id); setActiveConvId(null); setShowKnowledgeBase(false); }}
                className={`px-3 py-1 text-xs border transition-all ${
                  activeMode === m.id && !showKnowledgeBase
                    ? "border-primary text-primary bg-primary/10 terminal-glow"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:text-primary/70"
                }`}
              >
                {m.label}
              </button>
            ))}
            <button
              onClick={() => setShowKnowledgeBase(!showKnowledgeBase)}
              className={`px-3 py-1 text-xs border transition-all flex items-center gap-1 ${
                showKnowledgeBase
                  ? "border-amber-400 text-amber-400 bg-amber-400/10"
                  : "border-border text-muted-foreground hover:border-amber-400/50 hover:text-amber-400/70"
              }`}
            >
              <Database className="h-3 w-3" />
              RAG
            </button>
          </div>

          <div className="flex items-center gap-1 text-xs border border-border px-2 py-1">
            <DollarSign className="h-3 w-3 text-amber-400" />
            <span className="text-amber-400 font-mono">{usageDollars}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/team")}
              className="flex items-center gap-1 text-xs border border-border text-muted-foreground px-2 py-1 hover:border-primary hover:text-primary transition-all"
              title="Agent Team"
            >
              <Users className="h-3 w-3" />
              <span className="hidden sm:block">TEAM</span>
            </button>
            <span className="text-xs text-muted-foreground hidden sm:block truncate max-w-[120px]">
              {user?.email || "guest"}
            </span>
            <button
              onClick={() => signOut()}
              className="text-muted-foreground hover:text-destructive transition-colors"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <AnimatePresence>
          {sidebarOpen && !showKnowledgeBase && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 220, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-r border-border bg-card flex flex-col overflow-hidden shrink-0"
            >
              <div className="md:hidden flex flex-col border-b border-border">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { setActiveMode(m.id); setActiveConvId(null); }}
                    className={`flex items-center gap-2 px-3 py-2 text-xs transition-all ${
                      activeMode === m.id
                        ? "text-primary bg-primary/10"
                        : "text-muted-foreground hover:text-primary/70"
                    }`}
                  >
                    <m.icon className="h-3 w-3" />
                    {m.label}
                  </button>
                ))}
              </div>

              <div className="p-2 border-b border-border">
                <button
                  onClick={handleNewConversation}
                  className="w-full flex items-center gap-2 px-2 py-2 text-xs border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-all"
                >
                  <Plus className="h-3 w-3" />
                  NEW_SESSION
                </button>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-2 space-y-1">
                  {filteredConvs.length === 0 && (
                    <p className="text-xs text-muted-foreground px-2 py-4 text-center">
                      NO_SESSIONS_FOUND
                    </p>
                  )}
                  {filteredConvs.map((conv: Conversation) => (
                    <div
                      key={conv._id}
                      className={`group flex items-center gap-1 px-2 py-1.5 cursor-pointer transition-all ${
                        activeConvId === conv._id
                          ? "bg-primary/10 text-primary border-l-2 border-primary"
                          : "text-muted-foreground hover:text-primary/70 hover:bg-accent border-l-2 border-transparent"
                      }`}
                      onClick={() => setActiveConvId(conv._id)}
                    >
                      <ChevronRight className="h-3 w-3 shrink-0" />
                      <span className="text-xs truncate flex-1">{conv.title}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteConversation({ id: conv._id, token: token || undefined });
                          if (activeConvId === conv._id) setActiveConvId(null);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              <div className="p-3 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  {MODES.find((m) => m.id === activeMode)?.prompt}
                </p>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Main area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {showKnowledgeBase ? (
            <KnowledgeBasePanel
              ragDocId={ragDocId}
              setRagDocId={setRagDocId}
              ragDocText={ragDocText}
              setRagDocText={setRagDocText}
              ragQuery={ragQuery}
              setRagQuery={setRagQuery}
              ragResults={ragResults}
              ragLoading={ragLoading}
              ragIndexing={ragIndexing}
              onAddDoc={handleRagAddDoc}
              onRunIndex={handleRagIndex}
              onQuery={handleRagQuery}
            />
          ) : (
            <>
              <ScrollArea className="flex-1 p-4">
                {!activeConvId || !messages || messages.length === 0 ? (
                  <WelcomeScreen mode={activeMode} />
                ) : (
                  <div className="max-w-4xl mx-auto space-y-4">
                    {messages.map((msg: Message, i: number) => (
                      <motion.div
                        key={msg._id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.02 }}
                        className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        {msg.role === "assistant" && (
                          <div className="shrink-0 w-6 h-6 border border-primary flex items-center justify-center text-primary text-xs terminal-glow">
                            A
                          </div>
                        )}
                        <div
                          className={`max-w-[80%] text-xs leading-relaxed ${
                            msg.role === "user"
                              ? "bg-primary/10 border border-primary/30 text-primary px-3 py-2"
                              : "text-foreground"
                          }`}
                        >
                          {msg.role === "user" ? (
                            <span className="font-mono">{msg.content}</span>
                          ) : (
                            <div className="prose prose-invert prose-sm max-w-none font-mono prose-code:text-primary prose-pre:bg-card prose-pre:border prose-pre:border-border">
                              <ReactMarkdown>{msg.content}</ReactMarkdown>
                            </div>
                          )}
                        </div>
                        {msg.role === "user" && (
                          <div className="shrink-0 w-6 h-6 border border-muted-foreground flex items-center justify-center text-muted-foreground text-xs">
                            U
                          </div>
                        )}
                      </motion.div>
                    ))}
                    {isThinking && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex gap-3 items-center"
                      >
                        <div className="w-6 h-6 border border-primary flex items-center justify-center text-primary text-xs terminal-glow">
                          A
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin text-primary" />
                          <span className="terminal-cursor">PROCESSING</span>
                        </div>
                      </motion.div>
                    )}
                    <div id="messages-end" />
                  </div>
                )}
              </ScrollArea>

              <div className="border-t border-border p-4 bg-card">
                <div className="max-w-4xl mx-auto">
                  <div className="flex items-end gap-2 border border-border bg-background focus-within:border-primary transition-colors">
                    <span className="text-primary text-xs px-3 py-3 shrink-0 terminal-glow">
                      {activeMode === "chat" ? ">" : activeMode === "research" ? "?>" : "$>"}
                    </span>
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={`Enter ${activeMode} query... (Enter to send, Shift+Enter for newline)`}
                      className="flex-1 bg-transparent text-foreground text-xs font-mono resize-none outline-none py-3 pr-2 placeholder:text-muted-foreground min-h-[44px] max-h-[200px]"
                      rows={1}
                      disabled={isThinking}
                    />
                    <button
                      onClick={handleSend}
                      disabled={!input.trim() || isThinking}
                      className="px-3 py-3 text-primary hover:text-primary/80 disabled:text-muted-foreground transition-colors shrink-0"
                    >
                      {isThinking ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 text-right">
                    AGENT_AI • {activeMode.toUpperCase()} MODE • CLAUDE 3.5 SONNET
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Knowledge Base Panel Component
interface KnowledgeBasePanelProps {
  ragDocId: string;
  setRagDocId: (v: string) => void;
  ragDocText: string;
  setRagDocText: (v: string) => void;
  ragQuery: string;
  setRagQuery: (v: string) => void;
  ragResults: unknown;
  ragLoading: boolean;
  ragIndexing: boolean;
  onAddDoc: () => void;
  onRunIndex: () => void;
  onQuery: () => void;
}

function KnowledgeBasePanel({
  ragDocId, setRagDocId, ragDocText, setRagDocText,
  ragQuery, setRagQuery, ragResults, ragLoading, ragIndexing,
  onAddDoc, onRunIndex, onQuery,
}: KnowledgeBasePanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex-1 overflow-auto p-6"
    >
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="border border-amber-400/30 bg-amber-400/5 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Database className="h-4 w-4 text-amber-400" />
            <span className="text-amber-400 font-bold text-sm">KNOWLEDGE_BASE</span>
          </div>
          <p className="text-xs text-muted-foreground">
            ChromaDB vector store + GraphRAG knowledge graph at{" "}
            <span className="text-amber-400/70 font-mono text-xs">leadshello-graph-rag-and-chroma-db.hf.space</span>
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Add Document */}
          <div className="border border-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <FileText className="h-3 w-3 text-primary" />
              <span className="text-xs text-primary font-bold">ADD_DOCUMENT</span>
            </div>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">// document_id</label>
                <input
                  value={ragDocId}
                  onChange={(e) => setRagDocId(e.target.value)}
                  placeholder="doc_001"
                  className="w-full bg-background border border-border text-foreground text-xs font-mono px-2 py-1.5 outline-none focus:border-primary transition-colors"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">// document_text</label>
                <textarea
                  value={ragDocText}
                  onChange={(e) => setRagDocText(e.target.value)}
                  placeholder="Enter document content to add to the knowledge base..."
                  rows={5}
                  className="w-full bg-background border border-border text-foreground text-xs font-mono px-2 py-1.5 outline-none focus:border-primary transition-colors resize-none"
                />
              </div>
              <button
                onClick={onAddDoc}
                disabled={ragLoading || !ragDocId.trim() || !ragDocText.trim()}
                className="w-full flex items-center justify-center gap-2 py-2 text-xs border border-primary text-primary hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {ragLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                ADD TO KNOWLEDGE BASE
              </button>
            </div>
          </div>

          {/* GraphRAG Index + Query */}
          <div className="space-y-4">
            {/* Trigger Indexing */}
            <div className="border border-border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2 border-b border-border pb-2">
                <Zap className="h-3 w-3 text-amber-400" />
                <span className="text-xs text-amber-400 font-bold">GRAPHRAG_INDEX</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Trigger entity extraction and knowledge graph building from all added documents.
              </p>
              <button
                onClick={onRunIndex}
                disabled={ragIndexing}
                className="w-full flex items-center justify-center gap-2 py-2 text-xs border border-amber-400/50 text-amber-400 hover:bg-amber-400/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {ragIndexing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                {ragIndexing ? "INDEXING..." : "RUN GRAPHRAG INDEX"}
              </button>
            </div>

            {/* Vector Query */}
            <div className="border border-border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2 border-b border-border pb-2">
                <Search className="h-3 w-3 text-primary" />
                <span className="text-xs text-primary font-bold">VECTOR_SEARCH</span>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">// search_query</label>
                <div className="flex gap-2">
                  <input
                    value={ragQuery}
                    onChange={(e) => setRagQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && onQuery()}
                    placeholder="Search knowledge base..."
                    className="flex-1 bg-background border border-border text-foreground text-xs font-mono px-2 py-1.5 outline-none focus:border-primary transition-colors"
                  />
                  <button
                    onClick={onQuery}
                    disabled={ragLoading || !ragQuery.trim()}
                    className="px-3 py-1.5 text-xs border border-primary text-primary hover:bg-primary/10 disabled:opacity-50 transition-all"
                  >
                    {ragLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Results */}
        {ragResults !== null && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="border border-border bg-card p-4"
          >
            <div className="flex items-center gap-2 border-b border-border pb-2 mb-3">
              <Search className="h-3 w-3 text-primary" />
              <span className="text-xs text-primary font-bold">SEARCH_RESULTS</span>
            </div>
            <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-all overflow-auto max-h-96">
              {JSON.stringify(ragResults, null, 2)}
            </pre>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

function WelcomeScreen({ mode }: { mode: Mode }) {
  const modeInfo = {
    chat: {
      title: "CHAT_MODE",
      desc: "General purpose AI conversation",
      commands: ["ask me anything", "explain a concept", "help me think through a problem", "creative writing"],
    },
    research: {
      title: "RESEARCH_MODE",
      desc: "Deep research and comprehensive analysis",
      commands: ["research [topic] in depth", "compare [A] vs [B]", "analyze trends in [field]", "summarize [subject]"],
    },
    code: {
      title: "CODE_MODE",
      desc: "Vibe coding — build anything with AI",
      commands: ["build a [component/feature]", "debug this code: [paste code]", "refactor [code] to be cleaner", "explain how [algorithm] works"],
    },
  };

  const info = modeInfo[mode];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto py-16 px-4"
    >
      <div className="border border-border p-6 bg-card">
        <div className="flex items-center gap-2 mb-4">
          <Terminal className="h-4 w-4 text-primary" />
          <span className="text-primary text-sm font-bold terminal-glow">{info.title}</span>
        </div>
        <p className="text-muted-foreground text-xs mb-6">{info.desc}</p>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground mb-3">// EXAMPLE COMMANDS:</p>
          {info.commands.map((cmd, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="text-primary">$</span>
              <span>{cmd}</span>
            </div>
          ))}
        </div>
        <div className="mt-6 pt-4 border-t border-border">
          <p className="text-xs text-muted-foreground terminal-cursor">TYPE YOUR FIRST MESSAGE TO BEGIN</p>
        </div>
      </div>
    </motion.div>
  );
}