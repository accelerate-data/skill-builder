import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useBlocker } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Loader2,
  Play,
  Package,
  MessageSquare,
  SkipForward,
  FileText,
  ArrowRight,
  AlertCircle,
  RotateCcw,
  Bug,
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
import { WorkflowStepComplete } from "@/components/workflow-step-complete";
import { ReasoningChat } from "@/components/reasoning-chat";
import { RefinementChat } from "@/components/refinement-chat";
import "@/hooks/use-agent-stream";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useAgentStore } from "@/stores/agent-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  runWorkflowStep,
  packageSkill,
  resetWorkflowStep,
  getWorkflowState,
  saveWorkflowState,
  captureStepArtifacts,
  getArtifactContent,
  saveArtifactContent,
  readFile,
  type PackageResult,
} from "@/lib/tauri";

// --- Step config ---

interface StepConfig {
  type: "agent" | "human" | "package" | "reasoning";
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
  6: { type: "agent", outputFiles: ["context/agent-validation-log.md"], model: "sonnet" },
  7: { type: "agent", outputFiles: ["context/test-skill.md"], model: "sonnet" },
  8: { type: "package" },
};

// Human review steps: step id -> relative artifact path
const HUMAN_REVIEW_STEPS: Record<number, { relativePath: string }> = {
  1: { relativePath: "context/clarifications-concepts.md" },
  3: { relativePath: "context/clarifications.md" },
};

