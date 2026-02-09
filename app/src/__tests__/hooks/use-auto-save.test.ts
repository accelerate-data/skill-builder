import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAutoSave } from "@/hooks/use-auto-save";
import { useEditorStore } from "@/stores/editor-store";
import { mockInvoke } from "@/test/mocks/tauri";

// Mock sonner
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("useAutoSave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useEditorStore.getState().reset();
    mockInvoke.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not save when not dirty", () => {
    useEditorStore.getState().setOriginalContent("content");

    renderHook(() => useAutoSave());
    vi.advanceTimersByTime(2000);

    expect(mockInvoke).not.toHaveBeenCalledWith("save_raw_file", expect.anything());
  });

  it("does not save read-only files", () => {
    useEditorStore.getState().setActiveFile({
      name: "test.md",
      relative_path: "context/test.md",
      absolute_path: "/ws/skill/context/test.md",
      is_directory: false,
      is_readonly: true,
      size_bytes: 100,
    });
    useEditorStore.getState().setOriginalContent("original");
    useEditorStore.getState().setActiveFileContent("modified");

    renderHook(() => useAutoSave());
    vi.advanceTimersByTime(2000);

    expect(mockInvoke).not.toHaveBeenCalledWith("save_raw_file", expect.anything());
  });

  it("saves after 1.5s debounce when dirty", async () => {
    mockInvoke.mockResolvedValue(undefined);

    useEditorStore.getState().setActiveFile({
      name: "SKILL.md",
      relative_path: "skill/SKILL.md",
      absolute_path: "/ws/skill/skill/SKILL.md",
      is_directory: false,
      is_readonly: false,
      size_bytes: 100,
    });
    useEditorStore.getState().setOriginalContent("original");
    useEditorStore.getState().setActiveFileContent("modified");

    renderHook(() => useAutoSave());

    // Not saved yet at 1s
    vi.advanceTimersByTime(1000);
    expect(mockInvoke).not.toHaveBeenCalledWith("save_raw_file", expect.anything());

    // Saved at 1.5s
    vi.advanceTimersByTime(500);
    // Need to flush promises
    await vi.advanceTimersByTimeAsync(0);

    expect(mockInvoke).toHaveBeenCalledWith("save_raw_file", {
      filePath: "/ws/skill/skill/SKILL.md",
      content: "modified",
    });
  });
});
