import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeCommand } from "@/lib/tauri";
import type { ClarificationVerdictUpdate, RefinementsDto } from "@/generated/contracts";
import { queryKeys } from "./query-keys";

export function useClarifications(skillId: string | null) {
  return useQuery({
    queryKey: queryKeys.clarifications.bySkill(skillId ?? ""),
    queryFn: async () =>
      (await invokeCommand("get_clarifications", { skillId: skillId! })) ?? null,
    enabled: !!skillId,
  });
}

export function useRefinements(skillId: string | null) {
  return useQuery<RefinementsDto | null>({
    queryKey: ["refinements", skillId ?? ""],
    queryFn: async () =>
      (await invokeCommand("get_refinements", { skillId: skillId! })) ?? null,
    enabled: !!skillId,
  });
}

export function useUpdateClarificationAnswer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      skillId: string;
      questionId: string;
      answerChoice: string | null;
      answerText: string | null;
    }) => invokeCommand("update_clarification_answer", args),
    onSuccess: (_data, { skillId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.clarifications.bySkill(skillId) });
    },
  });
}

export function useUpdateClarificationVerdicts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { skillId: string; updates: ClarificationVerdictUpdate[] }) =>
      invokeCommand("update_clarification_verdicts", args),
    onSuccess: (_data, { skillId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.clarifications.bySkill(skillId) });
    },
  });
}
