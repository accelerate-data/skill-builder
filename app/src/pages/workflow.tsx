import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useBlocker, useNavigate } from "@tanstack/react-router";
import { type SaveStatus } from "@/components/clarifications-editor";
import { type ClarificationsFile, type Note, parseClarifications } from "@/lib/clarifications-types";
import {
  Play,
  AlertCircle,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { WorkflowSidebar } from "@/components/workflow-sidebar";
import { AgentOutputPanel } from "@/components/agent-output-panel";
import { AgentInitializingIndicator } from "@/components/agent-initializing-indicator";
import { RuntimeErrorDialog } from "@/components/runtime-error-dialog";
import { WorkflowStepComplete } from "@/components/workflow-step-complete";
import ResetStepDialog from "@/components/reset-step-dialog";
import "@/hooks/use-agent-stream";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useAgentStore, flushMessageBuffer } from "@/stores/agent-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  runWorkflowStep,
  resetWorkflowStep,
  getWorkflowState,
  saveWorkflowState,
  readFile,
  writeFile,
  getContextFileContent,
  getClarificationsContent,
  saveClarificationsContent,
  cleanupSkillSidecar,
  acquireLock,
  releaseLock,
  verifyStepOutput,
  endWorkflowSession,
  getDisabledSteps,
  runAnswerEvaluator,
  logGateDecision,
  materializeAnswerEvaluationOutput,
  materializeWorkflowStepOutput,
  navigateBackToStepDb,
  type AnswerEvaluation,
} from "@/lib/tauri";
import { TransitionGateDialog, type GateVerdict } from "@/components/transition-gate-dialog";
import { resolveModelId } from "@/lib/models";

// --- Step config ---

interface StepConfig {
  type: "agent" | "reasoning";
  outputFiles?: string[];
  /** Default model shorthand for display (actual model comes from backend settings) */
  model?: string;
  /** When true, show editable ClarificationsEditor on the completion screen */
  clarificationsEditable?: boolean;
}

const STEP_CONFIGS: Record<number, StepConfig> = {
  0: { type: "agent", outputFiles: ["context/clarifications.json"], model: "sonnet", clarificationsEditable: true },
  1: { type: "agent", outputFiles: ["context/clarifications.json"], model: "sonnet", clarificationsEditable: true },
  2: { type: "reasoning", outputFiles: ["context/decisions.json"], model: "opus" },
  3: { type: "agent", outputFiles: ["skill/SKILL.md", "skill/references/"], model: "sonnet" },
};

