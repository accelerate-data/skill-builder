import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteScenario,
  loadScenario,
  listScenarios,
  saveScenario,
  type ScenarioDto,
} from "@/lib/eval-workbench";

export const evalScenarioKeys = {
  list: (skillName: string, pluginSlug: string) =>
    ["eval-scenarios", skillName, pluginSlug] as const,
  detail: (
    skillName: string,
    pluginSlug: string,
    scenarioName: string,
  ) => ["eval-scenario", skillName, pluginSlug, scenarioName] as const,
};

export function useScenarios(skillName: string | null, pluginSlug: string) {
  return useQuery({
    queryKey: evalScenarioKeys.list(skillName ?? "", pluginSlug),
    queryFn: () => listScenarios(pluginSlug, skillName!),
    enabled: Boolean(skillName),
  });
}

export function useScenario(
  skillName: string | null,
  pluginSlug: string,
  scenarioName: string | null,
) {
  return useQuery({
    queryKey: evalScenarioKeys.detail(skillName ?? "", pluginSlug, scenarioName ?? ""),
    queryFn: () => loadScenario(pluginSlug, skillName!, scenarioName!),
    enabled: Boolean(skillName && scenarioName),
    placeholderData: (previousData) => previousData,
  });
}

export function useSaveScenario(skillName: string | null, pluginSlug: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (scenario: ScenarioDto) =>
      saveScenario(pluginSlug, skillName!, scenario),
    onSuccess: (savedScenario) => {
      void queryClient.invalidateQueries({
        queryKey: evalScenarioKeys.list(skillName ?? "", pluginSlug),
      });
      queryClient.setQueryData(
        evalScenarioKeys.detail(
          skillName ?? "",
          pluginSlug,
          savedScenario.name,
        ),
        savedScenario,
      );
    },
  });
}

export function useDeleteScenario(skillName: string | null, pluginSlug: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (scenarioName: string) =>
      deleteScenario(pluginSlug, skillName!, scenarioName),
    onSuccess: (_result, scenarioName) => {
      void queryClient.invalidateQueries({
        queryKey: evalScenarioKeys.list(skillName ?? "", pluginSlug),
      });
      queryClient.removeQueries({
        queryKey: evalScenarioKeys.detail(
          skillName ?? "",
          pluginSlug,
          scenarioName,
        ),
      });
    },
  });
}
