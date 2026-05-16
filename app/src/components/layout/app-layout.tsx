import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconRail } from "./sidebar";
import { SkillListPanel } from "@/components/skill-list-panel";
import { CloseGuard } from "@/components/close-guard";
import { SplashScreen } from "@/components/splash-screen";
import { SetupScreen } from "@/components/setup-screen";
import ReconciliationAckDialog from "@/components/reconciliation-ack-dialog";
import { useSettingsStore } from "@/stores/settings-store";
import { toast } from "@/lib/toast";
import { useSkillStore } from "@/stores/skill-store";
import { useAgentStore } from "@/stores/agent-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useAppStartup } from "@/hooks/use-app-startup";
import {
  logFrontend,
  pauseOpenHandsSession,
} from "@/lib/tauri";
import {
  getEvalsRunning,
  getEvalsStopping,
  requestEvalsCancel,
  setEvalsStopping,
  subscribeEvalsRunning,
} from "@/lib/eval-running-state";
import { useBuilderSkillsQuery, useImportedSkillsQuery } from "@/lib/queries/skills";
import { type EditableSkill, toEditableSkill } from "@/lib/types";
import { getSkillSurface } from "@/lib/skill-routing";
import { enterSkill, leaveCurrentSkill } from "@/lib/active-skill-transition";
import { useWorkspaceStore } from "@/stores/workspace-store";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function AppLayout() {
  const isConfigured = useSettingsStore((s) => s.isConfigured);
  const { data: builderSkills = [] } = useBuilderSkillsQuery();
  const { data: importedSkills = [] } = useImportedSkillsQuery();
  const selectedWorkspaceSkillId = useSkillStore((s) => s.activeSkillId);
  const setSelectedWorkspaceSkill = useSkillStore((s) => s.setActiveSkill);
  const selectedSkill = useSkillStore((s) => s.selectedSkill);
  const selectedSkillConversationId = useSkillStore((s) => s.conversationId);
  const runs = useAgentStore((s) => s.runs);
  const [evalsRunningReactive, setEvalsRunningReactive] = useState(getEvalsRunning);
  useEffect(() => subscribeEvalsRunning(setEvalsRunningReactive), []);
  const runningWorkflow = Object.values(runs).find(
    (r): r is typeof r & { skillName: string } =>
      r.status === "running" && r.runSource === "workflow" && !!r.skillName,
  );
  const agentRunning = evalsRunningReactive || Boolean(runningWorkflow);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const lockedSkills = useSkillStore((s) => s.lockedSkills);
  const setWorkspaceSurface = useWorkspaceStore((s) => s.setActiveSurface);

  const [splashDismissed, setSplashDismissed] = useState(false);
  const [startupReady, setStartupReady] = useState(false);

  // Keep refs for Escape handler to avoid stale closure over skills query data
  const builderSkillsRef = useRef(builderSkills);
  builderSkillsRef.current = builderSkills;
  const importedSkillsRef = useRef(importedSkills);
  importedSkillsRef.current = importedSkills;

  const {
    settingsLoaded,
    reconciled,
    reconNotifications,
    ackDone,
    reconRequiresApply,
    reconApplying,
    runtimeReady,
    runtimeError,
    handleApplyReconciliation,
    handleCancelReconciliation,
  } = useAppStartup();

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        navigate({ to: "/settings" });
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "1") {
        e.preventDefault();
        navigate({ to: "/" });
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        setPanelCollapsed((prev) => !prev);
      }
      if (e.key === "Escape") {
        logFrontend("debug", "[app-layout] escape pressed");
        const workflowStore = useWorkflowStore.getState();
        if (workflowStore.isRunning && !workflowStore.isStopping) {
          const runs = useAgentStore.getState().runs;
          const activeAgentId = useAgentStore.getState().activeAgentId;
          const running = Object.values(runs).find(
            (r): r is typeof r & { skillName: string } =>
              r.status === "running" && r.runSource === "workflow" && !!r.skillName,
          );
          const skillName = running?.skillName ?? selectedSkill?.name;
          const pluginSlug =
            (skillName
              ? builderSkillsRef.current.find((skill) => skill.name === skillName)?.plugin_slug ??
                importedSkillsRef.current.find((skill) => skill.skill_name === skillName)?.plugin_slug
              : undefined) ??
            selectedSkill?.plugin_slug;
          const workflowConversationId = running?.sessionId ?? selectedSkillConversationId;
          const workflowAgentId = running?.agentId ?? activeAgentId;

          if (skillName && pluginSlug && workflowConversationId) {
            logFrontend(
              "debug",
              `[app-layout] escape pausing workflow session skill=${skillName} has_run=${running ? "true" : "false"}`,
            );
            workflowStore.setStopping(true);
            pauseOpenHandsSession(
              skillName,
              pluginSlug,
              workflowConversationId,
              workflowAgentId,
            ).catch((err) => {
              console.error("[app-layout] escape: pause workflow conversation failed", err);
              workflowStore.setStopping(false);
            });
          } else {
            logFrontend(
              "debug",
              `[app-layout] escape workflow pause skipped skill=${skillName ?? "none"} plugin=${pluginSlug ?? "none"} conversation=${workflowConversationId ?? "none"}`,
            );
          }
          return;
        }
        if (getEvalsRunning() && !getEvalsStopping()) {
          setEvalsStopping(true);
          requestEvalsCancel().catch((err) => {
            console.error("[app-layout] escape: cancel eval workbench run failed", err);
            setEvalsStopping(false);
          });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [navigate]);

  const [pendingSkillSwitch, setPendingSkillSwitch] = useState<string | null>(null);

  const resolveSkillSelection = useCallback(
    (skillId: string): { editableSkill: EditableSkill; skillId: string } | null => {
      const builderSkill = builderSkills.find(
        (skill) => skill.skill_source === "skill-builder" && String(skill.id) === skillId,
      );
      if (builderSkill) {
        return {
          editableSkill: builderSkill as EditableSkill,
          skillId,
        };
      }

      const importedSkill = importedSkills.find(
        (skill) => String(skill.skill_id) === skillId,
      );
      if (importedSkill) {
        return {
          editableSkill: toEditableSkill(importedSkill),
          skillId,
        };
      }

      return null;
    },
    [builderSkills, importedSkills],
  );

  const activateSkill = useCallback(
    async (skillId: string, targetSurface?: "workflow" | "workspace") => {
      if (lockedSkills.has(Number(skillId))) {
        return;
      }

      const resolvedSkill = resolveSkillSelection(skillId);
      if (!resolvedSkill) {
        throw new Error(`Skill '${skillId}' is not available`);
      }
      const { editableSkill } = resolvedSkill;

      const sessionAlreadyActive =
        selectedSkill?.name === editableSkill.name &&
        selectedSkill.plugin_slug === editableSkill.plugin_slug &&
        !!selectedSkillConversationId;
      const surface = targetSurface ?? getSkillSurface(editableSkill);

      if (skillId === selectedWorkspaceSkillId && sessionAlreadyActive) {
        if (surface === "workflow") {
          navigate({ to: "/workflow/$skillId", params: { skillId } });
        } else {
          setWorkspaceSurface("overview");
          navigate({ to: "/workspace/$skillId", params: { skillId } });
        }
        return;
      }

      if (skillId !== selectedWorkspaceSkillId) {
        if (getEvalsRunning()) {
          await requestEvalsCancel();
          setEvalsStopping(false);
        }
        await leaveCurrentSkill();
      }

      try {
        setSelectedWorkspaceSkill(skillId);
        await enterSkill(editableSkill);
      } catch (err) {
        setSelectedWorkspaceSkill(null);
        throw err;
      }

      if (surface === "workflow") {
        navigate({ to: "/workflow/$skillId", params: { skillId } });
      } else {
        setWorkspaceSurface("overview");
        navigate({ to: "/workspace/$skillId", params: { skillId } });
      }
    },
    [
      lockedSkills,
      resolveSkillSelection,
      selectedSkill,
      selectedSkillConversationId,
      selectedWorkspaceSkillId,
      setSelectedWorkspaceSkill,
      setWorkspaceSurface,
      navigate,
    ],
  );

  const handleSelectSkill = useCallback(
    async (skillId: string, targetSurface: "overview" | "evals" = "overview") => {
      if (lockedSkills.has(Number(skillId))) {
        return;
      }

      const resolvedSkill = resolveSkillSelection(skillId);
      if (!resolvedSkill) return;
      const { editableSkill } = resolvedSkill;
      const sessionAlreadyActive =
        selectedSkill?.name === editableSkill.name &&
        selectedSkill.plugin_slug === editableSkill.plugin_slug &&
        !!selectedSkillConversationId;

      if (skillId === selectedWorkspaceSkillId && sessionAlreadyActive) {
        const surface = getSkillSurface(editableSkill);
        if (surface === "workspace") {
          setWorkspaceSurface(targetSurface);
        }
        const route = surface === "workflow"
          ? { to: "/workflow/$skillId", params: { skillId } }
          : { to: "/workspace/$skillId", params: { skillId } };
        navigate(route);
        return;
      }

      const evalsRunning = getEvalsRunning();
      if (evalsRunning || runningWorkflow) {
        setPendingSkillSwitch(skillId);
        return;
      }

      try {
        setWorkspaceSurface(targetSurface);
        await activateSkill(skillId);
      } catch (err) {
        console.error("[app-layout] skill switch cleanup failed", err);
        toast.error(err instanceof Error ? err.message : String(err), { duration: Infinity });
      }
    },
    [
      activateSkill,
      lockedSkills,
      resolveSkillSelection,
      selectedSkill,
      selectedSkillConversationId,
      selectedWorkspaceSkillId,
      runningWorkflow,
      setWorkspaceSurface,
      navigate,
    ],
  );

  const handleSkillSwitchStay = useCallback(() => {
    setPendingSkillSwitch(null);
  }, []);

  const handleSkillSwitchLeave = useCallback(() => {
    if (!pendingSkillSwitch) return;
    const nextSkill = pendingSkillSwitch;
    setPendingSkillSwitch(null);
    void (async () => {
      await activateSkill(nextSkill);
      toast.info("Agent paused — skill switched");
    })().catch((err) => {
      console.error("[app-layout] skill switch cleanup failed", err);
      toast.error(err instanceof Error ? err.message : String(err), { duration: Infinity });
    });
  }, [activateSkill, pendingSkillSwitch]);

  const ready = settingsLoaded && reconciled && runtimeReady && startupReady && ackDone;

  const [skillPanelWidth, setSkillPanelWidth] = useState(260);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = skillPanelWidth;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - resizeStartX.current;
      setSkillPanelWidth(Math.max(180, Math.min(480, resizeStartWidth.current + dx)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [skillPanelWidth]);

  return (
    <div className="flex h-screen overflow-hidden">
      <IconRail />
      {pathname !== "/settings" && (
        panelCollapsed ? (
          <div className="flex shrink-0 flex-col items-center border-r bg-background pt-2">
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7"
              onClick={() => setPanelCollapsed(false)}
              title="Expand skill list"
            >
              <PanelRight className="size-4" />
            </Button>
          </div>
        ) : (
          <div
            style={{ width: skillPanelWidth }}
            className="relative shrink-0 transition-[width] duration-200"
          >
            <SkillListPanel
              onSelectSkill={handleSelectSkill}
              onActivateSkill={activateSkill}
              onCollapse={() => setPanelCollapsed(true)}
            />
            {agentRunning && (
              <div className="absolute inset-0 z-10 bg-background/50 cursor-not-allowed" title="Agent is running — finish or cancel before switching skills" />
            )}
            <div
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 transition-colors"
              onMouseDown={handleResizeStart}
            />
          </div>
        )
      )}
      <main className="flex flex-1 flex-col overflow-hidden">
        {ready && isConfigured ? <Outlet /> : null}
      </main>
      <CloseGuard />
      {pendingSkillSwitch && (
        <Dialog open onOpenChange={(open) => { if (!open) handleSkillSwitchStay(); }}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Agent Running</DialogTitle>
              <DialogDescription>
                An agent is still running. Switching skills will cancel it.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={handleSkillSwitchStay}>
                Stay
              </Button>
              <Button variant="destructive" onClick={handleSkillSwitchLeave}>
                Switch
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {!splashDismissed && (
        <SplashScreen
          canDismiss={runtimeReady}
          runtimeStatus={
            startupReady && !runtimeReady
              ? {
                  kind: runtimeError ? "error" : "pending",
                  message: runtimeError ?? "Launching the OpenHands Agent Server for this app session.",
                }
              : null
          }
          onDismiss={() => setSplashDismissed(true)}
          onReady={() => setStartupReady(true)}
        />
      )}
      {splashDismissed && !isConfigured && <SetupScreen />}
      {!ackDone && (
        <ReconciliationAckDialog
          notifications={reconNotifications}
          requireApply={reconRequiresApply}
          applying={reconApplying}
          open
          onApply={handleApplyReconciliation}
          onCancel={handleCancelReconciliation}
        />
      )}
    </div>
  );
}
