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
          provider_id: "anthropic",
          model_id: "claude-sonnet-4-5",
          provider_overrides: {
            anthropic: {
              api_key: "sk-ant-test",
              base_url_override: null,
              api_version: null,
              temperature: null,
              max_output_tokens: null,
              timeout_seconds: 300,
              num_retries: 5,
              reasoning_effort: "auto",
              extra_headers: null,
              input_cost_per_token: null,
              output_cost_per_token: null,
              usage_id: "workflow",
            },
          },
        },
      }),
    );

    expect(patch.modelSettings).toEqual(
      expect.objectContaining({
        provider_id: "anthropic",
        model_id: "claude-sonnet-4-5",
      }),
    );
    expect(patch.modelSettings.provider_overrides.anthropic?.api_key).toBe("sk-ant-test");
  });

  it("returns null provider_id and model_id when model_settings is not configured", () => {
    const patch = settingsToStorePatch(makeSettings({ model_settings: null }));

    expect(patch.modelSettings.provider_id).toBeNull();
    expect(patch.modelSettings.model_id).toBeNull();
    expect(patch.modelSettings.provider_overrides).toEqual({});
  });
});
