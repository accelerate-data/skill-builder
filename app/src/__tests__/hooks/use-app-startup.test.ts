import { describe, expect, it } from "vitest";
import { settingsToStorePatch } from "@/hooks/use-app-startup";
import type { AppSettings } from "@/lib/types";

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    anthropic_api_key: null,
    model_settings: null,
    openhands_provider: null,
    openhands_api_key: null,
    openhands_model: null,
    openhands_base_url: null,
    workspace_path: null,
    skills_path: null,
    preferred_model: null,
    log_level: "info",
    extended_context: false,
    extended_thinking: false,
    interleaved_thinking_beta: true,
    sdk_effort: null,
    fallback_model: null,
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

  it("does not hydrate canonical config from legacy OpenHands fields", () => {
    const patch = settingsToStorePatch(
      makeSettings({
        anthropic_api_key: "sk-ant-legacy",
        openhands_provider: "openai",
        openhands_api_key: "sk-openai",
        openhands_model: "gpt-4o",
      }),
    );

    expect(patch.modelSettings.api_key).toBeNull();
    expect(patch.modelSettings.model).toBeNull();
  });
});
