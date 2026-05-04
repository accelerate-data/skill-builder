import { useCallback, useEffect, useRef, useState } from "react";
import type { SaveStatus } from "@/components/clarifications-editor";
import type { ClarificationsFile, Question } from "@/lib/clarifications-types";
import { invokeCommand } from "@/lib/tauri";
import { toast } from "@/lib/toast";

interface UseWorkflowAutosaveOptions {
  /** Skill name from route params */
  skillName: string;
  /** Whether current step allows clarifications editing */
  clarificationsEditable: boolean | undefined;
  /** Current step completion status */
  currentStepStatus: string | undefined;
  /** Clarifications data from DB query — used as the base for editor state */
  dbClarificationsData?: ClarificationsFile | null;
}

/** Flatten all questions (including refinements) from a ClarificationsFile */
function flattenQuestions(questions: Question[]): Question[] {
  return questions.flatMap((q) => [q, ...flattenQuestions(q.refinements ?? [])]);
}

function flattenFileQuestions(data: ClarificationsFile): Question[] {
  return (data.sections ?? []).flatMap((s) => flattenQuestions(s.questions ?? []));
}

function sameClarificationsData(
  left: ClarificationsFile | null | undefined,
  right: ClarificationsFile | null | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

export function useWorkflowAutosave({
  skillName,
  clarificationsEditable,
  currentStepStatus,
  dbClarificationsData,
}: UseWorkflowAutosaveOptions) {
  // Editor local state — initialized from DB data, tracks in-progress edits
  const [clarificationsData, setClarificationsData] = useState<ClarificationsFile | null>(null);

  // Editor dirty tracking and save status
  const [editorDirty, setEditorDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  // Refs for cleanup and unsaved-changes detection
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasUnsavedChangesRef = useRef(false);
  const clarificationsDataRef = useRef<ClarificationsFile | null>(null);

  useEffect(() => {
    clarificationsDataRef.current = clarificationsData;
  }, [clarificationsData]);

  // Sync local state when DB data arrives (initial load) or when step changes
  useEffect(() => {
    if (!clarificationsEditable || currentStepStatus !== "completed") {
      setClarificationsData(null);
      setEditorDirty(false);
      setSaveStatus("idle");
      hasUnsavedChangesRef.current = false;
      return;
    }
    // Update local state from DB data when not dirty (don't overwrite in-flight edits)
    if (
      dbClarificationsData &&
      !hasUnsavedChangesRef.current &&
      !sameClarificationsData(clarificationsDataRef.current, dbClarificationsData)
    ) {
      setClarificationsData(dbClarificationsData);
      setEditorDirty(false);
    }
  }, [clarificationsEditable, currentStepStatus, dbClarificationsData]);

  // Persist a single question answer change to the DB
  const persistQuestionAnswer = useCallback(
    async (questionId: string, answerChoice: string | null, answerText: string | null) => {
      try {
        await invokeCommand("update_clarification_answer", {
          skillId: skillName,
          questionId,
          answerChoice,
          answerText,
        });
      } catch (err) {
        toast.error(`Failed to save answer: ${err instanceof Error ? err.message : String(err)}`, {
          duration: Infinity,
          cause: err,
          context: { operation: "workflow_autosave", skillName },
        });
        throw err;
      }
    },
    [skillName],
  );

  // Handle editor content changes — detect changed question answers and persist
  const handleClarificationsChange = useCallback(
    (updated: ClarificationsFile) => {
      // Find which questions changed vs the current local state
      const prevQuestions = flattenFileQuestions(clarificationsData ?? { sections: [] });
      const nextQuestions = flattenFileQuestions(updated);
      const prevMap = new Map(prevQuestions.map((q) => [q.id, q]));

      for (const q of nextQuestions) {
        const prev = prevMap.get(q.id);
        const choiceChanged = prev?.answer_choice !== q.answer_choice;
        const textChanged = prev?.answer_text !== q.answer_text;
        if (choiceChanged || textChanged) {
          // Fire-and-forget — errors are toasted inside persistQuestionAnswer
          setSaveStatus("saving");
          persistQuestionAnswer(q.id, q.answer_choice ?? null, q.answer_text ?? null)
            .then(() => {
              setSaveStatus("saved");
              hasUnsavedChangesRef.current = false;
              if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
              savedTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
            })
            .catch(() => {
              setSaveStatus("dirty");
              hasUnsavedChangesRef.current = true;
            });
        }
      }

      setClarificationsData(updated);
      setEditorDirty(true);
      hasUnsavedChangesRef.current = true;
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    },
    [clarificationsData, persistQuestionAnswer],
  );

  // handleSave is a no-op in the DB-backed world — answers are persisted immediately.
  // Kept for interface compatibility with callers that await it before continuing.
  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!clarificationsEditable) return false;
    // All changes are already persisted via handleClarificationsChange.
    // If no dirty changes remain, return immediately.
    if (!hasUnsavedChangesRef.current) return true;
    setEditorDirty(false);
    hasUnsavedChangesRef.current = false;
    setSaveStatus("idle");
    return true;
  }, [clarificationsEditable]);

  // Cleanup: cancel pending save timers on unmount
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  // Legacy: expose a way to update clarifications state from outside.
  // With the DB-backed approach this is rarely needed, but kept for compatibility.
  const updateClarificationsState = useCallback((data: ClarificationsFile) => {
    setClarificationsData(data);
    setEditorDirty(false);
    setSaveStatus("idle");
    hasUnsavedChangesRef.current = false;
  }, []);

  return {
    clarificationsData,
    editorDirty,
    saveStatus,
    hasUnsavedChangesRef,
    handleClarificationsChange,
    handleSave,
    updateClarificationsState,
  };
}
