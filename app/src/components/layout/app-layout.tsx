import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconRail } from "./sidebar";
import { SkillListPanel } from "@/components/skill-list-panel";
import { CloseGuard } from "@/components/close-guard";
import { SplashScreen } from "@/components/splash-screen";
import { SetupScreen } from "@/components/setup-screen";
import OrphanResolutionDialog from "@/components/orphan-resolution-dialog";
import ReconciliationAckDialog from "@/components/reconciliation-ack-dialog";
import { useSettingsStore } from "@/stores/settings-store";
import { toast } from "@/lib/toast";
import { useSkillStore } from "@/stores/skill-store";
import { useAgentStore } from "@/stores/agent-store";
import { useRefineStore } from "@/stores/refine-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useAppStartup } from "@/hooks/use-app-startup";
import {
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
import { type EditableSkill } from "@/lib/types";
import { getSkillSurface } from "@/lib/skill-routing";
import { enterSkill, leaveCurrentSkill } from "@/lib/active-skill-transition";
import { resolveSkill } from "@/lib/resolve-skill";

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
  const workspacePath = useSettingsStore((s) => s.workspacePath);
  const { data: builderSkills = [] } = useBuilderSkillsQuery(workspacePath);
  const { data: importedSkills = [] } = useImportedSkillsQuery();
  const selectedWorkspaceSkillName = useSkillStore((s) => s.activeSkill);
  const setSelectedWorkspaceSkillName = useSkillStore((s) => s.setActiveSkill);
  const activeSessionSkillName = useSkillStore((s) => s.activeSessionSkillName);
  const setActiveSessionSkillName = useSkillStore((s) => s.setActiveSessionSkillName);
  const setSelectedSkillName = useSkillStore((s) => s.setSelectedSkillName);
  const runs = useAgentStore((s) => s.runs);
  const [evalsRunningReactive, setEvalsRunningReactive] = useState(getEvalsRunning);
  useEffect(() => subscribeEvalsRunning(setEvalsRunningReactive), []);
  const runningWorkflow = Object.values(runs).find(
    (r): r is typeof r & { skillName: string } =>
      r.status === "running" && r.runSource === "workflow" && !!r.skillName,
  );
  const refineRunning = useRefineStore((s) => s.isRunning);
  const agentRunning = refineRunning || evalsRunningReactive || Boolean(runningWorkflow);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const [splashDismissed, setSplashDismissed] = useState(false);
  const [nodeReady, setNodeReady] = useState(false);

  // Keep refs for Escape handler to avoid stale closure over skills query data
  const builderSkillsRef = useRef(builderSkills);
  builderSkillsRef.current = builderSkills;
  const importedSkillsRef = useRef(importedSkills);
  importedSkillsRef.current = importedSkills;

  const {
    settingsLoaded,
    reconciled,
    orphans,
    reconNotifications,
    reconDiscovered,
    ackDone,
    reconRequiresApply,
    reconApplying,
    setOrphans,
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
        const refineStore = useRefineStore.getState();
        if (refineStore.isRunning && refineStore.activeAgentId && !refineStore.isStopping &&
            refineStore.conversationId && refineStore.selectedSkill) {
          refineStore.setStopping(true);
          pauseOpenHandsSession(
            refineStore.selectedSkill.name,
            refineStore.selectedSkill.plugin_slug,
            refineStore.conversationId,
            refineStore.activeAgentId,
          ).catch((err) => {
            console.error("[app-layout] escape: pause refine conversation failed", err);
            toast.error(`Failed to pause agent: ${err instanceof Error ? err.message : String(err)}`, { duration: Infinity });
            refineStore.setStopping(false);
          });
          return;
        }
        const workflowStore = useWorkflowStore.getState();
        if (workflowStore.isRunning && !workflowStore.isStopping) {
          const runs = useAgentStore.getState().runs;
          const running = Object.values(runs).find(
            (r): r is typeof r & { skillName: string } =>
              r.status === "running" && r.runSource === "workflow" && !!r.skillName,
          );
          if (running) {
            const convoId = running.sessionId;
            const skillName = running.skillName;
            const resolved = resolveSkill(skillName, builderSkillsRef.current, importedSkillsRef.current);
            const pluginSlug = resolved?.plugin_slug;
            if (convoId && pluginSlug) {
              workflowStore.setStopping(true);
              pauseOpenHandsSession(
                skillName,
                pluginSlug,
                convoId,
                running.agentId,
              ).catch((err) => {
                console.error("[app-layout] escape: pause workflow conversation failed", err);
                workflowStore.setStopping(false);
              });
            }
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

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  const [pendingSkillSwitch, setPendingSkillSwitch] = useState<string | null>(null);

  const resolveEditableSkill = useCallback(
    (name: string): EditableSkill | null =>
      resolveSkill(name, builderSkills, importedSkills),
    [builderSkills, importedSkills],
  );

  const activateSkill = useCallback(
    async (name: string) => {
      const editableSkill = resolveEditableSkill(name);
      if (!editableSkill) {
        throw new Error(`Skill '${name}' is not available`);
      }
      if (!workspacePath) {
        throw new Error("Workspace path is not configured");
      }

      const refineStore = useRefineStore.getState();
      const sessionAlreadyActive =
        refineStore.selectedSkill?.name === editableSkill.name &&
        refineStore.selectedSkill.plugin_slug === editableSkill.plugin_slug &&
        !!refineStore.conversationId;
      const currentSessionName = activeSessionSkillName ?? selectedWorkspaceSkillName;

      if (name === currentSessionName && sessionAlreadyActive) {
        return;
      }

      if (name !== currentSessionName) {
        if (getEvalsRunning()) {
          await requestEvalsCancel();
          setEvalsStopping(false);
        }
        await leaveCurrentSkill();
      }

      try {
        setSelectedWorkspaceSkillName(name);
        await enterSkill(editableSkill, workspacePath);
        setActiveSessionSkillName(name);
      } catch (err) {
        setSelectedWorkspaceSkillName(null);
        setActiveSessionSkillName(null);
        throw err;
      }

      const surface = getSkillSurface(editableSkill);
      if (surface === "workflow") {
        navigate({ to: "/workflow/$skillName", params: { skillName: name } });
      } else {
        navigate({ to: "/workspace/$skillName", params: { skillName: name }, search: { tab: undefined } });
      }
    },
    [
      resolveEditableSkill,
      workspacePath,
      activeSessionSkillName,
      selectedWorkspaceSkillName,
      setSelectedWorkspaceSkillName,
      setActiveSessionSkillName,
      navigate,
    ],
  );

  const handleSelectSkill = useCallback(
    async (name: string, tab?: string) => {
      const editableSkill = resolveEditableSkill(name);
      if (!editableSkill) return;

      const currentSessionName = activeSessionSkillName ?? selectedWorkspaceSkillName;
      if (name === currentSessionName) {
        const surface = getSkillSurface(editableSkill);
        const route = surface === "workflow"
          ? { to: "/workflow/$skillName", params: { skillName: name } }
          : { to: "/workspace/$skillName", params: { skillName: name }, search: { tab: tab ?? undefined } };
        setSelectedSkillName(name);
        navigate(route);
        return;
      }

      const refineRunning = useRefineStore.getState().isRunning;
      const evalsRunning = getEvalsRunning();
      if (refineRunning || evalsRunning || runningWorkflow) {
        setPendingSkillSwitch(name);
        return;
      }

      try {
        await activateSkill(name);
      } catch (err) {
        console.error("[app-layout] skill switch cleanup failed", err);
        toast.error(err instanceof Error ? err.message : String(err), { duration: Infinity });
      }
    },
    [activateSkill, resolveEditableSkill, activeSessionSkillName, selectedWorkspaceSkillName, runningWorkflow, setSelectedSkillName, navigate],
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

  const ready = settingsLoaded && reconciled && nodeReady && ackDone;

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
          onDismiss={() => setSplashDismissed(true)}
          onReady={() => setNodeReady(true)}
        />
      )}
      {splashDismissed && !isConfigured && <SetupScreen />}
      {orphans.length > 0 && (
        <OrphanResolutionDialog
          orphans={orphans}
          open
          onResolved={() => setOrphans([])}
        />
      )}
      {!ackDone && (
        <ReconciliationAckDialog
          notifications={reconNotifications}
          discoveredSkills={reconDiscovered}
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
