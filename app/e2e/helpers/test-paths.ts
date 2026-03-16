import path from "node:path";
import os from "node:os";

const E2E_ROOT = path.join(os.tmpdir(), "skill-builder-test");

// No manual separator normalization needed — the E2E mock's
// resolveReadFileMock() normalizes both sides of the comparison.
export function joinE2ePath(...segments: string[]): string {
  return path.join(E2E_ROOT, ...segments);
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
  return path.join(basePath, skillName, "context", fileName);
}
