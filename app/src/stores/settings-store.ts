import { create } from "zustand";
import type { MarketplaceRegistry, ModelInfo } from "@/lib/types";

export type { ModelInfo };

interface SettingsState {
  anthropicApiKey: string | null;
  openhandsProvider: string | null;
  openhandsApiKey: string | null;
  openhandsModel: string | null;
  openhandsBaseUrl: string | null;
  workspacePath: string | null;
  skillsPath: string | null;
  preferredModel: string | null;
  logLevel: string;
  extendedThinking: boolean;
  interleavedThinkingBeta: boolean;
  sdkEffort: string | null;
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
  anthropicApiKey: null,
  openhandsProvider: "anthropic",
  openhandsApiKey: null,
  openhandsModel: null,
  openhandsBaseUrl: null,
  workspacePath: null,
  skillsPath: null,
  preferredModel: null,
  logLevel: "info",
  extendedThinking: false,
  interleavedThinkingBeta: true,
  sdkEffort: null,
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
      const next = { ...state, ...settings };
      const provider = next.openhandsProvider ?? "anthropic";
      const cloudProviderRequiresKey = provider !== "ollama";
      const hasProviderKey =
        !!next.openhandsApiKey || (provider === "anthropic" && !!next.anthropicApiKey);
      const hasRuntimeConfig =
        !!next.openhandsModel && (!cloudProviderRequiresKey || hasProviderKey);
      return {
        ...next,
        isConfigured: !!next.skillsPath && hasRuntimeConfig,
      };
    }),
  setPendingUpgradeOpen: (value) => set({ pendingUpgradeOpen: value }),
  reset: () => set(initialState),
}));
