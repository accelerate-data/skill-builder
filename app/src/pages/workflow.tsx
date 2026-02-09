import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Loader2,
  Play,
  Package,
  MessageSquare,
  SkipForward,
  FileText,
  Pencil,
  ArrowRight,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkflowSidebar } from "@/components/workflow-sidebar";
import { AgentOutputPanel } from "@/components/agent-output-panel";
import { ParallelAgentPanel } from "@/components/parallel-agent-panel";
import { WorkflowStepComplete } from "@/components/workflow-step-complete";
import { ReasoningChat } from "@/components/reasoning-chat";
import { useAgentStream } from "@/hooks/use-agent-stream";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useAgentStore } from "@/stores/agent-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  runWorkflowStep,
  runParallelAgents,
  packageSkill,
  resetWorkflowStep,
  getWorkflowState,
  saveWorkflowState,
  captureStepArtifacts,
  getArtifactContent,
  saveArtifactContent,
  type PackageResult,
} from "@/lib/tauri";

// --- Step config ---

interface StepConfig {
  type: "agent" | "human" | "package" | "reasoning" | "parallel";
  outputFiles?: string[];
}

const STEP_CONFIGS: Record<number, StepConfig> = {
  0: { type: "agent", outputFiles: ["context/clarifications-concepts.md"] },
  1: { type: "human" },
  2: { type: "parallel", outputFiles: ["context/clarifications-patterns.md", "context/clarifications-data.md"] },
  3: { type: "parallel", outputFiles: ["context/clarifications-data.md"] }, // Run as part of step 2
  4: { type: "agent", outputFiles: ["context/clarifications.md"] },
  5: { type: "human" },
  6: { type: "reasoning", outputFiles: ["context/decisions.md"] },
  7: { type: "agent", outputFiles: ["SKILL.md", "references/"] },
  8: { type: "agent", outputFiles: ["context/agent-validation-log.md"] },
  9: { type: "agent", outputFiles: ["context/test-skill.md"] },
  10: { type: "package" },
};

// Human review steps: step id -> relative artifact path
const HUMAN_REVIEW_STEPS: Record<number, { relativePath: string }> = {
  1: { relativePath: "context/clarifications-concepts.md" },
  5: { relativePath: "context/clarifications.md" },
};

