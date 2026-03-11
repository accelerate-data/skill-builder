import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/auth-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { AppSettings } from "@/lib/types";

const baseSettings: AppSettings = {
  anthropic_api_key: null,
  workspace_path: null,
  skills_path: null,
  preferred_model: null,
  log_level: "info",
  extended_context: false,
  extended_thinking: false,
  splash_shown: false,
  github_oauth_token: null,
  github_user_login: null,
  github_user_avatar: null,
  github_user_email: null,
  marketplace_registries: [],
  marketplace_initialized: false,
  max_dimensions: 0,
  industry: null,
  function_role: null,
  dashboard_view_mode: null,
  auto_update: false,
};

const mocks = vi.hoisted(() => ({
  githubGetUser: vi.fn(),
  githubLogout: vi.fn(),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  githubGetUser: mocks.githubGetUser,
  githubLogout: mocks.githubLogout,
  getSettings: mocks.getSettings,
  saveSettings: mocks.saveSettings,
}));

describe("useAuthStore", () => {
  beforeEach(() => {
    mocks.githubGetUser.mockReset();
    mocks.githubLogout.mockReset();
    mocks.getSettings.mockReset();
    mocks.saveSettings.mockReset();
    mocks.getSettings.mockResolvedValue({ ...baseSettings });
    mocks.saveSettings.mockResolvedValue(undefined);
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

  it("loadUser persists GitHub user identity to database via saveSettings", async () => {
    mocks.githubGetUser.mockResolvedValue({
      login: "octocat",
      avatar_url: "https://github.com/octocat.png",
      email: "octocat@github.com",
    });

    await useAuthStore.getState().loadUser();

    expect(mocks.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        github_user_login: "octocat",
        github_user_avatar: "https://github.com/octocat.png",
        github_user_email: "octocat@github.com",
      })
    );
  });

  it("setUser persists GitHub user identity to database via saveSettings", async () => {
    useAuthStore.getState().setUser({
      login: "dev",
      avatar_url: "https://github.com/dev.png",
      email: "dev@example.com",
    });

    // Wait for fire-and-forget promise chain
    await new Promise((r) => setTimeout(r, 0));

    expect(mocks.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        github_user_login: "dev",
        github_user_avatar: "https://github.com/dev.png",
        github_user_email: "dev@example.com",
      })
    );
  });

  it("setUser persists null values when clearing user", async () => {
    useAuthStore.getState().setUser(null);

    // Wait for fire-and-forget promise chain
    await new Promise((r) => setTimeout(r, 0));

    expect(mocks.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        github_user_login: null,
        github_user_avatar: null,
        github_user_email: null,
      })
    );
  });

  it("logout persists cleared GitHub user identity to database via saveSettings", async () => {
    mocks.githubLogout.mockResolvedValue(undefined);

    await useAuthStore.getState().logout();

    expect(mocks.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        github_oauth_token: null,
        github_user_login: null,
        github_user_avatar: null,
        github_user_email: null,
      })
    );
  });

  it("loadUser merges into existing settings — does not overwrite unrelated fields", async () => {
    const existingSettings: AppSettings = {
      ...baseSettings,
      anthropic_api_key: "sk-ant-existing",
      workspace_path: "/some/path",
    };
    mocks.getSettings.mockResolvedValue(existingSettings);
    mocks.githubGetUser.mockResolvedValue({
      login: "octocat",
      avatar_url: "https://github.com/octocat.png",
      email: "octocat@github.com",
    });

    await useAuthStore.getState().loadUser();

    expect(mocks.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        anthropic_api_key: "sk-ant-existing",
        workspace_path: "/some/path",
        github_user_login: "octocat",
      })
    );
  });

  it("loadUser handles saveSettings errors gracefully and continues", async () => {
    mocks.githubGetUser.mockResolvedValue({
      login: "octocat",
      avatar_url: "https://github.com/octocat.png",
      email: "octocat@github.com",
    });
    mocks.saveSettings.mockRejectedValue(new Error("Database error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await useAuthStore.getState().loadUser();

    const calls = consoleSpy.mock.calls;
    const failureCall = calls.find((call) =>
      String(call[0]).includes("Failed to persist GitHub user identity")
    );
    expect(failureCall).toBeDefined();
    expect(useAuthStore.getState().isLoggedIn).toBe(true);
    expect(useAuthStore.getState().user?.login).toBe("octocat");

    consoleSpy.mockRestore();
  });

  it("logout handles saveSettings errors gracefully and continues", async () => {
    mocks.githubLogout.mockResolvedValue(undefined);
    mocks.saveSettings.mockRejectedValue(new Error("Database error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await useAuthStore.getState().logout();

    const calls = consoleSpy.mock.calls;
    const failureCall = calls.find((call) =>
      String(call[0]).includes("Failed to persist logout state")
    );
    expect(failureCall).toBeDefined();
    expect(useAuthStore.getState().isLoggedIn).toBe(false);

    consoleSpy.mockRestore();
  });
});
