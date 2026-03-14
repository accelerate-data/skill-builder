const E2E_ROOT = "C:/skill-builder-test";

export function joinE2ePath(...parts: string[]): string {
  return [E2E_ROOT, ...parts].join("/");
}

export const E2E_WORKSPACE_PATH = joinE2ePath("workspace");
export const E2E_SKILLS_PATH = joinE2ePath("skills");
export const E2E_DEFAULT_SKILLS_PATH = joinE2ePath("default-skills");

export function workspaceSkillPath(skillName: string): string {
  return joinE2ePath("workspace", skillName);
}

export function skillOutputPath(skillName: string): string {
  return joinE2ePath("skills", skillName);
}

export function skillContextPath(basePath: string, skillName: string, fileName: string): string {
  return `${basePath}/${skillName}/context/${fileName}`;
}
