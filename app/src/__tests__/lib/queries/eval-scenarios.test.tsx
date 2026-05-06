import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  evalScenarioKeys,
  useSaveScenario,
} from "@/lib/queries/eval-scenarios";
import { createTestQueryClient } from "@/test/query-test-utils";

const mockSaveScenario = vi.fn();

vi.mock("@/lib/eval-workbench", async () => {
  const actual = await vi.importActual<typeof import("@/lib/eval-workbench")>(
    "@/lib/eval-workbench",
  );

  return {
    ...actual,
    saveScenario: (...args: unknown[]) => mockSaveScenario(...args),
  };
});

describe("eval scenario queries", () => {
  beforeEach(() => {
    mockSaveScenario.mockReset();
  });

  it("stores renamed scenario detail under the new key and removes the old cache entry", async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    queryClient.setQueryData(
      evalScenarioKeys.detail("forecast-skill", "skills", "Regression"),
      { name: "Regression" },
    );

    mockSaveScenario.mockResolvedValue({
      id: "case-1",
      name: "Smoke",
      tags: ["performance"],
      prompt: "Summarize pipeline risk",
      shouldTrigger: null,
      assertions: [],
    });

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );
    }

    const { result } = renderHook(
      () => useSaveScenario("forecast-skill", "skills"),
      { wrapper: Wrapper },
    );

    await result.current.mutateAsync({
      scenario: {
        id: "case-1",
        name: "Smoke",
        tags: ["performance"],
        prompt: "Summarize pipeline risk",
        shouldTrigger: null,
        assertions: [],
      },
      previousScenarioName: "Regression",
    });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: evalScenarioKeys.list("forecast-skill", "skills"),
      }),
    );
    expect(
      queryClient.getQueryData(
        evalScenarioKeys.detail("forecast-skill", "skills", "Regression"),
      ),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(
        evalScenarioKeys.detail("forecast-skill", "skills", "Smoke"),
      ),
    ).toMatchObject({ name: "Smoke" });
  });
});
