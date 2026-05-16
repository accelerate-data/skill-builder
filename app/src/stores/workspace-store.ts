import { create } from "zustand";
import type { RefineDiff } from "@/lib/types";
import type { WorkspaceSurface } from "@/components/workspace/workspace-shell";

export interface SkillFile {
  filename: string;
  content: string;
}

interface WorkspaceState {
  activeSurface: WorkspaceSurface;
  skillFiles: SkillFile[];
  isLoadingFiles: boolean;
  activeFileTab: string;
  selectedModifiedFile: string | null;
  diffMode: boolean;
  gitDiff: RefineDiff | null;
  setActiveSurface: (surface: WorkspaceSurface) => void;
  setSkillFiles: (files: SkillFile[]) => void;
  setLoadingFiles: (loading: boolean) => void;
  setActiveFileTab: (filename: string) => void;
  setSelectedModifiedFile: (filename: string | null) => void;
  setDiffMode: (diffMode: boolean) => void;
  setGitDiff: (diff: RefineDiff | null) => void;
  resetFileViewer: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeSurface: "overview",
  skillFiles: [],
  isLoadingFiles: false,
  activeFileTab: "SKILL.md",
  selectedModifiedFile: null,
  diffMode: false,
  gitDiff: null,
  setActiveSurface: (surface) => set({ activeSurface: surface }),
  setSkillFiles: (skillFiles) => set({ skillFiles, isLoadingFiles: false }),
  setLoadingFiles: (isLoadingFiles) => set({ isLoadingFiles }),
  setActiveFileTab: (activeFileTab) => set({ activeFileTab }),
  setSelectedModifiedFile: (selectedModifiedFile) => set({ selectedModifiedFile }),
  setDiffMode: (diffMode) => set({ diffMode }),
  setGitDiff: (gitDiff) => set({ gitDiff }),
  resetFileViewer: () =>
    set({
      skillFiles: [],
      isLoadingFiles: false,
      activeFileTab: "SKILL.md",
      selectedModifiedFile: null,
      diffMode: false,
      gitDiff: null,
    }),
}));
