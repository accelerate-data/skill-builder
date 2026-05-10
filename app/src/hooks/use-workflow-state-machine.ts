import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useAgentStore } from "@/stores/agent-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  runWorkflowStep,
  verifyStepOutput,
  getDisabledSteps,
  resetWorkflowStep,
  endWorkflowSession,
  logFrontend,
} from "@/lib/tauri";
import { invalidateWorkflowArtifactsAfterStep } from "@/lib/queries/agent-stream-cache";
import { requireSettingsModel } from "@/lib/models";
import { type StepConfig } from "@/lib/workflow-step-configs";
import { toast } from "@/lib/toast";
import { useWorkflowGate } from "@/hooks/use-workflow-gate";
import { parseResultTextPayload } from "@/lib/result-text-payload";

const WORKFLOW_MATERIALIZATION_WAIT_MS = 5000;

interface WorkflowStepMaterializedPayload {
  agentId: string;
  skillName?: string;
  stepId: number;
  success: boolean;
  errorDetail?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getString(
  record: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function getNumber(
  record: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function getBoolean(
  record: Record<string, unknown>,
  ...keys: string[]
): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function normalizeWorkflowStepMaterializedPayload(
  payload: unknown,
): WorkflowStepMaterializedPayload | null {
  const record = asRecord(payload);
  if (!record) return null;
  const agentId = getString(record, "agent_id", "agentId");
  const stepId = getNumber(record, "step_id", "stepId");
  const success = getBoolean(record, "success");
  if (!agentId || stepId === undefined || success === undefined) return null;

  return {
    agentId,
    skillName: getString(record, "skill_name", "skillName"),
    stepId,
    success,
    errorDetail: getString(record, "error_detail", "errorDetail"),
  };
}

interface UseWorkflowStateMachineOptions {
  skillId: number | null;
  skillName: string;
  /** Plugin slug for the skill (looked up from skill store) */
  pluginSlug?: string;
  /** Workspace path from settings */
  workspacePath: string | null;
  /** Skills output directory from settings */
  skillsPath: string | null;
  /** Current step index */
  currentStep: number;
  /** All steps in the workflow */
  steps: Array<{ id: number; status: string; name: string }>;
  /** Current step configuration */
  stepConfig: StepConfig | undefined;
  /** Whether page has hydrated */
  hydrated: boolean;
  /** Whether in review mode */
  reviewMode: boolean;
  /** Disabled steps that cannot be auto-advanced to */
  disabledSteps: number[];
  /** Whether an error step has partial artifacts */
  errorHasArtifacts: boolean;
  /** Workflow purpose */
  purpose: string | null;
  /** Step configurations for all steps */
  stepConfigs: Record<number, StepConfig>;
  /** Recreate the selected skill's OpenHands session after reset clears conversation state. */
  restartOpenHandsSession: () => Promise<void>;
}

/**
 * Manages the workflow state machine: step advancement, agent execution,
 * gate evaluation (via useWorkflowGate), and all associated state transitions.
 */
export function useWorkflowStateMachine({
  skillId,
  skillName,
  pluginSlug,
  workspacePath,
  skillsPath: _skillsPath,
  currentStep,
  steps,
  stepConfig,
  hydrated,
  reviewMode,
  disabledSteps: _disabledSteps,
  errorHasArtifacts: _errorHasArtifacts,
  purpose,
  stepConfigs,
  restartOpenHandsSession,
}: UseWorkflowStateMachineOptions) {
  // Store actions (individual selectors to avoid new object reference on every render)
  const setCurrentStep = useWorkflowStore((s) => s.setCurrentStep);
  const updateStepStatus = useWorkflowStore((s) => s.updateStepStatus);
  const setRunning = useWorkflowStore((s) => s.setRunning);
  const setStopping = useWorkflowStore((s) => s.setStopping);
  const setInitializing = useWorkflowStore((s) => s.setInitializing);
  const clearInitializing = useWorkflowStore((s) => s.clearInitializing);
  const setGateLoading = useWorkflowStore((s) => s.setGateLoading);
  const resetToStep = useWorkflowStore((s) => s.resetToStep);

  const setActiveAgent = useAgentStore((s) => s.setActiveAgent);
  const clearRuns = useAgentStore((s) => s.clearRuns);
  const agentStartRun = useAgentStore((s) => s.startRun);

  // Step switch state (when user clicks sidebar while agent running)
  const [pendingStepSwitch, setPendingStepSwitch] = useState<number | null>(
    null,
  );

  // Reset confirmation state
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetTarget, setResetTarget] = useState<number | null>(null);

  // Auto-start state
  const [pendingAutoStartStep, setPendingAutoStartStep] = useState<
    number | null
  >(null);

  // Refs for cross-effect communication
  const prevReviewModeRef = useRef<boolean | null>(null);
  const workflowMaterializationRef = useRef<
    Record<string, WorkflowStepMaterializedPayload>
  >({});
  const pendingWorkflowCompletionRef = useRef<Record<string, { step: number }>>(
    {},
  );
  const workflowMaterializationTimeoutsRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});

