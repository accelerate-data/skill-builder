import { describe, it, expect, beforeEach } from "vitest";
import { mockInvoke, mockInvokeCommands, resetTauriMocks } from "@/test/mocks/tauri";
import { useImportedSkillsStore } from "@/stores/imported-skills-store";
import type { ImportedSkill } from "@/stores/imported-skills-store";

const sampleSkills: ImportedSkill[] = [
  {
    skill_id: "id-1",
    skill_name: "sales-analytics",
    domain: "sales",
    description: "Analytics skill for sales data",
    is_active: true,
    disk_path: "/skills/sales-analytics",
    imported_at: "2026-01-15T10:00:00Z",
  },
  {
    skill_id: "id-2",
    skill_name: "hr-metrics",
    domain: "HR",
    description: null,
    is_active: false,
    disk_path: "/skills/hr-metrics",
    imported_at: "2026-01-10T08:00:00Z",
  },
];

describe("useImportedSkillsStore", () => {
  beforeEach(() => {
    resetTauriMocks();
    useImportedSkillsStore.setState({
      skills: [],
      isLoading: false,
      error: null,
      selectedSkill: null,
    });
  });

  it("starts with empty state", () => {
    const state = useImportedSkillsStore.getState();
    expect(state.skills).toEqual([]);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.selectedSkill).toBeNull();
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

  describe("uploadSkill", () => {
    it("uploads and prepends skill to list", async () => {
      const newSkill: ImportedSkill = {
        skill_id: "id-3",
        skill_name: "new-skill",
        domain: "marketing",
        description: "A new skill",
        is_active: true,
        disk_path: "/skills/new-skill",
        imported_at: "2026-02-01T12:00:00Z",
      };
      mockInvokeCommands({ upload_skill: newSkill });

      // Start with existing skills
      useImportedSkillsStore.setState({ skills: sampleSkills });

      const result = await useImportedSkillsStore.getState().uploadSkill("/path/to/file.skill");

      expect(result).toEqual(newSkill);
      expect(mockInvoke).toHaveBeenCalledWith("upload_skill", { filePath: "/path/to/file.skill" });

      const state = useImportedSkillsStore.getState();
      expect(state.skills).toHaveLength(3);
      expect(state.skills[0].skill_name).toBe("new-skill");
    });
  });

  describe("toggleActive", () => {
    it("toggles skill active state", async () => {
      mockInvokeCommands({ toggle_skill_active: undefined });
      useImportedSkillsStore.setState({ skills: sampleSkills });

      await useImportedSkillsStore.getState().toggleActive("sales-analytics", false);

      expect(mockInvoke).toHaveBeenCalledWith("toggle_skill_active", {
        skillName: "sales-analytics",
        active: false,
      });

      const state = useImportedSkillsStore.getState();
      const toggled = state.skills.find((s) => s.skill_name === "sales-analytics");
      expect(toggled?.is_active).toBe(false);
    });

    it("does not affect other skills", async () => {
      mockInvokeCommands({ toggle_skill_active: undefined });
      useImportedSkillsStore.setState({ skills: sampleSkills });

      await useImportedSkillsStore.getState().toggleActive("hr-metrics", true);

      const state = useImportedSkillsStore.getState();
      const other = state.skills.find((s) => s.skill_name === "sales-analytics");
      expect(other?.is_active).toBe(true); // unchanged
    });
  });

  describe("deleteSkill", () => {
    it("removes skill from list", async () => {
      mockInvokeCommands({ delete_imported_skill: undefined });
      useImportedSkillsStore.setState({ skills: sampleSkills });

      await useImportedSkillsStore.getState().deleteSkill("sales-analytics");

      expect(mockInvoke).toHaveBeenCalledWith("delete_imported_skill", {
        skillName: "sales-analytics",
      });

      const state = useImportedSkillsStore.getState();
      expect(state.skills).toHaveLength(1);
      expect(state.skills[0].skill_name).toBe("hr-metrics");
    });

    it("clears selectedSkill if deleted skill was selected", async () => {
      mockInvokeCommands({ delete_imported_skill: undefined });
      useImportedSkillsStore.setState({
        skills: sampleSkills,
        selectedSkill: sampleSkills[0],
      });

      await useImportedSkillsStore.getState().deleteSkill("sales-analytics");

      expect(useImportedSkillsStore.getState().selectedSkill).toBeNull();
    });

    it("keeps selectedSkill if a different skill was deleted", async () => {
      mockInvokeCommands({ delete_imported_skill: undefined });
      useImportedSkillsStore.setState({
        skills: sampleSkills,
        selectedSkill: sampleSkills[0],
      });

      await useImportedSkillsStore.getState().deleteSkill("hr-metrics");

      expect(useImportedSkillsStore.getState().selectedSkill?.skill_name).toBe(
        "sales-analytics"
      );
    });
  });

  describe("getSkillContent", () => {
    it("invokes get_skill_content and returns content", async () => {
      mockInvokeCommands({ get_skill_content: "# My Skill\nContent here" });

      const content = await useImportedSkillsStore.getState().getSkillContent("sales-analytics");

      expect(content).toBe("# My Skill\nContent here");
      expect(mockInvoke).toHaveBeenCalledWith("get_skill_content", {
        skillName: "sales-analytics",
      });
    });
  });

  describe("setSelectedSkill", () => {
    it("sets selected skill", () => {
      useImportedSkillsStore.getState().setSelectedSkill(sampleSkills[0]);
      expect(useImportedSkillsStore.getState().selectedSkill).toEqual(sampleSkills[0]);
    });

    it("clears selected skill", () => {
      useImportedSkillsStore.setState({ selectedSkill: sampleSkills[0] });
      useImportedSkillsStore.getState().setSelectedSkill(null);
      expect(useImportedSkillsStore.getState().selectedSkill).toBeNull();
    });
  });
});
