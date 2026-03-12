import { useEffect, useState } from "react";
import { useWorkflowStore, useAgentStore } from "@/stores";
import {
  getWorkflowState,
  getDisabledSteps,
  saveWorkflowState,
  readFile,
  getContextFileContent,
} from "@/lib/tauri";
import { toast } from "@/lib/toast";

interface UseWorkflowPersistenceOptions {
  /** Skill name from route params */
  skillName: string;
  /** Workspace path from settings */
  workspacePath: string | null;
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
}

export function useWorkflowPersistence({
  skillName,
  workspacePath,
  skillsPath,
  stepConfig,
  currentStep,
  steps,
  purpose,
  hydrated,
}: UseWorkflowPersistenceOptions) {
  const [errorHasArtifacts, setErrorHasArtifacts] = useState(false);

  // Get store actions
  const { initWorkflow, loadWorkflowState, clearRuns, setDisabledSteps, consumeUpdateMode, setHydrated } =
    useWorkflowStore((state) => ({
      initWorkflow: state.initWorkflow,
      loadWorkflowState: state.loadWorkflowState,
      clearRuns: useAgentStore.getState().clearRuns,
      setDisabledSteps: state.setDisabledSteps,
      consumeUpdateMode: state.consumeUpdateMode,
      setHydrated: state.setHydrated,
    }));

  // Initialize workflow from saved state on skill change
  useEffect(() => {
    let cancelled = false;

    const store = useWorkflowStore.getState();

    // Skip if already hydrated for this skill
    if (store.skillName === skillName && store.hydrated) {
      consumeUpdateMode();
      return;
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

        // Initialize workflow with purpose from saved state
        initWorkflow(skillName, state.run?.purpose);

        // Apply disabled steps immediately
        useWorkflowStore.getState().setDisabledSteps(disabled);

        if (!state.run) {
          setHydrated(true);
          return;
        }

        const completedIds = state.steps
          .filter((s) => s.status === "completed")
          .map((s) => s.step_id);
        if (completedIds.length > 0) {
          loadWorkflowState(completedIds, state.run.current_step);
        } else {
          setHydrated(true);
        }
      })
      .catch(() => {
        setHydrated(true);
      })
      .finally(() => {
        // Consume the pendingUpdateMode flag exactly once
        if (!cancelled) {
          consumeUpdateMode();
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

  // Error-state artifact check: detect whether a failed step left partial output
  useEffect(() => {
    const stepStatus = steps[currentStep]?.status;

    if (stepStatus === "error" && skillName) {
      const firstOutput = stepConfig?.outputFiles?.[0];
      if (firstOutput) {
        if (firstOutput.startsWith("context/") && workspacePath) {
          getContextFileContent(skillName, workspacePath, firstOutput.slice("context/".length))
            .then((content) => setErrorHasArtifacts(!!content))
            .catch(() => setErrorHasArtifacts(false));
        } else if (skillsPath) {
          const skillsRelative = firstOutput.startsWith("skill/")
            ? firstOutput.slice("skill/".length)
            : firstOutput;
          readFile(`${skillsPath}/${skillName}/${skillsRelative}`)
            .then((content) => setErrorHasArtifacts(!!content))
            .catch(() => setErrorHasArtifacts(false));
        } else {
          setErrorHasArtifacts(false);
        }
      } else {
        setErrorHasArtifacts(false);
      }
    } else {
      setErrorHasArtifacts(false);
    }
  }, [currentStep, steps, skillsPath, workspacePath, skillName, stepConfig?.outputFiles]);

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

      saveWorkflowState(skillName, latestStore.currentStep, status, stepStatuses, purpose ?? undefined).catch(
        (err) => console.error("Failed to persist workflow state:", err)
      );
    }, 300);

    return () => clearTimeout(timer);
  }, [steps, currentStep, skillName, purpose, hydrated]);

  return {
    errorHasArtifacts,
  };
}
