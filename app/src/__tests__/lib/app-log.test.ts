import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDebug = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve());
const mockWarn = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve());
const mockError = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve());

vi.mock("@tauri-apps/plugin-log", () => ({
  debug: mockDebug,
  warn: mockWarn,
  error: mockError,
}));

describe("app-log", () => {
  beforeEach(() => {
    mockDebug.mockClear();
    mockWarn.mockClear();
    mockError.mockClear();
  });

  it("redacts nested apiKey variants", async () => {
    vi.resetModules();
    const { logDebug } = await import("@/lib/app-log");

    logDebug("evt", {
      context: {
        apiKey: "sk-ant-supersecret",
        api_key: "sk-ant-supersecret",
        "api-key": "sk-ant-supersecret",
        nested: { apikey: "sk-ant-supersecret" },
      },
    });

    expect(mockDebug).toHaveBeenCalledTimes(1);
    const line = String(mockDebug.mock.calls[0]?.[0] ?? "");
    expect(line).not.toContain("sk-ant-supersecret");
    // Values may be fully redacted or masked (abcd…wxyz). Either is acceptable.
    expect(line.includes("[REDACTED]") || line.includes("…")).toBe(true);
  });

  it("does not silently drop on plugin-log rejection (warns to console)", async () => {
    vi.resetModules();
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockDebug.mockImplementationOnce(() => Promise.reject(new Error("write failed")));

    const { logDebug } = await import("@/lib/app-log");
    logDebug("evt", { ok: true });

    // Allow promise rejection handler to run
    await Promise.resolve();

    expect(consoleWarn).toHaveBeenCalled();
    consoleWarn.mockRestore();
  });
});

