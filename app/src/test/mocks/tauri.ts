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

export const mockDialogSave = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: mockDialogSave,
}));

// Mock @tauri-apps/plugin-opener
export const mockRevealItemInDir = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: mockRevealItemInDir,
  openPath: vi.fn(() => Promise.resolve()),
  openUrl: vi.fn(() => Promise.resolve()),
}));

// Mock @tauri-apps/plugin-log
vi.mock("@tauri-apps/plugin-log", () => ({
  attachConsole: vi.fn(() => Promise.resolve(() => {})),
}));

// Mock @tauri-apps/api/app
export const mockGetVersion = vi.fn(() => Promise.resolve("0.1.0"));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: mockGetVersion,
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
  mockDialogSave.mockReset();
  mockGetVersion.mockReset().mockReturnValue(Promise.resolve("0.1.0"));
  mockRevealItemInDir.mockReset().mockReturnValue(Promise.resolve());
}
