import { create } from "zustand";
import { listPlugins } from "@/lib/tauri";
import type { LibraryPlugin } from "@/lib/types";

interface PluginState {
  plugins: LibraryPlugin[];
  isLoading: boolean;
  fetchPlugins: () => Promise<void>;
}

export const usePluginStore = create<PluginState>((set) => ({
  plugins: [],
  isLoading: false,

  fetchPlugins: async () => {
    set({ isLoading: true });
    try {
      const plugins = await listPlugins();
      set({ plugins, isLoading: false });
    } catch (err) {
      console.error("event=fetch_plugins_failed error=%s", err);
      set({ isLoading: false });
    }
  },
}));
