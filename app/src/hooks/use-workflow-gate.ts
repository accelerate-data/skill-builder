import { useCallback, useRef, useState } from "react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useAgentStore } from "@/stores/agent-store";
import type { GateVerdict } from "@/components/transition-gate-dialog";
import type { ClarificationsFile } from "@/lib/clarifications-types";
import type { AnswerEvaluation } from "@/lib/tauri";
import {
  runAnswerEvaluator,
  materializeAnswerEvaluationOutput,
  logGateDecision,
  readFile,
  saveWorkflowState,
  getClarificationsContent,
  saveClarificationsContent,
  writeFile,
} from "@/lib/tauri";
import { resolveModelId } from "@/lib/models";
import { joinPath } from "@/lib/path-utils";
import { parseClarifications } from "@/lib/clarifications-types";
import { toast } from "@/lib/toast";
import { buildGateFeedbackNotes } from "@/lib/gate-feedback";

export interface UseWorkflowGateOptions {
  skillName: string;
  workspacePath: string | null;
  currentStep: number;
  disabledSteps: number[];
  purpose: string | null;
  clarificationsData: ClarificationsFile | null;
  onClarificationsUpdated?: (data: ClarificationsFile, content: string) => void;
  /** Called after gate completes to advance the workflow */
  advanceToNextStep: () => void;
}

export interface UseWorkflowGateReturn {
  showGateDialog: boolean;
  gateVerdict: GateVerdict | null;
  gateEvaluation: AnswerEvaluation | null;
  gateContext: "clarifications" | "refinements";
  setShowGateDialog: (v: boolean) => void;
  setGateVerdict: (v: GateVerdict | null) => void;
  setGateEvaluation: (v: AnswerEvaluation | null) => void;
  setGateContext: (v: "clarifications" | "refinements") => void;
  runGateOrAdvance: () => void;
  handleReviewContinue: () => void;
  closeGateDialog: () => void;
  skipToDecisions: (message: string) => void;
  handleGateSkip: () => void;
  handleGateResearch: () => void;
  handleGateContinueAnyway: () => void;
  handleGateLetMeAnswer: () => void;
  /** Ref tracking the active gate evaluator agent ID (null when idle) */
  gateAgentIdRef: React.MutableRefObject<string | null>;
  /** Process gate agent completion — called by the agent watcher effect */
  finishGateEvaluation: (structuredOutput?: unknown) => Promise<void>;
}

/**
 * Manages the gate evaluation lifecycle: running the answer evaluator,
 * processing its output, showing the gate dialog, and handling user decisions.
 *
 * Extracted from useWorkflowStateMachine for independent testability and
 * to reduce the main hook from 640+ lines to ~400.
 */
