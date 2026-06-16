import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Loader2, ChevronLeft, ChevronRight,
  CheckCircle, XCircle, Zap, Trophy, BookOpen, ClipboardList, Gamepad2,
  Star, Clock, Target, ArrowRight, RefreshCw,
  CalendarDays, GitBranch, MessageCircleQuestion, Shuffle, TriangleAlert,
} from "lucide-react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";

interface Flashcard {
  front: string;
  back: string;
  topic: string;
}

interface MockQuestion {
  id: number;
  type: "mcq" | "short" | "long" | "hots" | "diagram";
  marks: number;
  question: string;
  options?: string[];
  correctAnswer?: string;
  imagePrompt?: string;
}

interface MockSection {
  name: string;
  instructions: string;
  questions: MockQuestion[];
}

interface MockTest {
  title: string;
  totalMarks: number;
  duration: string;
  sections: MockSection[];
}

interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  topic: string;
}

interface EvalFeedback {
  id: number;
  marks: number;
  maxMarks: number;
  feedback: string;
  correct: boolean;
}

interface EvalResult {
  totalMarks: number;
  obtainedMarks: number;
  percentage: number;
  grade: string;
  feedback: EvalFeedback[];
  overallFeedback: string;
}

type SuiteView = "menu" | "flashcards" | "mocktest" | "quiz" | "spaced" | "interleave" | "teachback" | "conceptmap" | "errors";
type MockPhase = "test" | "results";
type QuizPhase = "quiz" | "results";
type ReviewRating = "hard" | "okay" | "easy";

interface StudentSuiteProps {
  token: string;
  chatHistory: Array<{ role: string; content: string }>;
  studyGrade?: string | null;
  studyBoard?: string | null;
  studyLanguage?: string | null;
  onClose: () => void;
}

