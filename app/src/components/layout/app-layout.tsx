import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconRail } from "./sidebar";
import { SkillListPanel } from "@/components/skill-list-panel";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { WorkspaceLoadingSkeleton } from "@/components/workspace/workspace-loading-skeleton";
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
  acquireLock,
  pauseOpenHandsSession,
  selectSkillOpenHandsSession,
  releaseLock,
} from "@/lib/tauri";
import {
  getEvalsRunning,
  getEvalsStopping,
  requestEvalsCancel,
  setEvalsStopping,
  subscribeEvalsRunning,
} from "@/lib/eval-running-state";
import { useBuilderSkillsQuery, useImportedSkillsQuery } from "@/lib/queries/skills";
import { toEditableSkill, type EditableSkill } from "@/lib/types";
import { hydrateSelectedSkillOpenHandsSession } from "@/lib/skill-openhands-session";
import { getSkillSurface } from "@/lib/skill-routing";
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
        // Refine: check if running and not already stopping
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
        // Workflow: check if running and not already stopping
        const workflowStore = useWorkflowStore.getState();
        if (workflowStore.isRunning && !workflowStore.isStopping) {
          const runs = useAgentStore.getState().runs;
          const running = Object.values(runs).find(
            (r): r is typeof r & { skillName: string } =>
              r.status === "running" && r.runSource === "workflow" && !!r.skillName,
          );
          if (running && refineStore.conversationId && refineStore.selectedSkill) {
            workflowStore.setStopping(true);
            pauseOpenHandsSession(
              refineStore.selectedSkill.name,
              refineStore.selectedSkill.plugin_slug,
              refineStore.conversationId,
              running.agentId,
            ).catch((err) => {
              console.error("[app-layout] escape: pause workflow conversation failed", err);
              workflowStore.setStopping(false);
            });
          }
          return;
        }
        // Evals: check if running and not already stopping
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

  const refineSelectedSkill = useRefineStore((s) => s.selectedSkill);
  const selectedSkillName = selectedSkillData
    ? "name" in selectedSkillData ? selectedSkillData.name : selectedSkillData.skill_name
    : null;
  const isBootstrapping =
    showWorkspace &&
    (refineSelectedSkill === null ||
     refineSelectedSkill.name !== selectedSkillName ||
     refineSelectedSkill.plugin_slug !== selectedSkillData?.plugin_slug);

  const navigateToSkillSurface = useCallback(
    (skill: EditableSkill, tab?: string) => {
      if (getSkillSurface(skill) === "workflow") {
        navigate({ to: "/skill/$skillName", params: { skillName: skill.name } });
      } else {
        navigate({ to: "/", search: { tab: tab ?? undefined } });
      }
    },
    [navigate],
  );

  const bootstrapSelectedSkillSession = useCallback(
    async (skill: EditableSkill) => {
      if (!workspacePath) {
        throw new Error("Workspace path is not configured");
      }
      await acquireLock(skill.name);
      try {
        const session = await selectSkillOpenHandsSession(
          skill.name,
          workspacePath,
          skill.plugin_slug,
        );
        hydrateSelectedSkillOpenHandsSession(skill, session);
      } catch (error) {
        await releaseLock(skill.name).catch(() => {});
        throw error;
      }
    },
    [workspacePath],
  );

  const cleanupCurrentSelectedSkill = useCallback(async () => {
    const refineStore = useRefineStore.getState();
    const workflowStore = useWorkflowStore.getState();
    const agentIdToClose = runningWorkflow?.agentId ?? refineStore.activeAgentId;
    if (getEvalsRunning()) {
      await requestEvalsCancel();
      setEvalsStopping(false);
    }
    if (selectedSkillData && refineStore.conversationId) {
      await pauseOpenHandsSession(
        "name" in selectedSkillData ? selectedSkillData.name : selectedSkillData.skill_name,
        selectedSkillData.plugin_slug,
        refineStore.conversationId,
        agentIdToClose,
      );
    }
    if (runningWorkflow) {
      workflowStore.setStopping(false);
    }
    if (selectedSkillData) {
      await releaseLock(
        "name" in selectedSkillData ? selectedSkillData.name : selectedSkillData.skill_name,
      ).catch((error) => {
        console.warn("[app-layout] release lock failed", error);
      });
    }
    refineStore.selectSkill(null);
    useAgentStore.getState().clearRuns();
  }, [runningWorkflow, selectedSkillData]);

  const activateSkill = useCallback(
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
      const refineStore = useRefineStore.getState();
      const sessionAlreadyActive =
        refineStore.selectedSkill?.name === editableSkill.name &&
        refineStore.selectedSkill.plugin_slug === editableSkill.plugin_slug &&
        !!refineStore.conversationId;

      if (name === selectedWorkspaceSkillName && sessionAlreadyActive) {
        return;
      }

      if (name !== selectedWorkspaceSkillName) {
        await cleanupCurrentSelectedSkill();
        setSelectedWorkspaceSkillName(null);
        setSelectedWorkspaceSkillName(name);
      }

      try {
        await bootstrapSelectedSkillSession(editableSkill);
        navigateToSkillSurface(editableSkill);
      } catch (err) {
        setSelectedWorkspaceSkillName(null);
        throw err;
      }
    },
    [
      bootstrapSelectedSkillSession,
      builderSkills,
      cleanupCurrentSelectedSkill,
      importedSkills,
      navigateToSkillSurface,
      selectedWorkspaceSkillName,
      setSelectedWorkspaceSkillName,
    ],
  );

  const handleSelectSkill = useCallback(
    async (name: string, tab?: string) => {
      if (name === selectedWorkspaceSkillName) {
        const currentEditable: EditableSkill = selectedSkillData
          ? "name" in selectedSkillData
            ? selectedSkillData as EditableSkill
            : toEditableSkill(selectedSkillData)
          : (() => {
              const targetBuilderSkill = builderSkills.find(
                (skill) =>
                  skill.skill_source === "skill-builder" &&
                  (skill.library_key ?? skill.name) === name,
              );
              const targetImportedSkill = importedSkills.find(
                (skill) => (skill.library_key ?? `imported:${skill.skill_id}`) === name,
              );
              const targetSkill = targetBuilderSkill ?? targetImportedSkill ?? null;
              return targetSkill
                ? "name" in targetSkill
                  ? targetSkill as EditableSkill
                  : toEditableSkill(targetSkill)
                : null!;
            })();
        navigateToSkillSurface(currentEditable, tab);
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
      try {
        await activateSkill(name);
        // navigation is now inside activateSkill — do not add navigate() here
      } catch (err) {
        console.error("[app-layout] skill switch cleanup failed", err);
        toast.error(err instanceof Error ? err.message : String(err), { duration: Infinity });
      }
    },
    [activateSkill, builderSkills, importedSkills, navigateToSkillSurface, runningWorkflow, selectedSkillData, selectedWorkspaceSkillName],
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
      await activateSkill(nextSkill);
      toast.info("Agent paused — skill switched");
      navigate({ to: "/", search: { tab: tab ?? undefined } });
    })().catch((err) => {
      console.error("[app-layout] skill switch cleanup failed", err);
      toast.error(err instanceof Error ? err.message : String(err), { duration: Infinity });
    });
  }, [activateSkill, navigate, pendingSkillSwitch]);


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
        {ready && isConfigured
          ? showWorkspace && selectedSkillData
            ? isBootstrapping
              ? <WorkspaceLoadingSkeleton />
              : <WorkspaceShell
                  key={selectedSkillName ?? undefined}
                  skill={selectedSkillData}
                  skillType={selectedSkillType}
                  initialTab={workspaceInitialTab}
                  className="animate-in fade-in duration-200"
                />
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
