import type { Page } from "@playwright/test";

/**
 * Wait for the app to be fully ready by waiting for the splash screen to
 * appear and then be removed from the DOM. Also waits for setup screen
 * to be removed if it appears (only shows when settings are unconfigured).
 *
 * The splash screen runs startup dependency checks (~1s mock delay),
 * then fades out over 500ms before being unmounted. Total: ~1.5s.
 */
export async function waitForAppReady(page: Page) {
  const splash = page.getByTestId("splash-screen");
  // Wait for splash to mount (proves React has rendered)
  await splash.waitFor({ state: "attached", timeout: 5_000 });
  // Wait for splash to be unmounted (app is ready)
  await splash.waitFor({ state: "detached", timeout: 10_000 });

  // Wait for setup screen to finish if it appears (unconfigured settings).
  // Uses 'hidden' state which handles both never-mounted and mounted-then-dismissed.
  await page.waitForSelector('[data-testid="setup-screen"]', {
    state: "hidden",
    timeout: 15_000,
  }).catch(() => {});
}
