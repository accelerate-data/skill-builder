import { useQueryClient } from "@tanstack/react-query";
import { appQueryClient } from "@/lib/query-client";
import { usePluginsQuery } from "@/lib/queries/plugins";
import { queryKeys } from "@/lib/queries/query-keys";
import type { LibraryPlugin } from "@/lib/types";

interface PluginCompatState {
  plugins: LibraryPlugin[];
  isLoading: boolean;
  fetchPlugins: () => Promise<void>;
}

export function usePluginStore<T>(selector: (state: PluginCompatState) => T): T {
  const pluginsQuery = usePluginsQuery();
  const queryClient = useQueryClient();
  const state: PluginCompatState = {
    plugins: pluginsQuery.data ?? [],
    isLoading: pluginsQuery.isLoading,
    fetchPlugins: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.plugins.list });
    },
  };

  return selector(state);
}

usePluginStore.getState = (): PluginCompatState => ({
  plugins: appQueryClient.getQueryData<LibraryPlugin[]>(queryKeys.plugins.list) ?? [],
  isLoading: false,
  fetchPlugins: async () => {
    await appQueryClient.invalidateQueries({ queryKey: queryKeys.plugins.list });
  },
});
