import { create } from "zustand";

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
  remoteRepoOwner: string | null;
  remoteRepoName: string | null;
  maxDimensions: number;
  industry: string | null;
  functionRole: string | null;
  dashboardViewMode: string | null;
  isConfigured: boolean;
  setSettings: (settings: Partial<Omit<SettingsState, "isConfigured" | "setSettings" | "reset">>) => void;
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
  remoteRepoOwner: null,
  remoteRepoName: null,
  maxDimensions: 5,
  industry: null,
  functionRole: null,
  dashboardViewMode: null,
  isConfigured: false,
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
  reset: () => set(initialState),
}));
