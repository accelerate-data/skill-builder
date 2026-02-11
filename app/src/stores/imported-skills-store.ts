import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface ImportedSkill {
  skill_id: string;
  skill_name: string;
  domain: string | null;
  description: string | null;
  is_active: boolean;
  disk_path: string;
  imported_at: string;
}

interface ImportedSkillsState {
  skills: ImportedSkill[];
  isLoading: boolean;
  error: string | null;
  selectedSkill: ImportedSkill | null;

  fetchSkills: () => Promise<void>;
  uploadSkill: (filePath: string) => Promise<ImportedSkill>;
  toggleActive: (skillName: string, active: boolean) => Promise<void>;
  deleteSkill: (skillName: string) => Promise<void>;
  getSkillContent: (skillName: string) => Promise<string>;
  setSelectedSkill: (skill: ImportedSkill | null) => void;
}

export const useImportedSkillsStore = create<ImportedSkillsState>((set) => ({
  skills: [],
  isLoading: false,
  error: null,
  selectedSkill: null,

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

  uploadSkill: async (filePath: string) => {
    const skill = await invoke<ImportedSkill>("upload_skill", { filePath });
    set((state) => ({ skills: [skill, ...state.skills] }));
    return skill;
  },

  toggleActive: async (skillName: string, active: boolean) => {
    await invoke("toggle_skill_active", { skillName, active });
    set((state) => ({
      skills: state.skills.map((s) =>
        s.skill_name === skillName ? { ...s, is_active: active } : s
      ),
    }));
  },

  deleteSkill: async (skillName: string) => {
    await invoke("delete_imported_skill", { skillName });
    set((state) => ({
      skills: state.skills.filter((s) => s.skill_name !== skillName),
      selectedSkill:
        state.selectedSkill?.skill_name === skillName
          ? null
          : state.selectedSkill,
    }));
  },

  getSkillContent: async (skillName: string) => {
    return invoke<string>("get_skill_content", { skillName });
  },

  setSelectedSkill: (skill) => set({ selectedSkill: skill }),
}));