export default function WorkflowPage() {
  const { skillName } = useParams({ from: "/skill/$skillName" });
  const workspacePath = useSettingsStore((s) => s.workspacePath);
  const debugMode = useSettingsStore((s) => s.debugMode);

  const {
    domain,
    skillType,
    currentStep,
    steps,
    isRunning,
    hydrated,
    initWorkflow,
    setCurrentStep,
    updateStepStatus,
    setRunning,
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

  const handleNavStay = useCallback(() => {
    resetBlocker?.();
  }, [resetBlocker]);

  const handleNavLeave = useCallback(() => {
    // Revert step to pending so SQLite persists the correct state.
    const { currentStep: step, steps: curSteps } = useWorkflowStore.getState();
    if (curSteps[step]?.status === "in_progress") {
      useWorkflowStore.getState().updateStepStatus(step, "pending");
    }

    useWorkflowStore.getState().setRunning(false);
    useAgentStore.getState().clearRuns();
    proceed?.();
  }, [proceed]);

  // Safety-net cleanup: revert running state on unmount (e.g. if the
  // component is removed without going through the blocker dialog).
  useEffect(() => {
    return () => {
      const store = useWorkflowStore.getState();
      if (!store.isRunning) return;

      if (store.steps[store.currentStep]?.status === "in_progress") {
        useWorkflowStore.getState().updateStepStatus(store.currentStep, "pending");
      }
      useWorkflowStore.getState().setRunning(false);
      useAgentStore.getState().clearRuns();
    };
  }, [skillName]);

  // Human review state
  const [reviewContent, setReviewContent] = useState<string | null>(null);
  const [reviewFilePath, setReviewFilePath] = useState("");
  const [loadingReview, setLoadingReview] = useState(false);
  const debugAutoAnswerRef = useRef<number | null>(null);

  // Package result state
  const [packageResult, setPackageResult] = useState<PackageResult | null>(
    null
  );

  // Track whether current step has partial output from an interrupted run
  const [hasPartialOutput, setHasPartialOutput] = useState(false);

  // Refinement chat state
  const [showRefinementChat, setShowRefinementChat] = useState(false);
  const [showRerunWarning, setShowRerunWarning] = useState(false);

  // Pending step switch — set when user clicks a sidebar step while agent is running
  const [pendingStepSwitch, setPendingStepSwitch] = useState<number | null>(null);

  const stepConfig = STEP_CONFIGS[currentStep];
  const isHumanReviewStep = stepConfig?.type === "human";
  const isPackageStep = stepConfig?.type === "package";
  const allStepsComplete = steps.every(s => s.status === "completed");

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
          loadWorkflowState(completedIds);
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

  // Reset state when moving to a new step
  useEffect(() => {
    debugAutoAnswerRef.current = null;
    setHasPartialOutput(false);
  }, [currentStep]);

  // Detect partial output from interrupted runs
  useEffect(() => {
    if (!workspacePath || !hydrated) return;
    const cfg = STEP_CONFIGS[currentStep];
    const stepStatus = steps[currentStep]?.status;
    if (!cfg?.outputFiles || stepStatus !== "pending") {
      setHasPartialOutput(false);
      return;
    }
    // Check if any artifact exists for this step — try SQLite first,
    // then fall back to filesystem (handles interrupted runs where
    // artifacts were written to disk but never captured to SQLite).
    const path = cfg.outputFiles[0];
    if (!path) return;
    getArtifactContent(skillName, path)
      .catch(() => null)
      .then(async (artifact) => {
        if (artifact?.content) return true;
        const filePath = `${workspacePath}/${skillName}/${path}`;
        return readFile(filePath).then((content) => !!content).catch(() => false);
      })
      .then((exists) => setHasPartialOutput(exists))
      .catch(() => setHasPartialOutput(false));
  }, [currentStep, steps, workspacePath, skillName, hydrated]);

  // Persist workflow state to SQLite when steps change
  useEffect(() => {
    if (!domain || !hydrated) return;
    const store = useWorkflowStore.getState();
    if (store.skillName !== skillName) return;

    const stepStatuses = store.steps.map((s) => ({
      step_id: s.id,
      status: s.status,
    }));

    const status = store.steps[store.currentStep]?.status === "in_progress"
      ? "in_progress"
      : store.steps.every((s) => s.status === "completed")
        ? "completed"
        : "pending";

    saveWorkflowState(skillName, domain, currentStep, status, stepStatuses, skillType ?? undefined).catch(
      (err) => console.warn("Failed to persist workflow state:", err)
    );
  }, [steps, currentStep, skillName, domain, skillType, hydrated]);

  // Load file content when entering a human review step
  useEffect(() => {
    if (!isHumanReviewStep || !workspacePath) {
      setReviewContent(null);
      return;
    }

    const config = HUMAN_REVIEW_STEPS[currentStep];
    if (!config) return;
    const relativePath = config.relativePath;
    setReviewFilePath(relativePath);
    setLoadingReview(true);

    const filePath = `${workspacePath}/${skillName}/${relativePath}`;

    // Try SQLite artifact first, then fall back to filesystem.
    // Both paths are attempted even if one throws.
    getArtifactContent(skillName, relativePath)
      .catch(() => null)
      .then(async (artifact) => {
        if (artifact?.content) return artifact.content;
        // Fallback: read from filesystem if not captured in SQLite yet
        return readFile(filePath).catch(() => null);
      })
      .then((content) => setReviewContent(content ?? null))
      .finally(() => setLoadingReview(false));
  }, [currentStep, isHumanReviewStep, workspacePath, skillName]);

  // Advance to next step helper
  const advanceToNextStep = useCallback(() => {
    if (currentStep < steps.length - 1) {
      const nextStep = currentStep + 1;
      setCurrentStep(nextStep);
      const nextConfig = STEP_CONFIGS[nextStep];
      if (nextConfig?.type === "human") {
        updateStepStatus(nextStep, "waiting_for_user");
      }
    }
  }, [currentStep, steps.length, setCurrentStep, updateStepStatus]);

  // Debug mode: auto-answer clarifications with recommendations and advance
  useEffect(() => {
    if (
      !debugMode ||
      !isHumanReviewStep ||
      !reviewContent ||
      loadingReview ||
      debugAutoAnswerRef.current === currentStep
    ) {
      return;
    }

    debugAutoAnswerRef.current = currentStep;

    // Fill empty Answer fields with the corresponding Recommendation text
    const filled = reviewContent.replace(
      /\*\*Recommendation\*\*:\s*([^\n]+)\n\*\*Answer\*\*:\s*$/gm,
      (_match, rec) => `**Recommendation**: ${rec}\n**Answer**: ${rec.trim()}`
    );

    const config = HUMAN_REVIEW_STEPS[currentStep];
    if (!config) return;

    setReviewContent(filled);

    // Save and advance
    saveArtifactContent(skillName, currentStep, config.relativePath, filled)
      .catch(() => {})
      .finally(() => {
        updateStepStatus(currentStep, "completed");
        advanceToNextStep();
        toast.success(`Step ${currentStep + 1} auto-answered (debug mode)`);
      });
  }, [debugMode, isHumanReviewStep, reviewContent, loadingReview, currentStep, skillName, updateStepStatus, advanceToNextStep]);

  // Watch for single agent completion
  const activeRun = activeAgentId ? runs[activeAgentId] : null;
  const activeRunStatus = activeRun?.status;

  useEffect(() => {
    if (!activeRunStatus || !activeAgentId) return;
    // Guard: only complete steps that are actively running an agent
    const { steps: currentSteps, currentStep: step } = useWorkflowStore.getState();
    if (currentSteps[step]?.status !== "in_progress") return;

    if (activeRunStatus === "completed") {
      setActiveAgent(null);

      // Capture artifacts before marking step complete so the next
      // human review step can read them from SQLite immediately.
      const finish = () => {
        updateStepStatus(step, "completed");
        setRunning(false);
        toast.success(`Step ${step + 1} completed`);
      };

      if (workspacePath) {
        captureStepArtifacts(skillName, step, workspacePath)
          .catch(() => {})
          .then(finish);
      } else {
        finish();
      }
    } else if (activeRunStatus === "error") {
      updateStepStatus(step, "error");
      setRunning(false);
      setActiveAgent(null);
      toast.error(`Step ${step + 1} failed`);
    }
  }, [activeRunStatus, updateStepStatus, setRunning, setActiveAgent, skillName, workspacePath]);

  // (Review agent logic removed — direct completion is faster and sufficient)

  // --- Step handlers ---

  const handleStartAgentStep = async (resume = false) => {
    if (!domain || !workspacePath) {
      toast.error("Missing domain or workspace path");
      return;
    }

    try {
      clearRuns();
      updateStepStatus(currentStep, "in_progress");
      setRunning(true);
      setHasPartialOutput(false);

      const agentId = await runWorkflowStep(
        skillName,
        currentStep,
        domain,
        workspacePath,
        resume,
      );
      agentStartRun(agentId, stepConfig?.model ?? "sonnet");
    } catch (err) {
      updateStepStatus(currentStep, "error");
      setRunning(false);
      toast.error(
        `Failed to start agent: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleSkipHumanStep = () => {
    updateStepStatus(currentStep, "completed");
    advanceToNextStep();
    toast.success(`Step ${currentStep + 1} skipped`);
  };

  const handlePackageStep = async () => {
    if (!workspacePath) {
      toast.error("Missing workspace path");
      return;
    }

    try {
      updateStepStatus(currentStep, "in_progress");
      setRunning(true);

      const result = await packageSkill(skillName, workspacePath);
      setPackageResult(result);
      updateStepStatus(currentStep, "completed");
      setRunning(false);

      toast.success("Skill packaged successfully");
    } catch (err) {
      updateStepStatus(currentStep, "error");
      setRunning(false);
      toast.error(
        `Failed to package skill: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleStartStep = async (resume = false) => {
    if (!stepConfig) return;

    switch (stepConfig.type) {
      case "agent":
        return handleStartAgentStep(resume);
      case "package":
        return handlePackageStep();
      case "human":
        // Human steps don't have a "start" — they just show the form
        break;
    }
  };

  const handleRerunStep = async () => {
    if (!workspacePath) return;
    try {
      await resetWorkflowStep(workspacePath, skillName, currentStep);
      clearRuns();
      rerunFromStep(currentStep);
      toast.success(`Reset to step ${currentStep + 1}`);
    } catch (err) {
      toast.error(
        `Failed to reset: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleRerunWithWarning = async () => {
    try {
      const artifact = await getArtifactContent(skillName, "context/refinement-chat.json");
      if (artifact?.content) {
        const parsed = JSON.parse(artifact.content);
        if (parsed.messages?.length > 0) {
          setShowRerunWarning(true);
          return;
        }
      }
    } catch { /* no artifact = no warning needed */ }
    handleRerunStep();
  };

  const confirmRerun = async () => {
    try {
      await saveArtifactContent(skillName, 9, "context/refinement-chat.json", "");
    } catch { /* best effort */ }
    setShowRerunWarning(false);
    setShowRefinementChat(false);
    handleRerunStep();
  };

  const handleReviewContinue = async () => {
    // Auto-fill empty Answer fields with the corresponding Recommendation
    let content = reviewContent;
    if (content) {
      content = content.replace(
        /\*\*Recommendation\*\*:\s*(\w)[^\n]*\n\*\*Answer\*\*:\s*$/gm,
        (match, letter) =>
          match.replace(
            /\*\*Answer\*\*:\s*$/,
            `**Answer**: ${letter} (auto-selected from recommendation)`
          )
      );
      setReviewContent(content);
    }

    // Save the (possibly edited) content to DB
    const config = HUMAN_REVIEW_STEPS[currentStep];
    if (config && content !== null) {
      try {
        await saveArtifactContent(skillName, currentStep, config.relativePath, content);
      } catch {
        // best-effort
      }
    }
    updateStepStatus(currentStep, "completed");
    advanceToNextStep();
  };

  // Reload the file content (after user edits externally)
  const handleReviewReload = () => {
    if (!reviewFilePath || !workspacePath) return;
    setLoadingReview(true);
    const filePath = `${workspacePath}/${skillName}/${reviewFilePath}`;
    getArtifactContent(skillName, reviewFilePath)
      .catch(() => null)
      .then(async (artifact) => {
        if (artifact?.content) return artifact.content;
        return readFile(filePath).catch(() => null);
      })
      .then((content) => {
        setReviewContent(content ?? null);
        if (!content) toast.error("Failed to reload file");
      })
      .finally(() => setLoadingReview(false));
  };

  const currentStepDef = steps[currentStep];
  const canStart =
    stepConfig &&
    stepConfig.type !== "human" &&
    stepConfig.type !== "reasoning" &&
    !isRunning &&
    workspacePath &&
    currentStepDef?.status !== "completed";

  // --- Render content ---

  const renderContent = () => {
    // Refinement chat panel (shown when all steps complete and user clicks button)
    if (showRefinementChat && allStepsComplete) {
      return (
        <RefinementChat
          skillName={skillName}
          domain={domain ?? ""}
          workspacePath={workspacePath ?? ""}
          onDismiss={() => setShowRefinementChat(false)}
        />
      );
    }

    // Completed step with output files
    if (
      currentStepDef?.status === "completed" &&
      !activeAgentId
    ) {
      const isLastStep = currentStep >= steps.length - 1;
      if (isPackageStep && packageResult) {
        return (
          <WorkflowStepComplete
            stepName={currentStepDef.name}
            outputFiles={[packageResult.file_path]}
            onRerun={isLastStep ? handleRerunWithWarning : handleRerunStep}
            onNextStep={advanceToNextStep}
            isLastStep={isLastStep}
            onRefineChat={allStepsComplete ? () => setShowRefinementChat(true) : undefined}
          />
        );
      }
      if (stepConfig?.outputFiles) {
        return (
          <WorkflowStepComplete
            stepName={currentStepDef.name}
            outputFiles={stepConfig.outputFiles}
            onRerun={isLastStep ? handleRerunWithWarning : handleRerunStep}
            onNextStep={advanceToNextStep}
            isLastStep={isLastStep}
            onRefineChat={isLastStep && allStepsComplete ? () => setShowRefinementChat(true) : undefined}
          />
        );
      }
      // Human steps or steps without output files
      return (
        <WorkflowStepComplete
          stepName={currentStepDef.name}
          outputFiles={[]}
          onRerun={isLastStep ? handleRerunWithWarning : handleRerunStep}
          onNextStep={advanceToNextStep}
          isLastStep={isLastStep}
          onRefineChat={isLastStep && allStepsComplete ? () => setShowRefinementChat(true) : undefined}
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
                  <ArrowRight className="size-3.5" />
                  Continue
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

    // Reasoning step (Step 6) — multi-turn chat
    if (stepConfig?.type === "reasoning") {
      return (
        <ReasoningChat
          skillName={skillName}
          domain={domain ?? ""}
          workspacePath={workspacePath ?? ""}
        />
      );
    }

    // Single agent with output
    if (activeAgentId) {
      return <AgentOutputPanel agentId={activeAgentId} />;
    }

    // Package step empty state
    if (isPackageStep) {
      return (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <div className="flex flex-col items-center gap-2">
            <Package className="size-8 text-muted-foreground/50" />
            <p className="text-sm">
              Press "Package" to create a .skill file
            </p>
          </div>
        </div>
      );
    }

    // Error state with retry
    if (currentStepDef?.status === "error" && !activeAgentId) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
          <AlertCircle className="size-8 text-destructive/50" />
          <div className="text-center">
            <p className="font-medium text-destructive">Step {currentStep + 1} failed</p>
            <p className="mt-1 text-sm">
              An error occurred. You can retry this step.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                updateStepStatus(currentStep, "pending");
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

  const getStartButtonLabel = () => {
    if (!stepConfig) return "Start Step";
    switch (stepConfig.type) {
      case "package":
        return "Package";
      default:
        return "Start Step";
    }
  };

  const getStartButtonIcon = () => {
    if (stepConfig?.type === "package") {
      return <Package className="size-3.5" />;
    }
    return <Play className="size-3.5" />;
  };

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

      {/* Rerun warning — shown when user tries to rerun step 8 with existing refinement chat */}
      {showRerunWarning && (
        <Dialog open onOpenChange={(open) => { if (!open) setShowRerunWarning(false); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Clear Chat History?</DialogTitle>
              <DialogDescription>
                Rerunning this step will clear your refinement chat history. Skill files will not be affected until the step runs.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowRerunWarning(false)}>Cancel</Button>
              <Button variant="destructive" onClick={confirmRerun}>Clear and Rerun</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <div className="flex h-full -m-6">
        <WorkflowSidebar
          steps={steps}
          currentStep={currentStep}
          onStepClick={(id) => {
            if (steps[id]?.status !== "completed") return;
            if (isRunning) {
              setPendingStepSwitch(id);
              return;
            }
            setCurrentStep(id);
          }}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Step header */}
          <div className="flex items-center justify-between border-b px-6 py-4">
            <div className="flex flex-col gap-1">
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
                <Button onClick={() => handleStartStep(hasPartialOutput)} size="sm">
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
            </div>
          </div>

          {/* Content area */}
          <div className="flex flex-1 flex-col overflow-hidden p-4">
            {renderContent()}
          </div>
        </div>
      </div>

    </>
  );
}
