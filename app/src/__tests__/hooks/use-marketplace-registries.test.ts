import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSettingsStore } from "@/stores/settings-store";

const mocks = vi.hoisted(() => ({
  checkMarketplaceUrl: vi.fn(),
  parseGitHubUrl: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  checkMarketplaceUrl: mocks.checkMarketplaceUrl,
  parseGitHubUrl: mocks.parseGitHubUrl,
}));

vi.mock("@/lib/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { useMarketplaceRegistries, DEFAULT_MARKETPLACE_URL } from "@/hooks/use-marketplace-registries";

describe("useMarketplaceRegistries", () => {
  const mockAutoSave = vi.fn();

  beforeEach(() => {
    mockAutoSave.mockReset();
    mocks.checkMarketplaceUrl.mockReset();
    mocks.parseGitHubUrl.mockReset();
    useSettingsStore.getState().reset();
    useSettingsStore.getState().setSettings({
      marketplaceRegistries: [
        { name: "Default", source_url: DEFAULT_MARKETPLACE_URL, enabled: true },
        { name: "Custom", source_url: "org/custom-skills", enabled: true },
      ],
    });
  });

  it("returns current registries from store", () => {
    const { result } = renderHook(() => useMarketplaceRegistries(mockAutoSave));
    expect(result.current.marketplaceRegistries).toHaveLength(2);
    expect(result.current.marketplaceRegistries[0].name).toBe("Default");
  });

  it("toggleRegistry updates enabled flag and calls autoSave", () => {
    const { result } = renderHook(() => useMarketplaceRegistries(mockAutoSave));

    act(() => {
      result.current.toggleRegistry("org/custom-skills", false);
    });

    expect(mockAutoSave).toHaveBeenCalledTimes(1);
    const updated = mockAutoSave.mock.calls[0][0].marketplaceRegistries;
    const custom = updated.find((r: { source_url: string }) => r.source_url === "org/custom-skills");
    expect(custom.enabled).toBe(false);
  });

  it("removeRegistry filters out the registry and calls autoSave", () => {
    const { result } = renderHook(() => useMarketplaceRegistries(mockAutoSave));

    act(() => {
      result.current.removeRegistry({ name: "Custom", source_url: "org/custom-skills", enabled: true });
    });

    expect(mockAutoSave).toHaveBeenCalledTimes(1);
    const updated = mockAutoSave.mock.calls[0][0].marketplaceRegistries;
    expect(updated).toHaveLength(1);
    expect(updated[0].source_url).toBe(DEFAULT_MARKETPLACE_URL);
  });

  it("isDuplicateUrl detects existing URLs", () => {
    const { result } = renderHook(() => useMarketplaceRegistries(mockAutoSave));

    // Set the URL input to an existing registry
    act(() => {
      result.current.setNewRegistryUrl("org/custom-skills");
    });

    expect(result.current.isDuplicateUrl).toBe(true);
  });

  it("isDuplicateUrl returns false for new URL", () => {
    const { result } = renderHook(() => useMarketplaceRegistries(mockAutoSave));

    act(() => {
      result.current.setNewRegistryUrl("org/new-skills");
    });

    expect(result.current.isDuplicateUrl).toBe(false);
  });

  it("cancelAdd resets add state", () => {
    const { result } = renderHook(() => useMarketplaceRegistries(mockAutoSave));

    act(() => {
      result.current.setAddingRegistry(true);
      result.current.setNewRegistryUrl("org/test");
    });

    expect(result.current.addingRegistry).toBe(true);
    expect(result.current.newRegistryUrl).toBe("org/test");

    act(() => {
      result.current.cancelAdd();
    });

    expect(result.current.addingRegistry).toBe(false);
    expect(result.current.newRegistryUrl).toBe("");
  });
});
