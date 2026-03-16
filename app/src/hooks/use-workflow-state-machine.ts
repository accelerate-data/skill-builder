import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useAgentStore } from "@/stores/agent-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { ClarificationsFile } from "@/lib/clarifications-types";
import {
  runWorkflowStep,
  verifyStepOutput,
  getDisabledSteps,
  materializeWorkflowStepOutput,
  resetWorkflowStep,
  endWorkflowSession,
} from "@/lib/tauri";
import { resolveModelId } from "@/lib/models";
import { type StepConfig } from "@/lib/workflow-step-configs";
import { toast } from "@/lib/toast";
import { useWorkflowGate } from "@/hooks/use-workflow-gate";

interface UseWorkflowStateMachineOptions {
  /** Skill name from route params */
  skillName: string;
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
  /** Clarifications data (for merging with gate feedback) */
  clarificationsData: ClarificationsFile | null;
  /** Step configurations for all steps */
  stepConfigs: Record<number, StepConfig>;
  /** Optional callback to update clarifications editor state after gate writes feedback */
  onClarificationsUpdated?: (data: ClarificationsFile, content: string) => void;
}

/**
 * Manages the workflow state machine: step advancement, agent execution,
 * gate evaluation (via useWorkflowGate), and all associated state transitions.
 */
