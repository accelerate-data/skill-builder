import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useBlocker, useNavigate } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Loader2,
  Play,
  MessageSquare,
  SkipForward,
  FileText,
  ArrowRight,
  AlertCircle,
  RotateCcw,
  Bug,
  CheckCircle2,
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
import { ReasoningReview } from "@/components/reasoning-review";
import { RefinementChat } from "@/components/refinement-chat";
import { StepRerunChat, type StepRerunChatHandle } from "@/components/step-rerun-chat";
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
} from "@/lib/tauri";

// --- Step config ---

interface StepConfig {
  type: "agent" | "human" | "reasoning" | "refinement";
  outputFiles?: string[];
  /** Default model shorthand for display (actual model comes from backend settings) */
  model?: string;
}

const STEP_CONFIGS: Record<number, StepConfig> = {
  0: { type: "agent", outputFiles: ["context/clarifications-concepts.md"], model: "sonnet" },
  1: { type: "human" },
  2: { type: "agent", outputFiles: ["context/clarifications-patterns.md", "context/clarifications-data.md", "context/clarifications.md"], model: "sonnet" },
  3: { type: "human" },
  4: { type: "reasoning", outputFiles: ["context/decisions.md"], model: "opus" },
  5: { type: "agent", outputFiles: ["skill/SKILL.md", "skill/references/"], model: "sonnet" },
  6: { type: "agent", outputFiles: ["context/agent-validation-log.md", "context/test-skill.md"], model: "sonnet" },
  7: { type: "refinement" },
};

// Human review steps: step id -> relative artifact path
const HUMAN_REVIEW_STEPS: Record<number, { relativePath: string }> = {
  1: { relativePath: "context/clarifications-concepts.md" },
  3: { relativePath: "context/clarifications.md" },
};

// Agent step IDs eligible for rerun chat (not reasoning or refinement — those have their own chat)
const RERUN_CHAT_STEPS = new Set([0, 2, 5, 6]);

// Map step IDs to human-readable labels for the rerun chat header
const STEP_LABELS: Record<number, string> = {
  0: "research-concepts",
  2: "perform-research",
  5: "build",
  6: "validate-and-test",
};

