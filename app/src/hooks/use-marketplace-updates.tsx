import { useRouter } from "@tanstack/react-router";
import { toast } from "@/lib/toast";
import { useSettingsStore } from "@/stores/settings-store";
import { checkMarketplaceUpdates, importMarketplaceToLibrary, checkSkillCustomized, listPlugins } from "@/lib/tauri";
import type { AppSettings, SkillUpdateInfo } from "@/lib/types";

/** Filter out customized skills, returning only those safe to auto-update. */
export async function filterNonCustomized(skills: SkillUpdateInfo[]): Promise<SkillUpdateInfo[]> {
  const results = await Promise.all(
    skills.map(async (skill) => {
      const customized = await checkSkillCustomized(skill.name).catch(() => false);
      return customized ? null : skill;
    })
  );
  return results.filter((s): s is SkillUpdateInfo => s !== null);
}

/**
 * Filter out skills belonging to upgrade-locked plugins.
 * Compares skill.source_url against each locked plugin's source_url.
 */
export async function filterUpgradeLockedPlugins(skills: SkillUpdateInfo[]): Promise<SkillUpdateInfo[]> {
  const plugins = (await listPlugins().catch(() => [])) ?? [];
  const lockedSourceUrls = new Set(
    plugins
      .filter((p) => p.upgrade_locked && p.source_url)
      .map((p) => p.source_url as string)
  );
  if (lockedSourceUrls.size === 0) return skills;
  return skills.filter((s) => !s.source_url || !lockedSourceUrls.has(s.source_url));
}

/** Check the marketplace for updates and either auto-update or show notification toasts.
 *  Returns registry names read from marketplace.json keyed by source URL. */
export async function checkForMarketplaceUpdates(
  settings: AppSettings,
  cancelledRef: { current: boolean },
  router: ReturnType<typeof useRouter>,
): Promise<Map<string, string>> {
  try {
    const { library, workspace, registry_names } = await checkMarketplaceUpdates();
    if (cancelledRef.current) return new Map();

    if (settings.auto_update) {
      await handleAutoUpdate(library, workspace, cancelledRef);
    } else {
      await showManualUpdateToasts(library, workspace, router);
    }
    const bySource = new Map<string, string>();
    for (const entry of registry_names ?? []) {
      bySource.set(entry.source_url, entry.registry_name);
    }
    return bySource;
  } catch (err) {
    console.error("[app-layout] Marketplace update check failed:", err);
    toast.error(
      `Marketplace update check failed: ${err instanceof Error ? err.message : String(err)}`,
      { duration: Infinity }
    );
    return new Map();
  }
}

/** Auto-update non-customized skills silently and show a summary toast. */
export async function handleAutoUpdate(
  library: SkillUpdateInfo[],
  _workspace: SkillUpdateInfo[],
  cancelledRef: { current: boolean },
): Promise<void> {
  const groupBySource = (skills: SkillUpdateInfo[]): Map<string, SkillUpdateInfo[]> => {
    const grouped = new Map<string, SkillUpdateInfo[]>();
    for (const skill of skills) {
      const sourceUrl = skill.source_url?.trim();
      if (!sourceUrl) continue;
      const existing = grouped.get(sourceUrl) ?? [];
      existing.push(skill);
      grouped.set(sourceUrl, existing);
    }
    return grouped;
  };

  const libFiltered = await filterNonCustomized(await filterUpgradeLockedPlugins(library));
  if (cancelledRef.current) return;

  const libBySource = groupBySource(libFiltered);

  await Promise.all(
    Array.from(libBySource.entries()).map(async ([sourceUrl, scoped]) => {
      await importMarketplaceToLibrary(scoped.map((s) => s.path), sourceUrl).catch((err) =>
        console.warn("[app-layout] Auto-update library failed:", err)
      );
    }),
  );
  if (cancelledRef.current) return;

  if (libFiltered.length > 0) {
    toast.success(
      <div className="space-y-1">
        <p className="font-medium">Auto-updated {libFiltered.length} skill{libFiltered.length !== 1 ? "s" : ""}</p>
        <p>• Dashboard: {libFiltered.map((s) => s.name).join(", ")}</p>
      </div>,
      { duration: Infinity }
    );
  }
}

/** Show persistent notification toasts for available skill updates. */
export async function showManualUpdateToasts(
  library: SkillUpdateInfo[],
  _workspace: SkillUpdateInfo[],
  router: ReturnType<typeof useRouter>,
): Promise<void> {
  const upgradeableLibrary = await filterUpgradeLockedPlugins(library);
  if (upgradeableLibrary.length > 0) {
    const names = upgradeableLibrary.map((s) => s.name);
    toast.info(
      `Dashboard: update available for ${upgradeableLibrary.length} skill${upgradeableLibrary.length !== 1 ? "s" : ""}: ${names.join(", ")}`,
      {
        duration: Infinity,
        action: {
          label: "Upgrade",
          onClick: () => {
            useSettingsStore.getState().setPendingUpgradeOpen({ skills: names });
            router.navigate({ to: "/settings" });
          },
        },
      }
    );
  }
}
