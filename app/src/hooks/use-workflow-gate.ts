import { useCallback, useRef } from "react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useAgentStore } from "@/stores/agent-store";
import type { ClarificationsFile } from "@/lib/clarifications-types";
import type { AnswerEvaluation } from "@/lib/tauri";
import {
  runAnswerEvaluator,
  materializeAnswerEvaluationOutput,
  logGateDecision,
  readFile,
  getClarificationsContent,
  saveClarificationsContent,
  writeFile,
} from "@/lib/tauri";
import { resolveModelId } from "@/lib/models";
import { joinPath } from "@/lib/path-utils";
import { parseClarifications } from "@/lib/clarifications-types";
import { buildGateFeedbackNotes } from "@/lib/gate-feedback";
import { workspaceSkillDir } from "@/lib/evals";
import pluginPaths from "../../plugin-paths.json";

export interface UseWorkflowGateOptions {
  skillName: string;
  pluginSlug?: string;
  workspacePath: string | null;
  currentStep: number;
  purpose: string | null;
  clarificationsData: ClarificationsFile | null;
  onClarificationsUpdated?: (data: ClarificationsFile, content: string) => void;
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
  clarificationsData: _clarificationsData,
  onClarificationsUpdated,
  advanceToNextStep,
}: UseWorkflowGateOptions): UseWorkflowGateReturn {
  const updateStepStatus = useWorkflowStore((s) => s.updateStepStatus);
  const setGateLoading = useWorkflowStore((s) => s.setGateLoading);
  const setActiveAgent = useAgentStore((s) => s.setActiveAgent);
  const agentStartRun = useAgentStore((s) => s.startRun);

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

      const evalPath = joinPath(workspaceSkillDir(workspacePath, pluginSlug, skillName), "answer-evaluation.json");
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

      const gateDecision = evaluation.gate_decision ?? "run_research";

      if (workspacePath) {
        const gateLog = JSON.stringify({ ...evaluation, action: gateDecision, timestamp: new Date().toISOString() });
        writeFile(joinPath(workspaceSkillDir(workspacePath, pluginSlug, skillName), "gate-result.json"), gateLog).catch((e) => console.warn("[use-workflow-gate] non-fatal: op=writeFile err=%s", e));
      }

      logGateDecision(skillName, evaluation.verdict, gateDecision).catch((e) => console.warn("[use-workflow-gate] non-fatal: op=logGateDecision err=%s", e));

      setGateLoading(false);

      if (gateDecision === "revise") {
        // Contradictions found or answers insufficient — stay on step 0 so the user can revise.
        updateStepStatus(useWorkflowStore.getState().currentStep, "completed");
        // Refresh clarifications so the feedback notes are visible to the user.
        if (workspacePath) {
          getClarificationsContent(skillName, workspacePath)
            .then((content) => {
              const parsed = parseClarifications(content ?? null);
              if (parsed) {
                onClarificationsUpdated?.(parsed, content ?? "");
              }
            })
            .catch(() => {
              console.warn("[use-workflow-gate] Could not refresh clarifications after revise decision");
            });
        }
      } else {
        // "run_research" or unrecognized — advance to step 1.
        updateStepStatus(useWorkflowStore.getState().currentStep, "completed");
        advanceToNextStep();
      }
    } catch (err) {
      console.warn("[workflow] Gate evaluation materialization failed — proceeding normally:", err);
      proceedNormally();
    }
  }, [workspacePath, skillName, purpose, setGateLoading, updateStepStatus, advanceToNextStep, onClarificationsUpdated]);

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
