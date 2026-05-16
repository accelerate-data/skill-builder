import { useCallback, useMemo } from "react";
import { useParams, useNavigate, useLocation } from "@tanstack/react-router";
import {
  Play,
  AlertCircle,
  RotateCcw,
  Loader2,
  CircleHelp,
  Lock,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { getWorkflowStepUrl } from "@/lib/help-urls";
import { teardownWorkflowSession } from "@/lib/workflow-teardown";
import { cn } from "@/lib/utils";
import type { WorkflowStep } from "@/stores/workflow-store";
import { useSkillStore, useIsSkillLocked } from "@/stores/skill-store";
import { Button } from "@/components/ui/button";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { ReviewModeToggle } from "@/components/review-mode-toggle";
import { WorkflowSidebar } from "@/components/workflow-sidebar";
import { AgentInitializingIndicator } from "@/components/agent-initializing-indicator";
import { ConversationTimeline } from "@/components/conversation/conversation-timeline";
import { RuntimeErrorDialog } from "@/components/runtime-error-dialog";
import { WorkflowStepComplete } from "@/components/step-complete";
import ResetStepDialog from "@/components/reset-step-dialog";
import "@/hooks/use-session-runtime-stream";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useSessionRuntimeStore } from "@/stores/session-runtime-store";
import { useSettingsStore } from "@/stores/settings-store";
import { STEP_CONFIGS } from "@/lib/workflow-step-configs";
import { useWorkflowPersistence } from "@/hooks/use-workflow-persistence";
import { WorkflowLoadingSkeleton } from "@/components/workflow-loading-skeleton";
import { useWorkflowAutosave } from "@/hooks/use-workflow-autosave";
import { useWorkflowSession } from "@/hooks/use-workflow-session";
import { useWorkflowStateMachine } from "@/hooks/use-workflow-state-machine";
import { useBuilderSkillsQuery } from "@/lib/queries/skills";
import { useClarifications, useRefinements } from "@/lib/queries/clarifications";
import type { ClarificationsDto, ClarificationQuestionDto } from "@/generated/contracts";
import {
  mergeClarificationsAndRefinements,
  type ClarificationsFile,
  type Question,
} from "@/lib/clarifications-types";
import { restartSkillOpenHandsSession } from "@/lib/skill-openhands-session";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useConversationEvents } from "@/hooks/use-conversation-stream";

// ─── ClarificationsDto → ClarificationsFile mapper ───────────────────────────

function mapDtoQuestionToFile(q: ClarificationQuestionDto): Question {
  return {
    id: q.question_id,
    title: q.title,
    text: q.text,
    must_answer: q.must_answer,
    recommendation: q.recommendation ?? null,
    answer_choice: q.answer_choice ?? null,
    answer_text: q.answer_text ?? null,
    answer_verdict: q.answer_verdict ?? null,
    answer_verdict_reason: q.answer_verdict_reason ?? null,
    choices: (q.choices ?? []).map((c) => ({
      id: c.choice_id,
      text: c.text,
      is_other: c.is_other,
    })),
  };
}

function mapClarificationsDtoToFile(dto: ClarificationsDto): ClarificationsFile {
  return {
    version: dto.version,
    metadata: {
      title: dto.title,
      question_count: dto.question_count,
      section_count: dto.section_count,
      refinement_count: dto.refinement_count,
      must_answer_count: dto.must_answer_count,
      priority_questions: [],
      scope_recommendation: dto.scope_recommendation ?? null,
      scope_reason: dto.scope_reason ?? null,
      scope_next_action: dto.scope_next_action ?? null,
      error: dto.error_code ? { code: dto.error_code, message: dto.error_message ?? "" } : null,
      warning: dto.warning_code ? { code: dto.warning_code, message: dto.warning_message ?? "" } : null,
    },
    sections: (dto.sections ?? []).map((s) => ({
      id: s.section_id,
      title: s.title,
      description: s.description ?? undefined,
      questions: (dto.questions ?? [])
        .filter((q) => q.section_id === s.section_id && q.parent_question_id == null)
        .sort((a, b) => a.ordinal - b.ordinal)
        .map(mapDtoQuestionToFile),
    })),
    notes: (dto.notes ?? [])
      .filter((n) => n.note_type !== "answer_feedback")
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((n) => ({ type: n.note_type, title: n.title, body: n.body })),
    answer_evaluator_notes: [],
  };
}

function getDeleteFromStep(stepId: number, preserveTargetStep: boolean): number {
  return preserveTargetStep ? stepId + 1 : stepId;
}

interface WorkflowMainHeaderProps {
  skillName: string;
  currentStep: number;
  stepStatus: WorkflowStep["status"] | undefined;
}

