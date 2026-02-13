/**
 * E2E mock for @tauri-apps/plugin-dialog.
 * Returns a fake path when a dialog is opened or used to save.
 */
export async function open(_options?: Record<string, unknown>): Promise<string | null> {
  return "/tmp/test-workspace";
}

export async function save(_options?: Record<string, unknown>): Promise<string | null> {
  return "/tmp/test-workspace/export.skill";
}
