import { create } from "zustand";
import type { WorkspaceSurface } from "@/components/workspace/workspace-shell";

interface WorkspaceState {
  activeSurface: WorkspaceSurface;
  setActiveSurface: (surface: WorkspaceSurface) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeSurface: "overview",
  setActiveSurface: (surface) => set({ activeSurface: surface }),
}));
