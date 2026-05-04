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
import { cancelRefineTurn, cancelWorkflowStep } from "@/lib/tauri";
import { getEvalsRunning, subscribeEvalsRunning } from "@/lib/eval-running-state";
import { useBuilderSkillsQuery, useImportedSkillsQuery } from "@/lib/queries/skills";
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
  const [evalsRunningReactive, setEvalsRunningReactive] = useState(getEvalsRunning);
  useEffect(() => subscribeEvalsRunning(setEvalsRunningReactive), []);
  const agentRunning = refineRunning || evalsRunningReactive;
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
        // Refine (streaming): cancel via session UUID from RefineSessionManager.
        const refineStore = useRefineStore.getState();
        if (refineStore.isRunning && refineStore.sessionId) {
          cancelRefineTurn(refineStore.sessionId).catch((err) => {
            console.error("[app-layout] escape: cancel refine failed", err);
            toast.error(`Failed to cancel agent: ${err instanceof Error ? err.message : String(err)}`, { duration: Infinity });
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
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  const [pendingSkillSwitch, setPendingSkillSwitch] = useState<string | null>(null);

  const pendingSkillSwitchTabRef = useRef<string | undefined>(undefined);

  const handleSelectSkill = useCallback(
    (name: string, tab?: string) => {
      // Guard: block skill switch while refine or evals are running
      if (name !== selectedWorkspaceSkillName) {
        const refineRunning = useRefineStore.getState().isRunning;
        const evalsRunning = getEvalsRunning();
        if (refineRunning || evalsRunning) {
          setPendingSkillSwitch(name);
          pendingSkillSwitchTabRef.current = tab;
          return;
        }
      }
      setSelectedWorkspaceSkillName(name);
      navigate({ to: "/", search: { tab: tab ?? undefined } });
    },
    [navigate, setSelectedWorkspaceSkillName, selectedWorkspaceSkillName],
  );

  const handleSkillSwitchStay = useCallback(() => {
    setPendingSkillSwitch(null);
  }, []);

  const handleSkillSwitchLeave = useCallback(() => {
    if (!pendingSkillSwitch) return;
    // Clean up running agents for the current skill
    if (selectedWorkspaceSkillName) {
      // Sidecar pool removed; cancellation via OpenHands server is handled by the workflow page's own cleanup.
    }
    useRefineStore.getState().clearSession();
    useAgentStore.getState().clearRuns();
    toast.info("Agent cancelled — skill switched");
    setSelectedWorkspaceSkillName(pendingSkillSwitch);
    const tab = pendingSkillSwitchTabRef.current;
    setPendingSkillSwitch(null);
    pendingSkillSwitchTabRef.current = undefined;
    navigate({ to: "/", search: { tab: tab ?? undefined } });
  }, [pendingSkillSwitch, selectedWorkspaceSkillName, setSelectedWorkspaceSkillName, navigate]);


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
