import { useRouter } from "@tanstack/react-router";
import { toast } from "@/lib/toast";
import { useSettingsStore } from "@/stores/settings-store";
import { checkMarketplaceUpdates, importMarketplaceToLibrary, checkSkillCustomized } from "@/lib/tauri";
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
      showManualUpdateToasts(library, workspace, router);
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

  const libFiltered = await filterNonCustomized(library);
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
export function showManualUpdateToasts(
  library: SkillUpdateInfo[],
  _workspace: SkillUpdateInfo[],
  router: ReturnType<typeof useRouter>,
): void {
  if (library.length > 0) {
    const names = library.map((s) => s.name);
    toast.info(
      `Dashboard: update available for ${library.length} skill${library.length !== 1 ? "s" : ""}: ${names.join(", ")}`,
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
