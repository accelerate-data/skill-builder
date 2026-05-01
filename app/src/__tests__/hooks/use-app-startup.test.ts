import { describe, expect, it } from "vitest";
import { settingsToStorePatch } from "@/hooks/use-app-startup";
import type { AppSettings } from "@/lib/types";

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    anthropic_api_key: null,
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
  it("uses legacy Anthropic API key only for Anthropic provider", () => {
    const patch = settingsToStorePatch(
      makeSettings({
        anthropic_api_key: "sk-ant-legacy",
        openhands_provider: "anthropic",
        openhands_api_key: null,
      }),
    );

    expect(patch.openhandsApiKey).toBe("sk-ant-legacy");
  });

  it("does not hydrate OpenAI provider from legacy Anthropic API key", () => {
    const patch = settingsToStorePatch(
      makeSettings({
        anthropic_api_key: "sk-ant-legacy",
        openhands_provider: "openai",
        openhands_api_key: null,
      }),
    );

    expect(patch.openhandsApiKey).toBeNull();
  });

  it("prefers explicit OpenHands API key for non-Anthropic provider", () => {
    const patch = settingsToStorePatch(
      makeSettings({
        anthropic_api_key: "sk-ant-legacy",
        openhands_provider: "google",
        openhands_api_key: "sk-google",
      }),
    );

    expect(patch.openhandsApiKey).toBe("sk-google");
  });
});
