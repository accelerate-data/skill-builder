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

  it("starts with empty defaults and supports basic setters", () => {
    const state = useSkillStore.getState();
    expect(state.skills).toEqual([]);
    expect(state.activeSkill).toBeNull();
    expect(state.isLoading).toBe(false);

    // setActiveSkill
    useSkillStore.getState().setActiveSkill("my-skill");
    expect(useSkillStore.getState().activeSkill).toBe("my-skill");
    useSkillStore.getState().setActiveSkill(null);
    expect(useSkillStore.getState().activeSkill).toBeNull();

    // setLoading
    useSkillStore.getState().setLoading(true);
    expect(useSkillStore.getState().isLoading).toBe(true);
  });

  it("setSkills stores skills, clears loading, and replaces previous skills", () => {
    useSkillStore.getState().setLoading(true);

    const skills = [
      makeSkillSummary({ name: "skill-a" }),
      makeSkillSummary({ name: "skill-b", purpose: "domain" }),
    ];
    useSkillStore.getState().setSkills(skills);

    let state = useSkillStore.getState();
    expect(state.skills).toHaveLength(2);
    expect(state.skills[0].name).toBe("skill-a");
    expect(state.skills[1].purpose).toBe("domain");
    expect(state.isLoading).toBe(false);

    // Replaces previous skills entirely
    useSkillStore.getState().setSkills([
      makeSkillSummary({ name: "new-a" }),
      makeSkillSummary({ name: "new-b" }),
      makeSkillSummary({ name: "new-c" }),
    ]);

    state = useSkillStore.getState();
    expect(state.skills).toHaveLength(3);
    expect(state.skills.map((s) => s.name)).toEqual(["new-a", "new-b", "new-c"]);
  });
});
