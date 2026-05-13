import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "@/stores/settings-store";

describe("useSettingsStore", () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useSettingsStore.getState().reset();
  });

  it("has null fields and isConfigured=false in initial state", () => {
    const state = useSettingsStore.getState();
    expect(state.modelSettings.provider_id).toBeNull();
    expect(state.modelSettings.model_id).toBeNull();
    expect(state.workspacePath).toBeNull();
    expect(state.dashboardViewMode).toBeNull();
    expect(state.isConfigured).toBe(false);
  });

  it("setSettings with skillsPath sets isConfigured to true", () => {
    useSettingsStore.getState().setSettings({
      skillsPath: "/some/skills",
    });
    const state = useSettingsStore.getState();
    expect(state.skillsPath).toBe("/some/skills");
    expect(state.isConfigured).toBe(true);
  });

  it("setSettings with model settings only keeps isConfigured false (skillsPath required)", () => {
    useSettingsStore.getState().setSettings({
      modelSettings: {
        provider_id: "anthropic",
        model_id: "claude-sonnet-4-5",
        provider_overrides: {
          anthropic: {
            api_key: "sk-ant-test-key",
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
    });
    const state = useSettingsStore.getState();
    expect(state.modelSettings.provider_overrides.anthropic.api_key).toBe("sk-ant-test-key");
    expect(state.isConfigured).toBe(false);
  });

  it("setSettings without skillsPath keeps isConfigured false", () => {
    useSettingsStore.getState().setSettings({
      workspacePath: "/some/path",
    });
    const state = useSettingsStore.getState();
    expect(state.workspacePath).toBe("/some/path");
    expect(state.isConfigured).toBe(false);
  });

  it("setSettings preserves existing fields not included in update", () => {
    useSettingsStore.getState().setSettings({
      modelSettings: {
        provider_id: "anthropic",
        model_id: "claude-sonnet-4-5",
        provider_overrides: {
          anthropic: {
            api_key: "sk-ant-test-key",
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
      skillsPath: "/some/skills",
    });
    useSettingsStore.getState().setSettings({
      workspacePath: "/some/path",
    });
    const state = useSettingsStore.getState();
    expect(state.modelSettings.provider_overrides.anthropic.api_key).toBe("sk-ant-test-key");
    expect(state.workspacePath).toBe("/some/path");
    expect(state.skillsPath).toBe("/some/skills");
    expect(state.isConfigured).toBe(true);
  });

  it("treats skillsPath as configured even when canonical model is missing", () => {
    useSettingsStore.getState().setSettings({
      modelSettings: {
        provider_id: "anthropic",
        model_id: null,
        provider_overrides: {
          anthropic: {
            api_key: "sk-ant-test-key",
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
      skillsPath: "/some/skills",
    });

    expect(useSettingsStore.getState().isConfigured).toBe(true);
  });

  it("setSettings stores dashboardViewMode", () => {
    useSettingsStore.getState().setSettings({
      dashboardViewMode: "list",
    });
    expect(useSettingsStore.getState().dashboardViewMode).toBe("list");

    useSettingsStore.getState().setSettings({
      dashboardViewMode: "grid",
    });
    expect(useSettingsStore.getState().dashboardViewMode).toBe("grid");
  });

  it("reset returns to initial state", () => {
    useSettingsStore.getState().setSettings({
      modelSettings: {
        provider_id: "anthropic",
        model_id: "claude-sonnet-4-5",
        provider_overrides: {
          anthropic: {
            api_key: "sk-ant-test-key",
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
      workspacePath: "/some/path",
      skillsPath: "/some/skills",
    });
    // Verify configured before reset
    expect(useSettingsStore.getState().isConfigured).toBe(true);

    useSettingsStore.getState().reset();

    const state = useSettingsStore.getState();
    expect(state.modelSettings.provider_id).toBeNull();
    expect(state.modelSettings.model_id).toBeNull();
    expect(state.workspacePath).toBeNull();
    expect(state.isConfigured).toBe(false);
  });

});
