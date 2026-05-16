import { describe, expect, it, vi } from "vitest";
import { createAppQueryClient } from "@/lib/query-client";
import {
  invalidateSkillDataAfterWorkflow,
  invalidateUsageDataAfterAgentRun,
  invalidateWorkflowArtifactsAfterStep,
} from "@/lib/queries/agent-stream-cache";

describe("query client defaults", () => {
  it("keeps backend data fresh briefly without refetching on focus", () => {
    const client = createAppQueryClient();
    const defaults = client.getDefaultOptions();

    expect(defaults.queries?.staleTime).toBe(30_000);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaults.mutations?.retry).toBe(0);
  });
});

describe("stream cache integration", () => {
  it("invalidates skill and usage query families explicitly", async () => {
    const client = createAppQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    await invalidateSkillDataAfterWorkflow(client);
    await invalidateUsageDataAfterAgentRun(client);

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["skills"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["usage"] });
  });

  it("invalidates the workflow artifact query families for each step", () => {
    const client = createAppQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    invalidateWorkflowArtifactsAfterStep("42", 0, client);
    invalidateWorkflowArtifactsAfterStep("42", 1, client);
    invalidateWorkflowArtifactsAfterStep("42", 2, client);

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["clarifications", "42"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["refinements", "42"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["decisions", "42"],
    });
  });
});
