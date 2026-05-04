import { useQuery } from "@tanstack/react-query";
import { invokeCommand } from "@/lib/tauri";
import { queryKeys } from "./query-keys";

export function useDecisions(skillId: string | null) {
  return useQuery({
    queryKey: queryKeys.decisions.bySkill(skillId ?? ""),
    queryFn: () => invokeCommand("get_decisions", { skillId: skillId! }),
    enabled: !!skillId,
  });
}
