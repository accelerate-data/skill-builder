import { describe, it, expect, beforeEach } from "vitest";
import { mockInvoke, mockInvokeCommands, resetTauriMocks } from "@/test/mocks/tauri";
import { useImportedSkillsStore } from "@/stores/imported-skills-store";
import type { ImportedSkill } from "@/lib/types";

const sampleSkills: ImportedSkill[] = [
  {
    skill_id: "id-1",
    skill_name: "sales-analytics",
    description: "Analytics skill for sales data",
    is_active: true,
    disk_path: "/skills/sales-analytics",
    imported_at: "2026-01-15T10:00:00Z",
    is_bundled: false,
    purpose: null,
    version: null,
    model: null,
    argument_hint: null,
    user_invocable: null,
    disable_model_invocation: null,
    marketplace_source_url: null,
  },
  {
    skill_id: "id-2",
    skill_name: "hr-metrics",
    description: null,
    is_active: true,
    disk_path: "/skills/hr-metrics",
    imported_at: "2026-01-10T08:00:00Z",
    is_bundled: false,
    purpose: null,
    version: null,
    model: null,
    argument_hint: null,
    user_invocable: null,
    disable_model_invocation: null,
    marketplace_source_url: null,
  },
];

describe("useImportedSkillsStore", () => {
  beforeEach(() => {
    resetTauriMocks();
    useImportedSkillsStore.setState({
      skills: [],
      isLoading: false,
      error: null,
    });
  });

  it("starts with empty state", () => {
    const state = useImportedSkillsStore.getState();
    expect(state.skills).toEqual([]);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  describe("fetchSkills", () => {
    it("fetches skills and updates state", async () => {
      mockInvokeCommands({ list_imported_skills: sampleSkills });

      await useImportedSkillsStore.getState().fetchSkills();

      const state = useImportedSkillsStore.getState();
      expect(state.skills).toHaveLength(2);
      expect(state.skills[0].skill_name).toBe("sales-analytics");
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(mockInvoke).toHaveBeenCalledWith("list_imported_skills");
    });

    it("sets error on failure", async () => {
      mockInvoke.mockRejectedValue(new Error("Network error"));

      await useImportedSkillsStore.getState().fetchSkills();

      const state = useImportedSkillsStore.getState();
      expect(state.skills).toEqual([]);
      expect(state.error).toBe("Network error");
      expect(state.isLoading).toBe(false);
    });

    it("sets isLoading during fetch", async () => {
      let resolvePromise: (value: ImportedSkill[]) => void;
      mockInvoke.mockReturnValue(
        new Promise<ImportedSkill[]>((resolve) => {
          resolvePromise = resolve;
        })
      );

      const promise = useImportedSkillsStore.getState().fetchSkills();
      expect(useImportedSkillsStore.getState().isLoading).toBe(true);

      resolvePromise!(sampleSkills);
      await promise;
      expect(useImportedSkillsStore.getState().isLoading).toBe(false);
    });
  });

  describe("deleteSkill", () => {
    it("removes skill from list", async () => {
      mockInvokeCommands({ delete_imported_skill: undefined });
      useImportedSkillsStore.setState({ skills: sampleSkills });

      await useImportedSkillsStore.getState().deleteSkill("id-1");

      expect(mockInvoke).toHaveBeenCalledWith("delete_imported_skill", {
        skillId: "id-1",
      });

      const state = useImportedSkillsStore.getState();
      expect(state.skills).toHaveLength(1);
      expect(state.skills[0].skill_name).toBe("hr-metrics");
    });
  });
});
