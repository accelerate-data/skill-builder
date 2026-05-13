import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useStartupValidation } from "@/hooks/use-node-validation";
import { mockInvoke } from "@/test/mocks/tauri";

describe("useStartupValidation", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("returns deps on successful check", async () => {
    const mockDeps = {
      all_ok: true,
      checks: [
        { code: "openhands_agent_server", name: "OpenHands Agent Server", ok: true, detail: "available" },
        { code: "git_binary", name: "Git", ok: true, detail: "git version 2.49.0" },
      ],
    };
    mockInvoke.mockResolvedValue(mockDeps);

    const { result } = renderHook(() => useStartupValidation());

    // Initially checking
    expect(result.current.isChecking).toBe(true);

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.deps).toEqual(mockDeps);
    expect(result.current.error).toBeNull();
  });

  it("returns error on failed check", async () => {
    mockInvoke.mockRejectedValue(new Error("Startup dependency check failed"));

    const { result } = renderHook(() => useStartupValidation());

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.deps).toBeNull();
    expect(result.current.error).toBe("Startup dependency check failed");
  });

  it("returns fallback error message for non-Error rejections", async () => {
    mockInvoke.mockRejectedValue("something broke");

    const { result } = renderHook(() => useStartupValidation());

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.error).toBe("something broke");
  });

  it("retry re-invokes the check", async () => {
    mockInvoke
      .mockRejectedValueOnce(new Error("First attempt failed"))
      .mockResolvedValueOnce({
        all_ok: true,
        checks: [
          { code: "openhands_agent_server", name: "OpenHands Agent Server", ok: true, detail: "available" },
          { code: "git_binary", name: "Git", ok: true, detail: "git version 2.49.0" },
        ],
      });

    const { result } = renderHook(() => useStartupValidation());

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.error).toBe("First attempt failed");

    // Retry
    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.deps).toEqual({
      all_ok: true,
      checks: [
        { code: "openhands_agent_server", name: "OpenHands Agent Server", ok: true, detail: "available" },
        { code: "git_binary", name: "Git", ok: true, detail: "git version 2.49.0" },
      ],
    });
    expect(result.current.error).toBeNull();
  });
});