function WorkflowMainHeader({ skillName, currentStep, stepStatus }: WorkflowMainHeaderProps) {
  let dotColor: string | undefined;
  let label = "";

  if (stepStatus === "waiting_for_user") {
    dotColor = "bg-amber-600 dark:bg-amber-400";
    label = "Awaiting input";
  }

  const showStatus = label.length > 0;

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-5">
      <span className="text-[13px] font-semibold" style={{ color: "var(--color-navy)" }}>
        {skillName}
      </span>
      <span className="text-[13px] text-muted-foreground">· Workflow</span>
      <div className="ml-auto flex items-center gap-3">
        <ReviewModeToggle />
        {showStatus && (
          <div className="flex items-center gap-1.5">
            <div
              className={cn("size-2.5 shrink-0 rounded-full", dotColor)}
            />
            <span className="font-mono text-[11px]" style={{ color: "var(--color-pacific)" }}>
              {label}
            </span>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => openUrl(getWorkflowStepUrl(currentStep))}
          title="Help"
        >
          <CircleHelp className="size-4" />
        </Button>
        <FeedbackDialog />
      </div>
    </div>
  );
}

export default function WorkflowPage() {
  const setWorkspaceSurface = useWorkspaceStore((s) => s.setActiveSurface);
  const { skillId } = useParams({ from: "/workflow/$skillId" });
  const navigate = useNavigate();
  const location = useLocation();
  const autoStart = location.state?.autoStart === true;
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
  } = useWorkflowStore();

  const activeConversationId = useWorkflowStore((s) => s.activeConversationId);
  const runtimeRuns = useSessionRuntimeStore((s) => s.runs);
  const selectedSkill = useSkillStore((s) => s.selectedSkill);
  const conversationId = useSkillStore((s) => s.conversationId);
  const activeConversationEventCount = useConversationEvents(conversationId ?? "").length;
  const { data: builderSkills = [] } = useBuilderSkillsQuery();
  const currentSkill = builderSkills.find(
    (sk) => String(sk.id) === skillId,
  );
  const selectedSkillMatchesRoute =
    selectedSkill != null && String(selectedSkill.id ?? "") === skillId;
  const currentSkillId = currentSkill?.id ?? (
    selectedSkillMatchesRoute ? selectedSkill?.id ?? null : null
  );
  const isLocked = useIsSkillLocked(currentSkillId);
  const pluginSlug = currentSkill?.plugin_slug ?? (
    selectedSkillMatchesRoute ? selectedSkill?.plugin_slug : undefined
  );
  const actualSkillName = currentSkill?.name ?? (
    selectedSkillMatchesRoute ? selectedSkill?.name : skillId
  );

  const stepConfig = STEP_CONFIGS[currentStep];

  // 1. Persistence — initializes hydrated state, tracks error artifacts
  const { errorHasArtifacts, isLoaded } = useWorkflowPersistence({
    skillName: actualSkillName,
    skillId: currentSkillId,
    skillsPath,
    stepConfig,
    currentStep,
    autoStart,
    steps,
    purpose,
    hydrated,
  });

  // 2a. DB clarifications query — feeds editor when step is clarifications-editable
  const isClarificationsEditable = !!stepConfig?.clarificationsEditable;
  const isStepCompleted = steps[currentStep]?.status === "completed";
  const { data: clarificationsDto } = useClarifications(
    isClarificationsEditable && isStepCompleted && currentSkillId != null
      ? String(currentSkillId)
      : null,
  );
  const { data: refinementsDto } = useRefinements(
    isClarificationsEditable && isStepCompleted && currentStep === 1 && currentSkillId != null
      ? String(currentSkillId)
      : null,
  );
  const dbClarificationsData = useMemo(
    () => mergeClarificationsAndRefinements(
      clarificationsDto ? mapClarificationsDtoToFile(clarificationsDto) : null,
      currentStep === 1 ? refinementsDto ?? null : null,
    ),
    [clarificationsDto, currentStep, refinementsDto],
  );

  // 2b. Autosave — owns clarifications editing state and persists per-question changes
  const {
    clarificationsData,
    editorDirty,
    saveStatus,
    hasUnsavedChangesRef,
    handleClarificationsChange,
    handleSave,
  } = useWorkflowAutosave({
    skillId: currentSkillId,
    clarificationsEditable: stepConfig?.clarificationsEditable,
    currentStepStatus: steps[currentStep]?.status,
    dbClarificationsData,
  });

  // 3. Session cleanup and navigation blocking
  const { blockerStatus, handleNavStay, handleNavLeave } = useWorkflowSession({
    skillName: actualSkillName,
    shouldBlock: () => {
      const s = useWorkflowStore.getState();
      return s.isRunning || s.gateLoading || hasUnsavedChangesRef.current;
    },
    hasUnsavedChanges: editorDirty && !!stepConfig?.clarificationsEditable,
  });

  const restartSelectedSkillSession = useCallback(async () => {
    const restartSkill =
      String(selectedSkill?.id ?? "") === skillId ? selectedSkill : null;

    if (!restartSkill) {
      throw new Error(
        `No active selected skill session is available for workflow skill '${skillId}'`,
      );
    }
    await restartSkillOpenHandsSession(restartSkill);
  }, [selectedSkill, skillId]);

  // 4. State machine — step transitions, agent orchestration, gate evaluation
  const {
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
  } = useWorkflowStateMachine({
    skillId: currentSkillId,
    skillName: actualSkillName,
    pluginSlug,
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
    stepConfigs: STEP_CONFIGS,
    restartOpenHandsSession: restartSelectedSkillSession,
  });

  // Local callback: abandon agent and switch to a different step.
  // Unlike handleNavLeave, we do NOT release the skill lock or shut down the runtime
  // because the user is still in the workflow.
  const handleStepSwitchLeave = useCallback(() => {
    const targetStep = pendingStepSwitch;
    teardownWorkflowSession({ logPrefix: "workflow", clearSessionId: true });

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
    const handleClose = () => {
      setWorkspaceSurface("overview");
      navigate({ to: "/workspace/$skillId", params: { skillId } });
    };
    const handleEval = () => {
      useSkillStore.getState().setActiveSkill(
        currentSkillId != null ? String(currentSkillId) : null,
      );
      setWorkspaceSurface("evals");
      navigate({ to: "/workspace/$skillId", params: { skillId } });
    };
    const nextStepLabel = !isTerminalStep ? steps[nextStep]?.name ?? "Next Step" : undefined;

    return (
      <WorkflowStepComplete
        stepName={currentStepDef.name}
        stepId={currentStep}
        outputFiles={stepConfig?.outputFiles ?? []}
        onNextStep={async () => {
          if (editorDirty) await handleSave();
          handleReviewContinue();
        }}
        onClose={handleClose}
        onEval={disabledSteps.length > 0 ? undefined : handleEval}
        isLastStep={isLastStep}
        nextStepBlocked={showDecisionConflictResolution}
        nextStepLabel={nextStepLabel}
        reviewMode={reviewMode}
        skillName={actualSkillName}
        skillId={currentSkillId}
        pluginSlug={pluginSlug}
        skillsPath={skillsPath}
        clarificationsEditable={!!stepConfig?.clarificationsEditable && !reviewMode}
        clarificationsData={clarificationsData}
        onClarificationsChange={handleClarificationsChange}
        onClarificationsContinue={async () => {
          if (editorDirty) await handleSave();
          handleReviewContinue();
        }}
        onReset={!reviewMode && stepConfig?.clarificationsEditable && currentStep !== 0 ? () => setResetTarget(currentStep) : undefined}
        onResetStep={!reviewMode ? () => performStepReset(currentStep) : undefined}
        saveStatus={saveStatus}
        evaluating={!!gateLoading}
      />
    );
  };

  // --- Render content (dispatch by step type) ---

  const renderContent = () => {
    // 1. Agent running — show streaming output or init spinner
    if (activeConversationId && conversationId && runtimeRuns[activeConversationId]) {
      if (isInitializing && activeConversationEventCount === 0) {
        return <AgentInitializingIndicator />;
      }
      return <ConversationTimeline conversationId={conversationId} />;
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
              <Button size="sm" onClick={() => handleStartAgentStep()}>
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
        <Button size="sm" onClick={() => handleStartAgentStep()}>
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

  if (!isLoaded || !conversationId) {
    return <WorkflowLoadingSkeleton />;
  }

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
        deleteFromStep={resetTarget !== null ? getDeleteFromStep(resetTarget, false) : undefined}
        workspacePath={workspacePath ?? ""}
        skillName={actualSkillName}
        open={resetTarget !== null}
        onOpenChange={(open) => { if (!open) setResetTarget(null) }}
        executeReset={resetTarget !== null ? async () => {} : undefined}
        onReset={() => {
          if (resetTarget !== null) {
            void performStepReset(resetTarget);
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

      {/* Gate evaluation progress modal — shown while the answer-evaluator agent runs */}
      <Dialog open={gateLoading}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Analyzing Responses</DialogTitle>
            <DialogDescription>
              Reviewing your answers before continuing.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Running answer analysis...
          </div>
        </DialogContent>
      </Dialog>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {isLocked && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-[1px]">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Lock className="size-8 opacity-50" />
              <p className="text-sm font-medium">Skill is locked by another instance</p>
            </div>
          </div>
        )}
        {/* Main header — skill name + status */}
        <WorkflowMainHeader
          skillName={`${currentSkill?.plugin_display_name ?? "Skill Builder"} · ${actualSkillName}`}
          currentStep={currentStep}
          stepStatus={currentStepDef?.status}
        />

        {/* Workflow body — step sidebar + step content */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
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

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
            </div>

            {/* Content area */}
            <div className={`flex min-h-0 flex-1 flex-col overflow-hidden animate-in fade-in duration-200 ${
              activeConversationId && runtimeRuns[activeConversationId] ? "" : "p-4"
            }`}>
              {renderContent()}
            </div>
          </div>
        </div>
      </div>

    </>
  );
}
