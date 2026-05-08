import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconRail } from "./sidebar";
import { SkillListPanel } from "@/components/skill-list-panel";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
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
import { useAppStartup } from "@/hooks/use-app-startup";
import {
  cancelAgentRun,
  cancelWorkflowStep,
  pauseOpenHandsSession,
  selectSkillOpenHandsSession,
} from "@/lib/tauri";
import {
  getEvalsRunning,
  requestEvalsCancel,
  subscribeEvalsRunning,
} from "@/lib/eval-running-state";
import { useBuilderSkillsQuery, useImportedSkillsQuery } from "@/lib/queries/skills";
import { toEditableSkill, type EditableSkill } from "@/lib/types";
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
  const refineRunning = useRefineStore((s) => s.isRunning);
  const runs = useAgentStore((s) => s.runs);
  const [evalsRunningReactive, setEvalsRunningReactive] = useState(getEvalsRunning);
  useEffect(() => subscribeEvalsRunning(setEvalsRunningReactive), []);
  const runningWorkflow = Object.values(runs).find(
    (r): r is typeof r & { skillName: string } =>
      r.status === "running" && r.runSource === "workflow" && !!r.skillName,
  );
  const agentRunning = refineRunning || evalsRunningReactive || Boolean(runningWorkflow);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const workspaceInitialTab = useRouterState({
    select: (s) => {
      if (s.location.pathname !== "/") return undefined;
      const search = s.location.search as Record<string, string>;
      return typeof search.tab === "string" ? search.tab : undefined;
    },
  });

  const [splashDismissed, setSplashDismissed] = useState(false);
  const [nodeReady, setNodeReady] = useState(false);

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
        navigate({ to: "/", search: { tab: undefined } });
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        setPanelCollapsed((prev) => !prev);
      }
      if (e.key === "Escape") {
        // Refine (streaming): pause via session UUID from RefineSessionManager.
        const refineStore = useRefineStore.getState();
        if (refineStore.isRunning && refineStore.activeAgentId) {
          cancelAgentRun(refineStore.activeAgentId).catch((err) => {
            console.error("[app-layout] escape: cancel refine run failed", err);
            toast.error(`Failed to pause agent: ${err instanceof Error ? err.message : String(err)}`, { duration: Infinity });
          });
          return;
        }
        // Workflow step (streaming): cancel via agentId → session lookup in backend.
        const runs = useAgentStore.getState().runs;
        const running = Object.values(runs).find(
          (r): r is typeof r & { skillName: string } =>
            r.status === "running" && r.runSource === "workflow" && !!r.skillName,
        );
        if (running) {
          cancelWorkflowStep(running.agentId).catch((err) => {
            console.error("[app-layout] escape: cancel workflow step failed", err);
          });
          return;
        }
        if (getEvalsRunning()) {
          requestEvalsCancel().catch((err) => {
            console.error("[app-layout] escape: cancel eval workbench run failed", err);
          });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  const [pendingSkillSwitch, setPendingSkillSwitch] = useState<string | null>(null);

  const pendingSkillSwitchTabRef = useRef<string | undefined>(undefined);

  const selectedBuilderSkill = builderSkills.find(
    (s) => s.skill_source === "skill-builder" && (s.library_key ?? s.name) === selectedWorkspaceSkillName,
  );
  const selectedImportedSkill = importedSkills.find(
    (s) => (s.library_key ?? `imported:${s.skill_id}`) === selectedWorkspaceSkillName,
  );
  const selectedSkillData = selectedBuilderSkill ?? selectedImportedSkill ?? null;
  const selectedSkillType: "builder" | "imported" | "marketplace" = selectedBuilderSkill
    ? selectedBuilderSkill.skill_source === "marketplace"
      ? "marketplace"
      : "builder"
    : selectedImportedSkill?.marketplace_source_url
      ? "marketplace"
      : "imported";
  const showWorkspace = selectedSkillData !== null && pathname === "/";

  const editableSelectedSkill: EditableSkill | null = selectedSkillData
    ? "name" in selectedSkillData
      ? (selectedSkillData as EditableSkill)
      : toEditableSkill(selectedSkillData)
    : null;

  const bootstrapSelectedSkillSession = useCallback(
    async (skill: EditableSkill) => {
      if (!workspacePath) {
        throw new Error("Workspace path is not configured");
      }
      const session = await selectSkillOpenHandsSession(
        skill.name,
        workspacePath,
        skill.plugin_slug,
      );
      const store = useRefineStore.getState();
      store.setSelectedSkill(skill);
      store.setConversationId(session.conversation_id || null);
      store.setAvailableAgents(session.available_agents ?? []);
      store.setMessages([]);
    },
    [workspacePath],
  );

  const cleanupCurrentSelectedSkill = useCallback(async () => {
    const refineStore = useRefineStore.getState();
    if (runningWorkflow) {
      await cancelWorkflowStep(runningWorkflow.agentId);
    }
    if (getEvalsRunning()) {
      await requestEvalsCancel();
    }
    if (selectedSkillData && refineStore.conversationId) {
      await pauseOpenHandsSession(
        "name" in selectedSkillData ? selectedSkillData.name : selectedSkillData.skill_name,
        selectedSkillData.plugin_slug,
        refineStore.conversationId,
        refineStore.activeAgentId,
      );
    }
    refineStore.selectSkill(null);
    useAgentStore.getState().clearRuns();
  }, [runningWorkflow, selectedSkillData]);

  const prepareWorkflowSkill = useCallback(
    async (name: string) => {
      const targetBuilderSkill = builderSkills.find(
        (skill) =>
          skill.skill_source === "skill-builder" &&
          (skill.library_key ?? skill.name) === name,
      );
      const targetImportedSkill = importedSkills.find(
        (skill) => (skill.library_key ?? `imported:${skill.skill_id}`) === name,
      );
      const targetSkill = targetBuilderSkill ?? targetImportedSkill ?? null;
      if (!targetSkill) {
        throw new Error(`Skill '${name}' is not available`);
      }
      const editableSkill =
        "name" in targetSkill
          ? (targetSkill as EditableSkill)
          : toEditableSkill(targetSkill);

      if (name !== selectedWorkspaceSkillName) {
        await cleanupCurrentSelectedSkill();
        setSelectedWorkspaceSkillName(name);
      }

      await bootstrapSelectedSkillSession(editableSkill);
    },
    [
      bootstrapSelectedSkillSession,
      builderSkills,
      cleanupCurrentSelectedSkill,
      importedSkills,
      selectedWorkspaceSkillName,
      setSelectedWorkspaceSkillName,
    ],
  );

  const handleSelectSkill = useCallback(
    (name: string, tab?: string) => {
      if (name === selectedWorkspaceSkillName) {
        navigate({ to: "/", search: { tab: tab ?? undefined } });
        return;
      }
      // Guard: block skill switch while refine or evals are running
      const refineRunning = useRefineStore.getState().isRunning;
      const evalsRunning = getEvalsRunning();
      if (refineRunning || evalsRunning || runningWorkflow) {
        setPendingSkillSwitch(name);
        pendingSkillSwitchTabRef.current = tab;
        return;
      }
      void (async () => {
        await cleanupCurrentSelectedSkill();
        setSelectedWorkspaceSkillName(name);
        navigate({ to: "/", search: { tab: tab ?? undefined } });
      })().catch((err) => {
        console.error("[app-layout] skill switch cleanup failed", err);
        toast.error(err instanceof Error ? err.message : String(err), { duration: Infinity });
      });
    },
    [cleanupCurrentSelectedSkill, navigate, runningWorkflow, selectedWorkspaceSkillName, setSelectedWorkspaceSkillName],
  );

  const handleSkillSwitchStay = useCallback(() => {
    setPendingSkillSwitch(null);
  }, []);

  const handleSkillSwitchLeave = useCallback(() => {
    if (!pendingSkillSwitch) return;
    const nextSkill = pendingSkillSwitch;
    const tab = pendingSkillSwitchTabRef.current;
    setPendingSkillSwitch(null);
    pendingSkillSwitchTabRef.current = undefined;
    void (async () => {
      await cleanupCurrentSelectedSkill();
      toast.info("Agent paused — skill switched");
      setSelectedWorkspaceSkillName(nextSkill);
      navigate({ to: "/", search: { tab: tab ?? undefined } });
    })().catch((err) => {
      console.error("[app-layout] skill switch cleanup failed", err);
      toast.error(err instanceof Error ? err.message : String(err), { duration: Infinity });
    });
  }, [cleanupCurrentSelectedSkill, navigate, pendingSkillSwitch, setSelectedWorkspaceSkillName]);

  useEffect(() => {
    if (!workspacePath || !editableSelectedSkill) {
      return;
    }
    const existingRefineSkill = useRefineStore.getState().selectedSkill;
    const existingConversationId = useRefineStore.getState().conversationId;
    if (
      existingRefineSkill?.name === editableSelectedSkill.name &&
      existingRefineSkill.plugin_slug === editableSelectedSkill.plugin_slug &&
      existingConversationId
    ) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const session = await selectSkillOpenHandsSession(
        editableSelectedSkill.name,
        workspacePath,
        editableSelectedSkill.plugin_slug,
      );
      if (cancelled) return;
      const store = useRefineStore.getState();
      store.setSelectedSkill(editableSelectedSkill);
      store.setConversationId(session.conversation_id || null);
      store.setAvailableAgents(session.available_agents ?? []);
      store.setMessages([]);
    })().catch((err) => {
      console.error("[app-layout] failed to bootstrap selected skill session", err);
      toast.error(err instanceof Error ? err.message : String(err), { duration: Infinity });
    });
    return () => {
      cancelled = true;
    };
  }, [editableSelectedSkill, workspacePath]);

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
              onPrepareWorkflowSkill={prepareWorkflowSkill}
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
        {ready && isConfigured
          ? showWorkspace && selectedSkillData
            ? <WorkspaceShell skill={selectedSkillData} skillType={selectedSkillType} initialTab={workspaceInitialTab} />
            : <Outlet />
          : null}
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
