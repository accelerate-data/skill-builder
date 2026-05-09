import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  navigateToSkillSurface,
  leaveActiveSkillForNonSkillRoute,
  type SkillNavigationTarget,
  type SkillNavigationDeps,
  type LeaveToNonSkillRouteDeps,
} from "@/lib/route-skill-session";

const mockNavigate = vi.fn();
const mockSetSelectedSkillName = vi.fn();
const mockSetActiveSessionSkillName = vi.fn();
const mockLeaveCurrentSkill = vi.fn();
const mockEnterSkill = vi.fn();

function buildNavigationDeps(
  overrides: Partial<SkillNavigationDeps> = {},
): SkillNavigationDeps {
  return {
    currentActiveSessionSkillName: null,
    navigate: mockNavigate,
    setSelectedSkillName: mockSetSelectedSkillName,
    setActiveSessionSkillName: mockSetActiveSessionSkillName,
    leaveCurrentSkill: mockLeaveCurrentSkill,
    enterSkill: mockEnterSkill,
    ...overrides,
  };
}

function buildLeaveRouteDeps(route: string): LeaveToNonSkillRouteDeps {
  return {
    currentActiveSessionSkillName: null,
    route,
    navigate: mockNavigate,
    setActiveSessionSkillName: mockSetActiveSessionSkillName,
    leaveCurrentSkill: mockLeaveCurrentSkill,
  };
}

function makeSkill(name: string) {
  return {
    name,
    status: "completed" as const,
    current_step: null,
    last_modified: null,
    tags: [],
    purpose: "domain" as const,
    skill_source: "skill-builder" as const,
    author_login: null,
    author_avatar: null,
    intake_json: null,
    plugin_slug: "skills",
    plugin_display_name: "Skills",
    is_default_plugin: true,
  };
}

describe("navigateToSkillSurface", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockSetSelectedSkillName.mockClear();
    mockSetActiveSessionSkillName.mockClear();
    mockLeaveCurrentSkill.mockClear();
    mockEnterSkill.mockClear();
  });

  it("does not leave or re-enter when moving between surfaces of the same skill", async () => {
    const target: SkillNavigationTarget = {
      skillName: "sales-skill",
      skill: makeSkill("sales-skill"),
      route: { to: "/workspace/$skillName/refine", params: { skillName: "sales-skill" } },
      workspacePath: "/workspace",
    };

    await navigateToSkillSurface(target, buildNavigationDeps({
      currentActiveSessionSkillName: "sales-skill",
    }));

    expect(mockLeaveCurrentSkill).not.toHaveBeenCalled();
    expect(mockEnterSkill).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(target.route);
  });

  it("leaves the old skill and enters the new skill when skill identity changes", async () => {
    const target: SkillNavigationTarget = {
      skillName: "finance-skill",
      skill: makeSkill("finance-skill"),
      route: { to: "/workspace/$skillName", params: { skillName: "finance-skill" } },
      workspacePath: "/workspace",
    };

    await navigateToSkillSurface(target, buildNavigationDeps({
      currentActiveSessionSkillName: "sales-skill",
    }));

    expect(mockLeaveCurrentSkill).toHaveBeenCalledTimes(1);
    expect(mockEnterSkill).toHaveBeenCalledTimes(1);
    expect(mockEnterSkill).toHaveBeenCalledWith(target.skill, target.workspacePath);
    expect(mockSetActiveSessionSkillName).toHaveBeenCalledWith("finance-skill");
    expect(mockNavigate).toHaveBeenCalledWith(target.route);
  });

  it("enters a skill when no session is active", async () => {
    const target: SkillNavigationTarget = {
      skillName: "sales-skill",
      skill: makeSkill("sales-skill"),
      route: { to: "/workspace/$skillName", params: { skillName: "sales-skill" } },
      workspacePath: "/workspace",
    };

    await navigateToSkillSurface(target, buildNavigationDeps({
      currentActiveSessionSkillName: null,
    }));

    expect(mockLeaveCurrentSkill).not.toHaveBeenCalled();
    expect(mockEnterSkill).toHaveBeenCalledTimes(1);
    expect(mockSetActiveSessionSkillName).toHaveBeenCalledWith("sales-skill");
    expect(mockNavigate).toHaveBeenCalledWith(target.route);
  });

  it("does not restart OpenHands when navigating between routes of the same skill", async () => {
    const target: SkillNavigationTarget = {
      skillName: "sales-skill",
      skill: makeSkill("sales-skill"),
      route: { to: "/workflow/$skillName", params: { skillName: "sales-skill" } },
      workspacePath: "/workspace",
    };

    await navigateToSkillSurface(target, buildNavigationDeps({
      currentActiveSessionSkillName: "sales-skill",
    }));

    expect(mockLeaveCurrentSkill).not.toHaveBeenCalled();
    expect(mockEnterSkill).not.toHaveBeenCalled();
  });
});

describe("leaveActiveSkillForNonSkillRoute", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockSetActiveSessionSkillName.mockClear();
    mockLeaveCurrentSkill.mockClear();
  });

  it("navigates without cleanup when no session is active", async () => {
    await leaveActiveSkillForNonSkillRoute(buildLeaveRouteDeps("/settings"));

    expect(mockLeaveCurrentSkill).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/settings");
  });

  it("cleans up OpenHands without bootstrapping a replacement when leaving to settings", async () => {
    await leaveActiveSkillForNonSkillRoute({
      ...buildLeaveRouteDeps("/settings"),
      currentActiveSessionSkillName: "sales-skill",
    });

    expect(mockLeaveCurrentSkill).toHaveBeenCalledTimes(1);
    expect(mockEnterSkill).not.toHaveBeenCalled();
    expect(mockSetActiveSessionSkillName).toHaveBeenCalledWith(null);
    expect(mockNavigate).toHaveBeenCalledWith("/settings");
  });

  it("cleans up OpenHands when navigating to home", async () => {
    await leaveActiveSkillForNonSkillRoute({
      ...buildLeaveRouteDeps("/"),
      currentActiveSessionSkillName: "sales-skill",
    });

    expect(mockLeaveCurrentSkill).toHaveBeenCalledTimes(1);
    expect(mockSetActiveSessionSkillName).toHaveBeenCalledWith(null);
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });
});
