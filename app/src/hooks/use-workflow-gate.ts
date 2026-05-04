import { useCallback, useRef } from "react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useAgentStore } from "@/stores/agent-store";
import type { AnswerEvaluation } from "@/lib/tauri";
import {
  runAnswerEvaluator,
  materializeAnswerEvaluationOutput,
  logGateDecision,
  readFile,
  invokeCommand,
  writeFile,
} from "@/lib/tauri";
import { requireSettingsModel } from "@/lib/models";
import { joinPath } from "@/lib/path-utils";
import { toast } from "@/lib/toast";
import { workspaceSkillDir } from "@/lib/evals";
import pluginPaths from "../../plugin-paths.json";
import { useSettingsStore } from "@/stores/settings-store";
import { appQueryClient } from "@/lib/query-client";
import { queryKeys } from "@/lib/queries/query-keys";

export interface UseWorkflowGateOptions {
  skillName: string;
  pluginSlug?: string;
  workspacePath: string | null;
  currentStep: number;
  purpose: string | null;
  /** Called after gate completes to advance the workflow */
  advanceToNextStep: () => void;
}

export interface UseWorkflowGateReturn {
  runGateOrAdvance: () => void;
  handleReviewContinue: () => void;
  /** Ref tracking the active gate evaluator agent ID (null when idle) */
  gateAgentIdRef: React.MutableRefObject<string | null>;
  /** Process gate agent completion — called by the agent watcher effect */
  finishGateEvaluation: (structuredOutput?: unknown) => Promise<void>;
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
  skillName,
  pluginSlug = pluginPaths.default_plugin_slug,
  workspacePath,
  currentStep,
  purpose,
  advanceToNextStep,
}: UseWorkflowGateOptions): UseWorkflowGateReturn {
  const updateStepStatus = useWorkflowStore((s) => s.updateStepStatus);
  const setGateLoading = useWorkflowStore((s) => s.setGateLoading);
  const setActiveAgent = useAgentStore((s) => s.setActiveAgent);
  const agentStartRun = useAgentStore((s) => s.startRun);
  const selectedModel = useSettingsStore((s) => s.modelSettings.model);

  const gateAgentIdRef = useRef<string | null>(null);

  // --- Core gate operations ---

  const runGateEvaluation = useCallback(async () => {
    if (!workspacePath) return;
    console.log(`[workflow] Running answer evaluator gate for "${skillName}"`);

    let model: string;
    try {
      model = requireSettingsModel(selectedModel);
    } catch (err) {
      console.error("[workflow] Gate evaluation skipped:", err);
      toast.warning("Answer evaluation skipped — proceeding to next step", {
        duration: Infinity,
      });
      updateStepStatus(currentStep, "completed");
      advanceToNextStep();
      return;
    }

    try {
      setGateLoading(true);
      const agentId = await runAnswerEvaluator(skillName, workspacePath);
      console.log(`[workflow] Gate evaluator started: agentId=${agentId}`);
      gateAgentIdRef.current = agentId;
      agentStartRun(agentId, model);
      setActiveAgent(agentId);
    } catch (err) {
      console.error("[workflow] Gate evaluation failed to start:", err);
      setGateLoading(false);
      toast.warning("Answer evaluation skipped — proceeding to next step", {
        duration: Infinity,
      });
      updateStepStatus(currentStep, "completed");
      advanceToNextStep();
    }
  }, [
    workspacePath,
    skillName,
    selectedModel,
    currentStep,
    setGateLoading,
    agentStartRun,
    setActiveAgent,
    updateStepStatus,
    advanceToNextStep,
  ]);

  const finishGateEvaluation = useCallback(
    async (structuredOutput?: unknown) => {
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
          await materializeAnswerEvaluationOutput(
            skillName,
            workspacePath,
            structuredOutput as import("@/lib/types").AnswerEvaluationOutput,
          );
        }

        const evalPath = joinPath(
          workspaceSkillDir(workspacePath, pluginSlug, skillName),
          "answer-evaluation.json",
        );
        const raw = await readFile(evalPath);
        const evaluation: AnswerEvaluation = JSON.parse(raw);

        if (
          !["sufficient", "mixed", "insufficient"].includes(evaluation.verdict)
        ) {
          console.warn("[workflow] Invalid gate verdict:", evaluation.verdict);
          proceedNormally();
          return;
        }

        // Persist per-question verdicts to the DB and invalidate the query cache
        // so the clarifications editor reflects the evaluator feedback.
        try {
          const updates = (evaluation.per_question ?? []).map((q) => ({
            question_id: q.question_id,
            verdict: q.verdict ?? null,
            reason: q.reason ?? null,
          }));
          if (updates.length > 0) {
            await invokeCommand("update_clarification_verdicts", {
              skillId: skillName,
              updates,
            });
          }
          appQueryClient.invalidateQueries({
            queryKey: queryKeys.clarifications.bySkill(skillName),
          });
        } catch (err) {
          console.warn(
            "[workflow] Could not persist clarification verdicts from gate evaluation:",
            err,
          );
        }

        const gateDecision = evaluation.gate_decision ?? "run_research";

        if (workspacePath) {
          const gateLog = JSON.stringify({
            ...evaluation,
            action: gateDecision,
            timestamp: new Date().toISOString(),
          });
          writeFile(
            joinPath(
              workspaceSkillDir(workspacePath, pluginSlug, skillName),
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
          // Contradictions found or answers insufficient — stay on step 0 so the user can revise.
          toast.info(
            "Please review the feedback and revise your answers before continuing",
          );
          updateStepStatus(
            useWorkflowStore.getState().currentStep,
            "completed",
          );
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
          "[workflow] Gate evaluation materialization failed — proceeding normally:",
          err,
        );
        proceedNormally();
      }
    },
    [
      workspacePath,
      skillName,
      purpose,
      setGateLoading,
      updateStepStatus,
      advanceToNextStep,
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
    finishGateEvaluation,
  };
}
