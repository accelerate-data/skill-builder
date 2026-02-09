import { create } from "zustand";

interface SettingsState {
  anthropicApiKey: string | null;
  workspacePath: string | null;
  preferredModel: string | null;
  debugMode: boolean;
  extendedContext: boolean;
  splashShown: boolean;
  isConfigured: boolean;
  setSettings: (settings: Partial<Omit<SettingsState, "isConfigured" | "setSettings" | "reset">>) => void;
  reset: () => void;
}

const initialState = {
  anthropicApiKey: null,
  workspacePath: null,
  preferredModel: null,
  debugMode: false,
  extendedContext: false,
  splashShown: false,
  isConfigured: false,
};

export const useSettingsStore = create<SettingsState>((set) => ({
  ...initialState,
  setSettings: (settings) =>
    set((state) => {
      const next = { ...state, ...settings };
      return {
        ...next,
        isConfigured: !!next.anthropicApiKey,
      };
    }),
  reset: () => set(initialState),
}));
