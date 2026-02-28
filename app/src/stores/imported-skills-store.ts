import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceSkill } from "@/lib/types";

export type { WorkspaceSkill };

interface ImportedSkillsState {
  skills: WorkspaceSkill[];
  isLoading: boolean;
  error: string | null;
  selectedSkill: WorkspaceSkill | null;

  fetchSkills: () => Promise<void>;
  uploadSkill: (filePath: string) => Promise<WorkspaceSkill>;
  toggleActive: (skillId: string, active: boolean) => Promise<void>;
  deleteSkill: (skillId: string) => Promise<void>;
  getSkillContent: (skillName: string) => Promise<string>;
  setSelectedSkill: (skill: WorkspaceSkill | null) => void;
  setPurpose: (skillId: string, purpose: string | null) => Promise<void>;
}

export const useImportedSkillsStore = create<ImportedSkillsState>((set) => ({
  skills: [],
  isLoading: false,
  error: null,
  selectedSkill: null,

  fetchSkills: async () => {
    set({ isLoading: true, error: null });
    try {
      const skills = await invoke<WorkspaceSkill[]>("list_workspace_skills");
      set({ skills, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        isLoading: false,
      });
    }
  },

  uploadSkill: async (filePath: string) => {
    const skill = await invoke<WorkspaceSkill>("upload_skill", { filePath });
    set((state) => ({ skills: [skill, ...state.skills] }));
    return skill;
  },

  toggleActive: async (skillId: string, active: boolean) => {
    await invoke("toggle_skill_active", { skillId, active });
    set((state) => ({
      skills: state.skills.map((s) =>
        s.skill_id === skillId ? { ...s, is_active: active } : s
      ),
    }));
  },

  deleteSkill: async (skillId: string) => {
    await invoke("delete_imported_skill", { skillId });
    set((state) => ({
      skills: state.skills.filter((s) => s.skill_id !== skillId),
      selectedSkill:
        state.selectedSkill?.skill_id === skillId
          ? null
          : state.selectedSkill,
    }));
  },

  getSkillContent: async (skillName: string) => {
    return invoke<string>("get_skill_content", { skillName });
  },

  setSelectedSkill: (skill) => set({ selectedSkill: skill }),

  setPurpose: async (skillId: string, purpose: string | null) => {
    await invoke<void>("set_workspace_skill_purpose", { skillId, purpose });
    set((state) => ({
      skills: state.skills.map((s) =>
        s.skill_id === skillId ? { ...s, purpose } : s
      ),
      selectedSkill:
        state.selectedSkill?.skill_id === skillId
          ? { ...state.selectedSkill, purpose }
          : state.selectedSkill,
    }));
  },
}));
