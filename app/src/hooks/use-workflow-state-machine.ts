import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useSessionRuntimeStore } from "@/stores/session-runtime-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  runWorkflowStep,
  verifyStepOutput,
  getDisabledSteps,
  resetWorkflowStep,
  endWorkflowSession,
  logFrontend,
} from "@/lib/tauri";
import {
  invalidateWorkflowArtifactsAfterReset,
  invalidateWorkflowArtifactsAfterStep,
} from "@/lib/queries/agent-stream-cache";
import { requireSettingsModel } from "@/lib/models";
import { type StepConfig } from "@/lib/workflow-step-configs";
import { toast } from "@/lib/toast";
import { useWorkflowGate } from "@/hooks/use-workflow-gate";
import { parseResultTextPayload } from "@/lib/result-text-payload";

const WORKFLOW_MATERIALIZATION_WAIT_MS = 5000;

interface WorkflowStepMaterializedPayload {
  conversationId: string;
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

function getStep3VerifierStatus(payload: unknown): string | undefined {
  const record = asRecord(payload);
  if (!record) return undefined;
  const status = getString(record, "status");
  if (
    !status ||
    !["generated", "rewritten", "complete", "partial", "skipped"].includes(
      status,
    )
  ) {
    return undefined;
  }

  const verifierResult = asRecord(record.verifier_result);
  if (!verifierResult) return undefined;
  return getString(verifierResult, "status");
}

function normalizeWorkflowStepMaterializedPayload(
  payload: unknown,
): WorkflowStepMaterializedPayload | null {
  const record = asRecord(payload);
  if (!record) return null;
  const conversationId = getString(record, "conversation_id", "conversationId");
  const stepId = getNumber(record, "step_id", "stepId");
  const success = getBoolean(record, "success");
  if (!conversationId || stepId === undefined || success === undefined)
    return null;

  return {
    conversationId,
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
  skillsPath,
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
  const setActiveConversationId = useWorkflowStore(
    (s) => s.setActiveConversationId,
  );
  const resetToStep = useWorkflowStore((s) => s.resetToStep);
  const clearSessionRuns = useSessionRuntimeStore((s) => s.clearSessionRuns);
  const startSessionRun = useSessionRuntimeStore((s) => s.startSessionRun);

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
  const warnedVerifierAgentsRef = useRef<Record<string, true>>({});

  // Current state selectors
  const activeConversationId = useWorkflowStore((s) => s.activeConversationId);
  const runs = useSessionRuntimeStore((s) => s.runs);
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const gateLoading = useWorkflowStore((s) => s.gateLoading);

  const isAgentType =
    stepConfig?.type === "agent" || stepConfig?.type === "reasoning";
  const activeRun = activeConversationId ? runs[activeConversationId] : null;
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
    (conversationId: string): unknown | null => {
      const run = useSessionRuntimeStore.getState().runs[conversationId];
      if (!run) return null;
      const state = run.conversationState;
      if (state?.resultText) return parseResultTextPayload(state.resultText);

      return null;
    },
    [],
  );

  const clearWorkflowMaterializationTimeout = useCallback(
    (conversationId: string) => {
      const timeout =
        workflowMaterializationTimeoutsRef.current[conversationId];
      if (timeout) {
        clearTimeout(timeout);
        delete workflowMaterializationTimeoutsRef.current[conversationId];
      }
    },
    [],
  );

  const failWorkflowStep = useCallback(
    (step: number, message: string) => {
      updateStepStatus(step, "error");
      setRunning(false);
      setStopping(false);
      setActiveConversationId(null);
      const workflowState = useWorkflowStore.getState();
      if (workflowState.isInitializing) {
        workflowState.clearInitializing();
      }
      toast.error(message, { duration: Infinity });
    },
    [setActiveConversationId, setRunning, setStopping, updateStepStatus],
  );

  const verifyOutputFiles = useCallback(
    async (
      step: number,
      options: { optimisticOnError?: boolean } = {},
    ): Promise<boolean> => {
      const optimisticOnError = options.optimisticOnError ?? true;
      if (!workspacePath || skillId == null) return true;
      try {
        const hasOutput = await verifyStepOutput(workspacePath, skillId, step);
        if (!hasOutput) return false;
      } catch {
        return optimisticOnError;
      }
      return true;
    },
    [skillId, workspacePath],
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
      if (skillId != null) {
        invalidateWorkflowArtifactsAfterStep(String(skillId), step);
      }
    },
    [skillId, setRunning, setStopping, updateStepStatus],
  );

