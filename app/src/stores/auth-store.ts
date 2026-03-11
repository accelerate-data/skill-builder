import { create } from "zustand";
import type { GitHubUser } from "@/lib/types";
import { githubGetUser, githubLogout, getSettings, saveSettings } from "@/lib/tauri";
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
        // Persist GitHub user identity to database
        try {
          const current = await getSettings();
          await saveSettings({ ...current, github_user_login: user.login, github_user_avatar: user.avatar_url, github_user_email: user.email });
        } catch (error) {
          console.error("Failed to persist GitHub user identity to database:", error);
        }
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
    // Persist GitHub user identity to database
    void getSettings().then((current) =>
      saveSettings({ ...current, github_user_login: user?.login ?? null, github_user_avatar: user?.avatar_url ?? null, github_user_email: user?.email ?? null })
    ).catch((error: unknown) => {
      console.error("Failed to persist GitHub user identity to database:", error);
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
      // Persist cleared GitHub user identity to database
      try {
        const current = await getSettings();
        await saveSettings({ ...current, github_oauth_token: null, github_user_login: null, github_user_avatar: null, github_user_email: null });
      } catch (error) {
        console.error("Failed to persist logout state to database:", error);
      }
    } catch (error) {
      console.error("Logout failed:", error);
    }
  },

  reset: () => set(initialState),
}));
