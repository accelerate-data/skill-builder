import type { Page } from "@playwright/test";

interface TrackedInvoke {
  cmd: string;
  args: Record<string, unknown>;
}

export async function trackInvokes(page: Page, commands: string[]): Promise<void> {
  await page.evaluate((cmds) => {
    const w = window as unknown as Record<string, unknown>;
    w.__TAURI_TRACK_INVOKES__ = cmds;
    w.__TAURI_TRACKED_INVOKES__ = [];
  }, commands);
}

export async function getTrackedInvokes(
  page: Page,
  cmd: string,
): Promise<TrackedInvoke[]> {
  const all = await page.evaluate(() => {
    return ((window as unknown as Record<string, unknown>).__TAURI_TRACKED_INVOKES__ ?? []) as TrackedInvoke[];
  });
  return all.filter((entry) => entry.cmd === cmd);
}

export async function getTrackedInvokeCount(
  page: Page,
  cmd: string,
): Promise<number> {
  const calls = await getTrackedInvokes(page, cmd);
  return calls.length;
}
