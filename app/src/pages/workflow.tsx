import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useBlocker, useNavigate } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownComponents } from "@/components/markdown-link";
import MDEditor from "@uiw/react-md-editor";
import {
  Loader2,
  Play,
  FileText,
  AlertCircle,
  RotateCcw,
  CheckCircle2,
  Save,
  Home,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  cleanupSkillSidecar,
  acquireLock,
  releaseLock,
  verifyStepOutput,
  endWorkflowSession,
  getDisabledSteps,
  runAnswerEvaluator,
  autofillClarifications,
  autofillRefinements,
  logGateDecision,
  type AnswerEvaluation,
  type PerQuestionVerdict,
} from "@/lib/tauri";
import { TransitionGateDialog, type GateVerdict } from "@/components/transition-gate-dialog";
import { resolveModelId } from "@/lib/models";

// --- Step config ---

interface StepConfig {
  type: "agent" | "human" | "reasoning";
  outputFiles?: string[];
  /** Default model shorthand for display (actual model comes from backend settings) */
  model?: string;
}

const STEP_CONFIGS: Record<number, StepConfig> = {
  0: { type: "agent", outputFiles: ["context/research-plan.md", "context/clarifications.md"], model: "sonnet" },
  1: { type: "human" },
  2: { type: "agent", outputFiles: ["context/clarifications.md"], model: "sonnet" },
  3: { type: "human" },
  4: { type: "reasoning", outputFiles: ["context/decisions.md"], model: "opus" },
  5: { type: "agent", outputFiles: ["skill/SKILL.md", "skill/references/"], model: "sonnet" },
};

