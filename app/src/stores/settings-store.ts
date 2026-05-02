import { create } from "zustand";
import type { MarketplaceRegistry, ModelInfo, ModelSettings } from "@/lib/types";

export type { ModelInfo };

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
  marketplaceInitialized: boolean;
  maxDimensions: number;
  industry: string | null;
  functionRole: string | null;
  dashboardViewMode: string | null;
  autoUpdate: boolean;
  isConfigured: boolean;
  availableModels: ModelInfo[];
  pendingUpgradeOpen: { skills: string[] } | null;
  setSettings: (settings: Partial<Omit<SettingsState, "isConfigured" | "setSettings" | "reset" | "setPendingUpgradeOpen">>) => void;
  setPendingUpgradeOpen: (value: { skills: string[] } | null) => void;
  reset: () => void;
}

const initialState = {
  modelSettings: {
    provider: "anthropic",
    model: null,
    api_key: null,
    base_url: null,
    api_version: null,
    temperature: null,
    max_output_tokens: null,
    timeout_seconds: 300,
    num_retries: 5,
    reasoning_effort: "auto",
    extra_headers: null,
    input_cost_per_token: null,
    output_cost_per_token: null,
    usage_id: "workflow",
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
  marketplaceInitialized: false,
  maxDimensions: 5,
  industry: null,
  functionRole: null,
  dashboardViewMode: null,
  autoUpdate: false,
  isConfigured: false,
  availableModels: [] as ModelInfo[],
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
