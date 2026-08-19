// Drives the study-mode lockout. Reads the persisted active study task for the
// current conversation (server-side, so it survives refresh / another device)
// and exposes whether the chat is locked plus helpers to mark items complete.
//
// While a task is active and incomplete, study mode blocks: no new prompt, no
// new conversation, no mode switch. The lock only lifts once every item
// (question / flashcard / pathway step) is done.

import { useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function useStudyTask(token: string | null, conversationId: Id<"conversations"> | null) {
  const activeTask = useQuery(
    api.studyTasks.getActiveStudyTask,
    token && conversationId ? { token, conversationId } : "skip",
  ) as
    | {
        taskKey: string;
        items: Array<{ id: string; kind: string; label: string; done: boolean }>;
        total: number;
        completed: number;
        complete: boolean;
      }
    | null
    | undefined;

  const markDone = useMutation(api.studyTasks.completeStudyItem);

  // Mark one item done in the persisted task (best-effort; failure is silent so
  // a network blip never blocks the UI).
  const completeItem = useCallback(
    (itemId: string, done = true) => {
      if (!token || !conversationId || !activeTask) return;
      void markDone({ token, conversationId, taskKey: activeTask.taskKey, itemId, done });
    },
    [token, conversationId, activeTask, markDone],
  );

  const isLoading = activeTask === undefined;
  const locked = activeTask != null && !activeTask.complete;

  return {
    // null = no active task (unlocked); object = active task state
    task: activeTask ?? null,
    isLoading,
    locked,
    completeItem,
  };
}
