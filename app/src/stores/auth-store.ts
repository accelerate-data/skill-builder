import { create } from "zustand";
import { appQueryClient } from "@/lib/query-client";
import { fetchGithubUser, persistGithubIdentity } from "@/lib/queries/auth";
import { queryKeys } from "@/lib/queries/query-keys";
import { githubLogout } from "@/lib/tauri";
import type { GitHubUser } from "@/lib/types";
import { useGithubLogoutMutation, useGithubUserQuery } from "@/lib/queries/auth";
import { useSettingsStore } from "@/stores/settings-store";

interface AuthUiState {
  lastCheckedAt: string | null;
  setLastCheckedAt: (value: string | null) => void;
  reset: () => void;
}

interface AuthCompatState {
  user: GitHubUser | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  lastCheckedAt: string | null;
  loadUser: () => Promise<void>;
  setUser: (user: GitHubUser | null) => void;
  logout: () => Promise<void>;
  reset: () => void;
}

const useAuthUiStore = create<AuthUiState>((set) => ({
  lastCheckedAt: null,
  setLastCheckedAt: (value) => set({ lastCheckedAt: value }),
  reset: () => set({ lastCheckedAt: null }),
}));

function markChecked() {
  useAuthUiStore.getState().setLastCheckedAt(new Date().toISOString());
}

async function loadUser() {
  const user = await fetchGithubUser();
  appQueryClient.setQueryData(queryKeys.auth.githubUser, user);
  markChecked();
}

function setUser(user: GitHubUser | null) {
  appQueryClient.setQueryData(queryKeys.auth.githubUser, user);
  persistGithubIdentity(user).catch((error: unknown) => {
    console.error("Failed to persist GitHub user identity to database:", error);
  });
  markChecked();
}

async function logout() {
  try {
    await githubLogout();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      "event=logout_failed component=auth-store operation=github_logout error=%s",
      message,
    );
  } finally {
    useSettingsStore.getState().setSettings({
      githubOauthToken: null,
      githubUserLogin: null,
      githubUserAvatar: null,
      githubUserEmail: null,
    });
    await persistGithubIdentity(null).catch((error: unknown) => {
      console.error("Failed to persist logout state to database:", error);
    });
    appQueryClient.setQueryData(queryKeys.auth.githubUser, null);
    markChecked();
  }
}

function reset() {
  appQueryClient.setQueryData(queryKeys.auth.githubUser, null);
  useAuthUiStore.getState().reset();
}

function buildSnapshot(user: GitHubUser | null, isLoading = false): AuthCompatState {
  return {
    user,
    isLoggedIn: user !== null,
    isLoading,
    lastCheckedAt: useAuthUiStore.getState().lastCheckedAt,
    loadUser,
    setUser,
    logout,
    reset,
  };
}

export function useAuthStore(): AuthCompatState;
export function useAuthStore<T>(selector: (state: AuthCompatState) => T): T;
export function useAuthStore<T>(selector?: (state: AuthCompatState) => T): T | AuthCompatState {
  const githubUserQuery = useGithubUserQuery();
  const logoutMutation = useGithubLogoutMutation();
  const lastCheckedAt = useAuthUiStore((state) => state.lastCheckedAt);
  const user = githubUserQuery.data ?? null;
  const state: AuthCompatState = {
    user,
    isLoggedIn: user !== null,
    isLoading: githubUserQuery.isLoading || logoutMutation.isPending,
    lastCheckedAt,
    loadUser: async () => {
      await githubUserQuery.refetch();
      markChecked();
    },
    setUser,
    logout: async () => {
      await logoutMutation.mutateAsync();
      markChecked();
    },
    reset,
  };

  return selector ? selector(state) : state;
}

useAuthStore.getState = (): AuthCompatState => {
  const user = appQueryClient.getQueryData<GitHubUser | null>(queryKeys.auth.githubUser) ?? null;
  return buildSnapshot(user);
};

useAuthStore.setState = (partial: Partial<AuthCompatState>) => {
  if ("user" in partial) {
    appQueryClient.setQueryData(queryKeys.auth.githubUser, partial.user ?? null);
  }
  if ("lastCheckedAt" in partial) {
    useAuthUiStore.getState().setLastCheckedAt(partial.lastCheckedAt ?? null);
  }
};
