import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAgentRuns,
  getRecentWorkflowSessions,
  getUsageByDay,
  getUsageByModel,
  getUsageByStep,
  getUsageSummary,
  getWorkflowSkillNames,
  resetUsage,
} from "@/lib/tauri";
import type { UsageQueryFilters } from "./query-keys";
import { queryKeys } from "./query-keys";

export type DateRange = "7d" | "14d" | "30d" | "90d" | "all";

export function toUsageStartDate(range: DateRange): string | null {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : range === "14d" ? 14 : range === "30d" ? 30 : 90;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function useUsageQueries(filters: UsageQueryFilters) {
  const results = useQueries({
    queries: [
      {
        queryKey: queryKeys.usage.summary(filters),
        queryFn: () => getUsageSummary(filters.hideCancelled, filters.startDate, filters.skillFilter),
      },
      {
        queryKey: queryKeys.usage.sessions(filters),
        queryFn: () => getRecentWorkflowSessions(50, filters.hideCancelled, filters.startDate, filters.skillFilter),
      },
      {
        queryKey: queryKeys.usage.agentRuns(filters),
        queryFn: () =>
          getAgentRuns(filters.hideCancelled, filters.startDate, filters.skillFilter, filters.modelFamilyFilter),
      },
      {
        queryKey: queryKeys.usage.byStep(filters),
        queryFn: () => getUsageByStep(filters.hideCancelled, filters.startDate, filters.skillFilter),
      },
      {
        queryKey: queryKeys.usage.byModel(filters),
        queryFn: () => getUsageByModel(filters.hideCancelled, filters.startDate, filters.skillFilter),
      },
      {
        queryKey: queryKeys.usage.byDay(filters),
        queryFn: () => getUsageByDay(filters.hideCancelled, filters.startDate, filters.skillFilter),
      },
    ],
  });

  return {
    summary: results[0],
    recentSessions: results[1],
    agentRuns: results[2],
    byStep: results[3],
    byModel: results[4],
    byDay: results[5],
    isLoading: results.some((result) => result.isLoading),
    isError: results.some((result) => result.isError),
    error: results.find((result) => result.error)?.error ?? null,
  };
}

export function useUsageSkillNamesQuery() {
  return useQuery({
    queryKey: queryKeys.usage.skillNames,
    queryFn: getWorkflowSkillNames,
    initialData: [],
  });
}

export function useResetUsageMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: resetUsage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.usage.all });
    },
  });
}
