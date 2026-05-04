import { describe, expect, it } from "vitest";
import { settingsToStorePatch } from "@/hooks/use-app-startup";
import type { AppSettings } from "@/lib/types";

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    model_settings: null,
    workspace_path: null,
    skills_path: null,
    log_level: "info",
    extended_context: false,
    refine_prompt_suggestions: true,
    splash_shown: false,
    github_oauth_token: null,
    github_user_login: null,
    github_user_avatar: null,
    github_user_email: null,
    marketplace_registries: [],
    marketplace_initialized: false,
    max_dimensions: 5,
    industry: null,
    function_role: null,
    dashboard_view_mode: null,
    auto_update: false,
    ...overrides,
  };
}

describe("settingsToStorePatch", () => {
  it("hydrates canonical model settings", () => {
    const patch = settingsToStorePatch(
      makeSettings({
        model_settings: {
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          api_key: "sk-ant-test",
          base_url: null,
        },
      }),
    );

    expect(patch.modelSettings).toEqual(
      expect.objectContaining({
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        api_key: "sk-ant-test",
        base_url: null,
      }),
    );
  });

  it("returns null api_key and model when model_settings is not configured", () => {
    const patch = settingsToStorePatch(makeSettings({ model_settings: null }));

    expect(patch.modelSettings.api_key).toBeNull();
    expect(patch.modelSettings.model).toBeNull();
  });
});
