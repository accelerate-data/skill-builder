import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useSkillFiles } from "@/hooks/use-skill-files";
import { useEditorStore } from "@/stores/editor-store";
import { mockInvoke } from "@/test/mocks/tauri";
import { makeFileEntry } from "@/test/fixtures";

describe("useSkillFiles", () => {
  beforeEach(() => {
    useEditorStore.getState().reset();
    mockInvoke.mockReset();
  });

  it("loads files on mount when workspace and skill are provided", async () => {
    const files = [
      makeFileEntry({ name: "SKILL.md", relative_path: "SKILL.md" }),
      makeFileEntry({ name: "context", relative_path: "context", is_directory: true }),
    ];
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_skill_files") return Promise.resolve(files);
      return Promise.reject(new Error(`Unmocked: ${cmd}`));
    });

    const { result } = renderHook(() => useSkillFiles("/ws", "my-skill"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(useEditorStore.getState().files).toEqual(files);
    expect(mockInvoke).toHaveBeenCalledWith("list_skill_files", {
      workspacePath: "/ws",
      skillName: "my-skill",
    });
  });

  it("does not load when workspacePath is null", () => {
    renderHook(() => useSkillFiles(null, "my-skill"));

    expect(mockInvoke).not.toHaveBeenCalledWith("list_skill_files", expect.anything());
  });

  it("does not load when skillName is empty", () => {
    renderHook(() => useSkillFiles("/ws", ""));

    expect(mockInvoke).not.toHaveBeenCalledWith("list_skill_files", expect.anything());
  });

  it("sets error on load failure", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_skill_files") return Promise.reject(new Error("Skill not found"));
      return Promise.reject(new Error(`Unmocked: ${cmd}`));
    });

    const { result } = renderHook(() => useSkillFiles("/ws", "bad-skill"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("Skill not found");
  });

  it("sets error from string rejection", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_skill_files") return Promise.reject("some string error");
      return Promise.reject(new Error(`Unmocked: ${cmd}`));
    });

    const { result } = renderHook(() => useSkillFiles("/ws", "bad-skill"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("some string error");
  });

  it("reload re-fetches files", async () => {
    const files = [makeFileEntry()];
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_skill_files") return Promise.resolve(files);
      return Promise.reject(new Error(`Unmocked: ${cmd}`));
    });

    const { result } = renderHook(() => useSkillFiles("/ws", "my-skill"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should have been called once from useEffect
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    // Call reload
    const updatedFiles = [makeFileEntry(), makeFileEntry({ name: "new.md" })];
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_skill_files") return Promise.resolve(updatedFiles);
      return Promise.reject(new Error(`Unmocked: ${cmd}`));
    });

    await act(async () => {
      await result.current.reload();
    });

    expect(useEditorStore.getState().files).toEqual(updatedFiles);
  });
});
