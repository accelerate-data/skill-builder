import { useEffect, useState } from "react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useAgentStore } from "@/stores/agent-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  getWorkflowState,
  getDisabledSteps,
  saveWorkflowState,
  readFile,
  verifyStepOutput,
} from "@/lib/tauri";
import { invalidateSkillDataAfterWorkflow } from "@/lib/queries/agent-stream-cache";
import { joinPath } from "@/lib/path-utils";

interface UseWorkflowPersistenceOptions {
  /** Skill name from route params */
  skillName: string;
  /** Skills directory path from settings */
  skillsPath: string | null;
  /** Current step configuration for output file paths */
  stepConfig: { outputFiles?: string[] } | undefined;
  /** Current step index */
  currentStep: number;
  /** All steps in the workflow */
  steps: Array<{ id: number; status: string }>;
  /** Workflow purpose/description */
  purpose: string | null;
  /** Whether the page has hydrated from saved state */
  hydrated: boolean;
  /** When true, switch to Update mode after hydration to auto-start the first pending step. */
  autoStart?: boolean;
}

export function useWorkflowPersistence({
  skillName,
  skillsPath,
  stepConfig,
  currentStep,
  steps,
  purpose,
  hydrated,
  autoStart = false,
}: UseWorkflowPersistenceOptions) {
  const [errorHasArtifacts, setErrorHasArtifacts] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Get store actions
  const initWorkflow = useWorkflowStore((state) => state.initWorkflow);
  const loadWorkflowState = useWorkflowStore((state) => state.loadWorkflowState);
  const setHydrated = useWorkflowStore((state) => state.setHydrated);

  const clearRuns = useAgentStore.getState().clearRuns;

  // Initialize workflow from saved state on skill change
  useEffect(() => {
    let cancelled = false;

    const store = useWorkflowStore.getState();

    // Skip if already hydrated for this skill.
    // Always reset reviewMode to match navigation intent: Update for autoStart, Review otherwise.
    // Without the else branch, re-navigating to a skill previously opened with autoStart=true
    // would leave reviewMode=false on a plain row-click (no autoStart).
    if (store.skillName === skillName && store.hydrated) {
      setIsLoaded(true);
      store.setReviewMode(!autoStart);
      return;
    }

    // Capture and clear pendingNoReviewMode synchronously before async work.
    // When true (sidebar navigation to in-progress skill), we pass initialReviewMode=false
    // directly to initWorkflow so reviewMode never transitions true→false — preventing the
    // wasToggle auto-start in use-workflow-state-machine.ts.
    const isNoReviewMode = store.pendingNoReviewMode;
    if (isNoReviewMode) {
      store.setPendingNoReviewMode(false);
    }

    // Clear stale agent data from previous skill
    clearRuns();

    // Read workflow state and disabled steps in parallel
    Promise.all([
      getWorkflowState(skillName),
      getDisabledSteps(skillName).catch(() => [] as number[]),
    ])
      .then(([state, disabled]) => {
        if (cancelled) return;
        setIsLoaded(true);

        // Initialize workflow with purpose from saved state.
        // Pass initialReviewMode=false for sidebar navigation to suppress wasToggle auto-start.
        initWorkflow(skillName, state.run?.purpose, isNoReviewMode ? false : undefined);

        // Apply disabled steps immediately
        useWorkflowStore.getState().setDisabledSteps(disabled);

        if (!state.run) {
          setHydrated(true);
          return;
        }

        const completedIds = state.steps
          .filter((s) => s.status === "completed")
          .map((s) => s.step_id);
        loadWorkflowState(completedIds, state.run.current_step);
      })
      .catch(() => {
        if (!cancelled) {
          setIsLoaded(true);
          setHydrated(true);
        }
      })
      .finally(() => {
        // If autoStart was requested, switch to Update mode after hydration so the
        // wasToggle effect (reviewMode: true→false) fires and schedules auto-start.
        if (!cancelled && autoStart) {
          useWorkflowStore.getState().setReviewMode(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillName]);

  // Reset error artifact detection when moving to a new step
  useEffect(() => {
    setErrorHasArtifacts(false);
  }, [currentStep]);

  // Error-state artifact check: detect whether a failed step left partial output.
  // Steps 0-2 are DB-backed (clarifications/decisions); step 3+ are file-backed (SKILL.md).
  // Distinguish by whether the first outputFile starts with "skill/" (file) or "context/" (DB).
  useEffect(() => {
    const stepStatus = steps[currentStep]?.status;

    if (stepStatus === "error" && skillName) {
      const firstOutput = stepConfig?.outputFiles?.[0];
      if (!firstOutput) {
        setErrorHasArtifacts(false);
        return;
      }

      if (firstOutput.startsWith("skill/")) {
        if (skillsPath) {
          readFile(joinPath(skillsPath, skillName, firstOutput.slice("skill/".length)))
            .then((content) => setErrorHasArtifacts(!!content))
            .catch(() => setErrorHasArtifacts(false));
        } else {
          setErrorHasArtifacts(false);
        }
      } else {
        const workspacePath = useSettingsStore.getState().workspacePath;
        if (workspacePath) {
          verifyStepOutput(workspacePath, skillName, currentStep)
            .then((has) => setErrorHasArtifacts(has))
            .catch(() => setErrorHasArtifacts(false));
        } else {
          setErrorHasArtifacts(false);
        }
      }
    } else {
      setErrorHasArtifacts(false);
    }
  }, [currentStep, steps, skillsPath, skillName, stepConfig?.outputFiles]);

  // Debounced SQLite persistence — saves workflow state at most once per 300ms
  useEffect(() => {
    if (!hydrated) return;

    const store = useWorkflowStore.getState();
    if (store.skillName !== skillName) return;

    const timer = setTimeout(() => {
      const latestStore = useWorkflowStore.getState();
      if (latestStore.skillName !== skillName) return;

      const stepStatuses = latestStore.steps.map((s) => ({
        step_id: s.id,
        status: s.status,
      }));

      let status: string;
      if (latestStore.steps[latestStore.currentStep]?.status === "in_progress") {
        status = "in_progress";
      } else if (latestStore.steps.every((s) => s.status === "completed")) {
        status = "completed";
      } else {
        status = "pending";
      }

      // When viewing (not running or completed), persist the highest completed step so
      // navigating back to view a previous step doesn't decrease current_step in the DB.
      const highestCompletedStep = latestStore.steps.reduce(
        (max, s, idx) => s.status === "completed" ? Math.max(max, idx) : max,
        latestStore.currentStep,
      );
      const stepToSave = status === "pending" ? highestCompletedStep : latestStore.currentStep;

      saveWorkflowState(skillName, stepToSave, status, stepStatuses, purpose ?? undefined)
        .then(() => {
          invalidateSkillDataAfterWorkflow()
            .catch((err) => console.error("event=refresh_skills_failed error=%s", err));
        })
        .catch((err) => console.error("Failed to persist workflow state:", err));
    }, 300);

    return () => clearTimeout(timer);
  }, [steps, currentStep, skillName, purpose, hydrated]);

  return {
    errorHasArtifacts,
    isLoaded,
  };
}
