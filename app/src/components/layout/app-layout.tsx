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
import { useSkillStore } from "@/stores/skill-store";
import { useImportedSkillsStore } from "@/stores/imported-skills-store";
import { useAgentStore } from "@/stores/agent-store";
import { useAppStartup } from "@/hooks/use-app-startup";
import { cancelAgentRun } from "@/lib/tauri";

export function AppLayout() {
  const isConfigured = useSettingsStore((s) => s.isConfigured);
  const builderSkills = useSkillStore((s) => s.skills);
  const selectedWorkspaceSkillName = useSkillStore((s) => s.activeSkill);
  const setSelectedWorkspaceSkillName = useSkillStore((s) => s.setActiveSkill);
  const importedSkills = useImportedSkillsStore((s) => s.skills);
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
        const runs = useAgentStore.getState().runs;
        const running = Object.values(runs).find(
          (r): r is typeof r & { skillName: string; sessionId: string } =>
            r.status === "running" && !!r.skillName && !!r.sessionId,
        );
        if (running) {
          cancelAgentRun(running.skillName, running.sessionId).catch((err) => {
            console.error("[app-layout] escape: cancel failed", err);
          });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  const handleSelectSkill = useCallback(
    (name: string) => {
      setSelectedWorkspaceSkillName(name);
      navigate({ to: "/", search: { tab: undefined } });
    },
    [navigate, setSelectedWorkspaceSkillName],
  );

  const selectedBuilderSkill = builderSkills.find(
    (s) => s.skill_source === "skill-builder" && (s.library_key ?? s.name) === selectedWorkspaceSkillName,
  );
  const selectedImportedSkill = importedSkills.find(
    (s) => (s.library_key ?? `imported:${s.skill_id}`) === selectedWorkspaceSkillName,
  );
  const selectedSkillData = selectedBuilderSkill ?? selectedImportedSkill ?? null;
  const selectedSkillType: "builder" | "imported" | "marketplace" = selectedBuilderSkill
    ? selectedBuilderSkill.skill_source === "marketplace" || !!selectedImportedSkill?.marketplace_source_url
      ? "marketplace"
      : selectedImportedSkill && !selectedImportedSkill.marketplace_source_url
        ? "imported"
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
