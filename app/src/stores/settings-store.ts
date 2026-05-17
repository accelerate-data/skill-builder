import { create } from "zustand";
import type { MarketplaceRegistry, ModelSettings } from "@/lib/types";

export type { ModelInfo } from "@/lib/types";

interface SettingsState {
  modelSettings: ModelSettings;
  workspacePath: string | null;
  skillsPath: string | null;
  logLevel: string;
  refinePromptSuggestions: boolean;
  githubOauthToken: string | null;
  githubUserLogin: string | null;
  githubUserAvatar: string | null;
  githubUserEmail: string | null;
  marketplaceRegistries: MarketplaceRegistry[];
  maxDimensions: number;
  industry: string | null;
  functionRole: string | null;
  dashboardViewMode: string | null;
  autoUpdate: boolean;
  isConfigured: boolean;
  pendingUpgradeOpen: { skills: string[] } | null;
  setSettings: (settings: Partial<Omit<SettingsState, "isConfigured" | "setSettings" | "reset" | "setPendingUpgradeOpen">>) => void;
  setPendingUpgradeOpen: (value: { skills: string[] } | null) => void;
  reset: () => void;
}

const initialState = {
  modelSettings: {
    provider_id: null,
    model_id: null,
    provider_overrides: {},
  } as ModelSettings,
  workspacePath: null,
  skillsPath: null,
  logLevel: "info",
  refinePromptSuggestions: true,
  githubOauthToken: null,
  githubUserLogin: null,
  githubUserAvatar: null,
  githubUserEmail: null,
  marketplaceRegistries: [] as MarketplaceRegistry[],
  maxDimensions: 5,
  industry: null,
  functionRole: null,
  dashboardViewMode: null,
  autoUpdate: false,
  isConfigured: false,
  pendingUpgradeOpen: null as { skills: string[] } | null,
};

export const useSettingsStore = create<SettingsState>((set) => ({
  ...initialState,
  setSettings: (settings) =>
    set((state) => {
      const next = {
        ...state,
        ...settings,
        modelSettings: {
          ...state.modelSettings,
          ...(settings.modelSettings ?? {}),
        },
      };
      return {
        ...next,
        isConfigured: !!next.skillsPath,
      };
    }),
  setPendingUpgradeOpen: (value) => set({ pendingUpgradeOpen: value }),
  reset: () => set(initialState),
}));