  // Current state selectors
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const runs = useAgentStore((s) => s.runs);
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const gateLoading = useWorkflowStore((s) => s.gateLoading);

  const isAgentType =
    stepConfig?.type === "agent" || stepConfig?.type === "reasoning";
  const activeRun = activeAgentId ? runs[activeAgentId] : null;
  const activeRunStatus = activeRun?.status;

  // --- Helper functions ---

  const endActiveSession = useCallback(() => {
    const sessionId = useWorkflowStore.getState().workflowSessionId;
    if (sessionId) {
      endWorkflowSession(sessionId).catch((e) =>
        console.warn(
          "[use-workflow-state-machine] non-fatal: op=endWorkflowSession err=%s",
          e,
        ),
      );
      useWorkflowStore.setState({ workflowSessionId: null });
    }
  }, []);

  const extractResultPayload = useCallback(
    (agentId: string): unknown | null => {
      const run = useAgentStore.getState().runs[agentId];
      if (!run) return null;
      const state = run.conversationState;
      if (state?.resultText) return parseResultTextPayload(state.resultText);

      return null;
    },
    [],
  );

  const clearWorkflowMaterializationTimeout = useCallback((agentId: string) => {
    const timeout = workflowMaterializationTimeoutsRef.current[agentId];
    if (timeout) {
      clearTimeout(timeout);
      delete workflowMaterializationTimeoutsRef.current[agentId];
    }
  }, []);

  const failWorkflowStep = useCallback(
    (step: number, message: string) => {
      updateStepStatus(step, "error");
      setRunning(false);
      setStopping(false);
      setActiveAgent(null);
      const workflowState = useWorkflowStore.getState();
      if (workflowState.isInitializing) {
        workflowState.clearInitializing();
      }
      toast.error(message, { duration: Infinity });
    },
    [setActiveAgent, setRunning, setStopping, updateStepStatus],
  );

  const verifyOutputFiles = useCallback(
    async (
      step: number,
      options: { optimisticOnError?: boolean } = {},
    ): Promise<boolean> => {
      const optimisticOnError = options.optimisticOnError ?? true;
      if (!workspacePath || !skillName) return true;
      try {
        const hasOutput = await verifyStepOutput(workspacePath, skillName, step);
        if (!hasOutput) return false;
      } catch {
        return optimisticOnError;
      }
      return true;
    },
    [skillName, workspacePath],
  );

  const finalizeCompletedStep = useCallback(
    async (step: number) => {
      if (skillId != null) {
        try {
          const disabled = await getDisabledSteps(skillId);
          useWorkflowStore.getState().setDisabledSteps(disabled);
        } catch {
          // Non-fatal
        }
      }

      // Guard against race with reset: if the step was reset while async operations
      // were in flight, abort rather than overwriting the reset state with "completed".
      if (useWorkflowStore.getState().steps[step]?.status !== "in_progress") {
        console.warn(
          "[workflow] finish() aborted for step %d — step was reset during async completion",
          step,
        );
        return;
      }

      updateStepStatus(step, "completed");
      setRunning(false);
      setStopping(false);

      // Invalidate workflow artifact caches so the DB-backed queries pick up
      // the newly materialized clarifications / decisions data.
      if (skillName) {
        invalidateWorkflowArtifactsAfterStep(skillName, step);
      }
    },
    [skillName, setRunning, setStopping, updateStepStatus],
  );

