import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSettingsStore } from "@/stores/settings-store";

const mocks = vi.hoisted(() => ({
  updateUserSettings: vi.fn(),
  listModels: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  updateUserSettings: mocks.updateUserSettings,
  listModels: mocks.listModels,
}));

vi.mock("@/lib/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { useSettingsForm } from "@/hooks/use-settings-form";

describe("useSettingsForm", () => {
  beforeEach(() => {
    mocks.updateUserSettings.mockReset();
    mocks.updateUserSettings.mockResolvedValue(undefined);
    mocks.listModels.mockReset();
    mocks.listModels.mockResolvedValue([]);
    useSettingsStore.getState().reset();
  });

  it("initializes fields from store snapshot", () => {
    useSettingsStore.getState().setSettings({
      anthropicApiKey: "sk-test",
      preferredModel: "claude-sonnet-4-6",
      logLevel: "debug",
    });

    const { result } = renderHook(() => useSettingsForm());

    expect(result.current.apiKey).toBe("sk-test");
    expect(result.current.preferredModel).toBe("claude-sonnet-4-6");
    expect(result.current.logLevel).toBe("debug");
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

  it("autoSave applies overrides over local state", async () => {
    useSettingsStore.getState().setSettings({ preferredModel: "old-model" });
    const { result } = renderHook(() => useSettingsForm());

    await act(async () => {
      await result.current.autoSave({ preferredModel: "new-model" });
    });

    const payload = mocks.updateUserSettings.mock.calls[0][0];
    expect(payload.preferred_model).toBe("new-model");
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
      result.current.setExtendedThinking(true);
      result.current.setMaxDimensions(10);
    });

    expect(result.current.logLevel).toBe("debug");
    expect(result.current.extendedThinking).toBe(true);
    expect(result.current.maxDimensions).toBe(10);
  });
});