export default function WorkflowPage() {
  const { skillName } = useParams({ from: "/skill/$skillName" });
  const navigate = useNavigate();
  const workspacePath = useSettingsStore((s) => s.workspacePath);
  const skillsPath = useSettingsStore((s) => s.skillsPath);
  const {
    purpose,
    currentStep,
    steps,
    isRunning,
    isInitializing,
    hydrated,
    reviewMode,
    disabledSteps,
    gateLoading,
    setGateLoading,
    initWorkflow,
    setCurrentStep,
    updateStepStatus,
    setRunning,
    setInitializing,
    clearInitializing,
    runtimeError,
    clearRuntimeError,
    resetToStep,
    navigateBackToStep,
    loadWorkflowState,
    setHydrated,
  } = useWorkflowStore();

  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const runs = useAgentStore((s) => s.runs);
  const agentStartRun = useAgentStore((s) => s.startRun);
  const setActiveAgent = useAgentStore((s) => s.setActiveAgent);
  const clearRuns = useAgentStore((s) => s.clearRuns);

  // --- Navigation guard ---
  // Block navigation while an agent is running and show a confirmation dialog.
  // Key: shouldBlockFn reads directly from Zustand (not React state) so the
  // value is current when the router re-evaluates after proceed().
  const { proceed, reset: resetBlocker, status: blockerStatus } = useBlocker({
    shouldBlockFn: () => {
      const s = useWorkflowStore.getState();
      return s.isRunning || s.gateLoading || hasUnsavedChangesRef.current;
    },
    enableBeforeUnload: false,
    withResolver: true,
  });

  /** End the active workflow session (fire-and-forget) and clear the store field. */
  const endActiveSession = useCallback(() => {
    const sessionId = useWorkflowStore.getState().workflowSessionId;
    if (sessionId) {
      endWorkflowSession(sessionId).catch(() => {});
      useWorkflowStore.setState({ workflowSessionId: null });
    }
  }, []);

  const handleNavStay = useCallback(() => {
    resetBlocker?.();
  }, [resetBlocker]);

  const handleNavLeave = useCallback(() => {
    const store = useWorkflowStore.getState();
    const { currentStep: step, steps: curSteps } = store;
    if (curSteps[step]?.status === "in_progress") {
      useWorkflowStore.getState().updateStepStatus(step, "pending");
    }

    useWorkflowStore.getState().setRunning(false);
    useWorkflowStore.getState().setGateLoading(false);
    // Clear session ID so the next "Continue" starts a fresh session
    useWorkflowStore.setState({ workflowSessionId: null });
    useAgentStore.getState().clearRuns();

    // Fire-and-forget: end workflow session
    endActiveSession();

    // Fire-and-forget: shut down persistent sidecar for this skill
    cleanupSkillSidecar(skillName).catch(() => {});

    // Fire-and-forget: release skill lock before leaving
    releaseLock(skillName).catch(() => {});

    proceed?.();
  }, [proceed, skillName, endActiveSession]);

  // Safety-net cleanup: revert running state on unmount (e.g. if the
  // component is removed without going through the blocker dialog).
  // Also flushes buffered agent messages, ends the workflow session,
  // releases the skill lock, and shuts down the persistent sidecar.
  useEffect(() => {
    return () => {
      // Flush any pending RAF-batched messages so they aren't lost
      flushMessageBuffer();

      const store = useWorkflowStore.getState();
      if (store.isRunning) {
        if (store.steps[store.currentStep]?.status === "in_progress") {
          useWorkflowStore.getState().updateStepStatus(store.currentStep, "pending");
        }
        useWorkflowStore.getState().setRunning(false);
        useAgentStore.getState().clearRuns();
      }
      useWorkflowStore.getState().setGateLoading(false);
      // Clear session ID so the next "Continue" starts a fresh session
      useWorkflowStore.setState({ workflowSessionId: null });

      // Fire-and-forget: end workflow session
      const sessionId = store.workflowSessionId;
      if (sessionId) {
        endWorkflowSession(sessionId).catch(() => {});
        useWorkflowStore.setState({ workflowSessionId: null });
      }

      // Fire-and-forget: release skill lock and shut down persistent sidecar
      releaseLock(skillName).catch(() => {});
      cleanupSkillSidecar(skillName).catch(() => {});
    };
  }, [skillName]);

  const stepConfig = STEP_CONFIGS[currentStep];

  // Clarifications editing state (for steps with clarificationsEditable)
  const [reviewContent, setReviewContent] = useState<string | null>(null);
  const [clarificationsData, setClarificationsData] = useState<ClarificationsFile | null>(null);
  // Explicit dirty flag — set on user edits, cleared on save/reload/load
  const [editorDirty, setEditorDirty] = useState(false);
  const hasUnsavedChanges = editorDirty;
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref for navigation guard (shouldBlockFn runs outside React render cycle).
  // Scoped to clarifications-editable steps so it doesn't block on other steps.
  const hasUnsavedChangesRef = useRef(false);
  useEffect(() => {
    hasUnsavedChangesRef.current = !!stepConfig?.clarificationsEditable && hasUnsavedChanges;
  }, [stepConfig?.clarificationsEditable, hasUnsavedChanges]);

  // Pending step switch — set when user clicks a sidebar step while agent is running
  const [pendingStepSwitch, setPendingStepSwitch] = useState<number | null>(null);

  /** Abandon the active agent and switch to a different step (step-switch guard "Leave").
   *  Unlike handleNavLeave, we do NOT release the skill lock or shut down the sidecar
   *  because the user is still in the workflow — the next step will reuse both. */
  const handleStepSwitchLeave = useCallback(() => {
    const targetStep = pendingStepSwitch;
    const { currentStep: step, steps: curSteps } = useWorkflowStore.getState();
    if (curSteps[step]?.status === "in_progress") {
      useWorkflowStore.getState().updateStepStatus(step, "pending");
    }
    useWorkflowStore.getState().setRunning(false);
    useWorkflowStore.getState().setGateLoading(false);
    useAgentStore.getState().clearRuns();

    endActiveSession();

    setPendingStepSwitch(null);
    setCurrentStep(targetStep!);
  }, [pendingStepSwitch, endActiveSession, setCurrentStep]);

  // Track whether error state has partial artifacts
  const [errorHasArtifacts, setErrorHasArtifacts] = useState(false);

  // Confirmation dialog for resetting steps with partial output
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Transition gate dialog state
  const [showGateDialog, setShowGateDialog] = useState(false);
  const [gateVerdict, setGateVerdict] = useState<GateVerdict | null>(null);
  const [gateEvaluation, setGateEvaluation] = useState<AnswerEvaluation | null>(null);
  const gateAgentIdRef = useRef<string | null>(null);
  const lastCompletedCostRef = useRef<number | undefined>(undefined);
  const [gateContext, setGateContext] = useState<"clarifications" | "refinements">("clarifications");

  // Target step for reset confirmation dialog (when clicking a prior step)
  const [resetTarget, setResetTarget] = useState<number | null>(null);

  // Consume the pendingUpdateMode flag set before navigation.
  // If set, switch to update mode so the first step auto-starts.
  const consumeUpdateMode = () => {
    const store = useWorkflowStore.getState();
    if (store.pendingUpdateMode) {
      store.setPendingUpdateMode(false);
      store.setReviewMode(false);
    }
  };

  // Initialize workflow and restore state from SQLite
  useEffect(() => {
    let cancelled = false;
    const store = useWorkflowStore.getState();

    // Already fully hydrated for this skill — skip.
    // Must check hydrated too: React StrictMode unmounts/remounts effects,
    // so skillName can match from the first (aborted) run while hydration
    // never completed.
    if (store.skillName === skillName && store.hydrated) {
      consumeUpdateMode();
      return;
    }

    // Clear stale agent data from previous skill so lifecycle effects
    // don't pick up a completed run from another workflow.
    clearRuns();

    // Reset immediately so stale state from another skill doesn't linger
    initWorkflow(skillName);

    // Read workflow state from SQLite
    getWorkflowState(skillName)
      .then((state) => {
        if (cancelled) return;
        if (!state.run) {
          setHydrated(true);
          return;
        }

        initWorkflow(skillName, state.run.purpose);

        const completedIds = state.steps
          .filter((s) => s.status === "completed")
          .map((s) => s.step_id);
        if (completedIds.length > 0) {
          loadWorkflowState(completedIds, state.run.current_step);
        } else {
          setHydrated(true);
        }

        // Restore disabled steps (scope recommendation) after hydration
        getDisabledSteps(skillName)
          .then((disabled) => {
            if (!cancelled) {
              useWorkflowStore.getState().setDisabledSteps(disabled);
            }
          })
          .catch(() => {}); // Non-fatal
      })
      .catch(() => {
        setHydrated(true);
      })
      .finally(() => {
        // Consume the pendingUpdateMode flag exactly once, regardless of
        // which path the async flow took (no saved state, has saved state,
        // or error). Must run after initWorkflow which resets reviewMode.
        if (!cancelled) {
          consumeUpdateMode();
        }
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillName]);

  // --- Skill lock management ---
  // Acquire lock when entering workflow, release when leaving.
  useEffect(() => {
    let mounted = true;

    acquireLock(skillName).catch((err) => {
      if (mounted) {
        toast.error(`Could not lock skill: ${err instanceof Error ? err.message : String(err)}`, {
          duration: Infinity,
          cause: err,
          context: { operation: "workflow_acquire_lock", skillName },
        });
        navigate({ to: "/" });
      }
    });

    return () => {
      mounted = false;
      // Fire-and-forget: release lock on unmount
      releaseLock(skillName).catch(() => {});
    };
  }, [skillName, navigate]);

  // Reset state when moving to a new step
  useEffect(() => {
    setErrorHasArtifacts(false);
    hasUnsavedChangesRef.current = false;
  }, [currentStep]);

  // Error-state artifact check: detect whether a failed step left partial output.
  useEffect(() => {
    const stepStatus = steps[currentStep]?.status;

    if (stepStatus === "error" && skillName) {
      const cfg = STEP_CONFIGS[currentStep];
      const firstOutput = cfg?.outputFiles?.[0];
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
  }, [currentStep, steps, skillsPath, workspacePath, skillName]);

  // Debounced SQLite persistence — saves workflow state at most once per 300ms
  // instead of firing synchronously on every step/status change.
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

  // Load clarifications file when viewing a completed clarifications-editable step.
  // Context files are backend-owned under workspace path.
  useEffect(() => {
    const currentStepStatus = steps[currentStep]?.status;
    if (!stepConfig?.clarificationsEditable || currentStepStatus !== "completed" || !workspacePath) {
      setReviewContent(null);
      return;
    }

    getClarificationsContent(skillName, workspacePath)
      .then((content) => {
        setReviewContent(content ?? null);
        setClarificationsData(parseClarifications(content ?? null));
      })
      .catch(() => {
        setReviewContent(null);
        setClarificationsData(null);
      })
      .finally(() => {
        setEditorDirty(false);
      });
  }, [currentStep, steps, stepConfig?.clarificationsEditable, workspacePath, skillName]);

  // Advance to next step helper
  const [pendingAutoStartStep, setPendingAutoStartStep] = useState<number | null>(null);

  /** After resetting to a step, auto-start if it's an agent step in update mode. */
  const isAgentType = stepConfig?.type === "agent" || stepConfig?.type === "reasoning";

  const autoStartAfterReset = (stepId: number) => {
    const cfg = STEP_CONFIGS[stepId];
    if ((cfg?.type === "agent" || cfg?.type === "reasoning") && !useWorkflowStore.getState().reviewMode) {
      setPendingAutoStartStep(stepId);
    }
  };

  const advanceToNextStep = useCallback(() => {
    const { gateLoading: gateLoadingNow, disabledSteps: disabled } = useWorkflowStore.getState();
    // Transition gate owns progression while answer analysis is running.
    if (gateLoadingNow || gateAgentIdRef.current) return;
    if (currentStep >= steps.length - 1) return;
    const nextStep = currentStep + 1;

    // Don't advance if the next step is disabled (scope too broad)
    if (disabled.includes(nextStep)) return;

    setCurrentStep(nextStep);

    // All steps are agent or reasoning — auto-start
    setPendingAutoStartStep(nextStep);
  }, [currentStep, steps, setCurrentStep]);

  // Auto-start agent/reasoning steps:
  // 1. When advancing from a completed step (pendingAutoStart set by advanceToNextStep)
  // 2. On initial page load when step hasn't started yet
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

  // Auto-start when switching from Review → Update mode on a pending agent step.
  // Does NOT fire on initial page load (new skills show a Start button per AC 1).
  const prevReviewModeRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!hydrated) return;

    const wasToggle = prevReviewModeRef.current === true && !reviewMode;
    prevReviewModeRef.current = reviewMode;

    if (!wasToggle) return; // only auto-start on review→update toggle
    if (!workspacePath) return;
    const status = steps[currentStep]?.status;
    if (status && status !== "pending") return;
    if (isRunning || pendingAutoStartStep !== null || gateLoading) return;
    console.log(`[workflow] Auto-starting step ${currentStep} (review→update toggle)`);
    setPendingAutoStartStep(currentStep);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, reviewMode]);

  // Reposition to first incomplete step when switching to Update mode (AC 3).
  // Exception: if the user is on a completed clarifications-editable step, stay put —
  // they're switching to update mode specifically to edit answers.
  useEffect(() => {
    if (!hydrated || reviewMode) return;
    const currentCfg = STEP_CONFIGS[currentStep];
    if (currentCfg?.clarificationsEditable && steps[currentStep]?.status === "completed") {
      return; // stay on this step for editing
    }
    const first = steps.find((s) => s.status !== "completed");
    const target = first ? first.id : steps.length - 1;
    if (target !== currentStep) {
      setCurrentStep(target);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewMode]);

  // Watch for agent completion
  const activeRun = activeAgentId ? runs[activeAgentId] : null;
  const activeRunStatus = activeRun?.status;

  const extractStructuredResultPayload = useCallback((agentId: string): unknown | null => {
    const run = useAgentStore.getState().runs[agentId];
    if (!run) return null;
    for (let i = run.messages.length - 1; i >= 0; i -= 1) {
      const msg = run.messages[i];
      if (msg.type !== "result") continue;
      const raw = msg.raw as Record<string, unknown>;
      // Prefer structured_output (new SDK behavior: text in result, JSON in structured_output).
      // Fall back to result for older SDK versions where result held the JSON object directly.
      if ("structured_output" in raw && raw.structured_output != null) return raw.structured_output;
      if ("result" in raw && raw.result != null && typeof raw.result !== "string") return raw.result;
    }
    return null;
  }, []);

  // Watch for gate agent (answer evaluator) completion — separate from workflow step agents
  useEffect(() => {
    if (!activeRunStatus || !activeAgentId) return;
    if (gateAgentIdRef.current !== activeAgentId) return; // not the gate agent

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

      // Materialize gate evaluation output before clearing run messages.
      const structuredOutput = extractStructuredResultPayload(completedGateAgentId);
      clearRuns();
      finishGateEvaluation(structuredOutput);
    }
  }, [activeRunStatus, activeAgentId, extractStructuredResultPayload]);

  useEffect(() => {
    if (!activeRunStatus || !activeAgentId) return;
    // Skip gate agent — handled by the dedicated gate watcher above
    if (gateAgentIdRef.current === activeAgentId) return;
    // Guard: only complete steps that are actively running an agent
    const { steps: currentSteps, currentStep: step } = useWorkflowStore.getState();
    if (currentSteps[step]?.status !== "in_progress") return;

    if (activeRunStatus === "completed") {
      const completedAgentId = activeAgentId;
      // Capture cost before clearing activeAgent — after setActiveAgent(null),
      // activeRun becomes null so activeRun?.totalCost would be undefined.
      lastCompletedCostRef.current = completedAgentId
        ? useAgentStore.getState().runs[completedAgentId]?.totalCost
        : undefined;
      setActiveAgent(null);

      const finish = async () => {
        // Backend-owned writes: step 0/1/2 return canonical artifact payload in
        // structured output; Rust validates and writes context files.
        if ((step === 0 || step === 1 || step === 2) && completedAgentId) {
          const structuredOutput = extractStructuredResultPayload(completedAgentId);
          if (structuredOutput == null || typeof structuredOutput !== "object" || Array.isArray(structuredOutput)) {
            // Step 1 requires a structured output object — treat missing/invalid as an error.
            // Step 0 does not require it — continue normally without materialization.
            if (step === 1) {
              updateStepStatus(step, "error");
              setRunning(false);
              toast.error(
                `Step ${step + 1} completed but produced no structured output`,
                { duration: Infinity },
              );
              return;
            }
            // step 0 and step 2: proceed without calling materialize
          } else {
            try {
              await materializeWorkflowStepOutput(skillName, step, structuredOutput);
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

        // Verify the agent actually produced output files before marking complete
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

        // Check for disabled steps before marking complete (so first render has correct state)
        if (step === 0 && skillName) {
          try {
            const disabled = await getDisabledSteps(skillName);
            useWorkflowStore.getState().setDisabledSteps(disabled);
          } catch {
            // Non-fatal: proceed normally
          }
        }

        updateStepStatus(step, "completed");
        setRunning(false);
        toast.success(`Step ${step + 1} completed`);

        // Agent steps always pause on the completion screen so the user can
        // review output files before proceeding. The user clicks "Next Step"
        // (or "Close" on the last step) in the bottom action bar.
      };

      finish();
    } else if (activeRunStatus === "error") {
      updateStepStatus(step, "error");
      setRunning(false);
      setActiveAgent(null);
      // Clear initializing state if the agent errored before sending any messages
      const workflowState = useWorkflowStore.getState();
      if (workflowState.isInitializing) {
        workflowState.clearInitializing();
      }
      toast.error(`Step ${step + 1} failed`, { duration: Infinity });
    }
  }, [
    activeRunStatus,
    updateStepStatus,
    setRunning,
    setActiveAgent,
    skillName,
    workspacePath,
    advanceToNextStep,
    extractStructuredResultPayload,
  ]);

  // --- Step handlers ---

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
      clearRuntimeError();
      updateStepStatus(currentStep, "in_progress");
      setRunning(true);
      setInitializing();

      console.log(`[workflow] Starting step ${currentStep} for skill "${skillName}"`);
      const agentId = await runWorkflowStep(
        skillName,
        currentStep,
        workspacePath,
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
    // Ensure no stale auto-start trigger can run another step during gate analysis.
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
      // Fail-open: proceed normally
      updateStepStatus(currentStep, "completed");
      advanceToNextStep();
    }
  };

  const runGateOrAdvance = () => {
    const { gateLoading: gateLoadingNow } = useWorkflowStore.getState();
    // Ignore duplicate clicks while evaluator is already running.
    if (gateLoadingNow || gateAgentIdRef.current) return;

    // Gate 1: after step 0 (Research), evaluate answers before advancing to Detailed Research
    if (currentStep === 0 && workspacePath && !disabledSteps.includes(1)) {
      setGateContext("clarifications");
      runGateEvaluation();
      return;
    }

    // Gate 2: after step 1 (Detailed Research), evaluate answers before Confirm Decisions
    if (currentStep === 1 && workspacePath && !disabledSteps.includes(2)) {
      setGateContext("refinements");
      runGateEvaluation();
      return;
    }

    // All other steps: advance normally
    advanceToNextStep();
  };

  const handleReviewContinue = async () => {
    // Save the editor content via backend-owned context commands.
    if (stepConfig?.clarificationsEditable && reviewContent !== null && workspacePath) {
      try {
        const content = clarificationsData
          ? JSON.stringify(clarificationsData, null, 2)
          : (reviewContent ?? "");
        await saveClarificationsContent(skillName, workspacePath, content);
        setReviewContent(content);
        setEditorDirty(false);
      } catch (err) {
        toast.error(`Failed to save: ${err instanceof Error ? err.message : String(err)}`, {
          duration: Infinity,
          cause: err,
          context: { operation: "workflow_review_continue_save", skillName },
        });
        return;
      }
    }

    runGateOrAdvance();
  };

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

    console.log("[workflow] Gate structured output:", structuredOutput);

    try {
      // Only materialize when the agent produced a structured payload.
      // When null, skip materialization but still try to read an existing
      // answer-evaluation.json in case the backend wrote it independently.
      if (structuredOutput != null) {
        await materializeAnswerEvaluationOutput(skillName, workspacePath, structuredOutput);
      }

      const evalPath = `${workspacePath}/${skillName}/answer-evaluation.json`;
      const raw = await readFile(evalPath);
      const evaluation: AnswerEvaluation = JSON.parse(raw);

      // Validate verdict shape — if the Haiku agent wrote malformed output, proceed normally
      if (!["sufficient", "mixed", "insufficient"].includes(evaluation.verdict)) {
        console.warn("[workflow] Invalid gate verdict:", evaluation.verdict);
        proceedNormally();
        return;
      }

      // Refresh only the evaluator feedback section so research notes stay intact
      // while "Let Me Answer" returns users to actionable guidance in the editor UI.
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
            setClarificationsData(next);
            setReviewContent(serialized);
            setEditorDirty(false);
            setSaveStatus("idle");
          }
        } catch (err) {
          console.warn("[workflow] Could not update clarifications notes from gate evaluation:", err);
        }
      }

      // Write gate result to the app-managed workspace directory so it appears in Rust
      // [write_file] logs and persists for debugging.
      if (workspacePath) {
        const gateLog = JSON.stringify({ ...evaluation, action: "show_dialog", timestamp: new Date().toISOString() });
        writeFile(`${workspacePath}/${skillName}/gate-result.json`, gateLog).catch(() => {});
      }

      // All verdicts show a dialog — sufficient offers skip, mixed/insufficient offer auto-fill
      setGateLoading(false);
      setGateVerdict(evaluation.verdict);
      setGateEvaluation(evaluation);
      setShowGateDialog(true);
    } catch (err) {
      console.warn("[workflow] Gate evaluation materialization failed — proceeding normally:", err);
      console.warn("[workflow] Gate structured output that failed:", structuredOutput);
      proceedNormally();
    }
  };

  function buildGateFeedbackNotes(evaluation: AnswerEvaluation): Note[] {
    const perQuestion = evaluation.per_question ?? [];
    const optionalReason = (q: (typeof perQuestion)[number]): string | null =>
      "reason" in q && typeof q.reason === "string" && q.reason.trim().length > 0
        ? q.reason.trim()
        : null;

    return perQuestion
    .filter(
      (q) =>
        q.verdict === "vague" ||
        q.verdict === "contradictory" ||
        q.verdict === "not_answered" ||
        q.verdict === "needs_refinement"
    )
      .map((q) => {
        if (q.verdict === "contradictory") {
          const fallback = `This answer conflicts with ${q.contradicts}.`;
          return {
            type: "answer_feedback",
            title: `Contradictory answer: ${q.question_id}`,
            body: optionalReason(q) || fallback,
          };
        }
      if (q.verdict === "not_answered") {
        return {
          type: "answer_feedback",
          title: `Not answered: ${q.question_id}`,
          body:
            optionalReason(q) ||
            "This question is still unanswered. Add a concrete answer before continuing.",
        };
      }
      if (q.verdict === "needs_refinement") {
        return {
          type: "answer_feedback",
          title: `Needs refinement: ${q.question_id}`,
          body:
            optionalReason(q) ||
            "Answer has useful direction but needs more concrete detail and constraints.",
        };
      }
        return {
          type: "answer_feedback",
          title: `Vague answer: ${q.question_id}`,
          body: optionalReason(q) || "Answer is too general and needs specific details.",
        };
      });
  }

  const closeGateDialog = () => {
    setShowGateDialog(false);
    setGateVerdict(null);
    setGateEvaluation(null);
  };

  /** Skip to decisions: gate 1 skips step 1 → jump to step 2, gate 2 just advances from step 1. */
  const skipToDecisions = (message: string) => {
    closeGateDialog();
    if (gateContext === "refinements") {
      // Gate 2: just advance from step 1 to step 2
      updateStepStatus(useWorkflowStore.getState().currentStep, "completed");
      advanceToNextStep();
    } else {
      // Gate 1: skip step 1 (Detailed Research) and jump to step 2 (Confirm Decisions)
      updateStepStatus(1, "completed");
      setCurrentStep(2);
    }
    // Persist immediately so a crash in the 300ms debounce window cannot revert the skipped step.
    // Read the store after the synchronous Zustand updates above so the snapshot is current.
    const s = useWorkflowStore.getState();
    const stepStatuses = s.steps.map((step) => ({ step_id: step.id, status: step.status }));
    const runStatus = s.steps.every((step) => step.status === "completed") ? "completed" : "pending";
    saveWorkflowState(skillName, s.currentStep, runStatus, stepStatuses, purpose ?? undefined).catch(
      (err) => console.error("skipToDecisions: failed to persist state:", err),
    );
    toast.success(message);
  };

  /** Write the user's gate decision to the app-managed workspace so it appears in Rust [write_file] logs. */
  const logGateAction = (decision: string) => {
    if (!workspacePath) return;
    const entry = JSON.stringify({ decision, verdict: gateVerdict, timestamp: new Date().toISOString() });
    writeFile(`${workspacePath}/${skillName}/gate-result.json`, entry).catch(() => {});
    logGateDecision(skillName, gateVerdict ?? "unknown", decision).catch(() => {});
  };

  /** Sufficient: skip straight to decisions (gate 1) or advance (gate 2). */
  const handleGateSkip = () => {
    logGateAction("skip");
    if (gateContext === "refinements") {
      skipToDecisions("Refinement answers verified — continuing to decisions");
    } else {
      skipToDecisions("Skipped detailed research — answers were sufficient");
    }
  };

  /** Sufficient override: run research anyway (gate 1) or continue to decisions (gate 2). */
  const handleGateResearch = () => {
    logGateAction(gateContext === "refinements" ? "continue_to_decisions" : "research_anyway");
    closeGateDialog();
    updateStepStatus(useWorkflowStore.getState().currentStep, "completed");
    advanceToNextStep();
  };

  /** Continue anyway: advance without auto-fill despite incomplete answers. */
  const handleGateContinueAnyway = () => {
    logGateAction("continue_anyway");
    closeGateDialog();
    updateStepStatus(useWorkflowStore.getState().currentStep, "completed");
    advanceToNextStep();
    toast.success("Continuing with current answers");
  };

  /** Override: go back to review so user can answer manually. */
  const handleGateLetMeAnswer = () => {
    logGateAction("let_me_answer");
    closeGateDialog();
    toast.info("Refreshing evaluator feedback...", { duration: 5000 });
    // Ensure evaluator-generated notes are visible immediately in the editor.
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
        setReviewContent(content ?? null);
        setClarificationsData(parsed);
        setEditorDirty(false);
        setSaveStatus("idle");

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

  /** Full reset for the current step: end session, clear disk artifacts, revert store, auto-start. */
  const performStepReset = async (stepId: number) => {
    endActiveSession();
    if (workspacePath) {
      try {
        await resetWorkflowStep(workspacePath, skillName, stepId);
      } catch {
        // best-effort -- proceed even if disk cleanup fails
      }
    }
    clearRuns();
    resetToStep(stepId);
    autoStartAfterReset(stepId);
    toast.success(`Reset to step ${stepId + 1}`);
  };

  const handleClarificationsChange = useCallback((updated: ClarificationsFile) => {
    setClarificationsData(updated);
    setEditorDirty(true);
    setSaveStatus("dirty");
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
  }, []);

  // Save editor content through backend domain command.
  // Returns true on success, false if the write failed.
  const handleSave = useCallback(async (silent = false): Promise<boolean> => {
    if (!stepConfig?.clarificationsEditable || !workspacePath) return false;
    setSaveStatus("saving");
    try {
      const content = clarificationsData
        ? JSON.stringify(clarificationsData, null, 2)
        : (reviewContent ?? "");
      await saveClarificationsContent(skillName, workspacePath, content);
      setReviewContent(content);
      setEditorDirty(false);
      setSaveStatus("saved");
      // Show "Saved" for 2s, then return to idle
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
      if (!silent) toast.success("Saved");
      return true;
    } catch (err) {
      setSaveStatus("dirty"); // Revert to dirty on failure
      toast.error(`Failed to save: ${err instanceof Error ? err.message : String(err)}`, {
        duration: Infinity,
        cause: err,
        context: { operation: "workflow_handle_save", skillName },
      });
      return false;
    }
  }, [stepConfig?.clarificationsEditable, workspacePath, reviewContent, clarificationsData, skillName]);

  const currentStepDef = steps[currentStep];

  // Debounce autosave — fires 1500ms after the last edit on a clarifications-editable step.
  // The cleanup cancels the previous timer whenever deps change, so no ref is needed.
  useEffect(() => {
    if (!stepConfig?.clarificationsEditable || currentStepDef?.status !== "completed" || !editorDirty) return;

    const timer = setTimeout(() => {
      handleSave(true);
    }, 1500);

    return () => clearTimeout(timer);
  }, [clarificationsData, editorDirty, stepConfig?.clarificationsEditable, currentStepDef?.status, handleSave]);

  // --- Render helpers ---

  /** Render completed agent/reasoning step with output files. */
  const renderCompletedStep = () => {
    const nextStep = currentStep + 1;
    const isLastStep = disabledSteps.includes(nextStep) || currentStep >= steps.length - 1;
    const handleClose = () => navigate({ to: "/" });
    const handleRefine = () => {
      navigate({ to: "/refine", search: { skill: skillName } });
    };

    return (
      <WorkflowStepComplete
        stepName={currentStepDef.name}
        stepId={currentStep}
        outputFiles={stepConfig?.outputFiles ?? []}
        cost={lastCompletedCostRef.current}
        onNextStep={advanceToNextStep}
        onClose={handleClose}
        onRefine={disabledSteps.length > 0 ? undefined : handleRefine}
        isLastStep={isLastStep}
        reviewMode={reviewMode}
        skillName={skillName}
        workspacePath={workspacePath ?? undefined}
        skillsPath={skillsPath}
        clarificationsEditable={!!stepConfig?.clarificationsEditable && !reviewMode}
        clarificationsData={clarificationsData}
        onClarificationsChange={handleClarificationsChange}
        onClarificationsContinue={() => handleReviewContinue()}
        onReset={!reviewMode && stepConfig?.clarificationsEditable ? () => setResetTarget(0) : undefined}
        onResetStep={!reviewMode ? () => performStepReset(currentStep) : undefined}
        saveStatus={saveStatus}
        evaluating={!!gateLoading}
      />
    );
  };

  // --- Render content (dispatch by step type) ---

  const renderContent = () => {
    // 1. Agent running — show streaming output or init spinner
    if (activeAgentId) {
      if (isInitializing && !runs[activeAgentId]?.messages.length) {
        return <AgentInitializingIndicator />;
      }
      return <AgentOutputPanel agentId={activeAgentId} />;
    }

    // 2. Agent initializing (no ID yet)
    if (isInitializing) {
      return <AgentInitializingIndicator />;
    }

    // 3. Completed step — show output files (with editable clarifications where applicable)
    if (currentStepDef?.status === "completed") {
      return renderCompletedStep();
    }

    // 4. Error state with retry
    if (currentStepDef?.status === "error") {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
          <AlertCircle className="size-8 text-destructive/50" />
          <div className="text-center">
            <p className="font-medium text-destructive">Step {currentStep + 1} failed</p>
            <p className="mt-1 text-sm">
              An error occurred. You can retry this step.
            </p>
          </div>
          {!reviewMode && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (errorHasArtifacts) {
                    setShowResetConfirm(true);
                    return;
                  }
                  performStepReset(currentStep);
                }}
              >
                <RotateCcw className="size-3.5" />
                Reset Step
              </Button>
              <Button size="sm" onClick={handleStartAgentStep}>
                <Play className="size-3.5" />
                Retry
              </Button>
            </div>
          )}
        </div>
      );
    }

    // 5. Pending — awaiting user action
    if (reviewMode) {
      return (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <p className="text-sm">Switch to Update mode to run this step.</p>
        </div>
      );
    }
    if (pendingAutoStartStep !== null) {
      return <AgentInitializingIndicator />;
    }
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
        <Play className="size-8 text-primary/50" />
        <div className="text-center">
          <p className="font-medium">Ready to run</p>
          <p className="mt-1 text-sm">Click Start to begin this step.</p>
        </div>
        <Button size="sm" onClick={handleStartAgentStep}>
          <Play className="size-3.5" />
          Start Step
        </Button>
      </div>
    );
  };

  // Navigation guard dialog helpers — avoids nested ternaries in JSX
  const navGuardTitle = (): string => {
    if (isRunning) return "Agent Running";
    if (gateLoading) return "Evaluating Answers";
    return "Unsaved Changes";
  };

  const navGuardDescription = (): string => {
    if (isRunning) return "An agent is still running on this step. Leaving will abandon it.";
    if (gateLoading) return "The answer evaluator is still running. Leaving will abandon it.";
    return "You have unsaved edits that will be lost if you leave.";
  };

  return (
    <>
      {/* Navigation guard dialog — shown when user tries to leave while agent is running or unsaved changes */}
      {blockerStatus === "blocked" && (
        <Dialog open onOpenChange={(open) => { if (!open) handleNavStay(); }}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>{navGuardTitle()}</DialogTitle>
              <DialogDescription>{navGuardDescription()}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={handleNavStay}>
                Stay
              </Button>
              <Button variant="destructive" onClick={handleNavLeave}>
                Leave
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Step-switch guard — shown when user clicks a prior step while agent is running */}
      {pendingStepSwitch !== null && (
        <Dialog open onOpenChange={(open) => { if (!open) setPendingStepSwitch(null); }}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Agent Running</DialogTitle>
              <DialogDescription>
                An agent is still running on this step. Leaving will abandon it.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPendingStepSwitch(null)}>
                Stay
              </Button>
              <Button variant="destructive" onClick={handleStepSwitchLeave}>
                Leave
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Runtime error dialog — shown when sidecar startup fails with an actionable error */}
      <RuntimeErrorDialog
        error={runtimeError}
        onDismiss={clearRuntimeError}
      />

      {/* Reset step dialog — shown when clicking a prior completed step */}
      <ResetStepDialog
        targetStep={resetTarget}
        deleteFromStep={resetTarget !== null && resetTarget > 0 ? resetTarget + 1 : undefined}
        workspacePath={workspacePath ?? ""}
        skillName={skillName}
        open={resetTarget !== null}
        onOpenChange={(open) => { if (!open) setResetTarget(null) }}
        executeReset={resetTarget !== null && resetTarget > 0
          ? () => navigateBackToStepDb(workspacePath ?? "", skillName, resetTarget)
          : undefined}
        onReset={() => {
          if (resetTarget !== null) {
            endActiveSession();
            clearRuns();
            if (resetTarget === 0) {
              // Step 0: full reset — re-runs from scratch.
              resetToStep(0);
            } else {
              // Steps 1+: navigate_back_to_step already persisted the correct DB state;
              // sync Zustand to match (target stays "completed", subsequent steps "pending").
              navigateBackToStep(resetTarget);
            }
            setResetTarget(null);
          }
        }}
      />

      {/* Reset confirmation dialog — shown when resetting a step with partial output */}
      {showResetConfirm && (
        <Dialog open onOpenChange={(open) => { if (!open) setShowResetConfirm(false); }}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Reset Step?</DialogTitle>
              <DialogDescription>
                This step has partial output that will be deleted. Continue?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowResetConfirm(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => {
                setShowResetConfirm(false);
                performStepReset(currentStep);
              }}>
                Reset
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Transition gate dialog — shown after step 0 (gate 1) or step 1 (gate 2) */}
      <TransitionGateDialog
        open={showGateDialog}
        verdict={gateVerdict}
        evaluation={gateEvaluation}
        context={gateContext}
        onSkip={handleGateSkip}
        onResearch={handleGateResearch}
        onLetMeAnswer={handleGateLetMeAnswer}
        onContinueAnyway={handleGateContinueAnyway}
      />

      {/* Gate evaluation progress modal — shown while answer evaluator runs */}
      <Dialog open={gateLoading && !showGateDialog}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Analyzing Responses</DialogTitle>
            <DialogDescription>
              Reviewing your answers to determine whether to continue, ask for refinements, or skip ahead.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Running answer analysis...
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex h-[calc(100%+3rem)] -m-6">
        <WorkflowSidebar
          steps={steps}
          currentStep={currentStep}
          disabledSteps={disabledSteps}
          onStepClick={(id) => {
            if (steps[id]?.status !== "completed") return;
            if (isRunning) {
              setPendingStepSwitch(id);
              return;
            }
            if (reviewMode) {
              setCurrentStep(id);
              return;
            }
            if (id < currentStep) {
              setResetTarget(id);
              return;
            }
            setCurrentStep(id);
          }}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Step header */}
          <div className="flex items-center justify-between border-b px-6 py-4">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-muted-foreground tracking-wide uppercase">
                {skillName.replace(/[-_]/g, " ")}
              </p>
              <h2 className="text-lg font-semibold">
                Step {currentStep + 1}: {currentStepDef?.name}
              </h2>
              <p className="text-sm text-muted-foreground">
                {currentStepDef?.description}
              </p>
            </div>
          </div>

          {/* Content area — agent output panel manages its own padding */}
          <div className={`flex flex-1 flex-col overflow-hidden ${
            activeAgentId ? "" : "p-4"
          }`}>
            {renderContent()}
          </div>
        </div>
      </div>

    </>
  );
}
