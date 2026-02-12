import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, SkillSummary, NodeStatus, PackageResult, ReconciliationResult } from "@/lib/types";

// Re-export shared types so existing imports from "@/lib/tauri" continue to work
export type { AppSettings, SkillSummary, NodeStatus, PackageResult, ReconciliationResult } from "@/lib/types";

// --- Settings ---

export const getSettings = () => invoke<AppSettings>("get_settings");

export const saveSettings = (settings: AppSettings) =>
  invoke("save_settings", { settings });

export const testApiKey = (apiKey: string) =>
  invoke<boolean>("test_api_key", { apiKey });

// --- Skills ---

export const listSkills = (workspacePath: string) =>
  invoke<SkillSummary[]>("list_skills", { workspacePath });

export const createSkill = (
  workspacePath: string,
  name: string,
  domain: string,
  tags?: string[],
  skillType?: string
) => invoke("create_skill", { workspacePath, name, domain, tags: tags ?? null, skillType: skillType ?? null });

export const deleteSkill = (workspacePath: string, name: string) =>
  invoke("delete_skill", { workspacePath, name });

export const updateSkillTags = (skillName: string, tags: string[]) =>
  invoke("update_skill_tags", { skillName, tags });

export const getAllTags = () =>
  invoke<string[]>("get_all_tags");

// --- Node.js ---

export const checkNode = () => invoke<NodeStatus>("check_node");

// --- Agent ---

export const startAgent = (
  agentId: string,
  prompt: string,
  model: string,
  cwd: string,
  allowedTools?: string[],
  maxTurns?: number,
  sessionId?: string,
  skillName?: string,
  stepLabel?: string,
  agentName?: string,
) => invoke<string>("start_agent", { agentId, prompt, model, cwd, allowedTools, maxTurns, sessionId, skillName: skillName ?? "unknown", stepLabel: stepLabel ?? "unknown", agentName: agentName ?? null });

// --- Workflow ---

export const runWorkflowStep = (
  skillName: string,
  stepId: number,
  domain: string,
  workspacePath: string,
  resume?: boolean,
  rerun?: boolean,
  timeoutSecs?: number,
) => invoke<string>("run_workflow_step", { skillName, stepId, domain, workspacePath, resume: resume ?? false, rerun: rerun ?? false, timeoutSecs: timeoutSecs ?? 90 });

export const runReviewStep = (
  skillName: string,
  stepId: number,
  domain: string,
  workspacePath: string,
) => invoke<string>("run_review_step", { skillName, stepId, domain, workspacePath });

export const packageSkill = (
  skillName: string,
  workspacePath: string,
) => invoke<PackageResult>("package_skill", { skillName, workspacePath });

export const resetWorkflowStep = (
  workspacePath: string,
  skillName: string,
  fromStepId: number,
) => invoke("reset_workflow_step", { workspacePath, skillName, fromStepId });

// --- Workflow State (SQLite) ---

export interface WorkflowRunRow {
  skill_name: string;
  domain: string;
  current_step: number;
  status: string;
  skill_type: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowStepRow {
  skill_name: string;
  step_id: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface WorkflowStateResponse {
  run: WorkflowRunRow | null;
  steps: WorkflowStepRow[];
}

export interface StepStatusUpdate {
  step_id: number;
  status: string;
}

export const getWorkflowState = (skillName: string) =>
  invoke<WorkflowStateResponse>("get_workflow_state", { skillName });

export const saveWorkflowState = (
  skillName: string,
  domain: string,
  currentStep: number,
  status: string,
  stepStatuses: StepStatusUpdate[],
  skillType?: string,
) => invoke("save_workflow_state", { skillName, domain, currentStep, status, stepStatuses, skillType: skillType ?? "domain" });

// --- Files ---

export const readFile = (filePath: string) =>
  invoke<string>("read_file", { filePath });

export const writeFile = (path: string, content: string) =>
  invoke<void>("write_file", { path, content });

// --- Lifecycle ---

export const hasRunningAgents = () =>
  invoke<boolean>("has_running_agents");

export const getWorkspacePath = () =>
  invoke<string>("get_workspace_path");

/** Shut down the persistent sidecar process for a skill (fire-and-forget). */
export const cleanupSkillSidecar = (skillName: string) =>
  invoke<void>("cleanup_skill_sidecar", { skillName });

// --- Artifacts ---

export interface ArtifactRow {
  skill_name: string;
  step_id: number;
  relative_path: string;
  content: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

export const captureStepArtifacts = (
  skillName: string,
  stepId: number,
  workspacePath: string,
) => invoke<ArtifactRow[]>("capture_step_artifacts", { skillName, stepId, workspacePath });

export const getArtifactContent = (
  skillName: string,
  relativePath: string,
) => invoke<ArtifactRow | null>("get_artifact_content", { skillName, relativePath });

export const saveArtifactContent = (
  skillName: string,
  stepId: number,
  relativePath: string,
  content: string,
) => invoke("save_artifact_content", { skillName, stepId, relativePath, content });

// --- Reconciliation ---

export const reconcileStartup = () =>
  invoke<ReconciliationResult>("reconcile_startup");

export const resolveOrphan = (skillName: string, action: "delete" | "keep") =>
  invoke("resolve_orphan", { skillName, action });

// --- Agent Prompts ---

export const getAgentPrompt = (skillType: string, phase: string) =>
  invoke<string>("get_agent_prompt", { skillType, phase });