export default function WorkflowPage() {
  const { skillName } = useParams({ from: "/skill/$skillName" });
  const navigate = useNavigate();
  const workspacePath = useSettingsStore((s) => s.workspacePath);
  const skillsPath = useSettingsStore((s) => s.skillsPath);
  const debugMode = useSettingsStore((s) => s.debugMode);

  const {
    domain,
    skillType,
    currentStep,
    steps,
    isRunning,
    isInitializing,
    hydrated,
    initWorkflow,
    setCurrentStep,
    updateStepStatus,
    setRunning,
    setInitializing,
    clearInitializing,
    runtimeError,
    clearRuntimeError,
    rerunFromStep,
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
      return useWorkflowStore.getState().isRunning;
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
  // and shuts down the persistent sidecar.
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
      // Clear session ID so the next "Continue" starts a fresh session
      useWorkflowStore.setState({ workflowSessionId: null });

      // Fire-and-forget: end workflow session
      const sessionId = store.workflowSessionId;
      if (sessionId) {
        endWorkflowSession(sessionId).catch(() => {});
        useWorkflowStore.setState({ workflowSessionId: null });
      }

      // Fire-and-forget: shut down persistent sidecar for this skill
      cleanupSkillSidecar(skillName).catch(() => {});
    };
  }, [skillName]);

  // Human review state
  const [reviewContent, setReviewContent] = useState<string | null>(null);
  const [reviewFilePath, setReviewFilePath] = useState("");
  const [loadingReview, setLoadingReview] = useState(false);
  const rerunRef = useRef<StepRerunChatHandle>(null);

  // Track whether current step has partial output from an interrupted run
  const [hasPartialOutput, setHasPartialOutput] = useState(false);

  // Track which step is in rerun chat mode (null = no rerun active)
  const [rerunStepId, setRerunStepId] = useState<number | null>(null);

  // Pending step switch — set when user clicks a sidebar step while agent is running
  const [pendingStepSwitch, setPendingStepSwitch] = useState<number | null>(null);

  // Track whether error state has partial artifacts
  const [errorHasArtifacts, setErrorHasArtifacts] = useState(false);

  // Confirmation dialog for resetting steps with partial output
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Target step for reset confirmation dialog (when clicking a prior step)
  const [resetTarget, setResetTarget] = useState<number | null>(null);

  const stepConfig = STEP_CONFIGS[currentStep];
  const isHumanReviewStep = stepConfig?.type === "human";

  // Initialize workflow and restore state from SQLite
  useEffect(() => {
    let cancelled = false;
    const store = useWorkflowStore.getState();

    // Already fully hydrated for this skill — skip.
    // Must check hydrated too: React StrictMode unmounts/remounts effects,
    // so skillName can match from the first (aborted) run while hydration
    // never completed.
    if (store.skillName === skillName && store.hydrated) return;

    // Clear stale agent data from previous skill so lifecycle effects
    // don't pick up a completed run from another workflow.
    clearRuns();

    // Reset immediately so stale state from another skill doesn't linger
    initWorkflow(skillName, skillName.replace(/-/g, " "));

    // Read workflow state from SQLite
    getWorkflowState(skillName)
      .then((state) => {
        if (cancelled) return;
        if (!state.run) {
          // No saved state — fresh skill, safe to persist
          setHydrated(true);
          return;
        }

        const domainName = state.run.domain || skillName.replace(/-/g, " ");
        initWorkflow(skillName, domainName, state.run.skill_type);

        const completedIds = state.steps
          .filter((s) => s.status === "completed")
          .map((s) => s.step_id);
        if (completedIds.length > 0) {
          loadWorkflowState(completedIds, state.run.current_step);
        } else {
          setHydrated(true);
        }
      })
      .catch(() => {
        // No saved state — fresh skill
        setHydrated(true);
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
    setHasPartialOutput(false);
    setRerunStepId(null);
    setErrorHasArtifacts(false);
  }, [currentStep]);

  // Consolidated step-artifact detection: partial output + error artifacts.
  // Merges two formerly separate effects that both depended on steps/currentStep
  // and each triggered async Tauri calls.
  useEffect(() => {
    const stepStatus = steps[currentStep]?.status;

    // --- Partial output from interrupted runs ---
    if (workspacePath && hydrated) {
      const cfg = STEP_CONFIGS[currentStep];
      if (cfg?.outputFiles && stepStatus === "pending") {
        const path = cfg.outputFiles[0];
        if (path) {
          const filePath = `${workspacePath}/${skillName}/${path}`;
          readFile(filePath)
            .then((content) => setHasPartialOutput(!!content))
            .catch(() => setHasPartialOutput(false));
        }
      } else {
        setHasPartialOutput(false);
      }
    }

    // --- Error-state artifact check ---
    if (stepStatus === "error" && skillName && workspacePath) {
      const cfg2 = STEP_CONFIGS[currentStep];
      const firstOutput = cfg2?.outputFiles?.[0];
      if (firstOutput) {
        readFile(`${workspacePath}/${skillName}/${firstOutput}`)
          .then((content) => setErrorHasArtifacts(!!content))
          .catch(() => setErrorHasArtifacts(false));
      } else {
        setErrorHasArtifacts(false);
      }
    } else {
      setErrorHasArtifacts(false);
    }
  }, [currentStep, steps, workspacePath, skillName, hydrated]);

  // Debounced SQLite persistence — saves workflow state at most once per 300ms
  // instead of firing synchronously on every step/status change.
  useEffect(() => {
    if (!domain || !hydrated) return;
    const store = useWorkflowStore.getState();
    if (store.skillName !== skillName) return;

    const timer = setTimeout(() => {
      const latestStore = useWorkflowStore.getState();
      if (latestStore.skillName !== skillName) return;

      const stepStatuses = latestStore.steps.map((s) => ({
        step_id: s.id,
        status: s.status,
      }));

      const status = latestStore.steps[latestStore.currentStep]?.status === "in_progress"
        ? "in_progress"
        : latestStore.steps.every((s) => s.status === "completed")
          ? "completed"
          : "pending";

      saveWorkflowState(skillName, domain, latestStore.currentStep, status, stepStatuses, skillType ?? undefined).catch(
        (err) => console.warn("Failed to persist workflow state:", err)
      );
    }, 300);

    return () => clearTimeout(timer);
  }, [steps, currentStep, skillName, domain, skillType, hydrated]);

  // Load file content when entering a human review step.
  // Priority: skill output context dir > SQLite artifact > workspace filesystem.
  useEffect(() => {
    if (!isHumanReviewStep || !workspacePath) {
      setReviewContent(null);
      return;
    }

    const config = HUMAN_REVIEW_STEPS[currentStep];
    if (!config) return;
    const relativePath = config.relativePath;
    const filename = relativePath.split("/").pop() ?? relativePath;
    setReviewFilePath(relativePath);
    setLoadingReview(true);

    const workspaceFilePath = `${workspacePath}/${skillName}/${relativePath}`;

    // 1. Try skill output context directory first (survives workspace clears)
    const trySkillsPath = skillsPath
      ? readFile(`${skillsPath}/${skillName}/context/${filename}`).catch(() => null)
      : Promise.resolve(null);

    trySkillsPath
      .then((content) => {
        if (content) return content;
        // 2. Fallback: read from workspace filesystem
        return readFile(workspaceFilePath).catch(() => null);
      })
      .then((content) => setReviewContent(content ?? null))
      .finally(() => setLoadingReview(false));
  }, [currentStep, isHumanReviewStep, workspacePath, skillsPath, skillName]);

  // Check if a step should be auto-completed in debug mode
  const isDebugAutoCompleteStep = useCallback((stepId: number) => {
    const cfg = STEP_CONFIGS[stepId];
    if (!cfg) return false;
    // Auto-complete: human review and refinement steps
    return cfg.type === "human" || cfg.type === "refinement";
  }, []);

  // Advance to next step helper
  const advanceToNextStep = useCallback(() => {
    if (currentStep >= steps.length - 1) return;
    let nextStep = currentStep + 1;
    setCurrentStep(nextStep);

    if (debugMode) {
      while (nextStep < steps.length && isDebugAutoCompleteStep(nextStep)) {
        updateStepStatus(nextStep, "completed");
        toast.success(`Step ${nextStep + 1} auto-completed (debug)`);
        if (nextStep >= steps.length - 1) return;
        nextStep += 1;
        setCurrentStep(nextStep);
      }
    } else {
      const nextConfig = STEP_CONFIGS[nextStep];
      if (nextConfig?.type === "human") {
        updateStepStatus(nextStep, "waiting_for_user");
      }
    }
  }, [currentStep, steps, setCurrentStep, updateStepStatus, debugMode, isDebugAutoCompleteStep]);

  // Watch for agent completion
  const activeRun = activeAgentId ? runs[activeAgentId] : null;
  const activeRunStatus = activeRun?.status;

  useEffect(() => {
    if (!activeRunStatus || !activeAgentId) return;
    // Guard: only complete steps that are actively running an agent
    const { steps: currentSteps, currentStep: step } = useWorkflowStore.getState();
    if (currentSteps[step]?.status !== "in_progress") return;

    if (activeRunStatus === "completed") {
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

        updateStepStatus(step, "completed");
        setRunning(false);
        toast.success(`Step ${step + 1} completed`);

        // Auto-advance: persist next step in database for agent steps
        // The completion screen still displays for user review
        const stepConfig = STEP_CONFIGS[step];
        if (stepConfig?.type === "agent") {
          advanceToNextStep();
        }
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

  // Debug auto-start ref — tracks which step we've already auto-started
  const debugAutoStartedRef = useRef<number | null>(null);

  // --- Step handlers ---

  const handleStartAgentStep = async (resume = false) => {
    if (!domain || !workspacePath) {
      toast.error("Missing domain or workspace path", { duration: Infinity });
      return;
    }

    try {
      clearRuns();
      clearRuntimeError();
      updateStepStatus(currentStep, "in_progress");
      setRunning(true);
      setInitializing();
      setHasPartialOutput(false);

      const agentId = await runWorkflowStep(
        skillName,
        currentStep,
        domain,
        workspacePath,
        resume,
        false,
      );
      agentStartRun(agentId, stepConfig?.model ?? "sonnet");
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

  const handleSkipHumanStep = () => {
    updateStepStatus(currentStep, "completed");
    advanceToNextStep();
    toast.success(`Step ${currentStep + 1} skipped`);
  };

  const handleStartStep = async (resume = false) => {
    if (!stepConfig) return;

    switch (stepConfig.type) {
      case "agent":
        return handleStartAgentStep(resume);
      case "human":
        // Human steps don't have a "start" — they just show the form
        break;
    }
  };

  const handleRerunStep = async () => {
    if (!workspacePath) return;

    // For agent steps eligible for rerun chat, enter interactive rerun mode
    // instead of destructively resetting.
    // Steps 4 (reasoning) and 7 (refinement) have their own chat components.
    if (RERUN_CHAT_STEPS.has(currentStep)) {
      clearRuns();
      setRerunStepId(currentStep);
      return;
    }

    // For steps not in RERUN_CHAT_STEPS (human review, reasoning, refinement),
    // use destructive reset. Step 4 (reasoning) intentionally uses this path
    // to clear the chat session file and start fresh.
    try {
      await resetWorkflowStep(workspacePath, skillName, currentStep);
      clearRuns();
      rerunFromStep(currentStep);
      toast.success(`Reset to step ${currentStep + 1}`);
    } catch (err) {
      toast.error(
        `Failed to reset: ${err instanceof Error ? err.message : String(err)}`,
        { duration: Infinity },
      );
    }
  };

  const handleReviewContinue = async () => {
    // Save the content to workspace filesystem
    const config = HUMAN_REVIEW_STEPS[currentStep];
    if (config && reviewContent !== null && workspacePath) {
      try {
        await writeFile(`${workspacePath}/${skillName}/${config.relativePath}`, reviewContent);
      } catch {
        // best-effort
      }
    }
    updateStepStatus(currentStep, "completed");
    advanceToNextStep();
  };

  // Handle completion from the rerun chat
  const handleRerunComplete = useCallback(async () => {
    setRerunStepId(null);
    // Verify output before marking as completed
    if (workspacePath && skillName) {
      try {
        const hasOutput = await verifyStepOutput(workspacePath, skillName, currentStep);
        if (!hasOutput) {
          updateStepStatus(currentStep, "error");
          toast.error(`Step ${currentStep + 1} rerun produced no output files`, { duration: Infinity });
          return;
        }
      } catch {
        // Verification failed — proceed optimistically
      }
    }
    updateStepStatus(currentStep, "completed");
    toast.success(`Step ${currentStep + 1} rerun completed`);
  }, [currentStep, updateStepStatus, workspacePath, skillName]);

  // Reload the file content (after user edits externally).
  // Same priority as initial load: skill context dir > workspace.
  const handleReviewReload = () => {
    if (!reviewFilePath || !workspacePath) return;
    setLoadingReview(true);
    const workspaceFilePath = `${workspacePath}/${skillName}/${reviewFilePath}`;
    const filename = reviewFilePath.split("/").pop() ?? reviewFilePath;

    // 1. Try skill output context directory first
    const trySkillsPath = skillsPath
      ? readFile(`${skillsPath}/${skillName}/context/${filename}`).catch(() => null)
      : Promise.resolve(null);

    trySkillsPath
      .then((content) => {
        if (content) return content;
        // 2. Fallback: workspace filesystem
        return readFile(workspaceFilePath).catch(() => null);
      })
      .then((content) => {
        setReviewContent(content ?? null);
        if (!content) toast.error("Failed to reload file", { duration: Infinity });
      })
      .finally(() => setLoadingReview(false));
  };

  // Debug mode: auto-start agent steps when landing on a pending agent step.
  // This fires after advanceToNextStep sets the current step to an agent/reasoning step.
  useEffect(() => {
    if (!debugMode || !hydrated || isRunning) return;

    const stepStatus = steps[currentStep]?.status;
    if (stepStatus !== "pending") return;

    const cfg = STEP_CONFIGS[currentStep];
    if (!cfg || cfg.type === "human" || cfg.type === "refinement") return;

    // Prevent re-triggering for the same step (guards against re-renders)
    if (debugAutoStartedRef.current === currentStep) return;
    debugAutoStartedRef.current = currentStep;

    // Agent step in debug mode — auto-start it after a small delay
    // so React state updates settle before we start the agent.
    // Reasoning step auto-start is handled inside reasoning-review.tsx.
    if (cfg.type === "agent") {
      const timer = setTimeout(() => {
        const store = useWorkflowStore.getState();
        if (store.currentStep !== currentStep || store.steps[currentStep]?.status !== "pending") return;
        if (store.isRunning) return;
        handleStartAgentStep();
      }, 100);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugMode, currentStep, hydrated, isRunning, steps]);

  const currentStepDef = steps[currentStep];
  const canStart =
    stepConfig &&
    stepConfig.type !== "human" &&
    stepConfig.type !== "reasoning" &&
    stepConfig.type !== "refinement" &&
    !isRunning &&
    workspacePath &&
    currentStepDef?.status !== "completed" &&
    rerunStepId === null;

  // --- Render content ---

  const renderContent = () => {
    // Rerun chat mode — interactive rerun for agent steps
    if (rerunStepId !== null && rerunStepId === currentStep && RERUN_CHAT_STEPS.has(currentStep)) {
      return (
        <StepRerunChat
          ref={rerunRef}
          skillName={skillName}
          domain={domain ?? ""}
          workspacePath={workspacePath ?? ""}
          skillType={skillType ?? "domain"}
          stepId={currentStep}
          stepLabel={STEP_LABELS[currentStep] ?? `step${currentStep}`}
          onComplete={handleRerunComplete}
        />
      );
    }

    // Completed step with output files.
    if (
      currentStepDef?.status === "completed" &&
      !activeAgentId
    ) {
      const isLastStep = currentStep >= steps.length - 1;
      if (stepConfig?.outputFiles) {
        return (
          <WorkflowStepComplete
            stepName={currentStepDef.name}
            outputFiles={stepConfig.outputFiles}
            onRerun={handleRerunStep}
            onNextStep={advanceToNextStep}
            isLastStep={isLastStep}
          />
        );
      }
      // Human steps or steps without output files
      return (
        <WorkflowStepComplete
          stepName={currentStepDef.name}
          outputFiles={[]}
          onRerun={handleRerunStep}
          onNextStep={advanceToNextStep}
          isLastStep={isLastStep}
        />
      );
    }

    // Human review step — read-only markdown preview
    if (isHumanReviewStep) {
      if (loadingReview) {
        return (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        );
      }

      if (reviewContent !== null) {
        return (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between pb-3">
              <p className="text-xs text-muted-foreground font-mono">
                {reviewFilePath}
              </p>
              <Button variant="ghost" size="sm" onClick={handleReviewReload}>
                Reload
              </Button>
            </div>
            <ScrollArea className="min-h-0 flex-1 rounded-md border">
              <div className="markdown-body max-w-none p-4">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {reviewContent}
                </ReactMarkdown>
              </div>
            </ScrollArea>
            <div className="flex items-center justify-between border-t pt-4">
              <p className="text-sm text-muted-foreground">
                Edit this file directly, then continue to the next step.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSkipHumanStep}
                >
                  <SkipForward className="size-3.5" />
                  Skip
                </Button>
                <Button size="sm" onClick={handleReviewContinue}>
                  <CheckCircle2 className="size-3.5" />
                  Complete Step
                </Button>
              </div>
            </div>
          </div>
        );
      }

      // File not available yet
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
          <MessageSquare className="size-8 text-muted-foreground/50" />
          <p className="text-sm">
            No clarification file found. Run the previous step or continue.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleSkipHumanStep}>
              <ArrowRight className="size-3.5" />
              Continue
            </Button>
          </div>
        </div>
      );
    }

    // Reasoning step (Step 4) — single-shot generation with review
    if (stepConfig?.type === "reasoning") {
      return (
        <ReasoningReview
          skillName={skillName}
          domain={domain ?? ""}
          workspacePath={workspacePath ?? ""}
          onStepComplete={advanceToNextStep}
        />
      );
    }

    // Refinement step (Step 7) — open-ended chat for skill polish
    if (stepConfig?.type === "refinement") {
      return (
        <RefinementChat
          skillName={skillName}
          domain={domain ?? ""}
          workspacePath={workspacePath ?? ""}
        />
      );
    }

    // Initializing state — show spinner before first agent message arrives.
    if (isInitializing) {
      if (!activeAgentId || !runs[activeAgentId]?.messages.length) {
        return <AgentInitializingIndicator />;
      }
    }

    // Agent with output
    if (activeAgentId) {
      return <AgentOutputPanel agentId={activeAgentId} />;
    }

    // Error state with retry
    if (currentStepDef?.status === "error" && !activeAgentId) {
      const canContinueInChat = errorHasArtifacts && RERUN_CHAT_STEPS.has(currentStep);

      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
          <AlertCircle className="size-8 text-destructive/50" />
          <div className="text-center">
            <p className="font-medium text-destructive">Step {currentStep + 1} failed</p>
            <p className="mt-1 text-sm">
              {canContinueInChat
                ? "This step has partial output. You can continue in chat or reset."
                : "An error occurred. You can retry this step."}
            </p>
          </div>
          <div className="flex gap-2">
            {canContinueInChat && (
              <Button
                size="sm"
                onClick={() => {
                  clearRuns();
                  setRerunStepId(currentStep);
                }}
              >
                <MessageSquare className="size-3.5" />
                Continue in Chat
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                // Show confirmation if partial output exists
                if (errorHasArtifacts) {
                  setShowResetConfirm(true);
                  return;
                }
                // End active session — reset starts a fresh workflow context
                endActiveSession();
                // Full reset: clear artifacts on disk, clear agent runs, then revert step
                if (workspacePath) {
                  try {
                    await resetWorkflowStep(workspacePath, skillName, currentStep);
                  } catch {
                    // best-effort — proceed even if disk cleanup fails
                  }
                }
                clearRuns();
                rerunFromStep(currentStep);
                toast.success(`Reset step ${currentStep + 1}`);
              }}
            >
              <RotateCcw className="size-3.5" />
              Reset Step
            </Button>
            {!canContinueInChat && (
              <Button size="sm" onClick={() => handleStartStep()}>
                <Play className="size-3.5" />
                Retry
              </Button>
            )}
          </div>
        </div>
      );
    }

    // Default empty state
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <div className="flex flex-col items-center gap-2">
          <Play className="size-8 text-muted-foreground/50" />
          <p className="text-sm">Press "Start Step" to begin</p>
        </div>
      </div>
    );
  };

  // --- Start button label ---

  const getStartButtonLabel = () => "Start Step";
  const getStartButtonIcon = () => <Play className="size-3.5" />;

  return (
    <>
      {/* Navigation guard dialog — shown when user tries to leave while agent is running */}
      {blockerStatus === "blocked" && (
        <Dialog open onOpenChange={(open) => { if (!open) handleNavStay(); }}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Agent Running</DialogTitle>
              <DialogDescription>
                An agent is still running on this step. Leaving will abandon it.
              </DialogDescription>
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
              <Button variant="destructive" onClick={() => {
                const targetStep = pendingStepSwitch;
                const { currentStep: step, steps: curSteps } = useWorkflowStore.getState();
                if (curSteps[step]?.status === "in_progress") {
                  useWorkflowStore.getState().updateStepStatus(step, "pending");
                }
                useWorkflowStore.getState().setRunning(false);
                useAgentStore.getState().clearRuns();
                setPendingStepSwitch(null);
                setCurrentStep(targetStep);
              }}>
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
            rerunFromStep(resetTarget);
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
              <Button variant="destructive" onClick={async () => {
                setShowResetConfirm(false);
                // End active session — reset starts a fresh workflow context
                endActiveSession();
                // Full reset: clear artifacts on disk, clear agent runs, then revert step
                if (workspacePath) {
                  try {
                    await resetWorkflowStep(workspacePath, skillName, currentStep);
                  } catch {
                    // best-effort — proceed even if disk cleanup fails
                  }
                }
                clearRuns();
                rerunFromStep(currentStep);
                toast.success(`Reset step ${currentStep + 1}`);
              }}>
                Reset
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}



      <div className="flex h-[calc(100%+3rem)] -m-6">
        <WorkflowSidebar
          steps={steps}
          currentStep={currentStep}
          onStepClick={(id) => {
            if (steps[id]?.status !== "completed") return;
            if (isRunning) {
              setPendingStepSwitch(id);
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
              {debugMode && (
                <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600">
                  <Bug className="size-3" />
                  Debug
                </Badge>
              )}
              {canStart && (
                <Button onClick={() => {
                  // For agent steps with partial output, enter rerun chat mode for interactive resume
                  if (hasPartialOutput && RERUN_CHAT_STEPS.has(currentStep)) {
                    clearRuns();
                    setRerunStepId(currentStep);
                  } else {
                    handleStartStep(hasPartialOutput);
                  }
                }} size="sm">
                  {hasPartialOutput ? <RotateCcw className="size-3.5" /> : getStartButtonIcon()}
                  {hasPartialOutput ? "Resume" : getStartButtonLabel()}
                </Button>
              )}
              {isHumanReviewStep && currentStepDef?.status !== "completed" && (
                <Badge variant="outline" className="gap-1">
                  <FileText className="size-3" />
                  Q&A Review
                </Badge>
              )}
              {rerunStepId !== null && !isRunning && (
                <Button
                  size="sm"
                  onClick={() => rerunRef.current?.completeStep()}
                >
                  <CheckCircle2 className="size-3.5" />
                  Complete Step
                </Button>
              )}
              {stepConfig?.type === "refinement" && currentStepDef?.status !== "completed" && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      updateStepStatus(currentStep, "completed");
                      toast.success(`Step ${currentStep + 1} skipped`);
                    }}
                  >
                    <SkipForward className="size-3.5" />
                    Skip
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      updateStepStatus(currentStep, "completed");
                      toast.success(`Step ${currentStep + 1} marked complete`);
                    }}
                  >
                    <CheckCircle2 className="size-3.5" />
                    Mark Complete
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Content area — reasoning/refinement/rerun/agent panels manage their own padding */}
          <div className={`flex flex-1 flex-col overflow-hidden ${
            stepConfig?.type === "reasoning" || stepConfig?.type === "refinement" || rerunStepId !== null || activeAgentId
              ? ""
              : "p-4"
          }`}>
            {renderContent()}
          </div>
        </div>
      </div>

    </>
  );
}
