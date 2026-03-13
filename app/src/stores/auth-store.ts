import { create } from "zustand";
import type { GitHubUser } from "@/lib/types";
import { githubGetUser, githubLogout } from "@/lib/tauri";
import { useSettingsStore } from "@/stores/settings-store";

interface AuthState {
  user: GitHubUser | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  lastCheckedAt: string | null;
  loadUser: () => Promise<void>;
  setUser: (user: GitHubUser | null) => void;
  logout: () => Promise<void>;
  reset: () => void;
}

const initialState = {
  user: null,
  isLoggedIn: false,
  isLoading: false,
  lastCheckedAt: null,
};

export const useAuthStore = create<AuthState>((set) => ({
  ...initialState,

  loadUser: async () => {
    set({ isLoading: true });
    try {
      const user = await githubGetUser();
      set({
        user,
        isLoggedIn: user !== null,
        isLoading: false,
        lastCheckedAt: new Date().toISOString(),
      });
      if (user) {
        useSettingsStore.getState().setSettings({
          githubUserLogin: user.login,
          githubUserAvatar: user.avatar_url,
          githubUserEmail: user.email,
        });
      }
    } catch {
      set({ isLoading: false, lastCheckedAt: new Date().toISOString() });
    }
  },

  setUser: (user) => {
    set({ user, isLoggedIn: user !== null, lastCheckedAt: new Date().toISOString() });
    useSettingsStore.getState().setSettings({
      githubUserLogin: user?.login ?? null,
      githubUserAvatar: user?.avatar_url ?? null,
      githubUserEmail: user?.email ?? null,
    });
  },

  logout: async () => {
    try {
      await githubLogout();
      set({ user: null, isLoggedIn: false, lastCheckedAt: new Date().toISOString() });
      useSettingsStore.getState().setSettings({
        githubOauthToken: null,
        githubUserLogin: null,
        githubUserAvatar: null,
        githubUserEmail: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        "event=logout_failed component=auth-store operation=github_logout error=%s",
        message,
      );
      set({ user: null, isLoggedIn: false, lastCheckedAt: new Date().toISOString() });
      useSettingsStore.getState().setSettings({
        githubOauthToken: null,
        githubUserLogin: null,
        githubUserAvatar: null,
        githubUserEmail: null,
      });
    }
  },

  reset: () => set(initialState),
}));