export default function WorkflowPage() {
  const { skillName } = useParams({ from: "/skill/$skillName" });
  const workspacePath = useSettingsStore((s) => s.workspacePath);

  const {
    domain,
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
  const parallelAgentIds = useAgentStore((s) => s.parallelAgentIds);
  const runs = useAgentStore((s) => s.runs);
  const agentStartRun = useAgentStore((s) => s.startRun);
  const setActiveAgent = useAgentStore((s) => s.setActiveAgent);
  const setParallelAgents = useAgentStore((s) => s.setParallelAgents);
  const clearRuns = useAgentStore((s) => s.clearRuns);

  useAgentStream();

  // Human review state
  const [reviewContent, setReviewContent] = useState<string | null>(null);
  const [reviewFilePath, setReviewFilePath] = useState("");
  const [loadingReview, setLoadingReview] = useState(false);

  // Package result state
  const [packageResult, setPackageResult] = useState<PackageResult | null>(
    null
  );


  const stepConfig = STEP_CONFIGS[currentStep];
  const isHumanReviewStep = stepConfig?.type === "human";
  const isPackageStep = stepConfig?.type === "package";

  // Initialize workflow and restore state from SQLite
  useEffect(() => {
    let cancelled = false;
    const store = useWorkflowStore.getState();

    // Already loaded for this skill — skip
    if (store.skillName === skillName) return;

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
        initWorkflow(skillName, domainName);

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
  }, [skillName, initWorkflow, loadWorkflowState]);

  // Reset state when moving to a new step
  useEffect(() => {
    // placeholder for future per-step state resets
  }, [currentStep]);

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

    saveWorkflowState(skillName, domain, currentStep, status, stepStatuses).catch(
      () => {} // silent — best-effort persistence
    );
  }, [steps, currentStep, skillName, domain, hydrated]);

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

    getArtifactContent(skillName, relativePath)
      .then((artifact) => setReviewContent(artifact?.content ?? null))
      .catch(() => setReviewContent(null))
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

  // Watch for single agent completion
  const activeRun = activeAgentId ? runs[activeAgentId] : null;
  const activeRunStatus = activeRun?.status;

  useEffect(() => {
    if (!activeRunStatus) return;
    // Guard: only complete steps that are actively running an agent
    const { steps: currentSteps, currentStep: step } = useWorkflowStore.getState();
    if (currentSteps[step]?.status !== "in_progress") return;

    if (activeRunStatus === "completed") {
      setActiveAgent(null);

      if (workspacePath) {
        captureStepArtifacts(skillName, step, workspacePath).catch(() => {});
      }
      updateStepStatus(step, "completed");
      setRunning(false);
      toast.success(`Step ${step + 1} completed`);
    } else if (activeRunStatus === "error") {
      updateStepStatus(step, "error");
      setRunning(false);
      setActiveAgent(null);
      toast.error(`Step ${step + 1} failed`);
    }
  }, [activeRunStatus, updateStepStatus, setRunning, setActiveAgent, skillName, workspacePath]);

  // Watch for parallel agent completion (both must finish)
  const runA = parallelAgentIds?.[0] ? runs[parallelAgentIds[0]] : null;
  const runB = parallelAgentIds?.[1] ? runs[parallelAgentIds[1]] : null;
  const parallelStatusA = runA?.status;
  const parallelStatusB = runB?.status;

  useEffect(() => {
    if (!parallelAgentIds) return;

    const bothCompleted = parallelStatusA === "completed" && parallelStatusB === "completed";
    const anyError = parallelStatusA === "error" || parallelStatusB === "error";

    if (bothCompleted) {
      setParallelAgents(null);

      if (workspacePath) {
        // Capture artifacts for both steps 2 and 3
        captureStepArtifacts(skillName, 2, workspacePath).catch(() => {});
        captureStepArtifacts(skillName, 3, workspacePath).catch(() => {});
      }
      // Mark both steps as completed
      updateStepStatus(2, "completed");
      updateStepStatus(3, "completed");
      setRunning(false);
      toast.success("Research steps completed");
    } else if (anyError) {
      setParallelAgents(null);
      updateStepStatus(2, "error");
      updateStepStatus(3, "error");
      setRunning(false);
      toast.error("Research step failed");
    }
  }, [parallelStatusA, parallelStatusB, parallelAgentIds, updateStepStatus, setRunning, setParallelAgents, skillName, workspacePath]);

  // (Review agent logic removed — direct completion is faster and sufficient)

  // --- Step handlers ---

  const handleStartAgentStep = async () => {
    if (!domain || !workspacePath) {
      toast.error("Missing domain or workspace path");
      return;
    }

    try {
      updateStepStatus(currentStep, "in_progress");
      setRunning(true);

      const agentId = await runWorkflowStep(
        skillName,
        currentStep,
        domain,
        workspacePath
      );
      agentStartRun(agentId, "agent");
    } catch (err) {
      updateStepStatus(currentStep, "error");
      setRunning(false);
      toast.error(
        `Failed to start agent: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleStartParallelStep = async () => {
    if (!domain || !workspacePath) {
      toast.error("Missing domain or workspace path");
      return;
    }

    try {
      updateStepStatus(2, "in_progress");
      updateStepStatus(3, "in_progress");
      setRunning(true);

      const result = await runParallelAgents(skillName, domain, workspacePath);
      agentStartRun(result.agent_id_a, "agent");
      agentStartRun(result.agent_id_b, "agent");
      // Clear activeAgentId so the single-agent watcher doesn't interfere —
      // parallel agents are tracked exclusively via parallelAgentIds
      setActiveAgent(null);
      setParallelAgents([result.agent_id_a, result.agent_id_b]);
    } catch (err) {
      updateStepStatus(2, "error");
      updateStepStatus(3, "error");
      setRunning(false);
      toast.error(
        `Failed to start research agents: ${err instanceof Error ? err.message : String(err)}`
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

  const handleStartStep = async () => {
    if (!stepConfig) return;

    switch (stepConfig.type) {
      case "agent":
        return handleStartAgentStep();
      case "parallel":
        return handleStartParallelStep();
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
    if (!reviewFilePath) return;
    setLoadingReview(true);
    getArtifactContent(skillName, reviewFilePath)
      .then((artifact) => setReviewContent(artifact?.content ?? null))
      .catch(() => toast.error("Failed to reload file"))
      .finally(() => setLoadingReview(false));
  };

  const currentStepDef = steps[currentStep];
  // Step 3 can't be started independently (it runs as part of step 2 parallel)
  const isParallelSubStep = currentStep === 3;
  const canStart =
    stepConfig &&
    stepConfig.type !== "human" &&
    stepConfig.type !== "reasoning" &&
    !isParallelSubStep &&
    !isRunning &&
    workspacePath &&
    currentStepDef?.status !== "completed";

  // --- Render content ---

  const renderContent = () => {
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
            onRerun={handleRerunStep}
            onNextStep={advanceToNextStep}
            isLastStep={isLastStep}
          />
        );
      }
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
            No clarification file found. You can edit it in the Editor or continue to the next step.
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

    // Parallel agents (Steps 2+3)
    if (parallelAgentIds) {
      return (
        <ParallelAgentPanel
          agentIdA={parallelAgentIds[0]}
          agentIdB={parallelAgentIds[1]}
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
              An error occurred. You can retry this step or view the editor for details.
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
            <Button size="sm" onClick={handleStartStep}>
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
    <div className="flex h-full -m-6">
      <WorkflowSidebar
        steps={steps}
        currentStep={currentStep}
        onStepClick={(id) => {
          if (steps[id]?.status === "completed") {
            setCurrentStep(id);
          }
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
            <Link to="/skill/$skillName/editor" params={{ skillName }}>
              <Button variant="outline" size="sm">
                <Pencil className="size-3.5" />
                Editor
              </Button>
            </Link>
            <Link to="/skill/$skillName/chat" params={{ skillName }}>
              <Button variant="outline" size="sm">
                <MessageSquare className="size-3.5" />
                Chat
              </Button>
            </Link>
            {isRunning && (
              <Badge variant="outline" className="gap-1">
                <Loader2 className="size-3 animate-spin" />
                Running
              </Badge>
            )}
            {canStart && (
              <Button onClick={handleStartStep} size="sm">
                {getStartButtonIcon()}
                {getStartButtonLabel()}
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
  );
}
