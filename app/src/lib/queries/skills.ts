import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  deleteImportedSkill,
  listImportedSkills,
  listSkills,
  type SkillSummary,
} from "@/lib/tauri";
import type { ImportedSkill } from "@/lib/types";
import { queryKeys } from "./query-keys";

export function useBuilderSkillsQuery(
  workspacePath: string | null,
  sourceUrl: string | null = null,
) {
  return useQuery<SkillSummary[]>({
    queryKey: queryKeys.skills.builder(workspacePath, sourceUrl),
    enabled: !!workspacePath,
    queryFn: () => listSkills(workspacePath!, sourceUrl),
    placeholderData: [],
  });
}

export function useImportedSkillsQuery(sourceUrl: string | null = null) {
  return useQuery<ImportedSkill[]>({
    queryKey: queryKeys.skills.imported(sourceUrl),
    queryFn: () => listImportedSkills(sourceUrl),
    placeholderData: [],
  });
}

export function useDeleteImportedSkillMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (skillId: number) => deleteImportedSkill(skillId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.skills.imported() });
    },
  });
}

export function useInvalidateSkillQueries() {
  const queryClient = useQueryClient();

  return () => queryClient.invalidateQueries({ queryKey: queryKeys.skills.all });
}

export function patchBuilderSkillQueryData(
  queryClient: QueryClient,
  updater: (skill: SkillSummary) => SkillSummary,
) {
  queryClient.setQueriesData<SkillSummary[]>(
    {
      predicate: (query) =>
        query.queryKey[0] === "skills" && query.queryKey[1] === "builder",
    },
    (skills) => skills?.map(updater) ?? skills,
  );
}
