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
  readFile,
  type PackageResult,
} from "@/lib/tauri";

// --- Step config ---

interface StepConfig {
  type: "agent" | "parallel" | "human" | "package" | "reasoning";
  model?: string;
  outputFiles?: string[];
}

const STEP_CONFIGS: Record<number, StepConfig> = {
  0: {
    type: "agent",
    model: "sonnet",
    outputFiles: ["context/clarifications-concepts.md"],
  },
  1: { type: "human" },
  2: {
    type: "parallel",
    model: "sonnet",
    outputFiles: [
      "context/clarifications-patterns.md",
      "context/clarifications-data.md",
    ],
  },
  3: {
    type: "agent",
    model: "haiku",
    outputFiles: ["context/clarifications.md"],
  },
  4: { type: "human" },
  5: {
    type: "reasoning",
    model: "opus",
    outputFiles: ["context/decisions.md"],
  },
  6: {
    type: "agent",
    model: "sonnet",
    outputFiles: ["SKILL.md", "references/"],
  },
  7: {
    type: "agent",
    model: "sonnet",
    outputFiles: ["context/agent-validation-log.md"],
  },
  8: {
    type: "agent",
    model: "sonnet",
    outputFiles: ["context/test-skill.md"],
  },
  9: { type: "package" },
};

// Human review steps: step id -> clarification file path builder
const HUMAN_REVIEW_STEPS: Record<
  number,
  { getFilePath: (workspacePath: string, skillName: string) => string }
> = {
  1: {
    getFilePath: (wp, name) =>
      `${wp}/${name}/context/clarifications-concepts.md`,
  },
  4: {
    getFilePath: (wp, name) => `${wp}/${name}/context/clarifications.md`,
  },
};

export default function WorkflowPage() {
  const { skillName } = useParams({ from: "/skill/$skillName" });
  const workspacePath = useSettingsStore((s) => s.workspacePath);

  const {
    domain,
    currentStep,
    steps,
    isRunning,
    initWorkflow,
    setCurrentStep,
    updateStepStatus,
    setRunning,
    rerunFromStep,
  } = useWorkflowStore();

  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const parallelAgentIds = useAgentStore((s) => s.parallelAgentIds);
  const runs = useAgentStore((s) => s.runs);
  const agentStartRun = useAgentStore((s) => s.startRun);
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
  const isParallelStep = stepConfig?.type === "parallel";
  const isPackageStep = stepConfig?.type === "package";

  // Initialize workflow if not already set
  useEffect(() => {
    if (!useWorkflowStore.getState().skillName) {
      initWorkflow(skillName, skillName.replace(/-/g, " "));
    }
  }, [skillName, initWorkflow]);

  // Load file content when entering a human review step
  useEffect(() => {
    if (!isHumanReviewStep || !workspacePath) {
      setReviewContent(null);
      return;
    }

    const config = HUMAN_REVIEW_STEPS[currentStep];
    if (!config) return;
    const filePath = config.getFilePath(workspacePath, skillName);
    setReviewFilePath(filePath);
    setLoadingReview(true);

    readFile(filePath)
      .then((content) => setReviewContent(content))
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
    if (!activeRunStatus || isParallelStep) return;
    // Guard: only complete steps that are actively running an agent
    const { steps: currentSteps, currentStep: step } = useWorkflowStore.getState();
    if (currentSteps[step]?.status !== "in_progress") return;

    if (activeRunStatus === "completed") {
      updateStepStatus(step, "completed");
      setRunning(false);

      toast.success(`Step ${step + 1} completed`);
      advanceToNextStep();
    } else if (activeRunStatus === "error") {
      updateStepStatus(step, "error");
      setRunning(false);
      toast.error(`Step ${step + 1} failed`);
    }
  }, [activeRunStatus, isParallelStep, updateStepStatus, setRunning, advanceToNextStep]);

  // Watch for parallel agents completion (Step 2)
  const parallelRunA = parallelAgentIds ? runs[parallelAgentIds[0]] : null;
  const parallelRunB = parallelAgentIds ? runs[parallelAgentIds[1]] : null;
  const parallelStatusA = parallelRunA?.status;
  const parallelStatusB = parallelRunB?.status;

  useEffect(() => {
    if (!parallelAgentIds || !isParallelStep) return;
    if (!parallelStatusA || !parallelStatusB) return;

    const aFinished = parallelStatusA === "completed" || parallelStatusA === "error";
    const bFinished = parallelStatusB === "completed" || parallelStatusB === "error";
    if (!aFinished || !bFinished) return;

    // Guard: only complete steps that are actively running parallel agents
    const { steps: currentSteps, currentStep: step } = useWorkflowStore.getState();
    if (currentSteps[step]?.status !== "in_progress") return;

    if (parallelStatusA === "completed" && parallelStatusB === "completed") {
      updateStepStatus(step, "completed");
      setRunning(false);
      setParallelAgents(null);

      toast.success(`Step ${step + 1} completed`);
      advanceToNextStep();
    } else {
      updateStepStatus(step, "error");
      setRunning(false);
      setParallelAgents(null);
      toast.error(`Step ${step + 1} failed`);
    }
  }, [parallelAgentIds, isParallelStep, parallelStatusA, parallelStatusB, updateStepStatus, setRunning, setParallelAgents, advanceToNextStep]);

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
      agentStartRun(agentId, stepConfig?.model ?? "sonnet");
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
      updateStepStatus(currentStep, "in_progress");
      setRunning(true);

      const result = await runParallelAgents(skillName, domain, workspacePath);
      agentStartRun(result.agent_id_a, "sonnet");
      agentStartRun(result.agent_id_b, "sonnet");
      setParallelAgents([result.agent_id_a, result.agent_id_b]);
    } catch (err) {
      updateStepStatus(currentStep, "error");
      setRunning(false);
      toast.error(
        `Failed to start parallel agents: ${err instanceof Error ? err.message : String(err)}`
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

  const handleReviewContinue = () => {
    updateStepStatus(currentStep, "completed");
    advanceToNextStep();
  };

  // Reload the file content (after user edits externally)
  const handleReviewReload = () => {
    if (!reviewFilePath) return;
    setLoadingReview(true);
    readFile(reviewFilePath)
      .then((content) => setReviewContent(content))
      .catch(() => toast.error("Failed to reload file"))
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
    // Completed step with output files
    if (
      currentStepDef?.status === "completed" &&
      !activeAgentId &&
      !parallelAgentIds
    ) {
      if (isPackageStep && packageResult) {
        return (
          <WorkflowStepComplete
            stepName={currentStepDef.name}
            outputFiles={[packageResult.file_path]}
            onRerun={handleRerunStep}
          />
        );
      }
      if (stepConfig?.outputFiles) {
        return (
          <WorkflowStepComplete
            stepName={currentStepDef.name}
            outputFiles={stepConfig.outputFiles}
            onRerun={handleRerunStep}
          />
        );
      }
      // Human steps or steps without output files
      return (
        <WorkflowStepComplete
          stepName={currentStepDef.name}
          outputFiles={[]}
          onRerun={handleRerunStep}
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
            <ScrollArea className="flex-1 rounded-md border p-4">
              <div className="prose prose-sm dark:prose-invert max-w-none">
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
            Waiting for the previous step to generate clarification questions.
          </p>
          <Button variant="outline" size="sm" onClick={handleSkipHumanStep}>
            <SkipForward className="size-3.5" />
            Skip
          </Button>
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

    // Parallel agents (Step 2)
    if (isParallelStep && parallelAgentIds) {
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
      case "parallel":
        return "Start Parallel Agents";
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
