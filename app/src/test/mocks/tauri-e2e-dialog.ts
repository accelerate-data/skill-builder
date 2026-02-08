/**
 * E2E mock for @tauri-apps/plugin-dialog.
 * Returns a fake path when the folder dialog is opened.
 */
export async function open(_options?: Record<string, unknown>): Promise<string | null> {
  return "/tmp/test-workspace";
}
