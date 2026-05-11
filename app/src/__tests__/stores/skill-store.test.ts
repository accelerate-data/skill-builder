import { describe, it, expect, beforeEach } from "vitest";
import { useSkillStore } from "@/stores/skill-store";

describe("useSkillStore", () => {
  beforeEach(() => {
    useSkillStore.setState({
      activeSkillId: null,
      lockedSkills: new Set(),
      latestVersion: null,
    });
  });

  it("stores selected skill UI state", () => {
    const state = useSkillStore.getState();
    expect(state.activeSkillId).toBeNull();

    useSkillStore.getState().setActiveSkill("my-skill");
    expect(useSkillStore.getState().activeSkillId).toBe("my-skill");
    useSkillStore.getState().setActiveSkill(null);
    expect(useSkillStore.getState().activeSkillId).toBeNull();
  });

  it("initial lockedSkills is an empty Set", () => {
    const state = useSkillStore.getState();
    expect(state.lockedSkills).toBeInstanceOf(Set);
    expect(state.lockedSkills.size).toBe(0);
  });

  it("setLockedSkills with new Set makes specific members present and others absent", () => {
    useSkillStore.getState().setLockedSkills(new Set([1, 2]));
    const { lockedSkills } = useSkillStore.getState();
    expect(lockedSkills.has(1)).toBe(true);
    expect(lockedSkills.has(2)).toBe(true);
    expect(lockedSkills.has(3)).toBe(false);
  });

  it("setLockedSkills with a new Set replaces the previous one entirely", () => {
    useSkillStore.getState().setLockedSkills(new Set([1, 2]));
    useSkillStore.getState().setLockedSkills(new Set([3, 4]));
    const { lockedSkills } = useSkillStore.getState();
    expect(lockedSkills.has(3)).toBe(true);
    expect(lockedSkills.has(4)).toBe(true);
    expect(lockedSkills.has(1)).toBe(false);
    expect(lockedSkills.has(2)).toBe(false);
  });

  it("setLockedSkills with an empty Set clears all locked skills", () => {
    useSkillStore.getState().setLockedSkills(new Set([1]));
    useSkillStore.getState().setLockedSkills(new Set());
    expect(useSkillStore.getState().lockedSkills.size).toBe(0);
  });

  it("stores latest version UI state for immediate post-restore display", () => {
    useSkillStore.getState().setLatestVersion("3");
    expect(useSkillStore.getState().latestVersion).toBe("3");
  });
});
