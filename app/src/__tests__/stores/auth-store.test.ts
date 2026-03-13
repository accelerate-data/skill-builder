import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/auth-store";
import { useSettingsStore } from "@/stores/settings-store";

const mocks = vi.hoisted(() => ({
  githubGetUser: vi.fn(),
  githubLogout: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  githubGetUser: mocks.githubGetUser,
  githubLogout: mocks.githubLogout,
}));

describe("useAuthStore", () => {
  beforeEach(() => {
    mocks.githubGetUser.mockReset();
    mocks.githubLogout.mockReset();
    useAuthStore.getState().reset();
    useSettingsStore.getState().reset();
  });

  it("loadUser sets logged-in state and lastCheckedAt when user exists", async () => {
    mocks.githubGetUser.mockResolvedValue({
      login: "octocat",
      avatar_url: "https://github.com/octocat.png",
      email: "octocat@github.com",
    });

    await useAuthStore.getState().loadUser();

    const state = useAuthStore.getState();
    expect(state.isLoggedIn).toBe(true);
    expect(state.user?.login).toBe("octocat");
    expect(state.lastCheckedAt).toBeTruthy();
    expect(useSettingsStore.getState().githubUserLogin).toBe("octocat");
  });

  it("setUser updates auth and settings stores", () => {
    useAuthStore.getState().setUser({
      login: "dev",
      avatar_url: "https://github.com/dev.png",
      email: null,
    });

    expect(useAuthStore.getState().isLoggedIn).toBe(true);
    expect(useAuthStore.getState().lastCheckedAt).toBeTruthy();
    expect(useSettingsStore.getState().githubUserLogin).toBe("dev");
  });

  it("logout clears persisted GitHub fields from settings store", async () => {
    mocks.githubLogout.mockResolvedValue(undefined);
    useSettingsStore.getState().setSettings({
      githubOauthToken: "tok_abc",
      githubUserLogin: "octocat",
      githubUserAvatar: "https://github.com/octocat.png",
      githubUserEmail: "octocat@github.com",
    });

    await useAuthStore.getState().logout();

    const auth = useAuthStore.getState();
    const settings = useSettingsStore.getState();
    expect(auth.isLoggedIn).toBe(false);
    expect(auth.user).toBeNull();
    expect(auth.lastCheckedAt).toBeTruthy();
    expect(settings.githubOauthToken).toBeNull();
    expect(settings.githubUserLogin).toBeNull();
    expect(settings.githubUserAvatar).toBeNull();
    expect(settings.githubUserEmail).toBeNull();
  });

  it("logout clears auth and settings state even when githubLogout throws", async () => {
    mocks.githubLogout.mockRejectedValue(new Error("Network error"));

    // Set up logged-in state
    useAuthStore.getState().setUser({
      login: "octocat",
      avatar_url: "https://github.com/octocat.png",
      email: "octocat@github.com",
    });
    useSettingsStore.getState().setSettings({
      githubOauthToken: "tok_abc",
      githubUserLogin: "octocat",
      githubUserAvatar: "https://github.com/octocat.png",
      githubUserEmail: "octocat@github.com",
    });

    await useAuthStore.getState().logout();

    // Auth state should be cleared despite the error
    const auth = useAuthStore.getState();
    expect(auth.isLoggedIn).toBe(false);
    expect(auth.user).toBeNull();

    // Settings should also be cleared
    const settings = useSettingsStore.getState();
    expect(settings.githubOauthToken).toBeNull();
    expect(settings.githubUserLogin).toBeNull();
    expect(settings.githubUserAvatar).toBeNull();
    expect(settings.githubUserEmail).toBeNull();
  });
});
