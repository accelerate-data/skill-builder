import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { ImportedSkill } from "@/lib/types";

interface ImportedSkillsState {
  skills: ImportedSkill[];
  isLoading: boolean;
  error: string | null;
  fetchSkills: () => Promise<void>;
  deleteSkill: (skillId: string, refetch: () => Promise<void>) => Promise<void>;
}

export const useImportedSkillsStore = create<ImportedSkillsState>((set) => ({
  skills: [],
  isLoading: false,
  error: null,

  fetchSkills: async () => {
    set({ isLoading: true, error: null });
    try {
      const skills = await invoke<ImportedSkill[]>("list_imported_skills");
      set({ skills, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        isLoading: false,
      });
    }
  },

  deleteSkill: async (skillId: string, refetch: () => Promise<void>) => {
    await invoke<void>("delete_imported_skill", { skillId });
    await refetch();
  },
}));
