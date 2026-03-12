import { useCallback, useEffect, useRef, useState } from "react";
import type { SaveStatus } from "@/components/clarifications-editor";
import type { ClarificationsFile } from "@/lib/clarifications-types";
import { parseClarifications, getClarificationsContent, saveClarificationsContent, readFile } from "@/lib/tauri";
import { toast } from "@/lib/toast";

interface UseWorkflowAutosaveOptions {
  /** Workspace path from settings */
  workspacePath: string | null;
  /** Skill name from route params */
  skillName: string;
  /** Whether current step allows clarifications editing */
  clarificationsEditable: boolean | undefined;
  /** Current step completion status */
  currentStepStatus: string | undefined;
}

export function useWorkflowAutosave({
  workspacePath,
  skillName,
  clarificationsEditable,
  currentStepStatus,
}: UseWorkflowAutosaveOptions) {
  // Clarifications file content and parsed state
  const [reviewContent, setReviewContent] = useState<string | null>(null);
  const [clarificationsData, setClarificationsData] = useState<ClarificationsFile | null>(null);

  // Editor dirty tracking and save status
  const [editorDirty, setEditorDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  // Refs for cleanup and unsaved-changes detection
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasUnsavedChangesRef = useRef(false);

  // Load clarifications file when visiting a completed, clarifications-editable step
  useEffect(() => {
    if (!clarificationsEditable || currentStepStatus !== "completed" || !workspacePath) {
      setReviewContent(null);
      setClarificationsData(null);
      return;
    }

    const loadContent = async () => {
      try {
        const content = await getClarificationsContent(skillName, workspacePath);
        const parsed = parseClarifications(content ?? null);
        setReviewContent(content ?? null);
        setClarificationsData(parsed);
        setEditorDirty(false);
      } catch (err) {
        console.error("[autosave] Failed to load clarifications:", err);
      }
    };

    loadContent();
  }, [currentStepStatus, clarificationsEditable, workspacePath, skillName]);

  // Handle editor content changes
  const handleClarificationsChange = useCallback((updated: ClarificationsFile) => {
    setClarificationsData(updated);
    setEditorDirty(true);
    setSaveStatus("dirty");
    hasUnsavedChangesRef.current = true;
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
  }, []);

  // Save clarifications content via backend command
  const handleSave = useCallback(
    async (silent = false): Promise<boolean> => {
      if (!clarificationsEditable || !workspacePath) return false;

      setSaveStatus("saving");
      try {
        const content = clarificationsData
          ? JSON.stringify(clarificationsData, null, 2)
          : (reviewContent ?? "");
        await saveClarificationsContent(skillName, workspacePath, content);
        setReviewContent(content);
        setEditorDirty(false);
        hasUnsavedChangesRef.current = false;
        setSaveStatus("saved");

        // Show "Saved" for 2s, then return to idle
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);

        if (!silent) toast.success("Saved");
        return true;
      } catch (err) {
        setSaveStatus("dirty"); // Revert to dirty on failure
        hasUnsavedChangesRef.current = true;
        toast.error(`Failed to save: ${err instanceof Error ? err.message : String(err)}`, {
          duration: Infinity,
          cause: err,
          context: { operation: "workflow_autosave", skillName },
        });
        return false;
      }
    },
    [clarificationsEditable, workspacePath, reviewContent, clarificationsData, skillName]
  );

  // Debounce autosave: fires 1500ms after last edit on completed clarifications-editable step
  useEffect(() => {
    if (!clarificationsEditable || currentStepStatus !== "completed" || !editorDirty) return;

    const timer = setTimeout(() => {
      handleSave(true);
    }, 1500);

    return () => clearTimeout(timer);
  }, [clarificationsData, editorDirty, clarificationsEditable, currentStepStatus, handleSave]);

  // Cleanup: cancel pending save timers on unmount
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  return {
    reviewContent,
    clarificationsData,
    editorDirty,
    saveStatus,
    hasUnsavedChangesRef,
    handleClarificationsChange,
    handleSave,
  };
}
