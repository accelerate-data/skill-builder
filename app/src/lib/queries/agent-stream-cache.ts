import type { QueryClient } from "@tanstack/react-query";
import { appQueryClient } from "@/lib/query-client";
import { queryKeys } from "./query-keys";

export function invalidateSkillDataAfterWorkflow(queryClient: QueryClient = appQueryClient) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.skills.all });
}

export function invalidateUsageDataAfterAgentRun(queryClient: QueryClient = appQueryClient) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.usage.all });
}

/**
 * Invalidate workflow artifact caches after a step completes.
 *
 * - Steps 0 and 1 write clarifications data → invalidate clarifications cache.
 * - Step 2 writes decisions data → invalidate decisions cache.
 */
export function invalidateWorkflowArtifactsAfterStep(
  skillId: string,
  stepId: number,
  queryClient: QueryClient = appQueryClient,
): void {
  if (stepId === 0 || stepId === 1) {
    queryClient.invalidateQueries({ queryKey: queryKeys.clarifications.bySkill(skillId) });
  }
  if (stepId === 2) {
    queryClient.invalidateQueries({ queryKey: queryKeys.decisions.bySkill(skillId) });
  }
}
