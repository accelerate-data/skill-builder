import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  evalScenarioKeys,
  useCreateScenario,
  useDeleteScenario,
  useGenerateEvalScenarioAssertions,
  useSaveScenario,
} from "@/lib/queries/eval-scenarios";
import { createTestQueryClient } from "@/test/query-test-utils";

const mockCreateScenario = vi.fn();
const mockSaveScenario = vi.fn();
const mockDeleteScenario = vi.fn();
const mockGenerateEvalScenarioAssertions = vi.fn();

vi.mock("@/lib/eval-workbench", async () => {
  const actual = await vi.importActual<typeof import("@/lib/eval-workbench")>(
    "@/lib/eval-workbench",
  );

  return {
    ...actual,
    createScenario: (...args: unknown[]) => mockCreateScenario(...args),
    saveScenario: (...args: unknown[]) => mockSaveScenario(...args),
    deleteScenario: (...args: unknown[]) => mockDeleteScenario(...args),
    generateEvalScenarioAssertions: (...args: unknown[]) =>
      mockGenerateEvalScenarioAssertions(...args),
  };
});

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

describe("eval scenario queries", () => {
  beforeEach(() => {
    mockCreateScenario.mockReset();
    mockSaveScenario.mockReset();
    mockDeleteScenario.mockReset();
    mockGenerateEvalScenarioAssertions.mockReset();
  });

  describe("useSaveScenario", () => {
    it("stores saved scenario detail and invalidates the list", async () => {
      const queryClient = createTestQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      mockSaveScenario.mockResolvedValue({
        id: "case-1",
        pluginSlug: "skills",
        skillName: "forecast-skill",
        name: "Smoke",
        tags: ["performance"],
        prompt: "Summarize pipeline risk",
        assertions: [],
      });

      function TestWrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
      }

      const { result } = renderHook(
        () => useSaveScenario("forecast-skill", "skills"),
        { wrapper: TestWrapper },
      );

      await result.current.mutateAsync({
        scenario: {
          id: "case-1",
          pluginSlug: "skills",
          skillName: "forecast-skill",
          name: "Smoke",
          tags: ["performance"],
          prompt: "Summarize pipeline risk",
          assertions: [],
        },
      });

      await waitFor(() =>
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: evalScenarioKeys.list("forecast-skill", "skills"),
        }),
      );
      expect(
        queryClient.getQueryData(
          evalScenarioKeys.detail("forecast-skill", "skills", "Smoke"),
        ),
      ).toMatchObject({ name: "Smoke" });
    });

    it("removes stale detail cache when scenario is renamed", async () => {
      const queryClient = createTestQueryClient();
      const removeSpy = vi.spyOn(queryClient, "removeQueries");

      mockSaveScenario.mockResolvedValue({
        id: "case-1",
        pluginSlug: "skills",
        skillName: "forecast-skill",
        name: "New name",
        tags: ["performance"],
        prompt: "Prompt",
        assertions: [],
      });

      function TestWrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
      }

      const { result } = renderHook(
        () => useSaveScenario("forecast-skill", "skills"),
        { wrapper: TestWrapper },
      );

      await result.current.mutateAsync({
        scenario: {
          id: "case-1",
          pluginSlug: "skills",
          skillName: "forecast-skill",
          name: "New name",
          tags: ["performance"],
          prompt: "Prompt",
          assertions: [],
        },
        previousScenarioName: "Old name",
      });

      await waitFor(() =>
        expect(removeSpy).toHaveBeenCalledWith({
          queryKey: evalScenarioKeys.detail("forecast-skill", "skills", "Old name"),
        }),
      );
    });
  });

  describe("useCreateScenario", () => {
    it("invalidates list and sets detail cache on create", async () => {
      const queryClient = createTestQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      mockCreateScenario.mockResolvedValue({
        id: "case-new",
        pluginSlug: "skills",
        skillName: "forecast-skill",
        name: "New scenario",
        tags: ["performance"],
        prompt: "",
        assertions: [],
      });

      function TestWrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
      }

      const { result } = renderHook(
        () => useCreateScenario("forecast-skill", "skills"),
        { wrapper: TestWrapper },
      );

      await result.current.mutateAsync();

      await waitFor(() =>
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: evalScenarioKeys.list("forecast-skill", "skills"),
        }),
      );
      expect(
        queryClient.getQueryData(
          evalScenarioKeys.detail("forecast-skill", "skills", "New scenario"),
        ),
      ).toMatchObject({ name: "New scenario" });
    });
  });

  describe("useGenerateEvalScenarioAssertions", () => {
    it("invalidates list, removes old detail, and sets new detail on generate", async () => {
      const queryClient = createTestQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const removeSpy = vi.spyOn(queryClient, "removeQueries");

      mockGenerateEvalScenarioAssertions.mockResolvedValue({
        id: "case-1",
        pluginSlug: "skills",
        skillName: "forecast-skill",
        name: "Generated scenario",
        tags: ["performance"],
        prompt: "Generated prompt",
        assertions: ["Generated assertion"],
      });

      function TestWrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
      }

      const { result } = renderHook(
        () => useGenerateEvalScenarioAssertions("forecast-skill", "skills"),
        { wrapper: TestWrapper },
      );

      await result.current.mutateAsync({ scenarioName: "Original" });

      await waitFor(() =>
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: evalScenarioKeys.list("forecast-skill", "skills"),
        }),
      );
      expect(removeSpy).toHaveBeenCalledWith({
        queryKey: evalScenarioKeys.detail("forecast-skill", "skills", "Original"),
      });
      expect(
        queryClient.getQueryData(
          evalScenarioKeys.detail("forecast-skill", "skills", "Generated scenario"),
        ),
      ).toMatchObject({ name: "Generated scenario" });
    });
  });

  describe("useDeleteScenario", () => {
    it("invalidates list and removes detail cache on delete", async () => {
      const queryClient = createTestQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const removeSpy = vi.spyOn(queryClient, "removeQueries");

      mockDeleteScenario.mockResolvedValue(undefined);

      function TestWrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
      }

      const { result } = renderHook(
        () => useDeleteScenario("forecast-skill", "skills"),
        { wrapper: TestWrapper },
      );

      await result.current.mutateAsync({ scenarioName: "ToDelete" });

      await waitFor(() =>
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: evalScenarioKeys.list("forecast-skill", "skills"),
        }),
      );
      expect(removeSpy).toHaveBeenCalledWith({
        queryKey: evalScenarioKeys.detail("forecast-skill", "skills", "ToDelete"),
      });
    });
  });
});