export function useWorkflowGate({
  skillName,
  workspacePath,
  currentStep,
  disabledSteps,
  purpose,
  clarificationsData,
  onClarificationsUpdated,
  advanceToNextStep,
}: UseWorkflowGateOptions): UseWorkflowGateReturn {
  const updateStepStatus = useWorkflowStore((s) => s.updateStepStatus);
  const setCurrentStep = useWorkflowStore((s) => s.setCurrentStep);
  const setGateLoading = useWorkflowStore((s) => s.setGateLoading);
  const setActiveAgent = useAgentStore((s) => s.setActiveAgent);
  const agentStartRun = useAgentStore((s) => s.startRun);

  const [showGateDialog, setShowGateDialog] = useState(false);
  const [gateVerdict, setGateVerdict] = useState<GateVerdict | null>(null);
  const [gateEvaluation, setGateEvaluation] = useState<AnswerEvaluation | null>(null);
  const [gateContext, setGateContext] = useState<"clarifications" | "refinements">("clarifications");

  const gateAgentIdRef = useRef<string | null>(null);

  // --- Core gate operations ---

  const runGateEvaluation = useCallback(async () => {
    if (!workspacePath) return;
    console.log(`[workflow] Running answer evaluator gate for "${skillName}"`);
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
  }, [workspacePath, skillName, currentStep, setGateLoading, agentStartRun, setActiveAgent, updateStepStatus, advanceToNextStep]);

  const finishGateEvaluation = useCallback(async (structuredOutput?: unknown) => {
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
        writeFile(joinPath(workspacePath, skillName, "gate-result.json"), gateLog).catch((e) => console.warn("[use-workflow-gate] non-fatal: op=writeFile err=%s", e));
      }

      setGateLoading(false);
      setGateVerdict(evaluation.verdict);
      setGateEvaluation(evaluation);
      setShowGateDialog(true);
    } catch (err) {
      console.warn("[workflow] Gate evaluation materialization failed — proceeding normally:", err);
      proceedNormally();
    }
  }, [workspacePath, skillName, setGateLoading, updateStepStatus, advanceToNextStep, onClarificationsUpdated]);

  // --- Dialog handlers ---

  const closeGateDialog = useCallback(() => {
    setShowGateDialog(false);
    setGateVerdict(null);
    setGateEvaluation(null);
  }, []);

  const skipToDecisions = useCallback((message: string) => {
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
  }, [gateContext, skillName, purpose, closeGateDialog, updateStepStatus, advanceToNextStep, setCurrentStep]);

  const logGateAction = useCallback((decision: string) => {
    if (!workspacePath) return;
    const entry = JSON.stringify({ decision, verdict: gateVerdict, timestamp: new Date().toISOString() });
    writeFile(joinPath(workspacePath, skillName, "gate-result.json"), entry).catch((e) => console.warn("[use-workflow-gate] non-fatal: op=writeFile err=%s", e));
    logGateDecision(skillName, gateVerdict ?? "unknown", decision).catch((e) => console.warn("[use-workflow-gate] non-fatal: op=logGateDecision err=%s", e));
  }, [workspacePath, skillName, gateVerdict]);

  const handleGateSkip = useCallback(() => {
    logGateAction("skip");
    if (gateContext === "refinements") {
      skipToDecisions("Refinement answers verified — continuing to decisions");
    } else {
      skipToDecisions("Skipped detailed research — answers were sufficient");
    }
  }, [gateContext, logGateAction, skipToDecisions]);

  const handleGateResearch = useCallback(() => {
    logGateAction(gateContext === "refinements" ? "continue_to_decisions" : "research_anyway");
    closeGateDialog();
    updateStepStatus(useWorkflowStore.getState().currentStep, "completed");
    advanceToNextStep();
  }, [gateContext, logGateAction, closeGateDialog, updateStepStatus, advanceToNextStep]);

  const handleGateContinueAnyway = useCallback(() => {
    logGateAction("continue_anyway");
    closeGateDialog();
    updateStepStatus(useWorkflowStore.getState().currentStep, "completed");
    advanceToNextStep();
    toast.success("Continuing with current answers");
  }, [logGateAction, closeGateDialog, updateStepStatus, advanceToNextStep]);

  const handleGateLetMeAnswer = useCallback(() => {
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
  }, [logGateAction, closeGateDialog, workspacePath, skillName, clarificationsData, onClarificationsUpdated]);

  // --- Routing ---

  const runGateOrAdvance = useCallback(() => {
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
  }, [currentStep, workspacePath, disabledSteps, runGateEvaluation, advanceToNextStep]);

  const handleReviewContinue = useCallback(() => {
    runGateOrAdvance();
  }, [runGateOrAdvance]);

  return {
    showGateDialog,
    gateVerdict,
    gateEvaluation,
    gateContext,
    setShowGateDialog,
    setGateVerdict,
    setGateEvaluation,
    setGateContext,
    runGateOrAdvance,
    handleReviewContinue,
    closeGateDialog,
    skipToDecisions,
    handleGateSkip,
    handleGateResearch,
    handleGateContinueAnyway,
    handleGateLetMeAnswer,
    gateAgentIdRef,
    finishGateEvaluation,
  };
}
