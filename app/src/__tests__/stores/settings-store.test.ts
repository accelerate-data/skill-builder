import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "@/stores/settings-store";

describe("useSettingsStore", () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useSettingsStore.getState().reset();
  });

  it("has null fields and isConfigured=false in initial state", () => {
    const state = useSettingsStore.getState();
    expect(state.modelSettings.api_key).toBeNull();
    expect(state.workspacePath).toBeNull();
    expect(state.dashboardViewMode).toBeNull();
    expect(state.isConfigured).toBe(false);
  });

  it("setSettings with model settings and skillsPath sets isConfigured to true", () => {
    useSettingsStore.getState().setSettings({
      modelSettings: {
        model: "claude-sonnet-4-5",
        api_key: "sk-ant-test-key",
      },
      skillsPath: "/some/skills",
    });
    const state = useSettingsStore.getState();
    expect(state.modelSettings.api_key).toBe("sk-ant-test-key");
    expect(state.skillsPath).toBe("/some/skills");
    expect(state.isConfigured).toBe(true);
  });

  it("setSettings with model settings only keeps isConfigured false (skillsPath required)", () => {
    useSettingsStore.getState().setSettings({
      modelSettings: {
        model: "claude-sonnet-4-5",
        api_key: "sk-ant-test-key",
      },
    });
    const state = useSettingsStore.getState();
    expect(state.modelSettings.api_key).toBe("sk-ant-test-key");
    expect(state.isConfigured).toBe(false);
  });

  it("setSettings without apiKey keeps isConfigured false", () => {
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
        model: "claude-sonnet-4-5",
        api_key: "sk-ant-test-key",
      },
      skillsPath: "/some/skills",
    });
    useSettingsStore.getState().setSettings({
      workspacePath: "/some/path",
    });
    const state = useSettingsStore.getState();
    expect(state.modelSettings.api_key).toBe("sk-ant-test-key");
    expect(state.workspacePath).toBe("/some/path");
    expect(state.skillsPath).toBe("/some/skills");
    expect(state.isConfigured).toBe(true);
  });

  it("does not treat legacy OpenHands fields as model configuration", () => {
    useSettingsStore.getState().setSettings({
      anthropicApiKey: "sk-ant-test-key",
      openhandsProvider: "openai",
      openhandsApiKey: null,
      openhandsModel: "openai/gpt-4o",
      skillsPath: "/some/skills",
    });

    expect(useSettingsStore.getState().isConfigured).toBe(false);
  });

  it("does not treat a legacy Anthropic key as model configuration", () => {
    useSettingsStore.getState().setSettings({
      anthropicApiKey: "sk-ant-test-key",
      openhandsProvider: "anthropic",
      openhandsApiKey: null,
      openhandsModel: "anthropic/claude-sonnet-4-6",
      skillsPath: "/some/skills",
    });

    expect(useSettingsStore.getState().isConfigured).toBe(false);
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
        model: "claude-sonnet-4-5",
        api_key: "sk-ant-test-key",
      },
      workspacePath: "/some/path",
      skillsPath: "/some/skills",
    });
    // Verify configured before reset
    expect(useSettingsStore.getState().isConfigured).toBe(true);

    useSettingsStore.getState().reset();

    const state = useSettingsStore.getState();
    expect(state.modelSettings.api_key).toBeNull();
    expect(state.workspacePath).toBeNull();
    expect(state.isConfigured).toBe(false);
  });

});
