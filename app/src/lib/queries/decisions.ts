import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeCommand } from "@/lib/tauri";
import { queryKeys } from "./query-keys";
import type { Decision } from "@/generated/contracts";

export function useDecisions(skillId: string | null) {
  return useQuery({
    queryKey: queryKeys.decisions.bySkill(skillId ?? ""),
    queryFn: () => invokeCommand("get_decisions", { skillId: skillId! }),
    enabled: !!skillId,
  });
}

export function useSaveDecisionsEdit(skillId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (decisions: Decision[]) => {
      if (!skillId) return Promise.resolve();
      const items = decisions.map((d) => ({
        decision_id: d.id,
        decision: d.decision,
        implication: d.implication,
        status: d.status,
      }));
      return invokeCommand("save_decisions_edit", { skillId, items });
    },
    onSuccess: () => {
      if (skillId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.decisions.bySkill(skillId) });
      }
    },
  });
}
