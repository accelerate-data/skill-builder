import { vi } from "vitest";

// Mock @tauri-apps/api/core
export const mockInvoke = vi.fn();
export const mockListen = vi.fn(() => Promise.resolve(() => {}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

// Mock @tauri-apps/api/window
export const mockGetCurrentWindow = vi.fn(() => ({
  close: vi.fn(() => Promise.resolve()),
  destroy: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: mockGetCurrentWindow,
}));

// Helper to configure invoke return values per command
export function mockInvokeCommand(
  command: string,
  returnValue: unknown
): void {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === command) return Promise.resolve(returnValue);
    return Promise.reject(new Error(`Unmocked command: ${cmd}`));
  });
}

// Helper to configure multiple command responses
export function mockInvokeCommands(
  commands: Record<string, unknown>
): void {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd in commands) return Promise.resolve(commands[cmd]);
    return Promise.reject(new Error(`Unmocked command: ${cmd}`));
  });
}

export function resetTauriMocks(): void {
  mockInvoke.mockReset();
  mockListen.mockReset().mockReturnValue(Promise.resolve(() => {}));
  mockGetCurrentWindow.mockClear();
}
