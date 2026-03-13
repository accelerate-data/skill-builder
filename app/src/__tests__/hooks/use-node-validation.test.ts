import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useNodeValidation } from "@/hooks/use-node-validation";
import { mockInvoke } from "@/test/mocks/tauri";

describe("useNodeValidation", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("returns deps on successful check", async () => {
    const mockDeps = { node_version: "v20.11.0", npm_version: "10.2.4" };
    mockInvoke.mockResolvedValue(mockDeps);

    const { result } = renderHook(() => useNodeValidation());

    // Initially checking
    expect(result.current.isChecking).toBe(true);

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.deps).toEqual(mockDeps);
    expect(result.current.error).toBeNull();
  });

  it("returns error on failed check", async () => {
    mockInvoke.mockRejectedValue(new Error("Node.js not found"));

    const { result } = renderHook(() => useNodeValidation());

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.deps).toBeNull();
    expect(result.current.error).toBe("Node.js not found");
  });

  it("returns fallback error message for non-Error rejections", async () => {
    mockInvoke.mockRejectedValue("something broke");

    const { result } = renderHook(() => useNodeValidation());

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.error).toBe("something broke");
  });

  it("retry re-invokes the check", async () => {
    mockInvoke
      .mockRejectedValueOnce(new Error("First attempt failed"))
      .mockResolvedValueOnce({ node_version: "v20.11.0", npm_version: "10.2.4" });

    const { result } = renderHook(() => useNodeValidation());

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

    expect(result.current.deps).toEqual({ node_version: "v20.11.0", npm_version: "10.2.4" });
    expect(result.current.error).toBeNull();
  });
});
