import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useAgentStore } from "@/stores/agent-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { GateVerdict } from "@/components/transition-gate-dialog";
import type { Note, ClarificationsFile } from "@/lib/clarifications-types";
import type { AnswerEvaluation } from "@/lib/tauri";
import {
  runWorkflowStep,
  runAnswerEvaluator,
  verifyStepOutput,
  getDisabledSteps,
  materializeWorkflowStepOutput,
  materializeAnswerEvaluationOutput,
  resetWorkflowStep,
  logGateDecision,
  readFile,
  saveWorkflowState,
  getClarificationsContent,
  saveClarificationsContent,
  writeFile,
  endWorkflowSession,
} from "@/lib/tauri";
import { resolveModelId } from "@/lib/models";
import { joinPath } from "@/lib/path-utils";
import { parseClarifications } from "@/lib/clarifications-types";
import { type StepConfig } from "@/lib/workflow-step-configs";
import { toast } from "@/lib/toast";
import { buildGateFeedbackNotes } from "@/lib/gate-feedback";

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
 * gate evaluation, and all associated state transitions.
 *
 * This is the most complex hook because all these concerns are tightly coupled:
 * - Auto-start logic depends on pending steps and review mode
 * - Agent completion depends on step status and structured output
 * - Gate evaluation depends on current step and answer data
 * - Reset flows depend on disabled steps and mode
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
  // Get store actions (individual selectors to avoid new object reference on every render)
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

  // Gate evaluation state
  const [showGateDialog, setShowGateDialog] = useState(false);
  const [gateVerdict, setGateVerdict] = useState<GateVerdict | null>(null);
  const [gateEvaluation, setGateEvaluation] = useState<AnswerEvaluation | null>(null);
  const [gateContext, setGateContext] = useState<"clarifications" | "refinements">("clarifications");

  // Step switch state (when user clicks sidebar while agent running)
  const [pendingStepSwitch, setPendingStepSwitch] = useState<number | null>(null);

  // Reset confirmation state
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetTarget, setResetTarget] = useState<number | null>(null);

  // Auto-start state
  const [pendingAutoStartStep, setPendingAutoStartStep] = useState<number | null>(null);

  // Refs for cross-effect communication
  const gateAgentIdRef = useRef<string | null>(null);
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
    if (gateLoadingNow || gateAgentIdRef.current) return;
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

  // Auto-start when advancing from a completed step or on review→update toggle
  useEffect(() => {
    if (pendingAutoStartStep === null) return;
    if (pendingAutoStartStep !== currentStep) return;
    if (!isAgentType) return;
    if (isRunning) return;
    if (gateLoading || gateAgentIdRef.current) return;
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
    if (gateAgentIdRef.current !== activeAgentId) return;

    if (activeRunStatus === "completed" || activeRunStatus === "error") {
      const completedGateAgentId = activeAgentId;
      gateAgentIdRef.current = null;
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
      finishGateEvaluation(structuredOutput);
    }
  }, [activeRunStatus, activeAgentId, extractStructuredResultPayload, setGateLoading, updateStepStatus, advanceToNextStep, clearRuns, setActiveAgent]);

  // Watch for workflow step agent completion
  useEffect(() => {
    if (!activeRunStatus || !activeAgentId) return;
    if (gateAgentIdRef.current === activeAgentId) return;

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

  // --- Step execution handlers ---

  const handleStartAgentStep = async () => {
    if (!workspacePath) {
      toast.error("Missing workspace path", { duration: Infinity });
      return;
    }
    if (gateLoading || gateAgentIdRef.current) {
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

  const runGateEvaluation = async () => {
    if (!workspacePath) return;
    console.log(`[workflow] Running answer evaluator gate for "${skillName}"`);
    setPendingAutoStartStep(null);
    setGateLoading(true);

    try {
      const agentId = await runAnswerEvaluator(skillName, workspacePath);
      console.log(`[workflow] Gate evaluator started: agentId=${agentId}`);
      gateAgentIdRef.current = agentId;
      agentStartRun(agentId, resolveModelId("haiku"));
      setActiveAgent(agentId);
    } catch (err) {
      console.error("[workflow] Gate evaluation failed to start:", err);
      setGateLoading(false);
      updateStepStatus(currentStep, "completed");
      advanceToNextStep();
    }
  };

  const runGateOrAdvance = () => {
    const { gateLoading: gateLoadingNow } = useWorkflowStore.getState();
    if (gateLoadingNow || gateAgentIdRef.current) return;

    if (currentStep === 0 && workspacePath && !disabledSteps.includes(1)) {
      setGateContext("clarifications");
      runGateEvaluation();
      return;
    }

    if (currentStep === 1 && workspacePath && !disabledSteps.includes(2)) {
      setGateContext("refinements");
      runGateEvaluation();
      return;
    }

    advanceToNextStep();
  };

  const handleReviewContinue = async () => {
    // Save is handled by useWorkflowAutosave; just proceed to gate
    runGateOrAdvance();
  };

  // --- Gate evaluation logic ---

  const finishGateEvaluation = async (structuredOutput?: unknown) => {
    const proceedNormally = () => {
      setGateLoading(false);
      updateStepStatus(useWorkflowStore.getState().currentStep, "completed");
      advanceToNextStep();
    };

    if (!workspacePath) {
      proceedNormally();
      return;
    }

    console.debug("[workflow] Gate structured output:", structuredOutput);

    try {
      if (structuredOutput != null) {
        await materializeAnswerEvaluationOutput(skillName, workspacePath, structuredOutput as import("@/lib/types").AnswerEvaluationOutput);
      }

      const evalPath = joinPath(workspacePath, skillName, "answer-evaluation.json");
      const raw = await readFile(evalPath);
      const evaluation: AnswerEvaluation = JSON.parse(raw);

      if (!["sufficient", "mixed", "insufficient"].includes(evaluation.verdict)) {
        console.warn("[workflow] Invalid gate verdict:", evaluation.verdict);
        proceedNormally();
        return;
      }

      if (workspacePath) {
        try {
          const clarificationsRaw = await getClarificationsContent(skillName, workspacePath);
          const parsed = parseClarifications(clarificationsRaw);
          if (parsed) {
            const next: ClarificationsFile = {
              ...parsed,
              answer_evaluator_notes: buildGateFeedbackNotes(evaluation),
            };
            const serialized = JSON.stringify(next, null, 2);
            await saveClarificationsContent(skillName, workspacePath, serialized);
            onClarificationsUpdated?.(next, serialized);
          }
        } catch (err) {
          console.warn("[workflow] Could not update clarifications notes from gate evaluation:", err);
        }
      }

      if (workspacePath) {
        const gateLog = JSON.stringify({ ...evaluation, action: "show_dialog", timestamp: new Date().toISOString() });
        writeFile(joinPath(workspacePath, skillName, "gate-result.json"), gateLog).catch((e) => console.warn("[use-workflow-state-machine] non-fatal: op=writeFile err=%s", e));
      }

      setGateLoading(false);
      setGateVerdict(evaluation.verdict);
      setGateEvaluation(evaluation);
      setShowGateDialog(true);
    } catch (err) {
      console.warn("[workflow] Gate evaluation materialization failed — proceeding normally:", err);
      proceedNormally();
    }
  };

  const closeGateDialog = () => {
    setShowGateDialog(false);
    setGateVerdict(null);
    setGateEvaluation(null);
  };

  const skipToDecisions = (message: string) => {
    closeGateDialog();
    if (gateContext === "refinements") {
      updateStepStatus(useWorkflowStore.getState().currentStep, "completed");
      advanceToNextStep();
    } else {
      updateStepStatus(1, "completed");
      setCurrentStep(2);
    }

    const s = useWorkflowStore.getState();
    const stepStatuses = s.steps.map((step) => ({ step_id: step.id, status: step.status }));
    const runStatus = s.steps.every((step) => step.status === "completed") ? "completed" : "pending";
    saveWorkflowState(skillName, s.currentStep, runStatus, stepStatuses, purpose ?? undefined).catch(
      (err) => console.error("skipToDecisions: failed to persist state:", err),
    );
    toast.success(message);
  };

  const logGateAction = (decision: string) => {
    if (!workspacePath) return;
    const entry = JSON.stringify({ decision, verdict: gateVerdict, timestamp: new Date().toISOString() });
    writeFile(joinPath(workspacePath, skillName, "gate-result.json"), entry).catch((e) => console.warn("[use-workflow-state-machine] non-fatal: op=writeFile err=%s", e));
    logGateDecision(skillName, gateVerdict ?? "unknown", decision).catch((e) => console.warn("[use-workflow-state-machine] non-fatal: op=logGateDecision err=%s", e));
  };

  const handleGateSkip = () => {
    logGateAction("skip");
    if (gateContext === "refinements") {
      skipToDecisions("Refinement answers verified — continuing to decisions");
    } else {
      skipToDecisions("Skipped detailed research — answers were sufficient");
    }
  };

  const handleGateResearch = () => {
    logGateAction(gateContext === "refinements" ? "continue_to_decisions" : "research_anyway");
    closeGateDialog();
    updateStepStatus(useWorkflowStore.getState().currentStep, "completed");
    advanceToNextStep();
  };

  const handleGateContinueAnyway = () => {
    logGateAction("continue_anyway");
    closeGateDialog();
    updateStepStatus(useWorkflowStore.getState().currentStep, "completed");
    advanceToNextStep();
    toast.success("Continuing with current answers");
  };

  const handleGateLetMeAnswer = () => {
    logGateAction("let_me_answer");
    closeGateDialog();
    toast.info("Refreshing evaluator feedback...", { duration: 5000 });

    if (!workspacePath) {
      toast.warning("Workspace path is missing in settings. Could not refresh feedback from disk.", { duration: Infinity });
      return;
    }

    const prevNoteCount = clarificationsData?.answer_evaluator_notes?.length ?? 0;
    getClarificationsContent(skillName, workspacePath)
      .then((content) => {
        const parsed = parseClarifications(content ?? null);
        if (!parsed) {
          toast.warning("Feedback file could not be parsed. You can still answer manually.", { duration: Infinity });
          return;
        }

        // Update editor state with refreshed feedback
        onClarificationsUpdated?.(parsed, content ?? "");

        const addedNotes = Math.max(0, (parsed.answer_evaluator_notes?.length ?? 0) - prevNoteCount);
        if (addedNotes > 0) {
          toast.success(`Loaded ${addedNotes} feedback note${addedNotes === 1 ? "" : "s"} for review.`);
        } else {
          toast.success("Feedback refreshed. You can update your answers now.");
        }
      })
      .catch(() => {
        toast.warning("Could not refresh feedback from disk. You can still answer manually.", { duration: Infinity });
      });
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
    showGateDialog,
    gateVerdict,
    gateEvaluation,
    gateContext,
    pendingStepSwitch,
    showResetConfirm,
    resetTarget,
    pendingAutoStartStep,

    // State setters
    setShowGateDialog,
    setGateVerdict,
    setGateEvaluation,
    setGateContext,
    setPendingStepSwitch,
    setShowResetConfirm,
    setResetTarget,

    // Handlers
    handleStartAgentStep,
    handleReviewContinue,
    performStepReset,
    runGateOrAdvance,
    closeGateDialog,
    skipToDecisions,
    handleGateSkip,
    handleGateResearch,
    handleGateContinueAnyway,
    handleGateLetMeAnswer,

    // Refs
    gateAgentIdRef,
    lastCompletedCostRef,
  };
}
