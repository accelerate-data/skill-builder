import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSettingsStore } from "@/stores/settings-store";

const mocks = vi.hoisted(() => ({
  updateUserSettings: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  updateUserSettings: mocks.updateUserSettings,
}));

vi.mock("@/lib/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { useSettingsForm } from "@/hooks/use-settings-form";

describe("useSettingsForm", () => {
  beforeEach(() => {
    mocks.updateUserSettings.mockReset();
    mocks.updateUserSettings.mockResolvedValue(undefined);
    useSettingsStore.getState().reset();
  });

  it("initializes fields from store snapshot", () => {
    useSettingsStore.getState().setSettings({
      modelSettings: {
        provider: "openai",
        model: "gpt-4o",
        api_key: "sk-openai",
        base_url: "https://models.example.com/v1",
      },
      logLevel: "debug",
    });

    const { result } = renderHook(() => useSettingsForm());

    expect(result.current.modelSettings.provider).toBe("openai");
    expect(result.current.modelSettings.api_key).toBe("sk-openai");
    expect(result.current.modelSettings.model).toBe("gpt-4o");
    expect(result.current.modelSettings.base_url).toBe("https://models.example.com/v1");
    expect(result.current.logLevel).toBe("debug");
  });

  it("keeps provider, model, and api_key null when store model settings are unset", () => {
    const { result } = renderHook(() => useSettingsForm());

    expect(result.current.modelSettings.provider).toBeNull();
    expect(result.current.modelSettings.model).toBeNull();
    expect(result.current.modelSettings.api_key).toBeNull();
  });

  it("autoSave calls updateUserSettings and updates store", async () => {
    const { result } = renderHook(() => useSettingsForm());

    await act(async () => {
      await result.current.autoSave({ logLevel: "warn" });
    });

    expect(mocks.updateUserSettings).toHaveBeenCalledTimes(1);
    const payload = mocks.updateUserSettings.mock.calls[0][0];
    expect(payload.log_level).toBe("warn");
  });

  it("autoSave applies model settings overrides over local state", async () => {
    useSettingsStore.getState().setSettings({
      modelSettings: {
        provider: "anthropic",
        model: "old-model",
        api_key: "sk-test",
        base_url: null,
      },
    });
    const { result } = renderHook(() => useSettingsForm());

    await act(async () => {
      await result.current.saveModelSettings({ model: "claude-sonnet-4-5" });
    });

    const payload = mocks.updateUserSettings.mock.calls[0][0];
    expect(payload.model_settings).toEqual(
      expect.objectContaining({
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        api_key: "sk-test",
        base_url: null,
      }),
    );
    expect(payload).not.toHaveProperty("preferred_model");
    expect(payload).not.toHaveProperty("openhands_model");
  });

  it("autoSave persists canonical model settings and updates store", async () => {
    const { result } = renderHook(() => useSettingsForm());

    await act(async () => {
      await result.current.saveModelSettings({
        provider: "ollama",
        api_key: null,
        model: "llama3.1",
        base_url: "http://localhost:11434",
      });
    });

    const payload = mocks.updateUserSettings.mock.calls[0][0];
    expect(payload.model_settings).toEqual(
      expect.objectContaining({
        provider: "ollama",
        api_key: null,
        model: "llama3.1",
        base_url: "http://localhost:11434",
      }),
    );
    expect(payload).not.toHaveProperty("openhands_provider");
    expect(payload).not.toHaveProperty("openhands_api_key");
    expect(payload).not.toHaveProperty("openhands_base_url");
    expect(useSettingsStore.getState().modelSettings.provider).toBe("ollama");
    expect(useSettingsStore.getState().modelSettings.base_url).toBe("http://localhost:11434");
  });

  it("redacts API keys in successful auto-save logs", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { result } = renderHook(() => useSettingsForm());

    await act(async () => {
      await result.current.saveModelSettings({ api_key: "sk-openai-secret" });
    });

    expect(logSpy).toHaveBeenCalledWith(
      "[settings] Saved: modelSettings.api_key=[redacted]",
    );
    expect(logSpy.mock.calls.join("\n")).not.toContain("sk-openai-secret");
    logSpy.mockRestore();
  });

  it("autoSave sets saved indicator", async () => {
    const { result } = renderHook(() => useSettingsForm());

    expect(result.current.saved).toBe(false);

    await act(async () => {
      await result.current.autoSave({ logLevel: "info" });
    });

    expect(result.current.saved).toBe(true);
  });

  it("field setters update local state", () => {
    const { result } = renderHook(() => useSettingsForm());

    act(() => {
      result.current.setLogLevel("debug");
      result.current.setMaxDimensions(10);
    });

    expect(result.current.logLevel).toBe("debug");
    expect(result.current.maxDimensions).toBe(10);
  });
});
