import { useCallback, useRef } from "react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useAgentStore } from "@/stores/agent-store";
import type { AnswerEvaluation } from "@/lib/tauri";
import {
  runAnswerEvaluator,
  materializeAnswerEvaluationOutput,
  logGateDecision,
  invokeCommand,
  writeFile,
} from "@/lib/tauri";
import { requireSettingsModel } from "@/lib/models";
import { joinPath } from "@/lib/path-utils";
import { toast } from "@/lib/toast";
import { skillDir } from "@/lib/evals";
import pluginPaths from "../../plugin-paths.json";
import { useSettingsStore } from "@/stores/settings-store";
import { appQueryClient } from "@/lib/query-client";
import { queryKeys } from "@/lib/queries/query-keys";

export interface UseWorkflowGateOptions {
  skillId: number | null;
  skillName: string;
  pluginSlug?: string;
  workspacePath: string | null;
  skillsPath: string | null;
  currentStep: number;
  purpose: string | null;
  /** Called after gate completes to advance the workflow */
  advanceToNextStep: () => void;
  /** Clears any queued auto-start so gate failures/revise do not advance later */
  cancelPendingAutoStart: () => void;
}

export interface UseWorkflowGateReturn {
  runGateOrAdvance: () => void;
  handleReviewContinue: () => void;
  /** Ref tracking the active gate evaluator agent ID (null when idle) */
  gateAgentIdRef: React.MutableRefObject<string | null>;
  /** Ref tracking the workflow step that started the current gate run */
  gateStepRef: React.MutableRefObject<number | null>;
  /** Process gate agent completion — called by the agent watcher effect */
  finishGateEvaluation: (evaluationPayload?: unknown) => Promise<void>;
}

/**
 * Manages the gate evaluation lifecycle: running the answer evaluator,
 * processing its output, and automatically advancing based on gate_decision.
 *
 * The answer-evaluator agent evaluates answers silently (no user interaction).
 * If contradictions are found it returns gate_decision="revise"; otherwise
 * "run_research". The frontend reads gate_decision and routes automatically.
 *
 * Extracted from useWorkflowStateMachine for independent testability and
 * to reduce the main hook from 640+ lines to ~400.
 */
