import { describe, it, expect, beforeEach } from "vitest";
import { useSkillStore } from "@/stores/skill-store";
import { makeSkillSummary } from "@/test/fixtures";

describe("useSkillStore", () => {
  beforeEach(() => {
    useSkillStore.setState({
      skills: [],
      activeSkill: null,
      isLoading: false,
    });
  });

  it("starts with empty skills and no active skill", () => {
    const state = useSkillStore.getState();
    expect(state.skills).toEqual([]);
    expect(state.activeSkill).toBeNull();
    expect(state.isLoading).toBe(false);
  });

  it("setSkills stores skills and clears loading", () => {
    useSkillStore.getState().setLoading(true);

    const skills = [
      makeSkillSummary({ name: "skill-a" }),
      makeSkillSummary({ name: "skill-b", domain: "finance" }),
    ];
    useSkillStore.getState().setSkills(skills);

    const state = useSkillStore.getState();
    expect(state.skills).toHaveLength(2);
    expect(state.skills[0].name).toBe("skill-a");
    expect(state.skills[1].domain).toBe("finance");
    expect(state.isLoading).toBe(false);
  });

  it("setActiveSkill sets and clears active skill", () => {
    useSkillStore.getState().setActiveSkill("my-skill");
    expect(useSkillStore.getState().activeSkill).toBe("my-skill");

    useSkillStore.getState().setActiveSkill(null);
    expect(useSkillStore.getState().activeSkill).toBeNull();
  });

  it("setLoading updates loading state", () => {
    useSkillStore.getState().setLoading(true);
    expect(useSkillStore.getState().isLoading).toBe(true);

    useSkillStore.getState().setLoading(false);
    expect(useSkillStore.getState().isLoading).toBe(false);
  });

  it("setSkills replaces previous skills entirely", () => {
    useSkillStore.getState().setSkills([
      makeSkillSummary({ name: "old-skill" }),
    ]);
    expect(useSkillStore.getState().skills).toHaveLength(1);

    useSkillStore.getState().setSkills([
      makeSkillSummary({ name: "new-a" }),
      makeSkillSummary({ name: "new-b" }),
      makeSkillSummary({ name: "new-c" }),
    ]);

    const state = useSkillStore.getState();
    expect(state.skills).toHaveLength(3);
    expect(state.skills.map((s) => s.name)).toEqual(["new-a", "new-b", "new-c"]);
  });
});
