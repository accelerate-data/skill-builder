import { create } from "zustand";
import type { MarketplaceRegistry } from "@/lib/types";

export interface ModelInfo {
  id: string;
  displayName: string;
}

interface SettingsState {
  anthropicApiKey: string | null;
  workspacePath: string | null;
  skillsPath: string | null;
  preferredModel: string | null;
  logLevel: string;
  extendedThinking: boolean;
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
  pendingUpgradeOpen: { mode: 'skill-library' | 'settings-skills'; skills: string[] } | null;
  setSettings: (settings: Partial<Omit<SettingsState, "isConfigured" | "setSettings" | "reset" | "setPendingUpgradeOpen">>) => void;
  setPendingUpgradeOpen: (value: { mode: 'skill-library' | 'settings-skills'; skills: string[] } | null) => void;
  reset: () => void;
}

const initialState = {
  anthropicApiKey: null,
  workspacePath: null,
  skillsPath: null,
  preferredModel: null,
  logLevel: "info",
  extendedThinking: false,
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
  pendingUpgradeOpen: null as { mode: 'skill-library' | 'settings-skills'; skills: string[] } | null,
};

export const useSettingsStore = create<SettingsState>((set) => ({
  ...initialState,
  setSettings: (settings) =>
    set((state) => {
      const next = { ...state, ...settings };
      return {
        ...next,
        isConfigured: !!next.anthropicApiKey && !!next.skillsPath,
      };
    }),
  setPendingUpgradeOpen: (value) => set({ pendingUpgradeOpen: value }),
  reset: () => set(initialState),
}));