export function useWorkflowGate({
  skillId,
  skillName,
  pluginSlug = pluginPaths.default_plugin_slug,
  workspacePath,
  skillsPath,
  currentStep,
  purpose,
  advanceToNextStep,
  cancelPendingAutoStart,
}: UseWorkflowGateOptions): UseWorkflowGateReturn {
  const updateStepStatus = useWorkflowStore((s) => s.updateStepStatus);
  const setGateLoading = useWorkflowStore((s) => s.setGateLoading);
  const setCurrentStep = useWorkflowStore((s) => s.setCurrentStep);
  const setActiveAgent = useAgentStore((s) => s.setActiveAgent);
  const agentStartRun = useAgentStore((s) => s.startRun);
  const selectedModel = useSettingsStore((s) => s.modelSettings.model_id);

  const gateAgentIdRef = useRef<string | null>(null);
  const gateStepRef = useRef<number | null>(null);

  const stayOnCurrentStep = useCallback(
    (message: string) => {
      const stepToRestore =
        gateStepRef.current ?? useWorkflowStore.getState().currentStep;
      cancelPendingAutoStart();
      setCurrentStep(stepToRestore);
      setGateLoading(false);
      updateStepStatus(stepToRestore, "completed");
      toast.error(message, { duration: Infinity });
    },
    [cancelPendingAutoStart, setCurrentStep, setGateLoading, updateStepStatus],
  );

  // --- Core gate operations ---

  const runGateEvaluation = useCallback(async () => {
    if (!workspacePath) return;
    console.log(`[workflow] Running answer evaluator gate for "${skillName}"`);

    let model: string;
    try {
      model = requireSettingsModel(selectedModel);
    } catch (err) {
      console.error("[workflow] Gate evaluation blocked:", err);
      stayOnCurrentStep(
        err instanceof Error
          ? `Answer evaluation could not start: ${err.message}`
          : `Answer evaluation could not start: ${String(err)}`,
      );
      return;
    }

    try {
      setGateLoading(true);
      gateStepRef.current = currentStep;
      toast.info("Reviewing answers before continuing");
      if (skillId == null) {
        throw new Error("Missing skill ID");
      }
      const agentId = await runAnswerEvaluator(skillId, skillName, workspacePath);
      console.log(`[workflow] Gate evaluator started: agentId=${agentId}`);
      gateAgentIdRef.current = agentId;
      agentStartRun(agentId, model);
      setActiveAgent(agentId);
    } catch (err) {
      console.error("[workflow] Gate evaluation failed to start:", err);
      stayOnCurrentStep(
        err instanceof Error
          ? `Answer evaluation failed to start: ${err.message}`
          : `Answer evaluation failed to start: ${String(err)}`,
      );
    }
  }, [
    workspacePath,
    skillName,
    selectedModel,
    setGateLoading,
    agentStartRun,
    setActiveAgent,
    stayOnCurrentStep,
  ]);

  const finishGateEvaluation = useCallback(
    async (evaluationPayload?: unknown) => {
      if (!workspacePath) {
        stayOnCurrentStep(
          "Answer evaluation failed because the workspace is unavailable. Retry when the workspace is ready.",
        );
        return;
      }

      console.debug("[workflow] Gate evaluation payload:", evaluationPayload);

      try {
        let evaluation: AnswerEvaluation;

        if (evaluationPayload != null) {
          await materializeAnswerEvaluationOutput(
            skillName,
            workspacePath,
            evaluationPayload as import("@/lib/types").AnswerEvaluationOutput,
          );
          evaluation = evaluationPayload as AnswerEvaluation;
        } else {
          stayOnCurrentStep(
            "Answer evaluation output was missing from the completed runtime result. Review the workflow logs and retry.",
          );
          return;
        }

        if (
          !["sufficient", "mixed", "insufficient"].includes(evaluation.verdict)
        ) {
          console.warn("[workflow] Invalid gate verdict:", evaluation.verdict);
          stayOnCurrentStep(
            "Answer evaluation returned an invalid verdict. Review the workflow logs and retry.",
          );
          return;
        }

        // Persist per-question verdicts to the DB and invalidate the query cache
        // so the clarifications editor reflects the evaluator feedback.
        try {
          const updates = (evaluation.per_question ?? [])
            .filter((q) => q.verdict)
            .map((q) => ({
              question_id: q.question_id,
              verdict: q.verdict ?? null,
              reason: q.reason ?? null,
            }));
          if (updates.length > 0) {
            await invokeCommand("update_clarification_verdicts", {
              skillId: String(skillId),
              updates,
            });
          }
          appQueryClient.invalidateQueries({
            queryKey: queryKeys.clarifications.bySkill(String(skillId)),
          });
        } catch (err) {
          console.warn(
            "[workflow] Could not persist clarification verdicts from gate evaluation:",
            err,
          );
        }

        const gateDecision = evaluation.gate_decision ?? "run_research";

        if (skillsPath) {
          const gateLog = JSON.stringify({
            ...evaluation,
            action: gateDecision,
            timestamp: new Date().toISOString(),
          });
          writeFile(
            joinPath(
              skillDir(skillsPath, pluginSlug, skillName),
              "gate-result.json",
            ),
            gateLog,
          ).catch((e) =>
            console.warn(
              "[use-workflow-gate] non-fatal: op=writeFile err=%s",
              e,
            ),
          );
        }

        logGateDecision(skillName, evaluation.verdict, gateDecision).catch(
          (e) =>
            console.warn(
              "[use-workflow-gate] non-fatal: op=logGateDecision err=%s",
              e,
            ),
        );

        setGateLoading(false);

        if (gateDecision === "revise") {
          const stepToRestore =
            gateStepRef.current ?? useWorkflowStore.getState().currentStep;
          // Contradictions found or answers insufficient — stay on step 0 so the user can revise.
          cancelPendingAutoStart();
          setCurrentStep(stepToRestore);
          toast.warning(
            "Please review the feedback and revise your answers before continuing",
            { duration: Infinity },
          );
          updateStepStatus(stepToRestore, "completed");
          // The query cache was already invalidated above; the clarifications editor
          // will re-fetch from the DB automatically via useClarifications.
        } else {
          // "run_research" or unrecognized — advance to step 1.
          updateStepStatus(
            useWorkflowStore.getState().currentStep,
            "completed",
          );
          advanceToNextStep();
        }
      } catch (err) {
        console.warn(
          "[workflow] Gate evaluation materialization failed:",
          err,
        );
        stayOnCurrentStep(
          "Answer evaluation output could not be read. Review the workflow logs and retry.",
        );
      }
    },
    [
      skillsPath,
    skillId,
    skillName,
      advanceToNextStep,
      cancelPendingAutoStart,
      purpose,
      setCurrentStep,
      setGateLoading,
      stayOnCurrentStep,
    ],
  );

  // --- Routing ---

  const runGateOrAdvance = useCallback(() => {
    const { gateLoading: gateLoadingNow } = useWorkflowStore.getState();
    if (gateLoadingNow || gateAgentIdRef.current) return;

    if ((currentStep === 0 || currentStep === 1) && workspacePath) {
      runGateEvaluation();
      return;
    }

    advanceToNextStep();
  }, [currentStep, workspacePath, runGateEvaluation, advanceToNextStep]);

  const handleReviewContinue = useCallback(() => {
    runGateOrAdvance();
  }, [runGateOrAdvance]);

  return {
    runGateOrAdvance,
    handleReviewContinue,
    gateAgentIdRef,
    gateStepRef,
    finishGateEvaluation,
  };
}
