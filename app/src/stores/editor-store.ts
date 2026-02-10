import { create } from "zustand";
import type { FileEntry } from "@/lib/types";

interface EditorState {
  files: FileEntry[];
  activeFile: FileEntry | null;
  activeFileContent: string;
  originalContent: string;
  isDirty: boolean;
  isLoading: boolean;
  isSaving: boolean;

  setFiles: (files: FileEntry[]) => void;
  setActiveFile: (file: FileEntry | null) => void;
  setActiveFileContent: (content: string) => void;
  setOriginalContent: (content: string) => void;
  markSaved: () => void;
  setLoading: (loading: boolean) => void;
  setSaving: (saving: boolean) => void;
  reset: () => void;
}

const initialState = {
  files: [] as FileEntry[],
  activeFile: null as FileEntry | null,
  activeFileContent: "",
  originalContent: "",
  isDirty: false,
  isLoading: false,
  isSaving: false,
};

export const useEditorStore = create<EditorState>((set) => ({
  ...initialState,
  setFiles: (files) => set({ files }),
  setActiveFile: (file) => set({ activeFile: file }),
  setActiveFileContent: (content) =>
    set((state) => ({
      activeFileContent: content,
      isDirty: content !== state.originalContent,
    })),
  setOriginalContent: (content) =>
    set({ originalContent: content, activeFileContent: content, isDirty: false }),
  markSaved: () =>
    set((state) => ({
      originalContent: state.activeFileContent,
      isDirty: false,
      isSaving: false,
    })),
  setLoading: (isLoading) => set({ isLoading }),
  setSaving: (isSaving) => set({ isSaving }),
  reset: () => set(initialState),
}));
