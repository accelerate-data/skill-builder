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
        provider_id: "openai",
        model_id: "gpt-4o",
        provider_overrides: {
          openai: {
            api_key: "sk-openai",
            base_url_override: "https://models.example.com/v1",
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
      logLevel: "debug",
    });

    const { result } = renderHook(() => useSettingsForm());

    expect(result.current.modelSettings.provider_id).toBe("openai");
    expect(result.current.modelSettings.model_id).toBe("gpt-4o");
    expect(result.current.modelSettings.provider_overrides.openai.api_key).toBe("sk-openai");
    expect(result.current.modelSettings.provider_overrides.openai.base_url_override).toBe("https://models.example.com/v1");
    expect(result.current.logLevel).toBe("debug");
  });

  it("keeps provider_id and model_id null when store model settings are unset", () => {
    const { result } = renderHook(() => useSettingsForm());

    expect(result.current.modelSettings.provider_id).toBeNull();
    expect(result.current.modelSettings.model_id).toBeNull();
  });

  it("keeps provider_id null when saving model settings before choosing a provider", async () => {
    const { result } = renderHook(() => useSettingsForm());

    await act(async () => {
      await result.current.saveModelSettings({
        provider_overrides: {
          ollama: {
            api_key: null,
            base_url_override: "http://localhost:11434",
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
      });
    });

    expect(mocks.updateUserSettings).toHaveBeenCalledTimes(1);
    const payload = mocks.updateUserSettings.mock.calls[0][0];
    expect(payload.model_settings.provider_id).toBeNull();
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
        provider_id: "anthropic",
        model_id: "old-model",
        provider_overrides: {
          anthropic: {
            api_key: "sk-test",
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
    const { result } = renderHook(() => useSettingsForm());

    await act(async () => {
      await result.current.saveModelSettings({ model_id: "claude-sonnet-4-5" });
    });

    const payload = mocks.updateUserSettings.mock.calls[0][0];
    expect(payload.model_settings.provider_id).toBe("anthropic");
    expect(payload.model_settings.model_id).toBe("claude-sonnet-4-5");
    expect(payload).not.toHaveProperty("preferred_model");
    expect(payload).not.toHaveProperty("openhands_model");
  });

  it("autoSave persists canonical model settings and updates store", async () => {
    const { result } = renderHook(() => useSettingsForm());

    await act(async () => {
      await result.current.saveModelSettings({
        provider_id: "ollama",
        model_id: "llama3.1",
        provider_overrides: {
          ollama: {
            api_key: null,
            base_url_override: "http://localhost:11434",
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
      });
    });

    const payload = mocks.updateUserSettings.mock.calls[0][0];
    expect(payload.model_settings.provider_id).toBe("ollama");
    expect(payload.model_settings.model_id).toBe("llama3.1");
    expect(payload).not.toHaveProperty("openhands_provider");
    expect(payload).not.toHaveProperty("openhands_api_key");
    expect(payload).not.toHaveProperty("openhands_base_url");
    expect(useSettingsStore.getState().modelSettings.provider_id).toBe("ollama");
  });

  it("redacts API keys in successful auto-save logs", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { result } = renderHook(() => useSettingsForm());

    await act(async () => {
      await result.current.saveModelSettings({
        provider_overrides: {
          test: {
            api_key: "sk-openai-secret",
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
      });
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("[settings] Saved:"),
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
