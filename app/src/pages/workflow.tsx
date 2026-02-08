import { useEffect, useCallback } from "react";
import { useParams } from "@tanstack/react-router";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WorkflowSidebar } from "@/components/workflow-sidebar";
import { AgentOutputPanel } from "@/components/agent-output-panel";
import { useAgentStream } from "@/hooks/use-agent-stream";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useAgentStore } from "@/stores/agent-store";
import { useSettingsStore } from "@/stores/settings-store";
import { startAgent } from "@/lib/tauri";

const STEP_AGENT_CONFIG: Record<
  number,
  { model: string; buildPrompt: (domain: string, skillName: string) => string }
> = {
  0: {
    model: "sonnet",
    buildPrompt: (domain, skillName) =>
      `Read prompts/shared-context.md and prompts/01-research-domain-concepts.md and follow the instructions. The domain is: ${domain}. Write output to skills/${skillName}/context/clarifications-concepts.md`,
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
  } = useWorkflowStore();

  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const runs = useAgentStore((s) => s.runs);
  const agentStartRun = useAgentStore((s) => s.startRun);

  useAgentStream();

  // Initialize workflow if not already set
  useEffect(() => {
    if (!useWorkflowStore.getState().skillName) {
      // Use skillName from route as both name and domain placeholder
      initWorkflow(skillName, skillName.replace(/-/g, " "));
    }
  }, [skillName, initWorkflow]);

  // Watch for agent completion to advance steps
  const activeRun = activeAgentId ? runs[activeAgentId] : null;
  const handleAgentComplete = useCallback(() => {
    if (!activeRun) return;
    if (activeRun.status === "completed") {
      updateStepStatus(currentStep, "completed");
      setRunning(false);
      toast.success(`Step ${currentStep + 1} completed`);

      // Auto-advance to next step
      if (currentStep < steps.length - 1) {
        const nextStep = currentStep + 1;
        setCurrentStep(nextStep);

        // If next step is a human review step, mark as waiting
        const nextStepDef = steps[nextStep];
        if (
          nextStepDef &&
          (nextStepDef.name === "Domain Concepts Review" ||
            nextStepDef.name === "Human Review")
        ) {
          updateStepStatus(nextStep, "waiting_for_user");
        }
      }
    } else if (activeRun.status === "error") {
      updateStepStatus(currentStep, "error");
      setRunning(false);
      toast.error(`Step ${currentStep + 1} failed`);
    }
  }, [
    activeRun?.status,
    currentStep,
    steps.length,
    updateStepStatus,
    setRunning,
    setCurrentStep,
    steps,
    activeRun,
  ]);

  useEffect(() => {
    handleAgentComplete();
  }, [handleAgentComplete]);

  const handleStartStep = async () => {
    const config = STEP_AGENT_CONFIG[currentStep];
    if (!config || !domain || !workspacePath) {
      toast.error("Cannot start step: missing configuration or workspace path");
      return;
    }

    const agentId = `${skillName}-step${currentStep}-${Date.now()}`;

    try {
      agentStartRun(agentId, config.model);
      updateStepStatus(currentStep, "in_progress");
      setRunning(true);

      await startAgent(
        agentId,
        config.buildPrompt(domain, skillName),
        config.model,
        workspacePath
      );
    } catch (err) {
      updateStepStatus(currentStep, "error");
      setRunning(false);
      toast.error(
        `Failed to start agent: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const currentStepDef = steps[currentStep];
  const hasAgentConfig = currentStep in STEP_AGENT_CONFIG;
  const canStart = hasAgentConfig && !isRunning && workspacePath;

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
            {currentStepDef?.agentModel && (
              <Badge variant="secondary">{currentStepDef.agentModel}</Badge>
            )}
            {isRunning && (
              <Badge variant="outline" className="gap-1">
                <Loader2 className="size-3 animate-spin" />
                Running
              </Badge>
            )}
            {canStart && currentStepDef?.status !== "completed" && (
              <Button onClick={handleStartStep} size="sm">
                <Play className="size-3.5" />
                Start Step
              </Button>
            )}
            {!hasAgentConfig && !isRunning && (
              <Badge variant="outline">Coming soon</Badge>
            )}
          </div>
        </div>

        {/* Agent output area */}
        <div className="flex flex-1 flex-col overflow-hidden p-4">
          {activeAgentId ? (
            <AgentOutputPanel agentId={activeAgentId} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <div className="flex flex-col items-center gap-2">
                <Play className="size-8 text-muted-foreground/50" />
                <p className="text-sm">
                  {hasAgentConfig
                    ? "Press \"Start Step\" to begin"
                    : "This step is not yet wired up"}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
