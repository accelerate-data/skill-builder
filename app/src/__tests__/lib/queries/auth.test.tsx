import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHubUser } from "@/lib/types";
import { createTestQueryClient } from "@/test/query-test-utils";

const mocks = vi.hoisted(() => ({
  githubGetUser: vi.fn(),
  githubLogout: vi.fn(),
  updateGithubIdentity: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  githubGetUser: mocks.githubGetUser,
  githubLogout: mocks.githubLogout,
  updateGithubIdentity: mocks.updateGithubIdentity,
}));

import {
  useGithubLogoutMutation,
  useGithubSetUserMutation,
  useGithubUserQuery,
} from "@/lib/queries/auth";
import { queryKeys } from "@/lib/queries/query-keys";

function wrapper() {
  const queryClient = createTestQueryClient();
  return {
    queryClient,
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

const githubUser: GitHubUser = {
  login: "octocat",
  avatar_url: "https://github.com/octocat.png",
  email: "octocat@github.com",
};

describe("auth query hooks", () => {
  beforeEach(() => {
    mocks.githubGetUser.mockReset();
    mocks.githubLogout.mockReset();
    mocks.updateGithubIdentity.mockReset();
    mocks.updateGithubIdentity.mockResolvedValue(undefined);
  });

  it("loads the GitHub user and persists the identity fields", async () => {
    mocks.githubGetUser.mockResolvedValue(githubUser);
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useGithubUserQuery(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data).toEqual(githubUser));
    expect(mocks.githubGetUser).toHaveBeenCalledTimes(1);
    expect(mocks.updateGithubIdentity).toHaveBeenCalledWith(
      "octocat",
      "https://github.com/octocat.png",
      "octocat@github.com",
      null,
    );
  });

  it("caches a newly authenticated GitHub user", async () => {
    const { Wrapper, queryClient } = wrapper();

    const { result } = renderHook(() => useGithubSetUserMutation(), { wrapper: Wrapper });
    result.current.mutate(githubUser);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(queryKeys.auth.githubUser)).toEqual(githubUser);
    expect(mocks.updateGithubIdentity).toHaveBeenCalledWith(
      "octocat",
      "https://github.com/octocat.png",
      "octocat@github.com",
      null,
    );
  });

  it("logs out and clears the cached GitHub user", async () => {
    const { Wrapper, queryClient } = wrapper();
    queryClient.setQueryData(queryKeys.auth.githubUser, githubUser);
    mocks.githubLogout.mockResolvedValue(undefined);

    const { result } = renderHook(() => useGithubLogoutMutation(), { wrapper: Wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.githubLogout).toHaveBeenCalledTimes(1);
    expect(mocks.updateGithubIdentity).toHaveBeenCalledWith(null, null, null, null);
    expect(queryClient.getQueryData(queryKeys.auth.githubUser)).toBeNull();
  });
});