  const resolveWorkflowStepCompletion = useCallback(
    async (agentId: string, step: number) => {
      clearWorkflowMaterializationTimeout(agentId);
      delete pendingWorkflowCompletionRef.current[agentId];

      const materialization = workflowMaterializationRef.current[agentId];
      if (materialization?.success === false) {
        failWorkflowStep(
          step,
          `Step ${step + 1} backend materialization failed: ${
            materialization.errorDetail ?? "Unknown error"
          }`,
        );
        return;
      }

      if (materialization?.success === true) {
        await finalizeCompletedStep(step);
        return;
      }

      const hasOutput = await verifyOutputFiles(step, {
        optimisticOnError: false,
      });
      if (hasOutput) {
        await finalizeCompletedStep(step);
        return;
      }

      pendingWorkflowCompletionRef.current[agentId] = { step };
      workflowMaterializationTimeoutsRef.current[agentId] = setTimeout(() => {
        void (async () => {
          delete pendingWorkflowCompletionRef.current[agentId];
          delete workflowMaterializationTimeoutsRef.current[agentId];

          const latest = workflowMaterializationRef.current[agentId];
          if (latest?.success === false) {
            failWorkflowStep(
              step,
              `Step ${step + 1} backend materialization failed: ${
                latest.errorDetail ?? "Unknown error"
              }`,
            );
            return;
          }
          if (
            latest?.success === true ||
            (await verifyOutputFiles(step, { optimisticOnError: false }))
          ) {
            await finalizeCompletedStep(step);
            return;
          }
          failWorkflowStep(
            step,
            `Step ${step + 1} completed but backend materialization did not produce output files`,
          );
        })();
      }, WORKFLOW_MATERIALIZATION_WAIT_MS);
    },
    [
      clearWorkflowMaterializationTimeout,
      failWorkflowStep,
      finalizeCompletedStep,
      verifyOutputFiles,
    ],
  );

