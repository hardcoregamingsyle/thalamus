// Shared data shapes for the StudentSuite modal (src/components/StudentSuite.tsx)
// and its per-view child components. The action-returned shapes come from
// src/convex/study.ts; the local MockTest type intentionally lets the shell
// cast the action result (see StudentSuite.tsx for the reconciliation note).

export interface Flashcard {
  front: string;
  back: string;
  topic: string;
}

export interface MockQuestion {
  id: number;
  type: "mcq" | "short" | "long" | "hots" | "diagram";
  marks: number;
  question: string;
  options?: string[];
  correctAnswer?: string;
  imagePrompt?: string;
}

export interface MockSection {
  name: string;
  instructions: string;
  questions: MockQuestion[];
}

export interface MockTest {
  title: string;
  totalMarks: number;
  duration: string;
  sections: MockSection[];
}

export interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  topic: string;
}

export interface EvalFeedback {
  id: number;
  marks: number;
  maxMarks: number;
  feedback: string;
  correct: boolean;
}

export interface EvalResult {
  totalMarks: number;
  obtainedMarks: number;
  percentage: number;
  grade: string;
  feedback: EvalFeedback[];
  overallFeedback: string;
}

export type SuiteView =
  | "menu" | "flashcards" | "mocktest" | "quiz"
  | "spaced" | "interleave" | "teachback" | "conceptmap" | "errors";
export type MockPhase = "test" | "results";
export type QuizPhase = "quiz" | "results";
export type ReviewRating = "hard" | "okay" | "easy";
