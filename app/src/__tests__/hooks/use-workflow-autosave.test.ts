import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useWorkflowAutosave } from "@/hooks/use-workflow-autosave";

vi.mock("@/lib/tauri", () => ({
  getClarificationsContent: vi.fn(),
  saveClarificationsContent: vi.fn(() => Promise.resolve()),
  readFile: vi.fn(() => Promise.reject("not found")),
}));

vi.mock("@/lib/clarifications-types", () => ({
  parseClarifications: vi.fn((raw: string | null) => {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }),
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { getClarificationsContent, saveClarificationsContent } from "@/lib/tauri";

describe("useWorkflowAutosave", () => {
  const defaultOptions = {
    workspacePath: "/workspace",
    skillName: "test-skill",
    clarificationsEditable: true,
    currentStepStatus: "completed",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads clarifications on completed editable step", async () => {
    vi.useRealTimers();
    const rawContent = JSON.stringify({ questions: [] });
    vi.mocked(getClarificationsContent).mockResolvedValue(rawContent);

    renderHook(() => useWorkflowAutosave(defaultOptions));

    await waitFor(() => {
      expect(getClarificationsContent).toHaveBeenCalledWith("test-skill", "/workspace");
    });
  });

  it("does not load when step is not completed", async () => {
    vi.useRealTimers();
    renderHook(() =>
      useWorkflowAutosave({ ...defaultOptions, currentStepStatus: "pending" })
    );

    await new Promise((r) => setTimeout(r, 10));
    expect(getClarificationsContent).not.toHaveBeenCalled();
  });

  it("handleClarificationsChange sets editorDirty", () => {
    const { result } = renderHook(() =>
      useWorkflowAutosave({ ...defaultOptions, currentStepStatus: "pending" })
    );

    expect(result.current.editorDirty).toBe(false);

    act(() => {
      result.current.handleClarificationsChange({ questions: [] } as any);
    });

    expect(result.current.editorDirty).toBe(true);
    expect(result.current.saveStatus).toBe("dirty");
  });

  it("handleSave persists content and resets status", async () => {
    vi.useRealTimers();
    vi.mocked(saveClarificationsContent).mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useWorkflowAutosave({ ...defaultOptions, currentStepStatus: "pending" })
    );

    act(() => {
      result.current.handleClarificationsChange({ questions: [{ id: "q1", text: "test" }] } as any);
    });

    await act(async () => {
      await result.current.handleSave(true);
    });

    expect(saveClarificationsContent).toHaveBeenCalled();
    expect(result.current.editorDirty).toBe(false);
    expect(result.current.saveStatus).toBe("saved");
  });

  it("autosave fires after 1500ms of inactivity", async () => {
    vi.mocked(saveClarificationsContent).mockResolvedValue(undefined);

    const { result } = renderHook(() => useWorkflowAutosave(defaultOptions));

    act(() => {
      result.current.handleClarificationsChange({ questions: [] } as any);
    });

    expect(saveClarificationsContent).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(saveClarificationsContent).toHaveBeenCalled();
  });

  it("updateClarificationsState updates data without marking dirty", () => {
    const { result } = renderHook(() =>
      useWorkflowAutosave({ ...defaultOptions, currentStepStatus: "pending" })
    );

    act(() => {
      result.current.updateClarificationsState({ questions: [{ id: "q1", text: "updated" }] } as any, '{"questions":[]}');
    });

    expect(result.current.editorDirty).toBe(false);
    expect(result.current.saveStatus).toBe("idle");
    expect(result.current.clarificationsData).toEqual({ questions: [{ id: "q1", text: "updated" }] });
  });
});