  useEffect(
    () => () => {
      for (const timeout of Object.values(
        workflowMaterializationTimeoutsRef.current,
      )) {
        clearTimeout(timeout);
      }
      workflowMaterializationTimeoutsRef.current = {};
      pendingWorkflowCompletionRef.current = {};
    },
    [],
  );

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen<unknown>("workflow-step-materialized", (event) => {
      const payload = normalizeWorkflowStepMaterializedPayload(event.payload);
      if (!payload || payload.stepId < 0 || payload.stepId > 3) return;
      if (payload.skillName && payload.skillName !== skillName) return;

      workflowMaterializationRef.current[payload.agentId] = payload;
      const pending = pendingWorkflowCompletionRef.current[payload.agentId];
      if (payload.success && pending) {
        void resolveWorkflowStepCompletion(payload.agentId, pending.step);
        return;
      }

      if (!payload.success) {
        clearWorkflowMaterializationTimeout(payload.agentId);
        delete pendingWorkflowCompletionRef.current[payload.agentId];
        const { currentStep: step, steps: currentSteps } =
          useWorkflowStore.getState();
        if (
          pending ||
          (currentSteps[step]?.status === "in_progress" &&
            useAgentStore.getState().activeAgentId === payload.agentId &&
            payload.stepId === step)
        ) {
          const failedStep = pending?.step ?? step;
          failWorkflowStep(
            failedStep,
            `Step ${failedStep + 1} backend materialization failed: ${
              payload.errorDetail ?? "Unknown error"
            }`,
          );
        }
      }
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
      } else {
        unlisten = cleanup;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [
    clearWorkflowMaterializationTimeout,
    failWorkflowStep,
    resolveWorkflowStepCompletion,
    skillName,
  ]);

  // --- Auto-advance logic ---

  const advanceToNextStep = useCallback(() => {
    const { gateLoading: gateLoadingNow, disabledSteps: disabled } =
      useWorkflowStore.getState();
    if (gateLoadingNow || gate.gateAgentIdRef.current) return;
    if (currentStep >= steps.length - 1) return;
    const nextStep = currentStep + 1;

    if (disabled.includes(nextStep)) return;

    setCurrentStep(nextStep);
    setPendingAutoStartStep(nextStep);
  }, [currentStep, steps, setCurrentStep]);

  // --- Gate evaluation (delegated to useWorkflowGate) ---

  const gate = useWorkflowGate({
    skillId,
    skillName,
    pluginSlug,
    workspacePath,
    currentStep,
    purpose,
    advanceToNextStep,
    cancelPendingAutoStart: () => setPendingAutoStartStep(null),
  });

  // --- Auto-start effects ---

  // Auto-start when advancing from a completed step or on review→update toggle
  useEffect(() => {
    if (pendingAutoStartStep === null) return;
    // Read currentStep directly from the store to avoid stale selector values
    // after resetToStep() + autoStartAfterReset() in the same tick.
    const storeStep = useWorkflowStore.getState().currentStep;
    if (pendingAutoStartStep !== storeStep) {
      logFrontend(
        "warn",
        `[auto-start] BLOCKED: pendingAutoStartStep=${pendingAutoStartStep} !== storeStep=${storeStep} (selectorStep=${currentStep})`,
      );
      setPendingAutoStartStep(null);
      return;
    }
    if (!isAgentType) {
      logFrontend(
        "warn",
        `[auto-start] BLOCKED: step ${currentStep} is not an agent type`,
      );
      return;
    }
    if (isRunning) {
      logFrontend("warn", `[auto-start] BLOCKED: isRunning=true`);
      return;
    }
    if (gateLoading || gate.gateAgentIdRef.current) {
      logFrontend(
        "warn",
        `[auto-start] BLOCKED: gateLoading=${gateLoading} gateAgentId=${gate.gateAgentIdRef.current}`,
      );
      return;
    }
    const storeSteps = useWorkflowStore.getState().steps;
    if (storeSteps[storeStep]?.status !== "pending") {
      logFrontend(
        "warn",
        `[auto-start] BLOCKED: step ${storeStep} status=${storeSteps[storeStep]?.status} (expected pending)`,
      );
      setPendingAutoStartStep(null);
      return;
    }
    logFrontend("info", `[auto-start] STARTING step ${storeStep}`);
    setPendingAutoStartStep(null);
    handleStartAgentStep();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pendingAutoStartStep,
    currentStep,
    steps,
    isRunning,
    isAgentType,
    gateLoading,
  ]);

  // Auto-start when switching from Review → Update mode on a pending agent step
  useEffect(() => {
    if (!hydrated) return;

    const wasToggle = prevReviewModeRef.current === true && !reviewMode;
    prevReviewModeRef.current = reviewMode;

    if (!wasToggle) return;
    if (!workspacePath) return;
    if (isRunning || pendingAutoStartStep !== null || gateLoading) return;

    // Use the same target step as the reposition effect (Effect C) so that
    // pendingAutoStartStep matches where currentStep will land after reposition.
    // Without this, viewing a later completed step in Review mode causes a mismatch:
    // wasToggle sets pendingAutoStartStep=viewingStep, reposition moves currentStep
    // to firstIncompleteStep, and Effect A sees they differ and skips auto-start.
    const { disabledSteps: disabled } = useWorkflowStore.getState();
    const first = steps.find(
      (s) => s.status !== "completed" && !disabled.includes(s.id),
    );
    const targetStep = first ? first.id : currentStep;

    const status = steps[targetStep]?.status;
    if (status && status !== "pending") return;
    console.log(
      `[workflow] Auto-starting step ${targetStep} (review→update toggle)`,
    );
    setPendingAutoStartStep(targetStep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, reviewMode]);

  // Reposition to first incomplete step when switching to Update mode
  useEffect(() => {
    if (!hydrated || reviewMode) return;
    const currentCfg = stepConfigs[currentStep];
    if (
      currentCfg?.clarificationsEditable &&
      steps[currentStep]?.status === "completed"
    ) {
      return;
    }
    const { disabledSteps: disabled } = useWorkflowStore.getState();
    const first = steps.find(
      (s) => s.status !== "completed" && !disabled.includes(s.id),
    );
    const target = first ? first.id : currentStep;
    if (target !== currentStep) {
      setCurrentStep(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewMode]);

  // --- Agent completion watchers ---

  // Watch for gate agent (answer evaluator) completion
  useEffect(() => {
    if (!activeRunStatus || !activeAgentId) return;
    if (gate.gateAgentIdRef.current !== activeAgentId) return;

    if (activeRunStatus === "completed" || activeRunStatus === "error") {
      const completedGateAgentId = activeAgentId;
      const gateStep = gate.gateStepRef.current;
      gate.gateAgentIdRef.current = null;
      setActiveAgent(null);

      if (activeRunStatus === "error") {
        clearRuns();
        console.warn("[workflow] Gate evaluation failed");
        const stepToRestore =
          gateStep ?? useWorkflowStore.getState().currentStep;
        setPendingAutoStartStep(null);
        setCurrentStep(stepToRestore);
        setGateLoading(false);
        setStopping(false);
        updateStepStatus(stepToRestore, "completed");
        gate.gateStepRef.current = null;
        toast.error("Answer evaluation failed. Review the workflow logs and retry.", {
          duration: Infinity,
        });
        return;
      }

      const evaluationPayload =
        extractResultPayload(completedGateAgentId);
      clearRuns();
      gate.finishGateEvaluation(evaluationPayload).finally(() => {
        gate.gateStepRef.current = null;
      });
    }
  }, [
    activeRunStatus,
    activeAgentId,
    extractResultPayload,
    setGateLoading,
    setStopping,
    updateStepStatus,
    advanceToNextStep,
    clearRuns,
    setActiveAgent,
  ]);

  // Watch for workflow step agent completion
  useEffect(() => {
    if (!activeRunStatus || !activeAgentId) return;
    if (gate.gateAgentIdRef.current === activeAgentId) return;

    const { steps: currentSteps, currentStep: step } =
      useWorkflowStore.getState();
    if (currentSteps[step]?.status !== "in_progress") return;

    if (activeRunStatus === "completed") {
      const completedAgentId = activeAgentId;
      setActiveAgent(null);

      const finish = async () => {
        await resolveWorkflowStepCompletion(completedAgentId, step);
      };

      finish();
    } else if (activeRunStatus === "error") {
      const errorDetail = activeRun?.resultErrors?.length
        ? activeRun.resultErrors.join("; ")
        : null;
      updateStepStatus(step, "error");
      setRunning(false);
      setStopping(false);
      setActiveAgent(null);
      const workflowState = useWorkflowStore.getState();
      if (workflowState.isInitializing) {
        workflowState.clearInitializing();
      }
      toast.error(
        errorDetail
          ? `Step ${step + 1} failed: ${errorDetail}`
          : `Step ${step + 1} failed`,
        { duration: Infinity },
      );
    } else if (activeRunStatus === "shutdown") {
      setActiveAgent(null);
      setRunning(false);
      setStopping(false);
      updateStepStatus(step, "pending");
      toast.info("Step cancelled");
    }
  }, [
    activeRunStatus,
    activeAgentId,
    resolveWorkflowStepCompletion,
    updateStepStatus,
    setRunning,
    setStopping,
    setActiveAgent,
    skillName,
    workspacePath,
    clearInitializing,
  ]);

  // --- Step execution ---

  const handleStartAgentStep = useCallback(
    async (overrideStep?: number) => {
      // Guard: when passed directly to onClick, React sends a MouseEvent as the first arg.
      const targetStep =
        typeof overrideStep === "number" ? overrideStep : currentStep;
      if (!workspacePath) {
        toast.error("Missing workspace path", { duration: Infinity });
        return;
      }
      // Read state from the store directly — avoids stale closures when called
      // from performStepReset before React re-renders with cleared state.
      const storeState = useWorkflowStore.getState();
      if (
        storeState.isRunning ||
        storeState.gateLoading ||
        gate.gateAgentIdRef.current
      ) {
        return;
      }

      let model: string;
      try {
        model = requireSettingsModel(
          useSettingsStore.getState().modelSettings.model,
        );
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : String(err),
          { duration: Infinity },
        );
        return;
      }

      try {
        clearRuns();
        useWorkflowStore.getState().clearRuntimeError();
        updateStepStatus(targetStep, "in_progress");
        setRunning(true);
        setInitializing();

        console.log(
          `[workflow] Starting step ${targetStep} for skill "${skillName}"`,
        );
        const sessionId = useWorkflowStore.getState().workflowSessionId;
        if (skillId == null) {
          throw new Error("Missing skill ID");
        }
        const agentId = await runWorkflowStep(
          skillId,
          skillName,
          targetStep,
          workspacePath,
          sessionId ?? undefined,
        );
        agentStartRun(agentId, model);
      } catch (err) {
        updateStepStatus(targetStep, "error");
        setRunning(false);
        setStopping(false);
        clearInitializing();
        toast.error(
          `Failed to start agent: ${err instanceof Error ? err.message : String(err)}`,
          { duration: Infinity },
        );
      }
    },
    [
      workspacePath,
      skillName,
      currentStep,
      gate,
      clearRuns,
      updateStepStatus,
      setRunning,
      setInitializing,
      clearInitializing,
      agentStartRun,
    ],
  );

  // --- Step reset ---

  const performStepReset = async (stepId: number) => {
    // Steps 0 (Research) and 1 (Detailed Research) share the same OpenHands
    // conversation. Resetting step 1 clears the conversation ID from the DB, so
    // step 1 cannot resume without step 0 first creating a new conversation.
    // Treat any reset of step 1 as a full reset to step 0.
    const effectiveStepId = stepId === 1 ? 0 : stepId;
    logFrontend(
      "info",
      `[performStepReset] resetting step ${stepId}, effectiveStepId=${effectiveStepId}, isRunning=${useWorkflowStore.getState().isRunning}, reviewMode=${useWorkflowStore.getState().reviewMode}`,
    );
    endActiveSession();
    setPendingAutoStartStep(null);
    // Clear gate state so Effect A isn't blocked when auto-starting after reset.
    gate.gateAgentIdRef.current = null;
    useWorkflowStore.getState().setGateLoading(false);
    if (workspacePath) {
      try {
        await resetWorkflowStep(workspacePath, skillName, effectiveStepId);
        await restartOpenHandsSession();
      } catch {
        // best-effort
      }
    }
    clearRuns();
    resetToStep(effectiveStepId);

    let disabled: number[] = [];
    if (skillId != null) {
      try {
        disabled = await getDisabledSteps(skillId);
        useWorkflowStore.getState().setDisabledSteps(disabled);
      } catch {
        // non-fatal
      }
    }

    if (!disabled.includes(effectiveStepId)) {
      // Start the agent directly instead of going through the pendingAutoStartStep →
      // useEffect pipeline. The effect-based approach is unreliable here because React 18
      // may batch the Zustand store updates (from resetToStep) with the React state change
      // (setPendingAutoStartStep), causing the effect to fire with stale selector values.
      const { reviewMode: isReview } = useWorkflowStore.getState();
      const cfg = stepConfigs[effectiveStepId];
      if ((cfg?.type === "agent" || cfg?.type === "reasoning") && !isReview) {
        logFrontend("info", `[performStepReset] auto-starting step ${effectiveStepId}`);
        handleStartAgentStep(effectiveStepId);
      }
    }
  };

  return {
    // State
    ...gate,
    pendingStepSwitch,
    showResetConfirm,
    resetTarget,
    pendingAutoStartStep,

    // State setters
    setPendingStepSwitch,
    setShowResetConfirm,
    setResetTarget,

    // Handlers
    handleStartAgentStep,
    performStepReset,
  };
}
