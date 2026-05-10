import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useWorkflowAutosave } from "@/hooks/use-workflow-autosave";

vi.mock("@/lib/tauri", () => ({
  invokeCommand: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { invokeCommand } from "@/lib/tauri";

const makeSection = (questions = []) => ({ id: "s1", title: "Section 1", questions });
const makeQuestion = (overrides = {}) => ({
  id: "q1",
  text: "Test question",
  answer_choice: null,
  answer_text: null,
  refinements: [],
  ...overrides,
});

describe("useWorkflowAutosave", () => {
  const defaultOptions = {
    skillId: 1,
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

  it("syncs clarificationsData from dbClarificationsData on completed editable step", async () => {
    vi.useRealTimers();
    const dbData = { sections: [makeSection([makeQuestion()])] };

    const { result } = renderHook(() =>
      useWorkflowAutosave({ ...defaultOptions, dbClarificationsData: dbData })
    );

    await waitFor(() => {
      expect(result.current.clarificationsData).toEqual(dbData);
    });
  });

  it("does not sync when step is not completed", async () => {
    vi.useRealTimers();
    const dbData = { sections: [makeSection([makeQuestion()])] };

    const { result } = renderHook(() =>
      useWorkflowAutosave({
        ...defaultOptions,
        currentStepStatus: "pending",
        dbClarificationsData: dbData,
      })
    );

    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.clarificationsData).toBeNull();
  });

  it("does not sync when clarificationsEditable is false", async () => {
    vi.useRealTimers();
    const dbData = { sections: [makeSection([makeQuestion()])] };

    const { result } = renderHook(() =>
      useWorkflowAutosave({
        ...defaultOptions,
        clarificationsEditable: false,
        dbClarificationsData: dbData,
      })
    );

    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.clarificationsData).toBeNull();
  });

  it("handleClarificationsChange sets editorDirty and calls invokeCommand for changed answers", async () => {
    vi.useRealTimers();
    const q = makeQuestion({ id: "q1", answer_choice: null, answer_text: null });
    const dbData = { sections: [makeSection([q])] };

    const { result } = renderHook(() =>
      useWorkflowAutosave({ ...defaultOptions, dbClarificationsData: dbData })
    );

    // Wait for initial DB sync
    await waitFor(() => expect(result.current.clarificationsData).not.toBeNull());

    const updated = { sections: [makeSection([{ ...q, answer_choice: "A" }])] };
    act(() => {
      result.current.handleClarificationsChange(updated);
    });

    expect(result.current.editorDirty).toBe(true);
    await waitFor(() => {
      expect(invokeCommand).toHaveBeenCalledWith("update_clarification_answer", {
        skillId: "1",
        questionId: "q1",
        answerChoice: "A",
        answerText: null,
      });
    });
  });

  it("handleClarificationsChange does not call invokeCommand when nothing changed", async () => {
    vi.useRealTimers();
    const q = makeQuestion({ id: "q1", answer_choice: "B", answer_text: null });
    const dbData = { sections: [makeSection([q])] };

    const { result } = renderHook(() =>
      useWorkflowAutosave({ ...defaultOptions, dbClarificationsData: dbData })
    );

    await waitFor(() => expect(result.current.clarificationsData).not.toBeNull());

    // Same answer — no change
    act(() => {
      result.current.handleClarificationsChange({ sections: [makeSection([{ ...q }])] });
    });

    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("sets saveStatus to saved after successful persist", async () => {
    vi.useRealTimers();
    vi.mocked(invokeCommand).mockResolvedValue(undefined);

    const q = makeQuestion({ id: "q1", answer_choice: null });
    const dbData = { sections: [makeSection([q])] };

    const { result } = renderHook(() =>
      useWorkflowAutosave({ ...defaultOptions, dbClarificationsData: dbData })
    );

    await waitFor(() => expect(result.current.clarificationsData).not.toBeNull());

    act(() => {
      result.current.handleClarificationsChange({
        sections: [makeSection([{ ...q, answer_choice: "A" }])],
      });
    });

    await waitFor(() => {
      expect(result.current.saveStatus).toBe("saved");
    });
  });

  it("sets saveStatus to dirty and toasts on persist failure", async () => {
    vi.useRealTimers();
    const saveError = new Error("disk full");
    vi.mocked(invokeCommand).mockRejectedValue(saveError);

    const q = makeQuestion({ id: "q1", answer_choice: null });
    const dbData = { sections: [makeSection([q])] };

    const { result } = renderHook(() =>
      useWorkflowAutosave({ ...defaultOptions, dbClarificationsData: dbData })
    );

    await waitFor(() => expect(result.current.clarificationsData).not.toBeNull());

    act(() => {
      result.current.handleClarificationsChange({
        sections: [makeSection([{ ...q, answer_choice: "A" }])],
      });
    });

    const { toast } = await import("@/lib/toast");
    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(result.current.saveStatus).toBe("dirty");
    });
  });

  it("handleSave returns true when no unsaved changes exist", async () => {
    vi.useRealTimers();
    const { result } = renderHook(() => useWorkflowAutosave(defaultOptions));

    let saveResult: boolean | undefined;
    await act(async () => {
      saveResult = await result.current.handleSave();
    });

    expect(saveResult).toBe(true);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("handleSave returns false when clarificationsEditable is false", async () => {
    vi.useRealTimers();
    const { result } = renderHook(() =>
      useWorkflowAutosave({ ...defaultOptions, clarificationsEditable: false })
    );

    let saveResult: boolean | undefined;
    await act(async () => {
      saveResult = await result.current.handleSave();
    });

    expect(saveResult).toBe(false);
  });

  it("updateClarificationsState updates data without marking dirty", () => {
    const { result } = renderHook(() =>
      useWorkflowAutosave({ ...defaultOptions, currentStepStatus: "pending" })
    );

    const newData = { sections: [makeSection([makeQuestion({ id: "q1", text: "updated" })])] };
    act(() => {
      result.current.updateClarificationsState(newData);
    });

    expect(result.current.editorDirty).toBe(false);
    expect(result.current.saveStatus).toBe("idle");
    expect(result.current.clarificationsData).toEqual(newData);
  });

  it("does not overwrite in-flight edits when dbClarificationsData updates", async () => {
    vi.useRealTimers();
    const q = makeQuestion({ id: "q1", answer_choice: null });
    const dbData1 = { sections: [makeSection([q])] };
    let dbData = dbData1;

    const { result, rerender } = renderHook(() =>
      useWorkflowAutosave({ ...defaultOptions, dbClarificationsData: dbData })
    );

    await waitFor(() => expect(result.current.clarificationsData).not.toBeNull());

    // Make a local edit (marks hasUnsavedChanges)
    const editedData = { sections: [makeSection([{ ...q, answer_choice: "A" }])] };
    act(() => {
      result.current.handleClarificationsChange(editedData);
    });

    // DB query returns new data — but in-flight edits should not be overwritten
    dbData = { sections: [makeSection([{ ...q, answer_choice: "B" }])] };
    rerender();

    // Local state should still reflect user's edit, not the DB update
    expect(result.current.clarificationsData?.sections[0].questions[0].answer_choice).toBe("A");
  });

  it("does not resync local state when dbClarificationsData is a fresh clone of the same data", async () => {
    vi.useRealTimers();
    const dbData = { sections: [makeSection([makeQuestion()])] };

    let incoming = dbData;
    const { result, rerender } = renderHook(() =>
      useWorkflowAutosave({
        ...defaultOptions,
        dbClarificationsData: incoming,
      })
    );

    await waitFor(() => expect(result.current.clarificationsData).toEqual(dbData));

    const firstSyncedValue = result.current.clarificationsData;
    incoming = {
      sections: [makeSection([makeQuestion()])],
    };
    rerender();

    await waitFor(() => expect(result.current.clarificationsData).toBe(firstSyncedValue));
  });
});
