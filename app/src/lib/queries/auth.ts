import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { githubGetUser, githubLogout, updateGithubIdentity } from "@/lib/tauri";
import type { GitHubUser } from "@/lib/types";
import { useSettingsStore } from "@/stores/settings-store";
import { queryKeys } from "./query-keys";

export function persistGithubIdentity(user: GitHubUser | null) {
  useSettingsStore.getState().setSettings({
    githubUserLogin: user?.login ?? null,
    githubUserAvatar: user?.avatar_url ?? null,
    githubUserEmail: user?.email ?? null,
  });

  return updateGithubIdentity(
    user?.login ?? null,
    user?.avatar_url ?? null,
    user?.email ?? null,
    null,
  );
}

export async function fetchGithubUser() {
  const user = await githubGetUser();
  if (user) {
    persistGithubIdentity(user).catch((error: unknown) => {
      console.error("Failed to persist GitHub user identity to database:", error);
    });
  }
  return user;
}

export function useGithubUserQuery() {
  return useQuery({
    queryKey: queryKeys.auth.githubUser,
    queryFn: fetchGithubUser,
  });
}

export function useGithubSetUserMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (user: GitHubUser) => {
      await persistGithubIdentity(user);
      return user;
    },
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.auth.githubUser, user);
    },
  });
}

export function useGithubLogoutMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      try {
        await githubLogout();
      } finally {
        useSettingsStore.getState().setSettings({
          githubOauthToken: null,
          githubUserLogin: null,
          githubUserAvatar: null,
          githubUserEmail: null,
        });
        await persistGithubIdentity(null);
      }
    },
    onSettled: () => {
      queryClient.setQueryData(queryKeys.auth.githubUser, null);
    },
  });
}
