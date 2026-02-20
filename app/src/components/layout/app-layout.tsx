import { useEffect, useState } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { CloseGuard } from "@/components/close-guard";
import { SplashScreen } from "@/components/splash-screen";
import { SetupScreen } from "@/components/setup-screen";
import OrphanResolutionDialog from "@/components/orphan-resolution-dialog";
import { useSettingsStore } from "@/stores/settings-store";
import { useAuthStore } from "@/stores/auth-store";
import { getSettings, reconcileStartup } from "@/lib/tauri";
import type { OrphanSkill } from "@/lib/types";

export function AppLayout() {
  const setSettings = useSettingsStore((s) => s.setSettings);
  const isConfigured = useSettingsStore((s) => s.isConfigured);
  const navigate = useNavigate();
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const isSettings = currentPath === "/settings";
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [reconciled, setReconciled] = useState(false);
  const [splashDismissed, setSplashDismissed] = useState(false);
  const [nodeReady, setNodeReady] = useState(false);
  const [orphans, setOrphans] = useState<OrphanSkill[]>([]);

  // Hydrate settings store from Tauri backend on app startup
  useEffect(() => {
    getSettings().then((s) => {
      setSettings({
        anthropicApiKey: s.anthropic_api_key,
        workspacePath: s.workspace_path,
        skillsPath: s.skills_path,
        preferredModel: s.preferred_model,
        logLevel: s.log_level,
        extendedThinking: s.extended_thinking,
        githubOauthToken: s.github_oauth_token,
        githubUserLogin: s.github_user_login,
        githubUserAvatar: s.github_user_avatar,
        githubUserEmail: s.github_user_email,
        remoteRepoOwner: s.remote_repo_owner,
        remoteRepoName: s.remote_repo_name,
        dashboardViewMode: s.dashboard_view_mode,
      });
      setSettingsLoaded(true);
    }).catch(() => {
      // Settings may not exist yet — show splash
      setSettingsLoaded(true);
    });

    // Load GitHub auth state
    useAuthStore.getState().loadUser();
  }, [setSettings]);

  // Run reconciliation after settings are loaded
  useEffect(() => {
    if (!settingsLoaded) return;

    reconcileStartup()
      .then((result) => {
        // Show toasts for auto-cleaned skills
        if (result.auto_cleaned > 0) {
          toast.info(
            `Cleaned up ${result.auto_cleaned} incomplete skill${result.auto_cleaned !== 1 ? "s" : ""}`
          );
        }

        // Show toasts for reset notifications (DB-ahead-of-disk)
        for (const notification of result.notifications) {
          toast.warning(notification, { duration: 5000 });
        }

        // Set orphans for dialog
        if (result.orphans.length > 0) {
          setOrphans(result.orphans);
        }

        setReconciled(true);
      })
      .catch(() => {
        // Reconciliation failed (e.g., workspace not set up yet) — proceed anyway
        setReconciled(true);
      });
  }, [settingsLoaded]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+, (Mac) or Ctrl+, (Win/Linux) -> Settings
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        navigate({ to: "/settings" });
      }
      // Cmd+1 -> Dashboard
      if ((e.metaKey || e.ctrlKey) && e.key === "1") {
        e.preventDefault();
        navigate({ to: "/" });
      }
      // Cmd+2 -> Usage
      if ((e.metaKey || e.ctrlKey) && e.key === "2") {
        e.preventDefault();
        navigate({ to: "/usage" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  const ready = settingsLoaded && reconciled && nodeReady;

  return (
    <div className="flex h-screen overflow-hidden">
      {!isSettings && <Sidebar />}
      <div className="flex flex-1 flex-col overflow-hidden">
        {!isSettings && <Header />}
        <main className={`flex-1 overflow-y-auto${isSettings ? "" : " p-6"}`}>
          {ready && isConfigured ? <Outlet /> : null}
        </main>
      </div>
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
          open={orphans.length > 0}
          onResolved={() => setOrphans([])}
        />
      )}
    </div>
  );
}