  const maybeWarnOnVerifierResult = useCallback(
    (conversationId: string, step: number) => {
      if (step !== 3 || warnedVerifierAgentsRef.current[conversationId]) return;

      const verifierStatus = getStep3VerifierStatus(
        extractResultPayload(conversationId),
      );
      if (!verifierStatus || verifierStatus === "pass") return;

      warnedVerifierAgentsRef.current[conversationId] = true;
      toast.warning(
        "Skill verifier reported findings. Review the generated skill before proceeding.",
      );
    },
    [extractResultPayload],
  );

  const resolveWorkflowStepCompletion = useCallback(
    async (conversationId: string, step: number) => {
      clearWorkflowMaterializationTimeout(conversationId);
      delete pendingWorkflowCompletionRef.current[conversationId];

      const materialization =
        workflowMaterializationRef.current[conversationId];
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
        maybeWarnOnVerifierResult(conversationId, step);
        await finalizeCompletedStep(step);
        return;
      }

      const hasOutput = await verifyOutputFiles(step, {
        optimisticOnError: false,
      });
      if (hasOutput) {
        maybeWarnOnVerifierResult(conversationId, step);
        await finalizeCompletedStep(step);
        return;
      }

      pendingWorkflowCompletionRef.current[conversationId] = { step };
      workflowMaterializationTimeoutsRef.current[conversationId] = setTimeout(
        () => {
          void (async () => {
            delete pendingWorkflowCompletionRef.current[conversationId];
            delete workflowMaterializationTimeoutsRef.current[conversationId];

            const latest = workflowMaterializationRef.current[conversationId];
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
              maybeWarnOnVerifierResult(conversationId, step);
              await finalizeCompletedStep(step);
              return;
            }
            failWorkflowStep(
              step,
              `Step ${step + 1} completed but backend materialization did not produce output files`,
            );
          })();
        },
        WORKFLOW_MATERIALIZATION_WAIT_MS,
      );
    },
    [
      clearWorkflowMaterializationTimeout,
      failWorkflowStep,
      finalizeCompletedStep,
      maybeWarnOnVerifierResult,
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
      warnedVerifierAgentsRef.current = {};
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

      workflowMaterializationRef.current[payload.conversationId] = payload;
      const pending =
        pendingWorkflowCompletionRef.current[payload.conversationId];
      if (payload.success && pending) {
        void resolveWorkflowStepCompletion(
          payload.conversationId,
          pending.step,
        );
        return;
      }

      if (!payload.success) {
        clearWorkflowMaterializationTimeout(payload.conversationId);
        delete pendingWorkflowCompletionRef.current[payload.conversationId];
        const { currentStep: step, steps: currentSteps } =
          useWorkflowStore.getState();
        if (
          pending ||
          (currentSteps[step]?.status === "in_progress" &&
            useWorkflowStore.getState().activeConversationId ===
              payload.conversationId &&
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
    if (gateLoadingNow || gate.gateConversationIdRef.current) return;
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
    skillsPath,
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
    if (gateLoading || gate.gateConversationIdRef.current) {
      logFrontend(
        "warn",
        `[auto-start] BLOCKED: gateLoading=${gateLoading} gateConversationId=${gate.gateConversationIdRef.current}`,
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
    if (!activeRunStatus || !activeConversationId) return;
    if (gate.gateConversationIdRef.current !== activeConversationId) return;

    if (activeRunStatus === "completed" || activeRunStatus === "error") {
      const completedGateConversationId = activeConversationId;
      const gateStep = gate.gateStepRef.current;
      gate.gateConversationIdRef.current = null;
      setActiveConversationId(null);

      if (activeRunStatus === "error") {
        clearSessionRuns();
        console.warn("[workflow] Gate evaluation failed");
        const stepToRestore =
          gateStep ?? useWorkflowStore.getState().currentStep;
        setPendingAutoStartStep(null);
        setCurrentStep(stepToRestore);
        setGateLoading(false);
        setStopping(false);
        updateStepStatus(stepToRestore, "completed");
        gate.gateStepRef.current = null;
        toast.error(
          "Answer evaluation failed. Review the workflow logs and retry.",
          {
            duration: Infinity,
          },
        );
        return;
      }

      const evaluationPayload = extractResultPayload(
        completedGateConversationId,
      );
      clearSessionRuns();
      gate.finishGateEvaluation(evaluationPayload).finally(() => {
        gate.gateStepRef.current = null;
      });
    }
  }, [
    activeRunStatus,
    activeConversationId,
    extractResultPayload,
    setGateLoading,
    setStopping,
    updateStepStatus,
    advanceToNextStep,
    clearSessionRuns,
    setActiveConversationId,
  ]);

  // Watch for workflow step agent completion
  useEffect(() => {
    if (!activeRunStatus || !activeConversationId) return;
    if (gate.gateConversationIdRef.current === activeConversationId) return;

    const { steps: currentSteps, currentStep: step } =
      useWorkflowStore.getState();
    if (currentSteps[step]?.status !== "in_progress") return;

    if (activeRunStatus === "completed") {
      const completedConversationId = activeConversationId;
      setActiveConversationId(null);

      const finish = async () => {
        await resolveWorkflowStepCompletion(completedConversationId, step);
      };

      finish();
    } else if (activeRunStatus === "error") {
      const errorDetail = activeRun?.resultErrors?.length
        ? activeRun.resultErrors.join("; ")
        : null;
      updateStepStatus(step, "error");
      setRunning(false);
      setStopping(false);
      setActiveConversationId(null);
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
      setActiveConversationId(null);
      setRunning(false);
      setStopping(false);
      updateStepStatus(step, "pending");
      toast.info("Step cancelled");
    } else if (activeRunStatus === "paused") {
      setRunning(false);
      setStopping(false);
    }
  }, [
    activeRunStatus,
    activeConversationId,
    resolveWorkflowStepCompletion,
    updateStepStatus,
    setRunning,
    setStopping,
    setActiveConversationId,
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
      // Read state from the store directly — avoids stale closures when called
      // from performStepReset before React re-renders with cleared state.
      const storeState = useWorkflowStore.getState();
      if (
        storeState.isRunning ||
        storeState.gateLoading ||
        gate.gateConversationIdRef.current
      ) {
        return;
      }

      let model: string;
      try {
        model = requireSettingsModel(
          useSettingsStore.getState().modelSettings.model_id,
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err), {
          duration: Infinity,
        });
        return;
      }

      try {
        clearSessionRuns();
        useWorkflowStore.getState().setActiveConversationId(null);
        useWorkflowStore.getState().clearRuntimeError();
        updateStepStatus(targetStep, "in_progress");
        setRunning(true);
        setInitializing();

        console.log(
          `[workflow] Starting step ${targetStep} for skill "${skillName}"`,
        );
        const conversationId = await runWorkflowStep(
          skillId!,
          skillName,
          targetStep,
        );
        startSessionRun(conversationId, model);
        useWorkflowStore.getState().setActiveConversationId(conversationId);
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
      skillName,
      currentStep,
      gate,
      clearSessionRuns,
      updateStepStatus,
      setRunning,
      setInitializing,
      clearInitializing,
      startSessionRun,
    ],
  );

  // --- Step reset ---

  const performStepReset = async (stepId: number) => {
    const effectiveStepId = stepId;
    logFrontend(
      "info",
      `[performStepReset] resetting step ${stepId}, effectiveStepId=${effectiveStepId}, isRunning=${useWorkflowStore.getState().isRunning}, reviewMode=${useWorkflowStore.getState().reviewMode}`,
    );
    endActiveSession();
    setPendingAutoStartStep(null);
    // Clear gate state so Effect A isn't blocked when auto-starting after reset.
    gate.gateConversationIdRef.current = null;
    useWorkflowStore.getState().setGateLoading(false);
    clearSessionRuns();
    useWorkflowStore.getState().setActiveConversationId(null);
    resetToStep(effectiveStepId);
    if (skillId != null) {
      invalidateWorkflowArtifactsAfterReset(String(skillId), effectiveStepId);
    }

    if (workspacePath) {
      try {
        await resetWorkflowStep(workspacePath, skillName, effectiveStepId);
      } catch {
        // best-effort
      }
    }

    try {
      await restartOpenHandsSession();
    } catch {
      // best-effort
    }

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
        logFrontend(
          "info",
          `[performStepReset] auto-starting step ${effectiveStepId}`,
        );
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
