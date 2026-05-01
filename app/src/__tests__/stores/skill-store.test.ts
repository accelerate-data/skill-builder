import { describe, it, expect, beforeEach } from "vitest";
import { useSkillStore } from "@/stores/skill-store";

describe("useSkillStore", () => {
  beforeEach(() => {
    useSkillStore.setState({
      activeSkill: null,
      lockedSkills: new Set(),
      latestVersion: null,
    });
  });

  it("stores selected skill UI state", () => {
    const state = useSkillStore.getState();
    expect(state.activeSkill).toBeNull();

    useSkillStore.getState().setActiveSkill("my-skill");
    expect(useSkillStore.getState().activeSkill).toBe("my-skill");
    useSkillStore.getState().setActiveSkill(null);
    expect(useSkillStore.getState().activeSkill).toBeNull();
  });

  it("initial lockedSkills is an empty Set", () => {
    const state = useSkillStore.getState();
    expect(state.lockedSkills).toBeInstanceOf(Set);
    expect(state.lockedSkills.size).toBe(0);
  });

  it("setLockedSkills with new Set makes specific members present and others absent", () => {
    useSkillStore.getState().setLockedSkills(new Set(["a", "b"]));
    const { lockedSkills } = useSkillStore.getState();
    expect(lockedSkills.has("a")).toBe(true);
    expect(lockedSkills.has("b")).toBe(true);
    expect(lockedSkills.has("c")).toBe(false);
  });

  it("setLockedSkills with a new Set replaces the previous one entirely", () => {
    useSkillStore.getState().setLockedSkills(new Set(["a", "b"]));
    useSkillStore.getState().setLockedSkills(new Set(["x", "y"]));
    const { lockedSkills } = useSkillStore.getState();
    expect(lockedSkills.has("x")).toBe(true);
    expect(lockedSkills.has("y")).toBe(true);
    expect(lockedSkills.has("a")).toBe(false);
    expect(lockedSkills.has("b")).toBe(false);
  });

  it("setLockedSkills with an empty Set clears all locked skills", () => {
    useSkillStore.getState().setLockedSkills(new Set(["a"]));
    useSkillStore.getState().setLockedSkills(new Set());
    expect(useSkillStore.getState().lockedSkills.size).toBe(0);
  });

  it("stores latest version UI state for immediate post-restore display", () => {
    useSkillStore.getState().setLatestVersion("3");
    expect(useSkillStore.getState().latestVersion).toBe("3");
  });
});
