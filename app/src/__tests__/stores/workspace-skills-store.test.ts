import { describe, it, expect, beforeEach } from "vitest";
import { mockInvoke, mockInvokeCommands, resetTauriMocks } from "@/test/mocks/tauri";
import { useWorkspaceSkillsStore } from "@/stores/workspace-skills-store";
import type { WorkspaceSkill } from "@/stores/workspace-skills-store";

const sampleSkills: WorkspaceSkill[] = [
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
    is_active: false,
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

describe("useWorkspaceSkillsStore", () => {
  beforeEach(() => {
    resetTauriMocks();
    useWorkspaceSkillsStore.setState({
      skills: [],
      isLoading: false,
      error: null,
      selectedSkill: null,
    });
  });

  it("starts with empty state", () => {
    const state = useWorkspaceSkillsStore.getState();
    expect(state.skills).toEqual([]);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.selectedSkill).toBeNull();
  });

  describe("fetchSkills", () => {
    it("fetches skills and updates state", async () => {
      mockInvokeCommands({ list_workspace_skills: sampleSkills });

      await useWorkspaceSkillsStore.getState().fetchSkills();

      const state = useWorkspaceSkillsStore.getState();
      expect(state.skills).toHaveLength(2);
      expect(state.skills[0].skill_name).toBe("sales-analytics");
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(mockInvoke).toHaveBeenCalledWith("list_workspace_skills");
    });

    it("sets error on failure", async () => {
      mockInvoke.mockRejectedValue(new Error("Network error"));

      await useWorkspaceSkillsStore.getState().fetchSkills();

      const state = useWorkspaceSkillsStore.getState();
      expect(state.skills).toEqual([]);
      expect(state.error).toBe("Network error");
      expect(state.isLoading).toBe(false);
    });

    it("sets isLoading during fetch", async () => {
      let resolvePromise: (value: WorkspaceSkill[]) => void;
      mockInvoke.mockReturnValue(
        new Promise<WorkspaceSkill[]>((resolve) => {
          resolvePromise = resolve;
        })
      );

      const promise = useWorkspaceSkillsStore.getState().fetchSkills();
      expect(useWorkspaceSkillsStore.getState().isLoading).toBe(true);

      resolvePromise!(sampleSkills);
      await promise;
      expect(useWorkspaceSkillsStore.getState().isLoading).toBe(false);
    });
  });

  describe("uploadSkill", () => {
    it("uploads and prepends skill to list", async () => {
      const newSkill: WorkspaceSkill = {
        skill_id: "id-3",
        skill_name: "new-skill",
        description: "A new skill",
        is_active: true,
        disk_path: "/skills/new-skill",
        imported_at: "2026-02-01T12:00:00Z",
        is_bundled: false,
        purpose: null,
        version: null,
        model: null,
        argument_hint: null,
        user_invocable: null,
        disable_model_invocation: null,
        marketplace_source_url: null,
      };
      mockInvokeCommands({ upload_skill: newSkill });

      // Start with existing skills
      useWorkspaceSkillsStore.setState({ skills: sampleSkills });

      const result = await useWorkspaceSkillsStore.getState().uploadSkill({
        filePath: "/path/to/file.skill",
        name: "new-skill",
        description: "A new skill",
        version: "1.0.0",
        forceOverwrite: false,
      });

      expect(result).toEqual(newSkill);
      expect(mockInvoke).toHaveBeenCalledWith("upload_skill", expect.objectContaining({
        filePath: "/path/to/file.skill",
        name: "new-skill",
        forceOverwrite: false,
      }));

      const state = useWorkspaceSkillsStore.getState();
      expect(state.skills).toHaveLength(3);
      expect(state.skills[0].skill_name).toBe("new-skill");
    });
  });

  describe("toggleActive", () => {
    it("toggles skill active state and refreshes list", async () => {
      const refreshedSkills: WorkspaceSkill[] = [
        { ...sampleSkills[0], is_active: false },
        sampleSkills[1],
      ];
      mockInvokeCommands({
        toggle_skill_active: undefined,
        list_workspace_skills: refreshedSkills,
      });
      useWorkspaceSkillsStore.setState({ skills: sampleSkills });

      await useWorkspaceSkillsStore.getState().toggleActive("id-1", false);

      expect(mockInvoke).toHaveBeenCalledWith("toggle_skill_active", {
        skillId: "id-1",
        active: false,
      });

      const state = useWorkspaceSkillsStore.getState();
      const toggled = state.skills.find((s) => s.skill_name === "sales-analytics");
      expect(toggled?.is_active).toBe(false);
      expect(mockInvoke).toHaveBeenCalledWith("list_workspace_skills");
    });

    it("keeps selectedSkill synced with refreshed list", async () => {
      const refreshedSkills: WorkspaceSkill[] = [
        sampleSkills[0],
        { ...sampleSkills[1], is_active: true },
      ];
      mockInvokeCommands({
        toggle_skill_active: undefined,
        list_workspace_skills: refreshedSkills,
      });
      useWorkspaceSkillsStore.setState({ skills: sampleSkills });
      useWorkspaceSkillsStore.getState().setSelectedSkill(sampleSkills[1]);

      await useWorkspaceSkillsStore.getState().toggleActive("id-2", true);

      expect(useWorkspaceSkillsStore.getState().selectedSkill?.is_active).toBe(true);
    });
  });

  describe("setPurpose", () => {
    it("sets purpose and refreshes list", async () => {
      const refreshedSkills: WorkspaceSkill[] = [
        sampleSkills[0],
        { ...sampleSkills[1], purpose: "research" },
      ];
      mockInvokeCommands({
        set_workspace_skill_purpose: undefined,
        list_workspace_skills: refreshedSkills,
      });
      useWorkspaceSkillsStore.setState({ skills: sampleSkills });

      await useWorkspaceSkillsStore.getState().setPurpose("id-2", "research");

      expect(mockInvoke).toHaveBeenCalledWith("set_workspace_skill_purpose", {
        skillId: "id-2",
        purpose: "research",
      });
      expect(useWorkspaceSkillsStore.getState().skills[1].purpose).toBe("research");
    });

    it("clears selectedSkill if it disappears after refresh", async () => {
      mockInvokeCommands({
        set_workspace_skill_purpose: undefined,
        list_workspace_skills: [sampleSkills[1]],
      });
      useWorkspaceSkillsStore.setState({ skills: sampleSkills, selectedSkill: sampleSkills[0] });

      await useWorkspaceSkillsStore.getState().setPurpose("id-2", "research");

      expect(useWorkspaceSkillsStore.getState().selectedSkill).toBeNull();
    });
  });

  describe("deleteSkill", () => {
    it("removes skill from list", async () => {
      mockInvokeCommands({ delete_workspace_skill: undefined });
      useWorkspaceSkillsStore.setState({ skills: sampleSkills });

      await useWorkspaceSkillsStore.getState().deleteSkill("id-1");

      expect(mockInvoke).toHaveBeenCalledWith("delete_workspace_skill", {
        skillId: "id-1",
      });

      const state = useWorkspaceSkillsStore.getState();
      expect(state.skills).toHaveLength(1);
      expect(state.skills[0].skill_name).toBe("hr-metrics");
    });

    it("clears selectedSkill if deleted skill was selected", async () => {
      mockInvokeCommands({ delete_workspace_skill: undefined });
      useWorkspaceSkillsStore.setState({
        skills: sampleSkills,
        selectedSkill: sampleSkills[0],
      });

      await useWorkspaceSkillsStore.getState().deleteSkill("id-1");

      expect(useWorkspaceSkillsStore.getState().selectedSkill).toBeNull();
    });

    it("keeps selectedSkill if a different skill was deleted", async () => {
      mockInvokeCommands({ delete_workspace_skill: undefined });
      useWorkspaceSkillsStore.setState({
        skills: sampleSkills,
        selectedSkill: sampleSkills[0],
      });

      await useWorkspaceSkillsStore.getState().deleteSkill("id-2");

      expect(useWorkspaceSkillsStore.getState().selectedSkill?.skill_name).toBe(
        "sales-analytics"
      );
    });
  });

  describe("getSkillContent", () => {
    it("invokes get_skill_content and returns content", async () => {
      mockInvokeCommands({ get_skill_content: "# My Skill\nContent here" });

      const content = await useWorkspaceSkillsStore.getState().getSkillContent("sales-analytics");

      expect(content).toBe("# My Skill\nContent here");
      expect(mockInvoke).toHaveBeenCalledWith("get_skill_content", {
        skillName: "sales-analytics",
      });
    });
  });

  describe("setSelectedSkill", () => {
    it("sets selected skill", () => {
      useWorkspaceSkillsStore.getState().setSelectedSkill(sampleSkills[0]);
      expect(useWorkspaceSkillsStore.getState().selectedSkill).toEqual(sampleSkills[0]);
    });

    it("clears selected skill", () => {
      useWorkspaceSkillsStore.setState({ selectedSkill: sampleSkills[0] });
      useWorkspaceSkillsStore.getState().setSelectedSkill(null);
      expect(useWorkspaceSkillsStore.getState().selectedSkill).toBeNull();
    });
  });
});
