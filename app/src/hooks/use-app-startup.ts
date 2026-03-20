import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "@/lib/toast";
import { useSettingsStore } from "@/stores/settings-store";
import { useSkillStore } from "@/stores/skill-store";
import { useAuthStore } from "@/stores/auth-store";
import { getSettings, saveSettings, reconcileStartup, recordReconciliationCancel, listModels, listSkills } from "@/lib/tauri";
import type { DiscoveredSkill, OrphanSkill } from "@/lib/types";
import { checkForMarketplaceUpdates } from "./use-marketplace-updates";

interface StartupState {
  settingsLoaded: boolean;
  reconciled: boolean;
  orphans: OrphanSkill[];
  reconNotifications: string[];
  reconDiscovered: DiscoveredSkill[];
  ackDone: boolean;
  reconRequiresApply: boolean;
  reconApplying: boolean;
}

export interface UseAppStartupReturn extends StartupState {
  setOrphans: (orphans: OrphanSkill[]) => void;
  setAckDone: (done: boolean) => void;
  setReconNotifications: (notifications: string[]) => void;
  setReconDiscovered: (discovered: DiscoveredSkill[]) => void;
  setReconRequiresApply: (requires: boolean) => void;
  setReconApplying: (applying: boolean) => void;
  handleApplyReconciliation: () => Promise<void>;
  handleCancelReconciliation: () => void;
}

export function useAppStartup(): UseAppStartupReturn {
  const setSettings = useSettingsStore((s) => s.setSettings);
  const router = useRouter();

  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [reconciled, setReconciled] = useState(false);
  const [orphans, setOrphans] = useState<OrphanSkill[]>([]);
  const [reconNotifications, setReconNotifications] = useState<string[]>([]);
  const [reconDiscovered, setReconDiscovered] = useState<DiscoveredSkill[]>([]);
  const [ackDone, setAckDone] = useState(true);
  const [reconRequiresApply, setReconRequiresApply] = useState(false);
  const [reconApplying, setReconApplying] = useState(false);

  // Hydrate settings and run reconciliation in parallel on app startup.
  // Both read from SQLite/filesystem independently — no frontend data dependency.
  useEffect(() => {
    const cancelledRef = { current: false };

    // Settings load
    getSettings().then((s) => {
      if (cancelledRef.current) return;
      setSettings({
        anthropicApiKey: s.anthropic_api_key,
        workspacePath: s.workspace_path,
        skillsPath: s.skills_path,
        preferredModel: s.preferred_model,
        logLevel: s.log_level,
        extendedThinking: s.extended_thinking,
        interleavedThinkingBeta: s.interleaved_thinking_beta ?? true,
        sdkEffort: s.sdk_effort,
        fallbackModel: s.fallback_model,
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
      });
      setSettingsLoaded(true);
      // Fetch available models in the background — no need to await
      if (s.anthropic_api_key) {
        listModels(s.anthropic_api_key)
          .then((models) => { if (!cancelledRef.current) setSettings({ availableModels: models }); })
          .catch((err) => console.warn("[app-layout] Could not fetch model list:", err));
      }
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
        if (result.notifications.length > 0 || result.discovered_skills.length > 0) {
          console.warn(
            "[app-layout] Reconciliation preview produced %d notifications, %d discovered skills",
            result.notifications.length,
            result.discovered_skills.length,
          );
          setReconNotifications(result.notifications);
          setReconDiscovered(result.discovered_skills);
          setReconRequiresApply(true);
          setAckDone(false);
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

    // Load GitHub auth state
    useAuthStore.getState().loadUser();

    return () => { cancelledRef.current = true; };
  }, [setSettings]);

  const handleApplyReconciliation = async () => {
    if (!reconRequiresApply) {
      setAckDone(true);
      setReconNotifications([]);
      setReconDiscovered([]);
      return;
    }
    try {
      setReconApplying(true);
      const applied = await reconcileStartup(true);
      if (applied.auto_cleaned > 0) {
        toast.info(
          `Cleaned up ${applied.auto_cleaned} incomplete skill${applied.auto_cleaned !== 1 ? "s" : ""}`
        );
      }
      if (applied.orphans.length > 0) {
        setOrphans(applied.orphans);
      }
      // Refresh skill list so sidebar status dots and navigation reflect
      // any workflow resets performed by reconciliation.
      const wp = useSettingsStore.getState().workspacePath;
      if (wp) {
        listSkills(wp)
          .then((skills) => useSkillStore.getState().setSkills(skills))
          .catch((err) => console.warn("[app-layout] op=refresh_skills_after_recon status=failure err=%s", err));
      }
      setAckDone(true);
      setReconNotifications([]);
      setReconDiscovered([]);
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
    recordReconciliationCancel(reconNotifications.length, reconDiscovered.length)
      .catch(() => undefined);
    toast.info("Startup reconciliation skipped. No automatic changes were applied.");
    setAckDone(true);
    setReconNotifications([]);
    setReconDiscovered([]);
    setReconRequiresApply(false);
  };

  return {
    settingsLoaded,
    reconciled,
    orphans,
    reconNotifications,
    reconDiscovered,
    ackDone,
    reconRequiresApply,
    reconApplying,
    setOrphans,
    setAckDone,
    setReconNotifications,
    setReconDiscovered,
    setReconRequiresApply,
    setReconApplying,
    handleApplyReconciliation,
    handleCancelReconciliation,
  };
}