export function useWorkflowStateMachine({
  skillName,
  workspacePath,
  skillsPath: _skillsPath,
  currentStep,
  steps,
  stepConfig,
  hydrated,
  reviewMode,
  disabledSteps,
  errorHasArtifacts: _errorHasArtifacts,
  purpose,
  clarificationsData,
  stepConfigs,
  onClarificationsUpdated,
}: UseWorkflowStateMachineOptions) {
  // Store actions (individual selectors to avoid new object reference on every render)
  const setCurrentStep = useWorkflowStore((s) => s.setCurrentStep);
  const updateStepStatus = useWorkflowStore((s) => s.updateStepStatus);
  const setRunning = useWorkflowStore((s) => s.setRunning);
  const setInitializing = useWorkflowStore((s) => s.setInitializing);
  const clearInitializing = useWorkflowStore((s) => s.clearInitializing);
  const setGateLoading = useWorkflowStore((s) => s.setGateLoading);
  const resetToStep = useWorkflowStore((s) => s.resetToStep);

  const setActiveAgent = useAgentStore((s) => s.setActiveAgent);
  const clearRuns = useAgentStore((s) => s.clearRuns);
  const agentStartRun = useAgentStore((s) => s.startRun);

  // Step switch state (when user clicks sidebar while agent running)
  const [pendingStepSwitch, setPendingStepSwitch] = useState<number | null>(null);

  // Reset confirmation state
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetTarget, setResetTarget] = useState<number | null>(null);

  // Auto-start state
  const [pendingAutoStartStep, setPendingAutoStartStep] = useState<number | null>(null);

  // Refs for cross-effect communication
  const lastCompletedCostRef = useRef<number | undefined>(undefined);
  const prevReviewModeRef = useRef<boolean | null>(null);

  // Current state selectors
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const runs = useAgentStore((s) => s.runs);
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const gateLoading = useWorkflowStore((s) => s.gateLoading);

  const isAgentType = stepConfig?.type === "agent" || stepConfig?.type === "reasoning";
  const activeRun = activeAgentId ? runs[activeAgentId] : null;
  const activeRunStatus = activeRun?.status;

  // --- Helper functions ---

  const endActiveSession = useCallback(() => {
    const sessionId = useWorkflowStore.getState().workflowSessionId;
    if (sessionId) {
      endWorkflowSession(sessionId).catch((e) => console.warn("[use-workflow-state-machine] non-fatal: op=endWorkflowSession err=%s", e));
      useWorkflowStore.setState({ workflowSessionId: null });
    }
  }, []);

  const extractStructuredResultPayload = useCallback((agentId: string): unknown | null => {
    const run = useAgentStore.getState().runs[agentId];
    if (!run) return null;
    const resultItem = [...run.displayItems].reverse().find((di) => di.type === "result");
    if (!resultItem?.structuredOutput) return null;
    return resultItem.structuredOutput;
  }, []);

  // --- Auto-advance logic ---

  const advanceToNextStep = useCallback(() => {
    const { gateLoading: gateLoadingNow, disabledSteps: disabled } = useWorkflowStore.getState();
    if (gateLoadingNow || gate.gateAgentIdRef.current) return;
    if (currentStep >= steps.length - 1) return;
    const nextStep = currentStep + 1;

    if (disabled.includes(nextStep)) return;

    setCurrentStep(nextStep);
    setPendingAutoStartStep(nextStep);
  }, [currentStep, steps, setCurrentStep]);

  const autoStartAfterReset = useCallback((stepId: number) => {
    const { reviewMode: isReview, disabledSteps: disabled } = useWorkflowStore.getState();
    if (disabled.includes(stepId)) return;
    const cfg = stepConfigs[stepId];
    if ((cfg?.type === "agent" || cfg?.type === "reasoning") && !isReview) {
      setPendingAutoStartStep(stepId);
    }
  }, [stepConfigs, setPendingAutoStartStep]);

  // --- Gate evaluation (delegated to useWorkflowGate) ---

  const gate = useWorkflowGate({
    skillName,
    workspacePath,
    currentStep,
    disabledSteps,
    purpose,
    clarificationsData,
    onClarificationsUpdated,
    advanceToNextStep,
  });

  // --- Auto-start effects ---

  // Auto-start when advancing from a completed step or on review→update toggle
  useEffect(() => {
    if (pendingAutoStartStep === null) return;
    if (pendingAutoStartStep !== currentStep) return;
    if (!isAgentType) return;
    if (isRunning) return;
    if (gateLoading || gate.gateAgentIdRef.current) return;
    if (steps[currentStep]?.status !== "pending") {
      setPendingAutoStartStep(null);
      return;
    }
    setPendingAutoStartStep(null);
    handleStartAgentStep();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoStartStep, currentStep, steps, isRunning, isAgentType, gateLoading]);

  // Auto-start when switching from Review → Update mode on a pending agent step
  useEffect(() => {
    if (!hydrated) return;

    const wasToggle = prevReviewModeRef.current === true && !reviewMode;
    prevReviewModeRef.current = reviewMode;

    if (!wasToggle) return;
    if (!workspacePath) return;
    const status = steps[currentStep]?.status;
    if (status && status !== "pending") return;
    if (isRunning || pendingAutoStartStep !== null || gateLoading) return;
    console.log(`[workflow] Auto-starting step ${currentStep} (review→update toggle)`);
    setPendingAutoStartStep(currentStep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, reviewMode]);

  // Reposition to first incomplete step when switching to Update mode
  useEffect(() => {
    if (!hydrated || reviewMode) return;
    const currentCfg = stepConfigs[currentStep];
    if (currentCfg?.clarificationsEditable && steps[currentStep]?.status === "completed") {
      return;
    }
    const { disabledSteps: disabled } = useWorkflowStore.getState();
    const first = steps.find((s) => s.status !== "completed" && !disabled.includes(s.id));
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
      gate.gateAgentIdRef.current = null;
      setActiveAgent(null);

      if (activeRunStatus === "error") {
        clearRuns();
        console.warn("[workflow] Gate evaluation failed — proceeding normally");
        setGateLoading(false);
        updateStepStatus(useWorkflowStore.getState().currentStep, "completed");
        advanceToNextStep();
        return;
      }

      const structuredOutput = extractStructuredResultPayload(completedGateAgentId);
      clearRuns();
      gate.finishGateEvaluation(structuredOutput);
    }
  }, [activeRunStatus, activeAgentId, extractStructuredResultPayload, setGateLoading, updateStepStatus, advanceToNextStep, clearRuns, setActiveAgent]);

  // Watch for workflow step agent completion
  useEffect(() => {
    if (!activeRunStatus || !activeAgentId) return;
    if (gate.gateAgentIdRef.current === activeAgentId) return;

    const { steps: currentSteps, currentStep: step } = useWorkflowStore.getState();
    if (currentSteps[step]?.status !== "in_progress") return;

    if (activeRunStatus === "completed") {
      const completedAgentId = activeAgentId;
      lastCompletedCostRef.current = completedAgentId
        ? useAgentStore.getState().runs[completedAgentId]?.totalCost
        : undefined;
      setActiveAgent(null);

      const finish = async () => {
        const cfg = stepConfigs[step];
        if (cfg && completedAgentId) {
          const structuredOutput = extractStructuredResultPayload(completedAgentId);
          if (structuredOutput == null || typeof structuredOutput !== "object" || Array.isArray(structuredOutput)) {
            if (cfg.requiresStructuredOutput) {
              updateStepStatus(step, "error");
              setRunning(false);
              toast.error(
                `Step ${step + 1} completed but produced no structured output`,
                { duration: Infinity },
              );
              return;
            }
          } else {
            try {
              await materializeWorkflowStepOutput(skillName, step as 0 | 1 | 2 | 3, structuredOutput as import("@/lib/types").WorkflowStepStructuredOutput);
            } catch (err) {
              updateStepStatus(step, "error");
              setRunning(false);
              toast.error(
                `Step ${step + 1} output validation failed: ${err instanceof Error ? err.message : String(err)}`,
                { duration: Infinity },
              );
              return;
            }
          }
        }

        if (workspacePath && skillName) {
          try {
            const hasOutput = await verifyStepOutput(workspacePath, skillName, step);
            if (!hasOutput) {
              updateStepStatus(step, "error");
              setRunning(false);
              toast.error(`Step ${step + 1} completed but produced no output files`, { duration: Infinity });
              return;
            }
          } catch {
            // Verification failed — proceed optimistically
          }
        }

        if (skillName) {
          try {
            const disabled = await getDisabledSteps(skillName);
            useWorkflowStore.getState().setDisabledSteps(disabled);
          } catch {
            // Non-fatal
          }
        }

        updateStepStatus(step, "completed");
        setRunning(false);
        toast.success(`Step ${step + 1} completed`);
      };

      finish();
    } else if (activeRunStatus === "error") {
      updateStepStatus(step, "error");
      setRunning(false);
      setActiveAgent(null);
      const workflowState = useWorkflowStore.getState();
      if (workflowState.isInitializing) {
        workflowState.clearInitializing();
      }
      toast.error(`Step ${step + 1} failed`, { duration: Infinity });
    }
  }, [activeRunStatus, activeAgentId, extractStructuredResultPayload, updateStepStatus, setRunning, setActiveAgent, skillName, workspacePath, clearInitializing]);

  // --- Step execution ---

  const handleStartAgentStep = async () => {
    if (!workspacePath) {
      toast.error("Missing workspace path", { duration: Infinity });
      return;
    }
    if (gateLoading || gate.gateAgentIdRef.current) {
      toast.info("Answer analysis is in progress. Please wait for results.", { duration: 5000 });
      return;
    }

    try {
      clearRuns();
      useWorkflowStore.getState().clearRuntimeError();
      updateStepStatus(currentStep, "in_progress");
      setRunning(true);
      setInitializing();

      console.log(`[workflow] Starting step ${currentStep} for skill "${skillName}"`);
      const sessionId = useWorkflowStore.getState().workflowSessionId;
      const agentId = await runWorkflowStep(
        skillName,
        currentStep,
        workspacePath,
        sessionId ?? undefined,
      );
      agentStartRun(
        agentId,
        resolveModelId(
          useSettingsStore.getState().preferredModel ?? stepConfig?.model ?? "sonnet"
        )
      );
    } catch (err) {
      updateStepStatus(currentStep, "error");
      setRunning(false);
      clearInitializing();
      toast.error(
        `Failed to start agent: ${err instanceof Error ? err.message : String(err)}`,
        { duration: Infinity },
      );
    }
  };

  // --- Step reset ---

  const performStepReset = async (stepId: number) => {
    endActiveSession();
    if (workspacePath) {
      try {
        await resetWorkflowStep(workspacePath, skillName, stepId);
      } catch {
        // best-effort
      }
    }
    clearRuns();
    resetToStep(stepId);

    let disabled: number[] = [];
    if (skillName) {
      try {
        disabled = await getDisabledSteps(skillName);
        useWorkflowStore.getState().setDisabledSteps(disabled);
      } catch {
        // non-fatal
      }
    }

    if (!disabled.includes(stepId)) {
      autoStartAfterReset(stepId);
    }
    toast.success(`Reset to step ${stepId + 1}`);
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

    // Refs
    lastCompletedCostRef,
  };
}
