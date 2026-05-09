import type { EditableSkill } from "@/lib/types";

export interface RouteDestination {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, unknown>;
}

export interface SkillNavigationTarget {
  skillName: string;
  skill: EditableSkill;
  route: RouteDestination;
  workspacePath: string;
}

export interface SkillNavigationDeps {
  currentActiveSessionSkillName: string | null;
  navigate: (route: RouteDestination) => void;
  setSelectedSkillName: (name: string | null) => void;
  setActiveSessionSkillName: (name: string | null) => void;
  leaveCurrentSkill: () => Promise<void>;
  enterSkill: (skill: EditableSkill, workspacePath: string) => Promise<void>;
}

export interface LeaveToNonSkillRouteDeps {
  currentActiveSessionSkillName: string | null;
  route: string;
  navigate: (route: string) => void;
  setActiveSessionSkillName: (name: string | null) => void;
  leaveCurrentSkill: () => Promise<void>;
}

export async function navigateToSkillSurface(
  target: SkillNavigationTarget,
  deps: SkillNavigationDeps,
): Promise<void> {
  deps.setSelectedSkillName(target.skillName);

  if (deps.currentActiveSessionSkillName === target.skillName) {
    deps.navigate(target.route);
    return;
  }

  if (deps.currentActiveSessionSkillName) {
    await deps.leaveCurrentSkill();
  }

  await deps.enterSkill(target.skill, target.workspacePath);
  deps.setActiveSessionSkillName(target.skillName);
  deps.navigate(target.route);
}

export async function leaveActiveSkillForNonSkillRoute(
  deps: LeaveToNonSkillRouteDeps,
): Promise<void> {
  if (!deps.currentActiveSessionSkillName) {
    deps.navigate(deps.route);
    return;
  }

  await deps.leaveCurrentSkill();
  deps.setActiveSessionSkillName(null);
  deps.navigate(deps.route);
}
