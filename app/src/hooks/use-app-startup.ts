import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { useSettingsStore } from "@/stores/settings-store";
import { getSettings, saveSettings, reconcileStartup, recordReconciliationCancel, refreshModelCatalog } from "@/lib/tauri";
import type { AppSettings, ModelSettings, OrphanSkill } from "@/lib/types";
import { checkForMarketplaceUpdates } from "./use-marketplace-updates";
import { queryKeys } from "@/lib/queries/query-keys";
import { fetchGithubUser } from "@/lib/queries/auth";

interface StartupState {
  settingsLoaded: boolean;
  reconciled: boolean;
  orphans: OrphanSkill[];
  reconNotifications: string[];
  ackDone: boolean;
  reconRequiresApply: boolean;
  reconApplying: boolean;
}

export interface UseAppStartupReturn extends StartupState {
  setOrphans: (orphans: OrphanSkill[]) => void;
  setAckDone: (done: boolean) => void;
  setReconNotifications: (notifications: string[]) => void;
  setReconRequiresApply: (requires: boolean) => void;
  setReconApplying: (applying: boolean) => void;
  handleApplyReconciliation: () => Promise<void>;
  handleCancelReconciliation: () => void;
}

export function settingsToStorePatch(s: AppSettings) {
  const modelSettings: ModelSettings = {
    provider_id: s.model_settings?.provider_id ?? null,
    model_id: s.model_settings?.model_id ?? null,
    provider_overrides: s.model_settings?.provider_overrides ?? {},
  };

  return {
    modelSettings,
    workspacePath: s.workspace_path,
    skillsPath: s.skills_path,
    logLevel: s.log_level,
    refinePromptSuggestions: s.refine_prompt_suggestions ?? true,
    maxDimensions: s.max_dimensions ?? 5,
    industry: s.industry,
    functionRole: s.function_role,
    autoUpdate: s.auto_update ?? false,
    githubOauthToken: s.github_oauth_token,
    githubUserLogin: s.github_user_login,
    githubUserAvatar: s.github_user_avatar,
    githubUserEmail: s.github_user_email,
    marketplaceRegistries: s.marketplace_registries ?? [],
    marketplaceInitialized: s.marketplace_initialized ?? false,
    dashboardViewMode: s.dashboard_view_mode,
  };
}

export function useAppStartup(): UseAppStartupReturn {
  const setSettings = useSettingsStore((s) => s.setSettings);
  const router = useRouter();
  const queryClient = useQueryClient();

  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [reconciled, setReconciled] = useState(false);
  const [orphans, setOrphans] = useState<OrphanSkill[]>([]);
  const [reconNotifications, setReconNotifications] = useState<string[]>([]);
  const [ackDone, setAckDone] = useState(true);
  const [reconRequiresApply, setReconRequiresApply] = useState(false);
  const [reconApplying, setReconApplying] = useState(false);

  // Hydrate settings and run reconciliation in parallel on app startup.
  // Both read from SQLite/filesystem independently — no frontend data dependency.
  useEffect(() => {
    const cancelledRef = { current: false };

    refreshModelCatalog().catch((err) => {
      if (cancelledRef.current) return;
      console.warn("[app-layout] model catalog refresh failed:", err);
    });

    // Settings load
    getSettings().then((s) => {
      if (cancelledRef.current) return;
      setSettings(settingsToStorePatch(s));
      setSettingsLoaded(true);
      // Check for marketplace updates in the background, and refresh stored registry names
      // from marketplace.json if they have changed since the registry was added.
      const enabledRegistries = (s.marketplace_registries ?? []).filter(r => r.enabled);
      if (enabledRegistries.length > 0) {
        checkForMarketplaceUpdates(s, cancelledRef, router)
          .then(async (resolvedNamesBySource) => {
            if (resolvedNamesBySource.size === 0) return;
            const current = useSettingsStore.getState().marketplaceRegistries;
            let changed = false;
            const updated = current.map((registry) => {
              const resolved = resolvedNamesBySource.get(registry.source_url);
              if (!resolved || resolved === registry.name) return registry;
              changed = true;
              return { ...registry, name: resolved };
            });
            if (!changed) return;
            useSettingsStore.getState().setSettings({ marketplaceRegistries: updated });
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

    // Reconciliation — fires concurrently with settings (reads its own config from SQLite)
    reconcileStartup()
      .then((result) => {
        if (cancelledRef.current) return;
        if (result.notifications.length > 0) {
          reconcileStartup(true)
            .then((applied) => {
              if (cancelledRef.current) return;
              queryClient.invalidateQueries({ queryKey: queryKeys.skills.all }).catch((err) =>
                console.warn("[app-layout] op=refresh_skills_after_auto_recon status=failure err=%s", err),
              );
              if (applied.orphans.length > 0) {
                setOrphans(applied.orphans);
              }
              setReconciled(true);
            })
            .catch((err) => {
              console.warn("[app-layout] auto-apply reconciliation failed:", err);
              setReconciled(true);
            });
          return;
        }

        if (result.orphans.length > 0) {
          setOrphans(result.orphans);
        }

        setReconciled(true);
      })
      .catch((err) => {
        console.warn("[app-layout] Reconciliation failed:", err);
        if (!cancelledRef.current) setReconciled(true);
      });

    queryClient.prefetchQuery({
      queryKey: queryKeys.auth.githubUser,
      queryFn: fetchGithubUser,
    }).catch((err: unknown) => {
      console.warn("[app-layout] op=prefetch_github_user status=failure err=%s", err);
    });

    return () => { cancelledRef.current = true; };
  }, [queryClient, router, setSettings]);

  const handleApplyReconciliation = async () => {
    if (!reconRequiresApply) {
      setAckDone(true);
      setReconNotifications([]);
      return;
    }
    try {
      setReconApplying(true);
      const applied = await reconcileStartup(true);
      if (applied.auto_cleaned > 0) {
        toast.info(
          `Cleaned up ${applied.auto_cleaned} incomplete skill${applied.auto_cleaned !== 1 ? "s" : ""}`,
        );
      }
      if (applied.orphans.length > 0) {
        setOrphans(applied.orphans);
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.skills.all }).catch((err) =>
        console.warn("[app-layout] op=refresh_skills_after_recon status=failure err=%s", err),
      );
      setAckDone(true);
      setReconNotifications([]);
      setReconRequiresApply(false);
    } catch (err) {
      toast.error(
        `Failed to apply startup reconciliation: ${err instanceof Error ? err.message : String(err)}`,
        { duration: Infinity }
      );
    } finally {
      setReconApplying(false);
    }
  };

  const handleCancelReconciliation = () => {
    recordReconciliationCancel(reconNotifications.length)
      .catch(() => undefined);
    setAckDone(true);
    setReconNotifications([]);
    setReconRequiresApply(false);
  };

  return {
    settingsLoaded,
    reconciled,
    orphans,
    reconNotifications,
    ackDone,
    reconRequiresApply,
    reconApplying,
    setOrphans,
    setAckDone,
    setReconNotifications,
    setReconRequiresApply,
    setReconApplying,
    handleApplyReconciliation,
    handleCancelReconciliation,
  };
}
