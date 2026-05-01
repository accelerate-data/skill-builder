import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPluginFromSkills, deletePlugin, listPlugins } from "@/lib/tauri";
import { queryKeys } from "./query-keys";

interface CreatePluginInput {
  pluginName: string;
  skillKeys: string[];
}

export function usePluginsQuery() {
  return useQuery({
    queryKey: queryKeys.plugins.list,
    queryFn: listPlugins,
    placeholderData: [],
  });
}

export function useCreatePluginMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pluginName, skillKeys }: CreatePluginInput) =>
      createPluginFromSkills(pluginName, skillKeys),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all }),
  });
}

export function useDeletePluginMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePlugin,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all }),
  });
}