// Human review steps: step id -> relative artifact path
const HUMAN_REVIEW_STEPS: Record<number, { relativePath: string }> = {
  1: { relativePath: "context/clarifications.md" },
  3: { relativePath: "context/clarifications.md" },
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
  const isHumanReviewStep = stepConfig?.type === "human";

  // Human review state
  const [reviewContent, setReviewContent] = useState<string | null>(null);
  const [reviewFilePath, setReviewFilePath] = useState("");
  const [loadingReview, setLoadingReview] = useState(false);
  // Markdown editor state
  const [editorContent, setEditorContent] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  // Explicit dirty flag — set on user edits, cleared on save/reload/load
  const [editorDirty, setEditorDirty] = useState(false);
  const hasUnsavedChanges = editorDirty;
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  // Ref for navigation guard (shouldBlockFn runs outside React render cycle).
  // Scoped to human review steps so it doesn't block on non-review steps.
  const hasUnsavedChangesRef = useRef(false);
  useEffect(() => {
    hasUnsavedChangesRef.current = isHumanReviewStep && hasUnsavedChanges;
  }, [isHumanReviewStep, hasUnsavedChanges]);

  // Sync editorContent when reviewContent loads or reloads (clears dirty flag)
  useEffect(() => {
    if (reviewContent !== null) {
      setEditorContent(reviewContent);
      setEditorDirty(false);
    }
  }, [reviewContent]);

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
  const [gateTotalCount, setGateTotalCount] = useState(0);
  const [gateUnansweredCount, setGateUnansweredCount] = useState(0);
  const [gatePerQuestion, setGatePerQuestion] = useState<PerQuestionVerdict[]>([]);
  const [isAutofilling, setIsAutofilling] = useState(false);
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
        toast.error(`Could not lock skill: ${err instanceof Error ? err.message : String(err)}`);
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

    if (stepStatus === "error" && skillName && skillsPath) {
      const cfg = STEP_CONFIGS[currentStep];
      const firstOutput = cfg?.outputFiles?.[0];
      if (firstOutput) {
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
  }, [currentStep, steps, skillsPath, skillName]);

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

  // Load file content when entering a human review step.
  // skills_path is required — no workspace fallback.
  useEffect(() => {
    if (!isHumanReviewStep || !skillsPath) {
      setReviewContent(null);
      return;
    }

    const config = HUMAN_REVIEW_STEPS[currentStep];
    if (!config) return;
    const relativePath = config.relativePath;
    const filename = relativePath.split("/").pop() ?? relativePath;
    setReviewFilePath(relativePath);
    setLoadingReview(true);

    readFile(`${skillsPath}/${skillName}/context/${filename}`)
      .then((content) => setReviewContent(content ?? null))
      .catch(() => setReviewContent(null))
      .finally(() => setLoadingReview(false));
  }, [currentStep, isHumanReviewStep, skillsPath, skillName]);

  // Advance to next step helper
  const [pendingAutoStart, setPendingAutoStart] = useState(false);

  /** After resetting to a step, auto-start if it's an agent step in update mode. */
  const isAgentType = stepConfig?.type === "agent" || stepConfig?.type === "reasoning";

  const autoStartAfterReset = (stepId: number) => {
    const cfg = STEP_CONFIGS[stepId];
    if ((cfg?.type === "agent" || cfg?.type === "reasoning") && !useWorkflowStore.getState().reviewMode) {
      setPendingAutoStart(true);
    }
  };

  const advanceToNextStep = useCallback(() => {
    if (currentStep >= steps.length - 1) return;
    const { disabledSteps: disabled } = useWorkflowStore.getState();
    const nextStep = currentStep + 1;

    // Don't advance if the next step is disabled (scope too broad)
    if (disabled.includes(nextStep)) return;

    setCurrentStep(nextStep);

    const nextConfig = STEP_CONFIGS[nextStep];
    if (nextConfig?.type === "human") {
      updateStepStatus(nextStep, "waiting_for_user");
    } else {
      // Agent and reasoning steps auto-start
      setPendingAutoStart(true);
    }
  }, [currentStep, steps, setCurrentStep, updateStepStatus]);

  // Auto-start agent/reasoning steps:
  // 1. When advancing from a completed step (pendingAutoStart set by advanceToNextStep)
  // 2. On initial page load when step hasn't started yet
  useEffect(() => {
    if (!pendingAutoStart) return;
    if (!isAgentType) return;
    if (isRunning) return;
    setPendingAutoStart(false);
    handleStartAgentStep();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoStart, currentStep]);

  // Auto-start when switching from Review → Update mode on a pending agent step.
  // Does NOT fire on initial page load (new skills show a Start button per AC 1).
  const prevReviewModeRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!hydrated) return;

    const wasToggle = prevReviewModeRef.current === true && !reviewMode;
    prevReviewModeRef.current = reviewMode;

    if (!wasToggle) return; // only auto-start on review→update toggle
    if (!workspacePath) return;
    if (stepConfig?.type === "human") return;
    const status = steps[currentStep]?.status;
    if (status && status !== "pending") return;
    if (isRunning || pendingAutoStart) return;
    console.log(`[workflow] Auto-starting step ${currentStep} (review→update toggle)`);
    setPendingAutoStart(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, reviewMode]);

  // Reposition to first incomplete step when switching to Update mode (AC 3).
  useEffect(() => {
    if (!hydrated || reviewMode) return;
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

  // Watch for gate agent (answer evaluator) completion — separate from workflow step agents
  useEffect(() => {
    if (!activeRunStatus || !activeAgentId) return;
    if (gateAgentIdRef.current !== activeAgentId) return; // not the gate agent

    if (activeRunStatus === "completed" || activeRunStatus === "error") {
      gateAgentIdRef.current = null;
      setActiveAgent(null);
      clearRuns();

      if (activeRunStatus === "error") {
        console.warn("[workflow] Gate evaluation failed — proceeding normally");
        setGateLoading(false);
        updateStepStatus(useWorkflowStore.getState().currentStep, "completed");
        advanceToNextStep();
        return;
      }

      // Read the evaluation result
      finishGateEvaluation();
    }
  }, [activeRunStatus, activeAgentId]);

  useEffect(() => {
    if (!activeRunStatus || !activeAgentId) return;
    // Skip gate agent — handled by the dedicated gate watcher above
    if (gateAgentIdRef.current === activeAgentId) return;
    // Guard: only complete steps that are actively running an agent
    const { steps: currentSteps, currentStep: step } = useWorkflowStore.getState();
    if (currentSteps[step]?.status !== "in_progress") return;

    if (activeRunStatus === "completed") {
      // Capture cost before clearing activeAgent — after setActiveAgent(null),
      // activeRun becomes null so activeRun?.totalCost would be undefined.
      lastCompletedCostRef.current = activeAgentId
        ? useAgentStore.getState().runs[activeAgentId]?.totalCost
        : undefined;
      setActiveAgent(null);

      const finish = async () => {
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
  }, [activeRunStatus, updateStepStatus, setRunning, setActiveAgent, skillName, workspacePath, advanceToNextStep]);

  // (Review agent logic removed — direct completion is faster and sufficient)

  // --- Step handlers ---

  const handleStartAgentStep = async () => {
    if (!workspacePath) {
      toast.error("Missing workspace path", { duration: Infinity });
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

  const handleStartStep = async () => {
    if (!stepConfig) return;

    switch (stepConfig.type) {
      case "agent":
      case "reasoning":
        return handleStartAgentStep();
      case "human":
        // Human steps don't have a "start" — they just show the form
        break;
    }
  };

  const runGateEvaluation = async () => {
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
      // Fail-open: proceed normally
      updateStepStatus(currentStep, "completed");
      advanceToNextStep();
    }
  };

  const runGateOrAdvance = () => {
    // Gate 1: after step 1, evaluate answers before advancing to research
    if (currentStep === 1 && workspacePath && !disabledSteps.includes(2)) {
      setGateContext("clarifications");
      runGateEvaluation();
      return;
    }

    // Gate 2: after step 3, evaluate answers (including refinements) before confirm-decisions
    if (currentStep === 3 && workspacePath && !disabledSteps.includes(4)) {
      setGateContext("refinements");
      runGateEvaluation();
      return;
    }

    // All other review steps: advance normally
    updateStepStatus(currentStep, "completed");
    advanceToNextStep();
  };

  const handleReviewContinue = async () => {
    // Save the editor content to skills path (required — no workspace fallback)
    const config = HUMAN_REVIEW_STEPS[currentStep];
    const filename = config?.relativePath.split("/").pop() ?? config?.relativePath;
    if (config && reviewContent !== null && skillsPath && filename) {
      try {
        const content = editorDirty ? editorContent : (reviewContent ?? "");
        await writeFile(`${skillsPath}/${skillName}/context/${filename}`, content);
        setReviewContent(content);
      } catch (err) {
        toast.error(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }

    runGateOrAdvance();
  };

  const finishGateEvaluation = async () => {
    const proceedNormally = () => {
      setGateLoading(false);
      updateStepStatus(useWorkflowStore.getState().currentStep, "completed");
      advanceToNextStep();
    };

    if (!skillsPath) {
      proceedNormally();
      return;
    }

    try {
      const evalPath = `${workspacePath}/${skillName}/answer-evaluation.json`;
      const raw = await readFile(evalPath);
      const evaluation: AnswerEvaluation = JSON.parse(raw);

      // Validate verdict shape — if the Haiku agent wrote malformed output, proceed normally
      if (!["sufficient", "mixed", "insufficient"].includes(evaluation.verdict)) {
        console.warn("[workflow] Invalid gate verdict:", evaluation.verdict);
        proceedNormally();
        return;
      }

      // Write gate result to .vibedata (internal files) so it appears in Rust
      // [write_file] logs and persists for debugging.
      if (workspacePath) {
        const gateLog = JSON.stringify({ ...evaluation, action: "show_dialog", timestamp: new Date().toISOString() });
        writeFile(`${workspacePath}/${skillName}/gate-result.json`, gateLog).catch(() => {});
      }

      // All verdicts show a dialog — sufficient offers skip, mixed/insufficient offer auto-fill
      const unanswered = evaluation.empty_count + evaluation.vague_count;
      setGateLoading(false);
      setGateVerdict(evaluation.verdict);
      setGateTotalCount(evaluation.total_count);
      setGateUnansweredCount(unanswered);
      setGatePerQuestion(evaluation.per_question ?? []);
      setShowGateDialog(true);
    } catch (err) {
      console.warn("[workflow] Could not read evaluation result — proceeding normally:", err);
      proceedNormally();
    }
  };

  const closeGateDialog = () => {
    setShowGateDialog(false);
    setGateVerdict(null);
  };

  /** Skip to decisions: gate 1 skips steps 1-3, gate 2 just advances from step 3. */
  const skipToDecisions = (message: string) => {
    closeGateDialog();
    if (gateContext === "refinements") {
      // Gate 2: just advance from step 3 to step 4
      updateStepStatus(useWorkflowStore.getState().currentStep, "completed");
      advanceToNextStep();
    } else {
      // Gate 1: skip steps 1-3 and jump to step 4
      updateStepStatus(1, "completed");
      updateStepStatus(2, "completed");
      updateStepStatus(3, "completed");
      setCurrentStep(4);
    }
    toast.success(message);
  };

  /** Write the user's gate decision to .vibedata so it appears in Rust [write_file] logs. */
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

  /** Shared autofill logic: call the appropriate autofill command, then run onSuccess with the count. */
  const runAutofill = async (decision: string, onSuccess: (filled: number) => void) => {
    logGateAction(decision);
    setIsAutofilling(true);
    try {
      const filled = gateContext === "refinements"
        ? await autofillRefinements(skillName)
        : await autofillClarifications(skillName);
      setIsAutofilling(false);
      onSuccess(filled);
    } catch (err) {
      toast.error(`Auto-fill failed: ${err instanceof Error ? err.message : String(err)}`);
      setIsAutofilling(false);
    }
  };

  /** Insufficient: auto-fill all answers then skip to decisions (gate 1) or advance (gate 2). */
  const handleGateAutofillAndSkip = () =>
    runAutofill("autofill_and_skip", (filled) => {
      const label = filled !== 1 ? "s" : "";
      if (gateContext === "refinements") {
        skipToDecisions(`Auto-filled ${filled} refinement answer${label} — continuing to decisions`);
      } else {
        skipToDecisions(`Auto-filled ${filled} answer${label} — skipped detailed research`);
      }
    });

  /** Mixed: auto-fill empty answers then proceed to detailed research. */
  const handleGateAutofillAndResearch = () =>
    runAutofill("autofill_and_research", (filled) => {
      closeGateDialog();
      toast.success(`Auto-filled ${filled} answer${filled !== 1 ? "s" : ""} — continuing to research`);
      updateStepStatus(useWorkflowStore.getState().currentStep, "completed");
      advanceToNextStep();
    });

  /** Sufficient override: run research anyway (gate 1) or continue to decisions (gate 2). */
  const handleGateResearch = () => {
    logGateAction(gateContext === "refinements" ? "continue_to_decisions" : "research_anyway");
    closeGateDialog();
    updateStepStatus(useWorkflowStore.getState().currentStep, "completed");
    advanceToNextStep();
  };

  /** Override: go back to review so user can answer manually. */
  const handleGateLetMeAnswer = () => {
    logGateAction("let_me_answer");
    closeGateDialog();
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
    toast.success(`Reset step ${stepId + 1}`);
  };

  // Reload the file content (after user edits externally).
  // skills_path is required — no workspace fallback.
  const handleReviewReload = () => {
    if (!reviewFilePath || !skillsPath) return;
    setLoadingReview(true);
    const filename = reviewFilePath.split("/").pop() ?? reviewFilePath;

    readFile(`${skillsPath}/${skillName}/context/${filename}`)
      .then((content) => {
        setReviewContent(content ?? null);
        if (!content) toast.error("Failed to reload file", { duration: Infinity });
      })
      .catch(() => {
        setReviewContent(null);
        toast.error("Failed to reload file", { duration: Infinity });
      })
      .finally(() => setLoadingReview(false));
  };

  // Save editor content to skills path (required — no workspace fallback).
  // Returns true on success, false if the write failed.
  const handleSave = useCallback(async (silent = false): Promise<boolean> => {
    const config = HUMAN_REVIEW_STEPS[currentStep];
    if (!config || !skillsPath) return false;
    const filename = config.relativePath.split("/").pop() ?? config.relativePath;
    setIsSaving(true);
    try {
      await writeFile(`${skillsPath}/${skillName}/context/${filename}`, editorContent);
      setReviewContent(editorContent);
      setEditorDirty(false);
      if (!silent) toast.success("Saved");
      return true;
    } catch (err) {
      toast.error(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [currentStep, skillsPath, editorContent, skillName]);

  // Debounce autosave — fires 1500ms after the last edit on a human review step.
  // The cleanup cancels the previous timer whenever deps change, so no ref is needed.
  useEffect(() => {
    if (!isHumanReviewStep || !editorDirty) return;

    const timer = setTimeout(() => {
      handleSave(true);
    }, 1500);

    return () => clearTimeout(timer);
  }, [editorContent, editorDirty, isHumanReviewStep, handleSave]);

  const currentStepDef = steps[currentStep];

  // --- Render content ---

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
      />
    );
  };

  /** Render human review step (all states: loading, active, completed). */
  const renderHumanContent = () => {
    if (loadingReview) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (reviewContent === null) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
          <AlertCircle className="size-8 text-destructive/50" />
          <div className="text-center">
            <p className="font-medium text-destructive">Missing clarification file</p>
            <p className="mt-1 text-sm">
              Expected <code className="text-xs">{HUMAN_REVIEW_STEPS[currentStep]?.relativePath}</code> but it was not found.
              The previous step may not have completed successfully.
            </p>
          </div>
        </div>
      );
    }

    // Review mode (or completed in any mode): read-only markdown preview
    if (reviewMode) {
      return (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between pb-3">
            <p className="text-xs text-muted-foreground font-mono">
              {reviewFilePath}
            </p>
          </div>
          <ScrollArea className="min-h-0 flex-1 rounded-md border">
            <div className="markdown-body compact max-w-none p-4">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {reviewContent}
              </ReactMarkdown>
            </div>
          </ScrollArea>
        </div>
      );
    }

    // Update mode: MDEditor
    const isCompleted = currentStepDef?.status === "completed";
    const nextStepAfterReview = currentStep + 1;
    const isReviewHalted = disabledSteps.includes(nextStepAfterReview);

    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between pb-3">
          <p className="text-xs text-muted-foreground font-mono">
            {reviewFilePath}
          </p>
        </div>
        <div className="min-h-0 flex-1" data-color-mode="dark">
          <MDEditor
            value={editorContent}
            onChange={(val) => { setEditorContent(val ?? ""); setEditorDirty(true); }}
            height="100%"
            visibleDragbar={false}
          />
        </div>
        {isReviewHalted ? (
          <div className="border-t pt-4">
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="size-8 text-green-500" />
              <div className="text-center max-w-md">
                <p className="text-base font-medium">Scope Too Broad</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  The research phase determined this skill topic is too broad for a single skill.
                  Review the scope recommendations above, then start a new workflow with a narrower focus.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate({ to: "/" })}
              >
                <Home className="size-3.5" />
                Return to Dashboard
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between border-t px-4 py-4">
            <p className="text-sm text-muted-foreground">
              {isCompleted ? "Step completed. You can still edit and save." : "Edit the markdown above, then save and continue."}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSave()}
                disabled={!hasUnsavedChanges || isSaving}
              >
                {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                Save
                {hasUnsavedChanges && (
                  <span className="ml-1 size-2 rounded-full bg-orange-500" />
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleReviewReload}
              >
                <RotateCcw className="size-3.5" />
                Reload
              </Button>
              {!isCompleted && (
                <Button
                  size="sm"
                  onClick={() => {
                    if (hasUnsavedChanges) {
                      setShowUnsavedDialog(true);
                    } else {
                      handleReviewContinue();
                    }
                  }}
                  disabled={gateLoading}
                >
                  {gateLoading
                    ? <Loader2 className="size-3.5 animate-spin" />
                    : <CheckCircle2 className="size-3.5" />}
                  {gateLoading ? "Evaluating..." : "Complete Step"}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // --- Render content (dispatch by step type) ---

  const renderContent = () => {
    // 1. Human review — always shows content regardless of status
    if (isHumanReviewStep) {
      return renderHumanContent();
    }

    // 2. Agent running — show streaming output or init spinner
    if (activeAgentId) {
      if (isInitializing && !runs[activeAgentId]?.messages.length) {
        return <AgentInitializingIndicator />;
      }
      return <AgentOutputPanel agentId={activeAgentId} />;
    }

    // 3. Agent initializing (no ID yet)
    if (isInitializing) {
      return <AgentInitializingIndicator />;
    }

    // 4. Completed agent/reasoning step — show output files
    if (currentStepDef?.status === "completed") {
      return renderCompletedStep();
    }

    // 5. Error state with retry
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
              <Button size="sm" onClick={() => handleStartStep()}>
                <Play className="size-3.5" />
                Retry
              </Button>
            </div>
          )}
        </div>
      );
    }

    // 6. Pending — awaiting user action
    if (reviewMode) {
      return (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <p className="text-sm">Switch to Update mode to run this step.</p>
        </div>
      );
    }
    if (pendingAutoStart) {
      return <AgentInitializingIndicator />;
    }
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
        <Play className="size-8 text-primary/50" />
        <div className="text-center">
          <p className="font-medium">Ready to run</p>
          <p className="mt-1 text-sm">Click Start to begin this step.</p>
        </div>
        <Button size="sm" onClick={handleStartStep}>
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
        workspacePath={workspacePath ?? ""}
        skillName={skillName}
        open={resetTarget !== null}
        onOpenChange={(open) => { if (!open) setResetTarget(null) }}
        onReset={() => {
          if (resetTarget !== null) {
            // End active session — resetting to a prior step starts a fresh workflow context
            endActiveSession();
            clearRuns();
            resetToStep(resetTarget);
            autoStartAfterReset(resetTarget);
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

      {/* Unsaved changes confirmation dialog — shown when completing step with unsaved edits */}
      {showUnsavedDialog && (
        <Dialog open onOpenChange={(open) => { if (!open) setShowUnsavedDialog(false); }}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Unsaved Changes</DialogTitle>
              <DialogDescription>
                You have unsaved edits. Would you like to save before continuing?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowUnsavedDialog(false)}>
                Cancel
              </Button>
              <Button variant="outline" onClick={() => {
                setShowUnsavedDialog(false);
                setEditorDirty(false);
                runGateOrAdvance();
              }}>
                Discard & Continue
              </Button>
              <Button onClick={async () => {
                setShowUnsavedDialog(false);
                const saved = await handleSave();
                if (saved) runGateOrAdvance();
              }}>
                Save & Continue
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Transition gate dialog — shown after step 1 review (gate 1) or step 3 review (gate 2) */}
      <TransitionGateDialog
        open={showGateDialog}
        verdict={gateVerdict}
        totalCount={gateTotalCount}
        unansweredCount={gateUnansweredCount}
        perQuestion={gatePerQuestion}
        context={gateContext}
        onSkip={handleGateSkip}
        onResearch={handleGateResearch}
        onAutofillAndSkip={handleGateAutofillAndSkip}
        onAutofillAndResearch={handleGateAutofillAndResearch}
        onLetMeAnswer={handleGateLetMeAnswer}
        isAutofilling={isAutofilling}
      />

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
            <div className="flex items-center gap-3">
              {isHumanReviewStep && (
                <Badge variant="outline" className="gap-1">
                  <FileText className="size-3" />
                  Q&A Review
                </Badge>
              )}
            </div>
          </div>

          {/* Content area — agent output panel manages its own padding */}
          <div className={`flex flex-1 flex-col overflow-hidden ${
            activeAgentId && !isHumanReviewStep ? "" : "p-4"
          }`}>
            {renderContent()}
          </div>
        </div>
      </div>

    </>
  );
}
