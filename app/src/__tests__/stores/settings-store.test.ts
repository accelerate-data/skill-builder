import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "@/stores/settings-store";

describe("useSettingsStore", () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useSettingsStore.getState().reset();
  });

  it("has null fields and isConfigured=false in initial state", () => {
    const state = useSettingsStore.getState();
    expect(state.anthropicApiKey).toBeNull();
    expect(state.workspacePath).toBeNull();
    expect(state.isConfigured).toBe(false);
  });

  it("setSettings with apiKey sets isConfigured to true", () => {
    useSettingsStore.getState().setSettings({
      anthropicApiKey: "sk-ant-test-key",
    });
    const state = useSettingsStore.getState();
    expect(state.anthropicApiKey).toBe("sk-ant-test-key");
    expect(state.isConfigured).toBe(true);
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
      anthropicApiKey: "sk-ant-test-key",
    });
    useSettingsStore.getState().setSettings({
      workspacePath: "/some/path",
    });
    const state = useSettingsStore.getState();
    expect(state.anthropicApiKey).toBe("sk-ant-test-key");
    expect(state.workspacePath).toBe("/some/path");
    expect(state.isConfigured).toBe(true);
  });

  it("reset returns to initial state", () => {
    useSettingsStore.getState().setSettings({
      anthropicApiKey: "sk-ant-test-key",
      workspacePath: "/some/path",
    });
    // Verify configured before reset
    expect(useSettingsStore.getState().isConfigured).toBe(true);

    useSettingsStore.getState().reset();

    const state = useSettingsStore.getState();
    expect(state.anthropicApiKey).toBeNull();
    expect(state.workspacePath).toBeNull();
    expect(state.isConfigured).toBe(false);
  });

});
