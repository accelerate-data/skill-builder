import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDebug = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve());
const mockWarn = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve());
const mockError = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve());

const mockSonnerToast = {
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(() => "toast-id"),
  dismiss: vi.fn(),
};

vi.mock("@tauri-apps/plugin-log", () => ({
  debug: mockDebug,
  warn: mockWarn,
  error: mockError,
}));

vi.mock("sonner", () => ({
  toast: mockSonnerToast,
}));

describe("toast wrapper", () => {
  beforeEach(() => {
    mockDebug.mockClear();
    mockWarn.mockClear();
    mockError.mockClear();
    mockSonnerToast.warning.mockClear();
    mockSonnerToast.error.mockClear();
  });

  it("logs debug + forwards toast.error (strips cause/context from sonner options)", async () => {
    vi.resetModules();
    vi.unmock("@/lib/toast");

    const { toast } = await import("@/lib/toast");
    const cause = new Error("boom");

    toast.error("Something failed", { duration: Infinity, cause, context: { operation: "test_op" } });

    expect(mockSonnerToast.error).toHaveBeenCalledWith("Something failed", { duration: Infinity });
    expect(mockDebug).toHaveBeenCalledTimes(1);

    const line = mockDebug.mock.calls[0]?.[0];
    expect(line).toBeDefined();
    expect(String(line)).toContain("toast_shown");
    expect(String(line)).toContain("Something failed");
    expect(String(line)).toContain("boom");
    expect(String(line)).toContain("test_op");
  });

  it("logs debug + forwards toast.warning", async () => {
    vi.resetModules();
    vi.unmock("@/lib/toast");

    const { toast } = await import("@/lib/toast");

    toast.warning("Heads up", { duration: Infinity, context: { operation: "warn_op" } });

    expect(mockSonnerToast.warning).toHaveBeenCalledWith("Heads up", { duration: Infinity });
    expect(mockDebug).toHaveBeenCalledTimes(1);
    const line = mockDebug.mock.calls[0]?.[0];
    expect(line).toBeDefined();
    expect(String(line)).toContain("Heads up");
  });
});

