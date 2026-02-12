import { create } from "zustand";

interface SettingsState {
  anthropicApiKey: string | null;
  workspacePath: string | null;
  skillsPath: string | null;
  preferredModel: string | null;
  debugMode: boolean;
  verboseLogging: boolean;
  extendedContext: boolean;
  extendedThinking: boolean;
  /** Agent timeout in seconds. If an agent step takes longer, a timeout dialog is shown. */
  agentTimeout: number;
  isConfigured: boolean;
  setSettings: (settings: Partial<Omit<SettingsState, "isConfigured" | "setSettings" | "reset">>) => void;
  reset: () => void;
}

/** Default agent timeout in seconds. */
export const DEFAULT_AGENT_TIMEOUT = 90;

const initialState = {
  anthropicApiKey: null,
  workspacePath: null,
  skillsPath: null,
  preferredModel: null,
  debugMode: false,
  verboseLogging: false,
  extendedContext: false,
  extendedThinking: false,
  agentTimeout: DEFAULT_AGENT_TIMEOUT,
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
