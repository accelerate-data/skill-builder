import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "@/stores/editor-store";

describe("editor-store", () => {
  beforeEach(() => {
    useEditorStore.getState().reset();
  });

  it("starts with default state", () => {
    const state = useEditorStore.getState();
    expect(state.files).toEqual([]);
    expect(state.activeFile).toBeNull();
    expect(state.activeFileContent).toBe("");
    expect(state.isDirty).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.isSaving).toBe(false);
  });

  it("sets files", () => {
    const files = [
      { name: "SKILL.md", relative_path: "SKILL.md", absolute_path: "/ws/skill/SKILL.md", is_directory: false, is_readonly: false, size_bytes: 100 },
    ];
    useEditorStore.getState().setFiles(files);
    expect(useEditorStore.getState().files).toEqual(files);
  });

  it("tracks dirty state when content changes", () => {
    useEditorStore.getState().setOriginalContent("original");
    expect(useEditorStore.getState().isDirty).toBe(false);

    useEditorStore.getState().setActiveFileContent("modified");
    expect(useEditorStore.getState().isDirty).toBe(true);

    useEditorStore.getState().setActiveFileContent("original");
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it("markSaved clears dirty state", () => {
    useEditorStore.getState().setOriginalContent("original");
    useEditorStore.getState().setActiveFileContent("modified");
    expect(useEditorStore.getState().isDirty).toBe(true);

    useEditorStore.getState().markSaved();
    expect(useEditorStore.getState().isDirty).toBe(false);
    expect(useEditorStore.getState().originalContent).toBe("modified");
  });

  it("reset clears all state", () => {
    useEditorStore.getState().setFiles([
      { name: "test.md", relative_path: "test.md", absolute_path: "/test.md", is_directory: false, is_readonly: false, size_bytes: 50 },
    ]);
    useEditorStore.getState().setOriginalContent("content");
    useEditorStore.getState().setActiveFileContent("changed");

    useEditorStore.getState().reset();

    const state = useEditorStore.getState();
    expect(state.files).toEqual([]);
    expect(state.activeFile).toBeNull();
    expect(state.isDirty).toBe(false);
  });
});