function cleanStudyText(text: string) {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getStudyTopics(chatHistory: Array<{ role: string; content: string }>) {
  const userLines = chatHistory
    .filter(message => message.role === "user")
    .map(message => cleanStudyText(message.content))
    .filter(Boolean);

  const assistantLines = chatHistory
    .filter(message => message.role !== "user")
    .flatMap(message => cleanStudyText(message.content).split(/[.!?]/))
    .map(line => line.trim())
    .filter(line => line.length > 24);

  const seeds = [...userLines, ...assistantLines]
    .map(line => line.slice(0, 72))
    .filter((line, index, arr) => arr.findIndex(item => item.toLowerCase() === line.toLowerCase()) === index)
    .slice(0, 6);

  return seeds.length > 0 ? seeds : [
    "Main concept from your latest study chat",
    "Key definition or formula",
    "Common exam question",
    "A confusing step to practice again",
  ];
}

function ToolCard({
  title,
  description,
  icon: Icon,
  tone,
  onClick,
  disabled,
}: {
  title: string;
  description: string;
  icon: typeof BookOpen;
  tone: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-4 p-4 border rounded-xl transition-all group text-left disabled:opacity-60 ${tone}`}
    >
      <div className="w-12 h-12 rounded-xl bg-background/40 border border-current/20 flex items-center justify-center shrink-0">
        {disabled ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-bold text-foreground transition-colors">{title}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground ml-auto transition-colors group-hover:text-current shrink-0" />
    </button>
  );
}

export default function StudentSuite({
  token,
  chatHistory,
  studyGrade,
  studyBoard,
  studyLanguage,
  onClose,
}: StudentSuiteProps) {
  const [view, setView] = useState<SuiteView>("menu");
  const [isLoading, setIsLoading] = useState(false);

  // Flashcards state
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [cardIndex, setCardIndex] = useState(0);
  const [cardFlipped, setCardFlipped] = useState(false);
  const [knownCards, setKnownCards] = useState<Set<number>>(new Set());

  // Mock test state
  const [mockTest, setMockTest] = useState<MockTest | null>(null);
  const [mockPhase, setMockPhase] = useState<MockPhase>("test");
  const [mockAnswers, setMockAnswers] = useState<Record<number, string>>({});
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);

  // Quiz state
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizPhase, setQuizPhase] = useState<QuizPhase>("quiz");
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [quizSelected, setQuizSelected] = useState<number | null>(null);
  const [quizShowAnswer, setQuizShowAnswer] = useState(false);
  const [quizScore, setQuizScore] = useState(0);
  const [quizStreak, setQuizStreak] = useState(0);
  const [quizMaxStreak, setQuizMaxStreak] = useState(0);
  const [reviewRatings, setReviewRatings] = useState<Record<number, ReviewRating>>({});
  const [teachBackInput, setTeachBackInput] = useState("");
  const [selectedMisconception, setSelectedMisconception] = useState<number | null>(null);

  const studyTopics = getStudyTopics(chatHistory);
  const interleavedPrompts = studyTopics.flatMap((topic, index) => [
    { topic, task: "Explain the idea in one sentence.", type: "Recall" },
    { topic, task: index % 2 === 0 ? "Solve or describe one example where this idea is used." : "Compare it with a related idea from your notes.", type: index % 2 === 0 ? "Apply" : "Compare" },
  ]).slice(0, 8);
  const misconceptionItems = [
    ...(evalResult?.feedback ?? []).filter(item => !item.correct).map(item => `Q${item.id}: ${item.feedback}`),
    ...quizQuestions.filter(q => quizAnswers[q.id] !== undefined && quizAnswers[q.id] !== q.correctIndex).map(q => q.question),
    ...studyTopics.map(topic => `What is the easiest mistake to make in: ${topic}?`),
  ].slice(0, 6);

  const generateFlashcards = useAction(api.study.generateFlashcards);
  const generateMockTest = useAction(api.study.generateMockTest);
  const evaluateMockTest = useAction(api.study.evaluateMockTest);
  const generateQuiz = useAction(api.study.generateQuiz);

  const handleGenerateFlashcards = async () => {
    setIsLoading(true);
    try {
      const cards = await generateFlashcards({
        token,
        chatHistory,
        studyGrade: studyGrade ?? undefined,
        studyBoard: studyBoard ?? undefined,
      });
      if (cards.length === 0) { toast.error("No flashcards generated. Have a study conversation first."); return; }
      setFlashcards(cards);
      setCardIndex(0);
      setCardFlipped(false);
      setKnownCards(new Set());
      setView("flashcards");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate flashcards");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateMockTest = async () => {
    setIsLoading(true);
    try {
      const test = await generateMockTest({
        token,
        chatHistory,
        studyGrade: studyGrade ?? undefined,
        studyBoard: studyBoard ?? undefined,
        studyLanguage: studyLanguage ?? undefined,
      });
      if (!test.sections || test.sections.length === 0) { toast.error("No test generated. Have a study conversation first."); return; }
      setMockTest(test as unknown as MockTest);
      setMockAnswers({});
      setMockPhase("test");
      setEvalResult(null);
      setView("mocktest");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate mock test");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateQuiz = async () => {
    setIsLoading(true);
    try {
      const questions = await generateQuiz({
        token,
        chatHistory,
        studyGrade: studyGrade ?? undefined,
        studyBoard: studyBoard ?? undefined,
      });
      if (questions.length === 0) { toast.error("No quiz generated. Have a study conversation first."); return; }
      setQuizQuestions(questions);
      setQuizPhase("quiz");
      setQuizIndex(0);
      setQuizAnswers({});
      setQuizSelected(null);
      setQuizShowAnswer(false);
      setQuizScore(0);
      setQuizStreak(0);
      setQuizMaxStreak(0);
      setView("quiz");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate quiz");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitMockTest = async () => {
    if (!mockTest) return;
    setIsEvaluating(true);
    try {
      const allQuestions = mockTest.sections.flatMap(s => s.questions);
      const answers = Object.entries(mockAnswers).map(([id, answer]) => ({ id: parseInt(id), answer }));
      const result = await evaluateMockTest({
        token,
        questions: allQuestions.map(q => ({
          id: q.id,
          type: q.type,
          marks: q.marks,
          question: q.question,
          correctAnswer: q.correctAnswer,
        })),
        answers,
        studyGrade: studyGrade ?? undefined,
        studyBoard: studyBoard ?? undefined,
      });
      setEvalResult(result);
      setMockPhase("results");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleQuizAnswer = (optionIndex: number) => {
    if (quizShowAnswer) return;
    const q = quizQuestions[quizIndex];
    setQuizSelected(optionIndex);
    setQuizShowAnswer(true);
    const isCorrect = optionIndex === q.correctIndex;
    const newAnswers = { ...quizAnswers, [q.id]: optionIndex };
    setQuizAnswers(newAnswers);
    if (isCorrect) {
      const newStreak = quizStreak + 1;
      setQuizScore(s => s + 1);
      setQuizStreak(newStreak);
      if (newStreak > quizMaxStreak) setQuizMaxStreak(newStreak);
    } else {
      setQuizStreak(0);
    }
  };

  const handleQuizNext = () => {
    if (quizIndex >= quizQuestions.length - 1) {
      setQuizPhase("results");
    } else {
      setQuizIndex(i => i + 1);
      setQuizSelected(null);
      setQuizShowAnswer(false);
    }
  };

  const gradeColor = (grade: string) => {
    if (grade === "A+" || grade === "A") return "text-emerald-400";
    if (grade === "B") return "text-blue-400";
    if (grade === "C") return "text-amber-400";
    return "text-red-400";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        className="relative z-10 bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="shrink-0 px-4 py-3 border-b border-border flex items-center justify-between bg-card">
          <div className="flex items-center gap-2">
            {view !== "menu" && (
              <button onClick={() => setView("menu")} className="text-muted-foreground hover:text-foreground transition-colors p-1 mr-1">
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <div className="w-8 h-8 rounded-xl bg-indigo-400/15 border border-indigo-400/30 flex items-center justify-center">
              {view === "menu" && <Target className="h-4 w-4 text-indigo-400" />}
              {view === "flashcards" && <BookOpen className="h-4 w-4 text-indigo-400" />}
              {view === "mocktest" && <ClipboardList className="h-4 w-4 text-purple-400" />}
              {view === "quiz" && <Gamepad2 className="h-4 w-4 text-emerald-400" />}
              {view === "spaced" && <CalendarDays className="h-4 w-4 text-sky-400" />}
              {view === "interleave" && <Shuffle className="h-4 w-4 text-amber-400" />}
              {view === "teachback" && <MessageCircleQuestion className="h-4 w-4 text-pink-400" />}
              {view === "conceptmap" && <GitBranch className="h-4 w-4 text-cyan-400" />}
              {view === "errors" && <TriangleAlert className="h-4 w-4 text-red-400" />}
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">
                {view === "menu" && "Student Suite"}
                {view === "flashcards" && `Flashcards (${flashcards.length})`}
                {view === "mocktest" && (mockPhase === "results" ? "Test Results" : mockTest?.title ?? "Mock Test")}
                {view === "quiz" && (quizPhase === "results" ? "Quiz Results" : `Quick Quiz — Q${quizIndex + 1}/${quizQuestions.length}`)}
                {view === "spaced" && "Spaced Review"}
                {view === "interleave" && "Mixed Practice"}
                {view === "teachback" && "Teach-Back Coach"}
                {view === "conceptmap" && "Concept Map"}
                {view === "errors" && "Mistake Review"}
              </h3>
              {studyGrade && <p className="text-[10px] text-muted-foreground">{studyGrade}{studyBoard ? ` · ${studyBoard}` : ""}</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <AnimatePresence mode="wait">

            {/* ── MENU ── */}
            {view === "menu" && (
              <motion.div key="menu" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-6">
                <p className="text-xs text-muted-foreground mb-6 text-center">
                  AI-powered study tools based on your conversation. Last-minute revision made easy.
                </p>
                <div className="space-y-5">
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground tracking-widest mb-2">GENERATE FROM YOUR CHAT</p>
                    <div className="grid grid-cols-1 gap-3">
                      <ToolCard
                        title="Flashcards"
                        description="AI generates revision cards from your chat. Flip to reveal answers."
                        icon={BookOpen}
                        tone="bg-indigo-400/8 border-indigo-400/25 text-indigo-400 hover:bg-indigo-400/15 hover:border-indigo-400/40"
                        onClick={handleGenerateFlashcards}
                        disabled={isLoading}
                      />
                      <ToolCard
                        title="Mock Test"
                        description="Full paper with MCQs, short answers, long answers, and board-style marking."
                        icon={ClipboardList}
                        tone="bg-purple-400/8 border-purple-400/25 text-purple-400 hover:bg-purple-400/15 hover:border-purple-400/40"
                        onClick={handleGenerateMockTest}
                        disabled={isLoading}
                      />
                      <ToolCard
                        title="Quick Quiz"
                        description="A short question challenge with streaks, scores, and instant feedback."
                        icon={Gamepad2}
                        tone="bg-emerald-400/8 border-emerald-400/25 text-emerald-400 hover:bg-emerald-400/15 hover:border-emerald-400/40"
                        onClick={handleGenerateQuiz}
                        disabled={isLoading}
                      />
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground tracking-widest mb-2">SCIENCE-BACKED STUDY METHODS</p>
                    <div className="grid grid-cols-1 gap-3">
                      <ToolCard
                        title="Spaced Review"
                        description="Plan what to review today, tomorrow, and later so you do not forget it."
                        icon={CalendarDays}
                        tone="bg-sky-400/8 border-sky-400/25 text-sky-400 hover:bg-sky-400/15 hover:border-sky-400/40"
                        onClick={() => setView("spaced")}
                      />
                      <ToolCard
                        title="Mixed Practice"
                        description="Mix topics and question styles so your brain learns to choose the right method."
                        icon={Shuffle}
                        tone="bg-amber-400/8 border-amber-400/25 text-amber-400 hover:bg-amber-400/15 hover:border-amber-400/40"
                        onClick={() => setView("interleave")}
                      />
                      <ToolCard
                        title="Teach-Back Coach"
                        description="Explain a topic in your own words and get a simple checklist for what is missing."
                        icon={MessageCircleQuestion}
                        tone="bg-pink-400/8 border-pink-400/25 text-pink-400 hover:bg-pink-400/15 hover:border-pink-400/40"
                        onClick={() => setView("teachback")}
                      />
                      <ToolCard
                        title="Concept Map"
                        description="See how your latest study topics connect, then use the links for deeper revision."
                        icon={GitBranch}
                        tone="bg-cyan-400/8 border-cyan-400/25 text-cyan-400 hover:bg-cyan-400/15 hover:border-cyan-400/40"
                        onClick={() => setView("conceptmap")}
                      />
                      <ToolCard
                        title="Mistake Review"
                        description="Find weak spots and turn them into targeted mini-practice."
                        icon={TriangleAlert}
                        tone="bg-red-400/8 border-red-400/25 text-red-400 hover:bg-red-400/15 hover:border-red-400/40"
                        onClick={() => setView("errors")}
                      />
                    </div>
                  </div>
                </div>

                {chatHistory.length < 2 && (
                  <div className="mt-4 p-3 bg-amber-400/8 border border-amber-400/25 rounded-xl">
                    <p className="text-[11px] text-amber-400 text-center">💡 Have a study conversation first, then come back to generate tools from it.</p>
                  </div>
                )}
              </motion.div>
            )}

            {/* ── SPACED REVIEW ── */}
            {view === "spaced" && (
              <motion.div key="spaced" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-5 space-y-4">
                <div className="p-4 bg-sky-400/8 border border-sky-400/25 rounded-xl">
                  <p className="text-sm font-bold text-foreground">Review before you forget</p>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                    Rate each topic. Hard topics come back sooner, easy topics move further away.
                  </p>
                </div>
                <div className="space-y-3">
                  {studyTopics.map((topic, index) => {
                    const rating = reviewRatings[index];
                    const nextReview = rating === "easy" ? "Review in 7 days" : rating === "okay" ? "Review in 3 days" : rating === "hard" ? "Review tomorrow" : "Review today";
                    return (
                      <div key={`${topic}-${index}`} className="p-3 bg-background border border-border rounded-xl">
                        <div className="flex items-start gap-3">
                          <CalendarDays className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-foreground leading-relaxed">{topic}</p>
                            <p className="text-[10px] text-sky-400 mt-1">{nextReview}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mt-3">
                          {(["hard", "okay", "easy"] as ReviewRating[]).map(option => (
                            <button
                              key={option}
                              onClick={() => setReviewRatings(prev => ({ ...prev, [index]: option }))}
                              className={`py-1.5 rounded-lg border text-[10px] font-bold capitalize transition-all ${rating === option ? "bg-sky-400/15 border-sky-400/40 text-sky-300" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* ── MIXED PRACTICE ── */}
            {view === "interleave" && (
              <motion.div key="interleave" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-5 space-y-4">
                <div className="p-4 bg-amber-400/8 border border-amber-400/25 rounded-xl">
                  <p className="text-sm font-bold text-foreground">Mixed practice</p>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                    Do these in order. The mix is intentional: switching topics helps long-term learning.
                  </p>
                </div>
                <div className="space-y-2">
                  {interleavedPrompts.map((prompt, index) => (
                    <div key={`${prompt.topic}-${index}`} className="flex gap-3 p-3 bg-background border border-border rounded-xl">
                      <div className="w-7 h-7 rounded-lg bg-amber-400/10 border border-amber-400/25 text-amber-400 flex items-center justify-center text-[10px] font-bold shrink-0">
                        {index + 1}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold text-amber-400">{prompt.type}</p>
                        <p className="text-xs text-foreground mt-0.5 leading-relaxed">{prompt.task}</p>
                        <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{prompt.topic}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── TEACH BACK ── */}
            {view === "teachback" && (
              <motion.div key="teachback" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-5 space-y-4">
                <div className="p-4 bg-pink-400/8 border border-pink-400/25 rounded-xl">
                  <p className="text-sm font-bold text-foreground">Teach it like you are explaining to a friend</p>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                    This checks whether you really understand the idea, not just recognize it.
                  </p>
                </div>
                <div className="p-3 bg-background border border-border rounded-xl">
                  <p className="text-[10px] font-bold text-pink-400 mb-2">Try explaining</p>
                  <p className="text-xs text-foreground leading-relaxed">{studyTopics[0]}</p>
                </div>
                <textarea
                  value={teachBackInput}
                  onChange={event => setTeachBackInput(event.target.value)}
                  placeholder="Explain it in your own words..."
                  rows={6}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-pink-400/60 transition-colors"
                />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    { label: "Simple words", done: teachBackInput.length > 80 },
                    { label: "Example included", done: /\b(example|for instance|like|such as)\b/i.test(teachBackInput) },
                    { label: "Why it matters", done: /\b(because|therefore|so that|this means)\b/i.test(teachBackInput) },
                  ].map(item => (
                    <div key={item.label} className={`p-3 rounded-xl border ${item.done ? "bg-emerald-400/8 border-emerald-400/25" : "bg-card border-border"}`}>
                      <div className="flex items-center gap-2">
                        {item.done ? <CheckCircle className="h-3.5 w-3.5 text-emerald-400" /> : <Clock className="h-3.5 w-3.5 text-muted-foreground" />}
                        <span className="text-[11px] text-foreground">{item.label}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── CONCEPT MAP ── */}
            {view === "conceptmap" && (
              <motion.div key="conceptmap" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-5 space-y-4">
                <div className="p-4 bg-cyan-400/8 border border-cyan-400/25 rounded-xl">
                  <p className="text-sm font-bold text-foreground">Connect the ideas</p>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                    Learning gets stronger when you know how ideas relate, not just what each one means.
                  </p>
                </div>
                <div className="space-y-3">
                  {studyTopics.map((topic, index) => {
                    const next = studyTopics[(index + 1) % studyTopics.length];
                    return (
                      <div key={`${topic}-${index}`} className="p-3 bg-background border border-border rounded-xl">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-cyan-400/10 border border-cyan-400/25 text-cyan-400 flex items-center justify-center text-[10px] font-bold shrink-0">
                            {index + 1}
                          </div>
                          <p className="text-xs font-semibold text-foreground leading-relaxed min-w-0">{topic}</p>
                        </div>
                        {studyTopics.length > 1 && (
                          <div className="ml-4 mt-3 pl-7 border-l border-cyan-400/25">
                            <p className="text-[10px] text-muted-foreground">Connect this to:</p>
                            <p className="text-[11px] text-cyan-300 mt-0.5 line-clamp-2">{next}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* ── MISTAKE REVIEW ── */}
            {view === "errors" && (
              <motion.div key="errors" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-5 space-y-4">
                <div className="p-4 bg-red-400/8 border border-red-400/25 rounded-xl">
                  <p className="text-sm font-bold text-foreground">Turn mistakes into practice</p>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                    Pick a weak spot. Then answer the diagnostic prompt before returning to quizzes or flashcards.
                  </p>
                </div>
                <div className="space-y-2">
                  {misconceptionItems.map((item, index) => (
                    <button
                      key={`${item}-${index}`}
                      onClick={() => setSelectedMisconception(index)}
                      className={`w-full text-left p-3 rounded-xl border transition-all ${selectedMisconception === index ? "bg-red-400/12 border-red-400/40" : "bg-background border-border hover:border-red-400/30"}`}
                    >
                      <p className="text-xs text-foreground leading-relaxed">{item}</p>
                    </button>
                  ))}
                </div>
                {selectedMisconception !== null && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-card border border-border rounded-xl">
                    <p className="text-[10px] font-bold text-red-400 mb-2">Diagnostic prompt</p>
                    <p className="text-xs text-foreground leading-relaxed">
                      Explain the correct idea, give one example, and write the mistake you will avoid next time.
                    </p>
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* ── FLASHCARDS ── */}
            {view === "flashcards" && flashcards.length > 0 && (
              <motion.div key="flashcards" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-6 flex flex-col items-center gap-4">
                {/* Progress */}
                <div className="w-full flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{cardIndex + 1} / {flashcards.length}</span>
                  <span className="text-emerald-400 font-bold">{knownCards.size} known ✓</span>
                  <span className="text-indigo-400">{flashcards[cardIndex]?.topic}</span>
                </div>
                <div className="w-full bg-border/30 rounded-full h-1">
                  <div className="bg-indigo-400 h-1 rounded-full transition-all" style={{ width: `${((cardIndex + 1) / flashcards.length) * 100}%` }} />
                </div>

                {/* Card */}
                <div
                  className="w-full cursor-pointer"
                  style={{ perspective: "1000px" }}
                  onClick={() => setCardFlipped(f => !f)}
                >
                  <motion.div
                    animate={{ rotateY: cardFlipped ? 180 : 0 }}
                    transition={{ duration: 0.4 }}
                    style={{ transformStyle: "preserve-3d", position: "relative", minHeight: 200 }}
                  >
                    {/* Front */}
                    <div
                      className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-indigo-400/8 border border-indigo-400/25 rounded-2xl"
                      style={{ backfaceVisibility: "hidden" }}
                    >
                      <p className="text-[10px] text-indigo-400 font-bold mb-3 uppercase tracking-wider">Question</p>
                      <p className="text-base font-semibold text-foreground text-center leading-relaxed">{flashcards[cardIndex]?.front}</p>
                      <p className="text-[10px] text-muted-foreground mt-4">Tap to reveal answer</p>
                    </div>
                    {/* Back */}
                    <div
                      className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-emerald-400/8 border border-emerald-400/25 rounded-2xl"
                      style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                    >
                      <p className="text-[10px] text-emerald-400 font-bold mb-3 uppercase tracking-wider">Answer</p>
                      <p className="text-sm text-foreground text-center leading-relaxed">{flashcards[cardIndex]?.back}</p>
                    </div>
                  </motion.div>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-3 w-full">
                  <button
                    onClick={() => { setCardIndex(i => Math.max(0, i - 1)); setCardFlipped(false); }}
                    disabled={cardIndex === 0}
                    className="flex-1 py-2 bg-card border border-border rounded-xl text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30 transition-all flex items-center justify-center gap-1.5"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Prev
                  </button>
                  {cardFlipped && (
                    <>
                      <button
                        onClick={() => { setKnownCards(s => { const n = new Set(s); n.delete(cardIndex); return n; }); setCardIndex(i => Math.min(flashcards.length - 1, i + 1)); setCardFlipped(false); }}
                        className="flex-1 py-2 bg-red-400/10 border border-red-400/30 rounded-xl text-[11px] text-red-400 hover:bg-red-400/20 transition-all flex items-center justify-center gap-1.5"
                      >
                        <XCircle className="h-3.5 w-3.5" /> Still Learning
                      </button>
                      <button
                        onClick={() => { setKnownCards(s => new Set([...s, cardIndex])); setCardIndex(i => Math.min(flashcards.length - 1, i + 1)); setCardFlipped(false); }}
                        className="flex-1 py-2 bg-emerald-400/10 border border-emerald-400/30 rounded-xl text-[11px] text-emerald-400 hover:bg-emerald-400/20 transition-all flex items-center justify-center gap-1.5"
                      >
                        <CheckCircle className="h-3.5 w-3.5" /> Got It!
                      </button>
                    </>
                  )}
                  {!cardFlipped && (
                    <button
                      onClick={() => { setCardIndex(i => Math.min(flashcards.length - 1, i + 1)); setCardFlipped(false); }}
                      disabled={cardIndex === flashcards.length - 1}
                      className="flex-1 py-2 bg-card border border-border rounded-xl text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30 transition-all flex items-center justify-center gap-1.5"
                    >
                      Next <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {knownCards.size === flashcards.length && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="w-full p-3 bg-emerald-400/10 border border-emerald-400/30 rounded-xl text-center">
                    <p className="text-sm font-bold text-emerald-400">🎉 All cards mastered!</p>
                    <button onClick={() => { setKnownCards(new Set()); setCardIndex(0); setCardFlipped(false); }} className="mt-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 mx-auto">
                      <RefreshCw className="h-3 w-3" /> Reset & review again
                    </button>
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* ── MOCK TEST ── */}
            {view === "mocktest" && mockTest && mockPhase === "test" && (
              <motion.div key="mocktest" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-4 space-y-4">
                <div className="flex items-center gap-3 p-3 bg-purple-400/8 border border-purple-400/25 rounded-xl">
                  <div>
                    <p className="text-xs font-bold text-foreground">{mockTest.title}</p>
                    <p className="text-[10px] text-muted-foreground">Total: {mockTest.totalMarks} marks · {mockTest.duration}</p>
                  </div>
                  <div className="ml-auto text-right">
                    <p className="text-[10px] text-muted-foreground">Answered</p>
                    <p className="text-sm font-bold text-purple-400">{Object.keys(mockAnswers).length}/{mockTest.sections.flatMap(s => s.questions).length}</p>
                  </div>
                </div>

                {mockTest.sections.map((section, si) => (
                  <div key={si} className="space-y-3">
                    <div className="px-3 py-2 bg-card border border-border rounded-lg">
                      <p className="text-[11px] font-bold text-foreground">{section.name}</p>
                      <p className="text-[10px] text-muted-foreground">{section.instructions}</p>
                    </div>
                    {section.questions.map((q) => (
                      <div key={q.id} className="p-3 bg-background border border-border rounded-xl space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[11px] font-semibold text-foreground flex-1">{q.id}. {q.question}</p>
                          <span className="text-[9px] text-purple-400 border border-purple-400/30 bg-purple-400/10 px-1.5 py-0.5 rounded-full shrink-0">{q.marks}M</span>
                        </div>
                        {q.type === "mcq" && q.options && (
                          <div className="space-y-1.5">
                            {q.options.map((opt, oi) => (
                              <button
                                key={oi}
                                onClick={() => setMockAnswers(a => ({ ...a, [q.id]: opt }))}
                                className={`w-full text-left px-3 py-2 rounded-lg text-[11px] border transition-all ${mockAnswers[q.id] === opt ? "bg-purple-400/15 border-purple-400/40 text-purple-300 font-bold" : "bg-card border-border text-muted-foreground hover:border-purple-400/30 hover:text-foreground"}`}
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        )}
                        {q.type !== "mcq" && (
                          <textarea
                            value={mockAnswers[q.id] ?? ""}
                            onChange={e => setMockAnswers(a => ({ ...a, [q.id]: e.target.value }))}
                            placeholder={q.type === "short" ? "Write your answer (2-3 sentences)..." : q.type === "long" ? "Write a detailed answer..." : q.type === "hots" ? "Apply your knowledge creatively..." : "Describe the diagram and explain..."}
                            rows={q.type === "long" || q.type === "hots" ? 4 : 2}
                            className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-purple-400/60 transition-colors"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                ))}

                <button
                  onClick={handleSubmitMockTest}
                  disabled={isEvaluating}
                  className="w-full py-3 bg-purple-500 text-white font-bold text-sm rounded-xl hover:bg-purple-600 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                  {isEvaluating ? <><Loader2 className="h-4 w-4 animate-spin" />Evaluating...</> : <><Zap className="h-4 w-4" />Submit & Evaluate</>}
                </button>
              </motion.div>
            )}

            {/* ── MOCK TEST RESULTS ── */}
            {view === "mocktest" && evalResult && mockPhase === "results" && (
              <motion.div key="mockresults" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-4 space-y-4">
                {/* Score card */}
                <div className="p-4 bg-purple-400/8 border border-purple-400/25 rounded-2xl text-center">
                  <p className="text-[10px] text-muted-foreground mb-1">Your Score</p>
                  <p className="text-4xl font-black text-foreground">{evalResult.obtainedMarks}<span className="text-xl text-muted-foreground">/{evalResult.totalMarks}</span></p>
                  <p className={`text-2xl font-bold mt-1 ${gradeColor(evalResult.grade)}`}>{evalResult.grade} · {evalResult.percentage}%</p>
                  <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">{evalResult.overallFeedback}</p>
                </div>

                {/* Per-question feedback */}
                <div className="space-y-2">
                  {evalResult.feedback.map(f => (
                    <div key={f.id} className={`p-3 rounded-xl border ${f.correct ? "bg-emerald-400/8 border-emerald-400/25" : "bg-red-400/8 border-red-400/25"}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-bold text-foreground">Q{f.id}</span>
                        <span className={`text-[11px] font-bold ${f.correct ? "text-emerald-400" : "text-red-400"}`}>{f.marks}/{f.maxMarks} marks</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">{f.feedback}</p>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => { setMockPhase("test"); setMockAnswers({}); setEvalResult(null); }}
                  className="w-full py-2.5 bg-card border border-border text-muted-foreground text-sm rounded-xl hover:bg-muted/50 transition-all flex items-center justify-center gap-2"
                >
                  <RefreshCw className="h-4 w-4" /> Retake Test
                </button>
              </motion.div>
            )}

            {/* ── QUIZ ── */}
            {view === "quiz" && quizQuestions.length > 0 && quizPhase === "quiz" && (
              <motion.div key="quiz" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-4 space-y-4">
                {/* Score bar */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 px-2 py-1 bg-emerald-400/10 border border-emerald-400/30 rounded-lg">
                      <Star className="h-3 w-3 text-emerald-400" />
                      <span className="text-[11px] font-bold text-emerald-400">{quizScore}</span>
                    </div>
                    {quizStreak >= 2 && (
                      <div className="flex items-center gap-1 px-2 py-1 bg-amber-400/10 border border-amber-400/30 rounded-lg">
                        <Zap className="h-3 w-3 text-amber-400" />
                        <span className="text-[11px] font-bold text-amber-400">{quizStreak}x streak!</span>
                      </div>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground">{quizIndex + 1}/{quizQuestions.length}</span>
                </div>

                {/* Progress */}
                <div className="w-full bg-border/30 rounded-full h-1.5">
                  <div className="bg-emerald-400 h-1.5 rounded-full transition-all" style={{ width: `${((quizIndex + 1) / quizQuestions.length) * 100}%` }} />
                </div>

                {/* Question */}
                <div className="p-4 bg-emerald-400/8 border border-emerald-400/25 rounded-xl">
                  <p className="text-[10px] text-emerald-400 font-bold mb-2">{quizQuestions[quizIndex]?.topic}</p>
                  <p className="text-sm font-semibold text-foreground leading-relaxed">{quizQuestions[quizIndex]?.question}</p>
                </div>

                {/* Options */}
                <div className="space-y-2">
                  {quizQuestions[quizIndex]?.options.map((opt, oi) => {
                    const isSelected = quizSelected === oi;
                    const isCorrect = oi === quizQuestions[quizIndex].correctIndex;
                    let cls = "bg-card border-border text-muted-foreground hover:border-emerald-400/30 hover:text-foreground";
                    if (quizShowAnswer) {
                      if (isCorrect) cls = "bg-emerald-400/15 border-emerald-400/40 text-emerald-300 font-bold";
                      else if (isSelected && !isCorrect) cls = "bg-red-400/15 border-red-400/40 text-red-300";
                      else cls = "bg-card border-border text-muted-foreground opacity-50";
                    } else if (isSelected) {
                      cls = "bg-emerald-400/10 border-emerald-400/30 text-foreground";
                    }
                    return (
                      <button
                        key={oi}
                        onClick={() => handleQuizAnswer(oi)}
                        disabled={quizShowAnswer}
                        className={`w-full text-left px-3 py-2.5 rounded-xl text-[11px] border transition-all ${cls}`}
                      >
                        <span className="font-bold mr-2">{String.fromCharCode(65 + oi)}.</span>{opt}
                      </button>
                    );
                  })}
                </div>

                {/* Explanation */}
                {quizShowAnswer && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="p-3 bg-card border border-border rounded-xl">
                    <p className="text-[10px] text-muted-foreground leading-relaxed">{quizQuestions[quizIndex]?.explanation}</p>
                  </motion.div>
                )}

                {quizShowAnswer && (
                  <button
                    onClick={handleQuizNext}
                    className="w-full py-2.5 bg-emerald-500 text-white font-bold text-sm rounded-xl hover:bg-emerald-600 transition-all flex items-center justify-center gap-2"
                  >
                    {quizIndex >= quizQuestions.length - 1 ? <><Trophy className="h-4 w-4" />See Results</> : <>Next Question <ChevronRight className="h-4 w-4" /></>}
                  </button>
                )}
              </motion.div>
            )}

            {/* ── QUIZ RESULTS ── */}
            {view === "quiz" && quizPhase === "results" && (
              <motion.div key="quizresults" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-6 space-y-4">
                <div className="text-center">
                  <div className="text-5xl mb-3">
                    {quizScore >= 13 ? "🏆" : quizScore >= 10 ? "🎉" : quizScore >= 7 ? "👍" : "📚"}
                  </div>
                  <p className="text-2xl font-black text-foreground">{quizScore}/{quizQuestions.length}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {quizScore >= 13 ? "Outstanding! You're exam-ready!" : quizScore >= 10 ? "Great job! Keep it up!" : quizScore >= 7 ? "Good effort! Review the missed ones." : "Keep studying — you'll get there!"}
                  </p>
                  {quizMaxStreak >= 3 && (
                    <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 bg-amber-400/10 border border-amber-400/30 rounded-full">
                      <Zap className="h-3 w-3 text-amber-400" />
                      <span className="text-[11px] text-amber-400 font-bold">Best streak: {quizMaxStreak}x</span>
                    </div>
                  )}
                </div>

                {/* Per-question review */}
                <div className="space-y-1.5">
                  {quizQuestions.map((q) => {
                    const answered = quizAnswers[q.id];
                    const correct = answered === q.correctIndex;
                    return (
                      <div key={q.id} className={`flex items-start gap-2 p-2.5 rounded-lg border ${correct ? "bg-emerald-400/8 border-emerald-400/20" : "bg-red-400/8 border-red-400/20"}`}>
                        {correct ? <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" /> : <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />}
                        <div className="min-w-0">
                          <p className="text-[10px] text-foreground line-clamp-1">{q.question}</p>
                          {!correct && <p className="text-[9px] text-emerald-400 mt-0.5">✓ {q.options[q.correctIndex]}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button
                  onClick={handleGenerateQuiz}
                  disabled={isLoading}
                  className="w-full py-2.5 bg-emerald-500 text-white font-bold text-sm rounded-xl hover:bg-emerald-600 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><RefreshCw className="h-4 w-4" />New Quiz</>}
                </button>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
