import { useCallback } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import {
  Play,
  AlertCircle,
  RotateCcw,
  Loader2,
} from "lucide-react";
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
import { useAgentStore } from "@/stores/agent-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  endWorkflowSession,
  getDisabledSteps,
  navigateBackToStepDb,
} from "@/lib/tauri";
import { TransitionGateDialog } from "@/components/transition-gate-dialog";
import { STEP_CONFIGS } from "@/lib/workflow-step-configs";
import { useWorkflowPersistence } from "@/hooks/use-workflow-persistence";
import { useWorkflowAutosave } from "@/hooks/use-workflow-autosave";
import { useWorkflowSession } from "@/hooks/use-workflow-session";
import { useWorkflowStateMachine } from "@/hooks/use-workflow-state-machine";

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
    setCurrentStep,
    runtimeError,
    clearRuntimeError,
    navigateBackToStep,
    resetToStep,
  } = useWorkflowStore();

  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const runs = useAgentStore((s) => s.runs);

  const stepConfig = STEP_CONFIGS[currentStep];

  // 1. Persistence — initializes hydrated state, tracks error artifacts
  const { errorHasArtifacts } = useWorkflowPersistence({
    skillName,
    workspacePath,
    skillsPath,
    stepConfig,
    currentStep,
    steps,
    purpose,
    hydrated,
  });

  // 2. Autosave — owns clarifications editing state
  const {
    clarificationsData,
    editorDirty,
    saveStatus,
    hasUnsavedChangesRef,
    handleClarificationsChange,
    handleSave,
    updateClarificationsState,
  } = useWorkflowAutosave({
    workspacePath,
    skillName,
    clarificationsEditable: stepConfig?.clarificationsEditable,
    currentStepStatus: steps[currentStep]?.status,
  });

  // 3. Session — lock lifecycle and navigation blocking
  const { blockerStatus, handleNavStay, handleNavLeave } = useWorkflowSession({
    skillName,
    shouldBlock: () => {
      const s = useWorkflowStore.getState();
      return s.isRunning || s.gateLoading || hasUnsavedChangesRef.current;
    },
    hasUnsavedChanges: editorDirty && !!stepConfig?.clarificationsEditable,
    currentStep,
    steps,
  });

  // 4. State machine — step transitions, agent orchestration, gate evaluation
  const {
    showGateDialog,
    gateVerdict,
    gateEvaluation,
    gateContext,
    pendingStepSwitch,
    showResetConfirm,
    resetTarget,
    pendingAutoStartStep,
    setShowResetConfirm,
    setResetTarget,
    setPendingStepSwitch,
    handleStartAgentStep,
    handleReviewContinue,
    performStepReset,
    handleGateSkip,
    handleGateResearch,
    handleGateContinueAnyway,
    handleGateLetMeAnswer,
    lastCompletedCostRef,
  } = useWorkflowStateMachine({
    skillName,
    workspacePath,
    skillsPath,
    currentStep,
    steps,
    stepConfig,
    hydrated,
    reviewMode,
    disabledSteps,
    errorHasArtifacts,
    purpose,
    clarificationsData,
    stepConfigs: STEP_CONFIGS,
    onClarificationsUpdated: updateClarificationsState,
  });

  // Local callback: abandon agent and switch to a different step.
  // Unlike handleNavLeave, we do NOT release the skill lock or shut down the sidecar
  // because the user is still in the workflow.
  const handleStepSwitchLeave = useCallback(() => {
    const targetStep = pendingStepSwitch;
    const store = useWorkflowStore.getState();
    const { currentStep: step, steps: curSteps } = store;
    if (curSteps[step]?.status === "in_progress") {
      store.updateStepStatus(step, "pending");
    }
    store.setRunning(false);
    store.setGateLoading(false);
    useAgentStore.getState().clearRuns();

    const sessionId = store.workflowSessionId;
    if (sessionId) {
      endWorkflowSession(sessionId).catch(() => {});
      useWorkflowStore.setState({ workflowSessionId: null });
    }

    setPendingStepSwitch(null);
    setCurrentStep(targetStep!);
  }, [pendingStepSwitch, setPendingStepSwitch, setCurrentStep]);

  const currentStepDef = steps[currentStep];

  // --- Render helpers ---

  /** Render completed agent/reasoning step with output files. */
  const renderCompletedStep = () => {
    const nextStep = currentStep + 1;
    const isTerminalStep = currentStep >= steps.length - 1;
    const nextStepBlocked = !isTerminalStep && disabledSteps.includes(nextStep);
    const showDecisionConflictResolution = currentStep === 2 && nextStepBlocked;
    const isLastStep = isTerminalStep || (nextStepBlocked && !showDecisionConflictResolution);
    const handleClose = () => navigate({ to: "/" });
    const handleRefine = () => {
      navigate({ to: "/refine", search: { skill: skillName } });
    };
    const nextStepLabel = !isTerminalStep ? steps[nextStep]?.name ?? "Next Step" : undefined;

    return (
      <WorkflowStepComplete
        stepName={currentStepDef.name}
        stepId={currentStep}
        outputFiles={stepConfig?.outputFiles ?? []}
        cost={lastCompletedCostRef.current}
        onNextStep={async () => {
          if (editorDirty) await handleSave(true);
          handleReviewContinue();
        }}
        onClose={handleClose}
        onRefine={disabledSteps.length > 0 ? undefined : handleRefine}
        isLastStep={isLastStep}
        nextStepBlocked={showDecisionConflictResolution}
        nextStepLabel={nextStepLabel}
        reviewMode={reviewMode}
        skillName={skillName}
        workspacePath={workspacePath ?? undefined}
        skillsPath={skillsPath}
        clarificationsEditable={!!stepConfig?.clarificationsEditable && !reviewMode}
        clarificationsData={clarificationsData}
        onClarificationsChange={handleClarificationsChange}
        onClarificationsContinue={async () => {
          if (editorDirty) await handleSave(true);
          handleReviewContinue();
        }}
        onReset={!reviewMode && stepConfig?.clarificationsEditable ? () => setResetTarget(currentStep === 1 ? 0 : currentStep) : undefined}
        onResetStep={!reviewMode ? () => performStepReset(currentStep === 1 ? 0 : currentStep) : undefined}
        saveStatus={saveStatus}
        evaluating={!!gateLoading}
      />
    );
  };

  // --- Render content (dispatch by step type) ---

  const renderContent = () => {
    // 1. Agent running — show streaming output or init spinner
    if (activeAgentId) {
      if (isInitializing && !runs[activeAgentId]?.displayItems.length) {
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

  // Navigation guard dialog helpers
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
      {/* Navigation guard dialog */}
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

      {/* Step-switch guard */}
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

      {/* Runtime error dialog */}
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
            const sessionId = useWorkflowStore.getState().workflowSessionId;
            if (sessionId) {
              endWorkflowSession(sessionId).catch(() => {});
              useWorkflowStore.setState({ workflowSessionId: null });
            }
            useAgentStore.getState().clearRuns();
            if (resetTarget === 0) {
              resetToStep(0);
            } else {
              navigateBackToStep(resetTarget);
            }
            if (skillName) {
              getDisabledSteps(skillName)
                .then((disabled) => useWorkflowStore.getState().setDisabledSteps(disabled))
                .catch(() => { /* non-fatal */ });
            }
            setResetTarget(null);
          }
        }}
      />

      {/* Reset confirmation dialog */}
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

      {/* Transition gate dialog */}
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

      {/* Gate evaluation progress modal */}
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

          {/* Content area */}
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
