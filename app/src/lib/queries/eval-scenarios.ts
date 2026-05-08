import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createScenario,
  deleteScenario,
  defineEvalScenario,
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

type SaveScenarioMutationInput = {
  scenario: ScenarioDto;
  previousScenarioName?: string | null;
};

type DeleteScenarioMutationInput = {
  scenarioName: string;
};

type DefineEvalScenarioMutationInput = {
  scenarioName: string;
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
  });
}

export function useSaveScenario(skillName: string | null, pluginSlug: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ scenario, previousScenarioName }: SaveScenarioMutationInput) =>
      saveScenario(pluginSlug, skillName!, scenario, previousScenarioName),
    onSuccess: (savedScenario, variables) => {
      void queryClient.invalidateQueries({
        queryKey: evalScenarioKeys.list(skillName ?? "", pluginSlug),
      });
      if (
        variables.previousScenarioName &&
        variables.previousScenarioName !== savedScenario.name
      ) {
        queryClient.removeQueries({
          queryKey: evalScenarioKeys.detail(
            skillName ?? "",
            pluginSlug,
            variables.previousScenarioName,
          ),
        });
      }
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

export function useCreateScenario(skillName: string | null, pluginSlug: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => createScenario(pluginSlug, skillName!),
    onSuccess: (createdScenario) => {
      void queryClient.invalidateQueries({
        queryKey: evalScenarioKeys.list(skillName ?? "", pluginSlug),
      });
      queryClient.setQueryData(
        evalScenarioKeys.detail(skillName ?? "", pluginSlug, createdScenario.name),
        createdScenario,
      );
    },
  });
}

export function useDefineEvalScenario(skillName: string | null, pluginSlug: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ scenarioName }: DefineEvalScenarioMutationInput) =>
      defineEvalScenario(pluginSlug, skillName!, scenarioName),
    onSuccess: (savedScenario, variables) => {
      void queryClient.invalidateQueries({
        queryKey: evalScenarioKeys.list(skillName ?? "", pluginSlug),
      });
      queryClient.removeQueries({
        queryKey: evalScenarioKeys.detail(
          skillName ?? "",
          pluginSlug,
          variables.scenarioName,
        ),
      });
      queryClient.setQueryData(
        evalScenarioKeys.detail(skillName ?? "", pluginSlug, savedScenario.name),
        savedScenario,
      );
    },
  });
}

export function useDeleteScenario(skillName: string | null, pluginSlug: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ scenarioName }: DeleteScenarioMutationInput) =>
      deleteScenario(pluginSlug, skillName!, scenarioName),
    onSuccess: (_result, { scenarioName }) => {
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
