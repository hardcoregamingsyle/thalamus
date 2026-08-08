// StudentSuite modal shell. Holds every useState + the four useAction calls +
// dispatch; the per-view UI lives in src/components/student-suite/*.tsx. The
// shared state is genuinely shared (flashcards feed spaced review, evalResult
// and quizAnswers feed the mistake-review list), so the hooks stay hoisted
// rather than being pushed down into the view components.

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen, CalendarDays, ChevronLeft, ClipboardList, Gamepad2, GitBranch,
  MessageCircleQuestion, Shuffle, Target, TriangleAlert, X,
} from "lucide-react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { errMsg } from "@/lib/errorMessage";
import type {
  EvalResult, Flashcard, MockPhase, MockTest, QuizPhase, QuizQuestion, ReviewRating, SuiteView,
} from "./student-suite/types";
import { getStudyTopics } from "./student-suite/utils";
import MenuView from "./student-suite/MenuView";
import FlashcardsView from "./student-suite/FlashcardsView";
import MockTestView from "./student-suite/MockTestView";
import QuizView from "./student-suite/QuizView";
import SpacedView from "./student-suite/SpacedView";
import InterleaveView from "./student-suite/InterleaveView";
import TeachbackView from "./student-suite/TeachbackView";
import ConceptMapView from "./student-suite/ConceptMapView";
import ErrorsView from "./student-suite/ErrorsView";

interface StudentSuiteProps {
  token: string;
  chatHistory: Array<{ role: string; content: string }>;
  studyGrade?: string | null;
  studyBoard?: string | null;
  studyLanguage?: string | null;
  onClose: () => void;
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
      toast.error(errMsg(err, "Failed to generate flashcards"));
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
      // Cast: the local MockTest type and the action's return type still need
      // reconciling — they agree at runtime but MockQuestion.type is a stricter
      // union here than the action currently declares.
      setMockTest(test as unknown as MockTest);
      setMockAnswers({});
      setMockPhase("test");
      setEvalResult(null);
      setView("mocktest");
    } catch (err) {
      toast.error(errMsg(err, "Failed to generate mock test"));
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
      toast.error(errMsg(err, "Failed to generate quiz"));
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
      toast.error(errMsg(err, "Evaluation failed"));
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
              <button
                aria-label="Back to menu"
                onClick={() => setView("menu")}
                className="text-muted-foreground hover:text-foreground transition-colors p-1 mr-1"
              >
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
          <button
            aria-label="Close student suite"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto min-h-0">
          <AnimatePresence mode="wait">

            {view === "menu" && (
              <MenuView
                isLoading={isLoading}
                chatHistoryLength={chatHistory.length}
                onGenerateFlashcards={handleGenerateFlashcards}
                onGenerateMockTest={handleGenerateMockTest}
                onGenerateQuiz={handleGenerateQuiz}
                onSelectView={setView}
              />
            )}

            {view === "spaced" && (
              <SpacedView
                studyTopics={studyTopics}
                reviewRatings={reviewRatings}
                onRate={(index, rating) => setReviewRatings(prev => ({ ...prev, [index]: rating }))}
              />
            )}

            {view === "interleave" && (
              <InterleaveView interleavedPrompts={interleavedPrompts} />
            )}

            {view === "teachback" && (
              <TeachbackView
                studyTopics={studyTopics}
                teachBackInput={teachBackInput}
                onTeachBackChange={setTeachBackInput}
              />
            )}

            {view === "conceptmap" && (
              <ConceptMapView studyTopics={studyTopics} />
            )}

            {view === "errors" && (
              <ErrorsView
                misconceptionItems={misconceptionItems}
                selectedMisconception={selectedMisconception}
                onSelect={setSelectedMisconception}
              />
            )}

            {view === "flashcards" && flashcards.length > 0 && (
              <FlashcardsView
                flashcards={flashcards}
                cardIndex={cardIndex}
                cardFlipped={cardFlipped}
                knownCards={knownCards}
                onFlip={() => setCardFlipped(f => !f)}
                onPrev={() => { setCardIndex(i => Math.max(0, i - 1)); setCardFlipped(false); }}
                onNextUnflipped={() => { setCardIndex(i => Math.min(flashcards.length - 1, i + 1)); setCardFlipped(false); }}
                onMarkStillLearning={() => { setKnownCards(s => { const n = new Set(s); n.delete(cardIndex); return n; }); setCardIndex(i => Math.min(flashcards.length - 1, i + 1)); setCardFlipped(false); }}
                onMarkKnown={() => { setKnownCards(s => new Set([...s, cardIndex])); setCardIndex(i => Math.min(flashcards.length - 1, i + 1)); setCardFlipped(false); }}
                onReset={() => { setKnownCards(new Set()); setCardIndex(0); setCardFlipped(false); }}
              />
            )}

            {view === "mocktest" && (
              <MockTestView
                mockTest={mockTest}
                mockPhase={mockPhase}
                mockAnswers={mockAnswers}
                isEvaluating={isEvaluating}
                evalResult={evalResult}
                onAnswerChange={(id, value) => setMockAnswers(a => ({ ...a, [id]: value }))}
                onSubmit={handleSubmitMockTest}
                onRetake={() => { setMockPhase("test"); setMockAnswers({}); setEvalResult(null); }}
              />
            )}

            {view === "quiz" && (
              <QuizView
                quizQuestions={quizQuestions}
                quizPhase={quizPhase}
                quizIndex={quizIndex}
                quizAnswers={quizAnswers}
                quizSelected={quizSelected}
                quizShowAnswer={quizShowAnswer}
                quizScore={quizScore}
                quizStreak={quizStreak}
                quizMaxStreak={quizMaxStreak}
                isLoading={isLoading}
                onAnswer={handleQuizAnswer}
                onNext={handleQuizNext}
                onNewQuiz={handleGenerateQuiz}
              />
            )}

          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
