// Shared study-task context. Provides the widgets (and the composer gating)
// with the active task's completion helper plus the inline grading action, so
// an answered question marks itself done in the persisted task without prop
// drilling through MessageRow.

import { createContext, useContext } from "react";

export interface StudyTaskContextValue {
  // Mark one persisted task item done (question answered, card mastered...).
  completeItem?: (itemId: string, done?: boolean) => void;
  // Grade an open answer inline and return structured feedback + decision.
  gradeAnswer?: (question: string, answer: string, attempt: number) => Promise<{
    correct: boolean;
    feedback: string;
    decision: "retry-same" | "retry-different" | "move-on";
    followUpQuestion?: string;
  }>;
}

const StudyTaskContext = createContext<StudyTaskContextValue>({});

export const StudyTaskProvider = StudyTaskContext.Provider;

// eslint-disable-next-line react-refresh/only-export-components -- provider + hook belong together; HMR is disabled repo-wide
export function useStudyTaskContext(): StudyTaskContextValue {
  return useContext(StudyTaskContext);
}
