import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteScenario,
  listScenarios,
  saveScenario,
  type ScenarioDto,
} from "@/lib/eval-workbench";

export const evalScenarioKeys = {
  list: (skillName: string, pluginSlug: string) =>
    ["eval-scenarios", skillName, pluginSlug] as const,
};

export function useScenarios(skillName: string | null, pluginSlug: string) {
  return useQuery({
    queryKey: evalScenarioKeys.list(skillName ?? "", pluginSlug),
    queryFn: () => listScenarios(pluginSlug, skillName!),
    enabled: Boolean(skillName),
  });
}

export function useSaveScenario(skillName: string | null, pluginSlug: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (scenario: ScenarioDto) =>
      saveScenario(pluginSlug, skillName!, scenario),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: evalScenarioKeys.list(skillName ?? "", pluginSlug),
      });
    },
  });
}

export function useDeleteScenario(skillName: string | null, pluginSlug: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (scenarioName: string) =>
      deleteScenario(pluginSlug, skillName!, scenarioName),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: evalScenarioKeys.list(skillName ?? "", pluginSlug),
      });
    },
  });
}
