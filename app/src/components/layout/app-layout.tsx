import { useEffect, useState } from "react";
import { Outlet, useNavigate, useRouterState, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { CloseGuard } from "@/components/close-guard";
import { SplashScreen } from "@/components/splash-screen";
import { SetupScreen } from "@/components/setup-screen";
import OrphanResolutionDialog from "@/components/orphan-resolution-dialog";
import ReconciliationAckDialog from "@/components/reconciliation-ack-dialog";
import { useSettingsStore } from "@/stores/settings-store";
import { useAuthStore } from "@/stores/auth-store";
import { getSettings, saveSettings, reconcileStartup, parseGitHubUrl, checkMarketplaceUpdates, importGitHubSkills, importMarketplaceToLibrary, checkSkillCustomized } from "@/lib/tauri";
import { invoke } from "@tauri-apps/api/core";
import type { ModelInfo } from "@/stores/settings-store";
import type { AppSettings, DiscoveredSkill, OrphanSkill, SkillUpdateInfo } from "@/lib/types";

/** Filter out customized skills, returning only those safe to auto-update. */
async function filterNonCustomized(skills: SkillUpdateInfo[]): Promise<SkillUpdateInfo[]> {
  const results = await Promise.all(
    skills.map(async (skill) => {
      const customized = await checkSkillCustomized(skill.name).catch(() => false);
      return customized ? null : skill;
    })
  );
  return results.filter((s): s is SkillUpdateInfo => s !== null);
}

/** Check the marketplace for updates and either auto-update or show notification toasts.
 *  Returns the registry name read from marketplace.json, or null on failure. */
async function checkForMarketplaceUpdates(
  sourceUrl: string,
  settings: AppSettings,
  cancelledRef: { current: boolean },
  router: ReturnType<typeof useRouter>,
): Promise<string | null> {
  try {
    const info = await parseGitHubUrl(sourceUrl);
    const { library, workspace, registry_name } = await checkMarketplaceUpdates(
      info.owner, info.repo, info.branch, info.subpath ?? undefined, sourceUrl
    );
    if (cancelledRef.current) return null;

    if (settings.auto_update) {
      await handleAutoUpdate(library, workspace, sourceUrl, info, cancelledRef);
    } else {
      showManualUpdateToasts(library, workspace, router, registry_name ?? null);
    }
    return registry_name ?? null;
  } catch (err) {
    console.error("[app-layout] Marketplace update check failed:", err);
    toast.error(
      `Marketplace update check failed: ${err instanceof Error ? err.message : String(err)}`,
      { duration: 8000 }
    );
    return null;
  }
}

/** Auto-update non-customized skills silently and show a summary toast. */
async function handleAutoUpdate(
  library: SkillUpdateInfo[],
  workspace: SkillUpdateInfo[],
  sourceUrl: string,
  info: { owner: string; repo: string; branch: string },
  cancelledRef: { current: boolean },
): Promise<void> {
  const [libFiltered, wsFiltered] = await Promise.all([
    filterNonCustomized(library),
    filterNonCustomized(workspace),
  ]);
  if (cancelledRef.current) return;

  await Promise.all([
    libFiltered.length > 0
      ? importMarketplaceToLibrary(libFiltered.map((s) => s.path), sourceUrl).catch((err) =>
          console.warn("[app-layout] Auto-update library failed:", err)
        )
      : Promise.resolve(),
    wsFiltered.length > 0
      ? importGitHubSkills(
          info.owner, info.repo, info.branch,
          wsFiltered.map((s) => ({ path: s.path, purpose: null, metadata_override: null, version: s.version })),
          sourceUrl
        ).catch((err) =>
          console.warn("[app-layout] Auto-update workspace failed:", err)
        )
      : Promise.resolve(),
  ]);
  if (cancelledRef.current) return;

  const total = libFiltered.length + wsFiltered.length;
  if (total > 0) {
    toast.success(
      <div className="space-y-1">
        <p className="font-medium">Auto-updated {total} skill{total !== 1 ? "s" : ""}</p>
        {libFiltered.length > 0 && (
          <p>• Skills Library: {libFiltered.map((s) => s.name).join(", ")}</p>
        )}
        {wsFiltered.length > 0 && (
          <p>• Workspace: {wsFiltered.map((s) => s.name).join(", ")}</p>
        )}
      </div>,
      { duration: Infinity }
    );
  }
}

/** Show persistent notification toasts for available skill updates. */
function showManualUpdateToasts(
  library: SkillUpdateInfo[],
  workspace: SkillUpdateInfo[],
  router: ReturnType<typeof useRouter>,
  registryName: string | null,
): void {
  const qualify = (name: string) => registryName ? `${registryName}::${name}` : name;
  if (library.length > 0) {
    const names = library.map((s) => qualify(s.name));
    toast.info(
      `Skills Library: update available for ${library.length} skill${library.length !== 1 ? "s" : ""}: ${names.join(", ")}`,
      {
        duration: Infinity,
        action: {
          label: "Upgrade",
          onClick: () => {
            useSettingsStore.getState().setPendingUpgradeOpen({ mode: "skill-library", skills: names });
            router.navigate({ to: "/" });
          },
        },
      }
    );
  }
  if (workspace.length > 0) {
    const names = workspace.map((s) => qualify(s.name));
    toast.info(
      `Settings \u2192 Skills: update available for ${workspace.length} skill${workspace.length !== 1 ? "s" : ""}: ${names.join(", ")}`,
      {
        duration: Infinity,
        action: {
          label: "Upgrade",
          onClick: () => {
            useSettingsStore.getState().setPendingUpgradeOpen({ mode: "settings-skills", skills: names });
            router.navigate({ to: "/settings" });
          },
        },
      }
    );
  }
}

export function AppLayout() {
  const setSettings = useSettingsStore((s) => s.setSettings);
  const isConfigured = useSettingsStore((s) => s.isConfigured);
  const navigate = useNavigate();
  const router = useRouter();
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const isSettings = currentPath === "/settings";
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [reconciled, setReconciled] = useState(false);
  const [splashDismissed, setSplashDismissed] = useState(false);
  const [nodeReady, setNodeReady] = useState(false);
  const [orphans, setOrphans] = useState<OrphanSkill[]>([]);
  const [reconNotifications, setReconNotifications] = useState<string[]>([]);
  const [reconDiscovered, setReconDiscovered] = useState<DiscoveredSkill[]>([]);
  const [ackDone, setAckDone] = useState(true);

  // Hydrate settings store from Tauri backend on app startup
  useEffect(() => {
    const cancelledRef = { current: false };

    getSettings().then((s) => {
      if (cancelledRef.current) return;
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
        marketplaceRegistries: s.marketplace_registries ?? [],
        marketplaceInitialized: s.marketplace_initialized ?? false,
        dashboardViewMode: s.dashboard_view_mode,
      });
      setSettingsLoaded(true);
      // Fetch available models in the background — no need to await
      if (s.anthropic_api_key) {
        invoke<ModelInfo[]>("list_models", { apiKey: s.anthropic_api_key })
          .then((models) => { if (!cancelledRef.current) setSettings({ availableModels: models }); })
          .catch((err) => console.warn("[app-layout] Could not fetch model list:", err));
      }
      // Check for marketplace updates in the background, and refresh stored registry names
      // from marketplace.json if they have changed since the registry was added.
      const enabledRegistries = (s.marketplace_registries ?? []).filter(r => r.enabled);
      for (const registry of enabledRegistries) {
        checkForMarketplaceUpdates(registry.source_url, s, cancelledRef, router)
          .then(async (resolvedName) => {
            if (!resolvedName || resolvedName === registry.name) return;
            const current = useSettingsStore.getState().marketplaceRegistries;
            const updated = current.map(r =>
              r.source_url === registry.source_url ? { ...r, name: resolvedName } : r
            );
            useSettingsStore.getState().setSettings({ marketplaceRegistries: updated });
            // Re-fetch fresh settings before saving to avoid overwriting concurrent changes.
            const fresh = await getSettings().catch(() => null);
            if (!fresh) return;
            saveSettings({ ...fresh, marketplace_registries: updated })
              .catch(err => console.warn("[app-layout] Failed to persist registry name update:", err));
          });
      }
    }).catch(() => {
      // Settings may not exist yet — show splash
      if (!cancelledRef.current) setSettingsLoaded(true);
    });

    // Load GitHub auth state
    useAuthStore.getState().loadUser();

    return () => { cancelledRef.current = true; };
  }, [setSettings]);

  // Run reconciliation after settings are loaded
  useEffect(() => {
    if (!settingsLoaded) return;

    reconcileStartup()
      .then((result) => {
        // Show toast for auto-cleaned skills (informational, not blocking)
        if (result.auto_cleaned > 0) {
          toast.info(
            `Cleaned up ${result.auto_cleaned} incomplete skill${result.auto_cleaned !== 1 ? "s" : ""}`
          );
        }

        // Block dashboard with ACK dialog if there are notifications or discovered skills
        if (result.notifications.length > 0 || result.discovered_skills.length > 0) {
          console.warn(
            "[app-layout] Reconciliation produced %d notifications, %d discovered skills",
            result.notifications.length,
            result.discovered_skills.length,
          );
          setReconNotifications(result.notifications);
          setReconDiscovered(result.discovered_skills);
          setAckDone(false);
        }

        // Set orphans for dialog
        if (result.orphans.length > 0) {
          setOrphans(result.orphans);
        }

        setReconciled(true);
      })
      .catch((err) => {
        // Reconciliation failed (e.g., workspace not set up yet) — proceed anyway
        console.warn("[app-layout] Reconciliation failed:", err);
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

  const ready = settingsLoaded && reconciled && nodeReady && ackDone;

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
          open
          onResolved={() => setOrphans([])}
        />
      )}
      {!ackDone && (
        <ReconciliationAckDialog
          notifications={reconNotifications}
          discoveredSkills={reconDiscovered}
          open
          onAcknowledge={() => {
            setAckDone(true);
            setReconNotifications([]);
            setReconDiscovered([]);
          }}
        />
      )}
    </div>
  );
}
