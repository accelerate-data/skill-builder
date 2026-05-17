import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useResetUsageMutation, useUsageQueries, useUsageSkillNamesQuery } from "@/lib/queries/usage";
import { createTestQueryClient } from "@/test/query-test-utils";
import { mockInvoke, mockInvokeCommands, resetTauriMocks } from "@/test/mocks/tauri";

function wrapper() {
  const queryClient = createTestQueryClient();
  return {
    queryClient,
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

const filters = {
  hideCancelled: false,
  startDate: null,
  skillFilter: null,
  modelFamilyFilter: null,
};

describe("usage queries", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("loads usage data through stable query keys", async () => {
    mockInvokeCommands({
      get_usage_summary: { total_cost: 1, total_runs: 2, avg_cost_per_run: 0.5 },
      get_recent_workflow_sessions: [],
      get_conversation_runs: [],
      get_usage_by_step: [],
      get_usage_by_model: [],
      get_usage_by_day: [],
    });
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useUsageQueries(filters), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.summary.isSuccess).toBe(true));
    expect(result.current.summary.data?.total_runs).toBe(2);
    expect(mockInvoke).toHaveBeenCalledWith("get_usage_summary", {
      hideCancelled: false,
      startDate: null,
      skillName: null,
    });
  });

  it("keeps stale usage responses from overwriting the latest filter result", async () => {
    const { Wrapper } = wrapper();
    let resolveOld!: (value: unknown) => void;
    const oldSummary = new Promise((resolve) => {
      resolveOld = resolve;
    });

    mockInvoke.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_usage_summary" && args.skillName === "old") return oldSummary;
      if (cmd === "get_usage_summary" && args.skillName === "new") {
        return Promise.resolve({ total_cost: 9, total_runs: 9, avg_cost_per_run: 1 });
      }
      return Promise.resolve([]);
    });

    const { result, rerender } = renderHook(
      ({ skillFilter }) => useUsageQueries({ ...filters, skillFilter }),
      { wrapper: Wrapper, initialProps: { skillFilter: "old" as string | null } },
    );

    rerender({ skillFilter: "new" });
    await waitFor(() => expect(result.current.summary.data?.total_runs).toBe(9));

    resolveOld({ total_cost: 1, total_runs: 1, avg_cost_per_run: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.current.summary.data?.total_runs).toBe(9);
  });

  it("invalidates usage queries after reset", async () => {
    mockInvokeCommands({ reset_usage: undefined });
    const { Wrapper, queryClient } = wrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useResetUsageMutation(), { wrapper: Wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["usage"] });
  });

  it("loads usage skill names", async () => {
    mockInvokeCommands({ get_workflow_skill_names: ["alpha"] });
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useUsageSkillNamesQuery(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data).toEqual(["alpha"]));
  });
});
