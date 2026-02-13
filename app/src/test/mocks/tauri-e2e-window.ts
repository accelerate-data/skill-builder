/**
 * E2E mock for @tauri-apps/api/window. This file is loaded via Vite alias
 * when TAURI_E2E=true, replacing the real Tauri window API.
 *
 * Only the APIs used by close-guard.tsx are mocked:
 * - getCurrentWindow().destroy()
 * - getCurrentWindow().close()
 */

interface MockWindow {
  close(): Promise<void>;
  destroy(): Promise<void>;
}

const mockWindow: MockWindow = {
  async close(): Promise<void> {
    // no-op in E2E mode
  },
  async destroy(): Promise<void> {
    // no-op in E2E mode
  },
};

export function getCurrentWindow(): MockWindow {
  return mockWindow;
}
