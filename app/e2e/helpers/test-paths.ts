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
export const E2E_PREFERRED_MODEL = "claude-sonnet-4-6";
export const E2E_MODEL_SETTINGS = {
  provider_id: "anthropic",
  model_id: E2E_PREFERRED_MODEL,
  provider_overrides: {
    anthropic: {
      api_key: "sk-ant-test",
      base_url: null,
      api_version: null,
      temperature: null,
      max_output_tokens: null,
      timeout_seconds: null,
      num_retries: null,
      reasoning_effort: "auto",
      extra_headers: null,
      input_cost_per_token: null,
      output_cost_per_token: null,
      usage_id: "workflow",
    },
  },
};

export function workspaceSkillPath(skillName: string): string {
  return joinE2ePath("workspace", skillName);
}

export function skillOutputPath(skillName: string): string {
  return joinE2ePath("skills", skillName);
}

export function skillContextPath(basePath: string, skillName: string, fileName: string): string {
  return path.join(basePath, skillName, "context", fileName);
}
