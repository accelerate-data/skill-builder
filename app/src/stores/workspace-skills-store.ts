import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceSkill } from "@/lib/types";

export type { WorkspaceSkill };

export interface UploadSkillParams {
  filePath: string;
  name: string;
  description: string;
  version: string;
  model?: string | null;
  argumentHint?: string | null;
  userInvocable?: boolean | null;
  disableModelInvocation?: boolean | null;
  purpose?: string | null;
  forceOverwrite: boolean;
}

interface WorkspaceSkillsState {
  skills: WorkspaceSkill[];
  isLoading: boolean;
  error: string | null;
  selectedSkill: WorkspaceSkill | null;

  fetchSkills: () => Promise<void>;
  uploadSkill: (params: UploadSkillParams) => Promise<WorkspaceSkill>;
  toggleActive: (skillId: string, active: boolean) => Promise<void>;
  deleteSkill: (skillId: string) => Promise<void>;
  getSkillContent: (skillName: string) => Promise<string>;
  setSelectedSkill: (skill: WorkspaceSkill | null) => void;
  setPurpose: (skillId: string, purpose: string | null) => Promise<void>;
}

export const useWorkspaceSkillsStore = create<WorkspaceSkillsState>((set) => ({
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

  uploadSkill: async (params: UploadSkillParams) => {
    const skill = await invoke<WorkspaceSkill>("upload_skill", {
      filePath: params.filePath,
      name: params.name,
      description: params.description,
      version: params.version,
      model: params.model ?? null,
      argumentHint: params.argumentHint ?? null,
      userInvocable: params.userInvocable ?? null,
      disableModelInvocation: params.disableModelInvocation ?? null,
      purpose: params.purpose ?? null,
      forceOverwrite: params.forceOverwrite,
    });
    set((state) => {
      const exists = state.skills.some((s) => s.skill_name === skill.skill_name);
      const skills = exists
        ? state.skills.map((s) => (s.skill_name === skill.skill_name ? skill : s))
        : [skill, ...state.skills];
      return { skills };
    });
    return skill;
  },

  toggleActive: async (skillId: string, active: boolean) => {
    await invoke("toggle_skill_active", { skillId, active });
    const skills = await invoke<WorkspaceSkill[]>("list_workspace_skills");
    set((state) => ({
      skills,
      selectedSkill: state.selectedSkill
        ? skills.find((s) => s.skill_id === state.selectedSkill?.skill_id) ?? null
        : null,
    }));
  },

  deleteSkill: async (skillId: string) => {
    await invoke("delete_workspace_skill", { skillId });
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
    const skills = await invoke<WorkspaceSkill[]>("list_workspace_skills");
    set((state) => ({
      skills,
      selectedSkill: state.selectedSkill
        ? skills.find((s) => s.skill_id === state.selectedSkill?.skill_id) ?? null
        : null,
    }));
  },
}));
