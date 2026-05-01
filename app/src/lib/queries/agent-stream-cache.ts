import type { QueryClient } from "@tanstack/react-query";
import { appQueryClient } from "@/lib/query-client";
import { queryKeys } from "./query-keys";

export function invalidateSkillDataAfterWorkflow(queryClient: QueryClient = appQueryClient) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.skills.all });
}

export function invalidateUsageDataAfterAgentRun(queryClient: QueryClient = appQueryClient) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.usage.all });
}
