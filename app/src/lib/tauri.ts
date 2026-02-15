import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, SkillSummary, NodeStatus, PackageResult, ReconciliationResult, DeviceFlowResponse, GitHubAuthResult, GitHubUser, AgentRunRecord, WorkflowSessionRecord, UsageSummary, UsageByStep, UsageByModel, ImportedSkill, GitHubRepoInfo, AvailableSkill } from "@/lib/types";

// Re-export shared types so existing imports from "@/lib/tauri" continue to work
export type { AppSettings, SkillSummary, NodeStatus, PackageResult, ReconciliationResult, DeviceFlowResponse, GitHubAuthResult, GitHubUser, AgentRunRecord, WorkflowSessionRecord, UsageSummary, UsageByStep, UsageByModel, ImportedSkill, GitHubRepoInfo, AvailableSkill } from "@/lib/types";

// --- Settings ---

export const getSettings = () => invoke<AppSettings>("get_settings");

export const saveSettings = (settings: AppSettings) =>
  invoke("save_settings", { settings });

export const testApiKey = (apiKey: string) =>
  invoke<boolean>("test_api_key", { apiKey });

export const getDataDir = () => invoke<string>("get_data_dir");

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
) => invoke<string>("run_workflow_step", { skillName, stepId, domain, workspacePath, resume: resume ?? false, rerun: rerun ?? false });

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

export interface StepResetPreview {
  step_id: number;
  step_name: string;
  files: string[];
}

export const previewStepReset = (
  workspacePath: string,
  skillName: string,
  fromStepId: number,
) => invoke<StepResetPreview[]>("preview_step_reset", { workspacePath, skillName, fromStepId });

export const verifyStepOutput = (
  workspacePath: string,
  skillName: string,
  stepId: number,
) => invoke<boolean>("verify_step_output", { workspacePath, skillName, stepId });

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

export const writeBase64ToTempFile = (fileName: string, base64Content: string) =>
  invoke<string>("write_base64_to_temp_file", { fileName, base64Content });

// --- Lifecycle ---

export const hasRunningAgents = () =>
  invoke<boolean>("has_running_agents");

export const getWorkspacePath = () =>
  invoke<string>("get_workspace_path");

/** Shut down the persistent sidecar process for a skill (fire-and-forget). */
export const cleanupSkillSidecar = (skillName: string) =>
  invoke<void>("cleanup_skill_sidecar", { skillName });

// --- Workflow Sessions ---

export const createWorkflowSession = (sessionId: string, skillName: string) =>
  invoke<void>("create_workflow_session", { sessionId, skillName });

export const endWorkflowSession = (sessionId: string) =>
  invoke<void>("end_workflow_session", { sessionId });

// --- Reconciliation ---

export const reconcileStartup = () =>
  invoke<ReconciliationResult>("reconcile_startup");

export const resolveOrphan = (skillName: string, action: "delete" | "keep") =>
  invoke("resolve_orphan", { skillName, action });

// --- Feedback ---

export interface CreateGithubIssueRequest {
  title: string;
  body: string;
  labels: string[];
}

export interface CreateGithubIssueResponse {
  url: string;
  number: number;
}

export const createGithubIssue = (request: CreateGithubIssueRequest) =>
  invoke<CreateGithubIssueResponse>("create_github_issue", { request });

// --- GitHub OAuth ---

export const githubStartDeviceFlow = () =>
  invoke<DeviceFlowResponse>("github_start_device_flow");

export const githubPollForToken = (deviceCode: string) =>
  invoke<GitHubAuthResult>("github_poll_for_token", { deviceCode });

export const githubGetUser = () =>
  invoke<GitHubUser | null>("github_get_user");

export const githubLogout = () =>
  invoke<void>("github_logout");

// --- Skill Locks ---

export interface SkillLock {
  skill_name: string;
  instance_id: string;
  pid: number;
  acquired_at: string;
}

export const acquireLock = (skillName: string) =>
  invoke<void>("acquire_lock", { skillName });

export const releaseLock = (skillName: string) =>
  invoke<void>("release_lock", { skillName });

export const getLockedSkills = () =>
  invoke<SkillLock[]>("get_locked_skills");

export const checkLock = (skillName: string) =>
  invoke<boolean>("check_lock", { skillName });

// --- Agent Prompts ---

export const getAgentPrompt = (skillType: string, phase: string) =>
  invoke<string>("get_agent_prompt", { skillType, phase });

// --- Usage Tracking ---

export const persistAgentRun = (params: {
  agentId: string;
  skillName: string;
  stepId: number;
  model: string;
  status: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
  durationMs: number;
  sessionId?: string;
  workflowSessionId?: string;
}) => invoke<void>("persist_agent_run", {
  agentId: params.agentId,
  skillName: params.skillName,
  stepId: params.stepId,
  model: params.model,
  status: params.status,
  inputTokens: params.inputTokens,
  outputTokens: params.outputTokens,
  cacheReadTokens: params.cacheReadTokens,
  cacheWriteTokens: params.cacheWriteTokens,
  totalCost: params.totalCost,
  durationMs: params.durationMs,
  sessionId: params.sessionId ?? null,
  workflowSessionId: params.workflowSessionId ?? null,
});

export const getUsageSummary = (hideCancelled: boolean = false) =>
  invoke<UsageSummary>("get_usage_summary", { hideCancelled });

export const getRecentRuns = (limit: number = 50) =>
  invoke<AgentRunRecord[]>("get_recent_runs", { limit });

export const getRecentWorkflowSessions = (limit: number = 50, hideCancelled: boolean = false) =>
  invoke<WorkflowSessionRecord[]>("get_recent_workflow_sessions", { limit, hideCancelled });

export const getSessionAgentRuns = (sessionId: string) =>
  invoke<AgentRunRecord[]>("get_session_agent_runs", { sessionId });

export const getUsageByStep = (hideCancelled: boolean = false) =>
  invoke<UsageByStep[]>("get_usage_by_step", { hideCancelled });

export const getUsageByModel = (hideCancelled: boolean = false) =>
  invoke<UsageByModel[]>("get_usage_by_model", { hideCancelled });

export const resetUsage = () =>
  invoke<void>("reset_usage");

// --- GitHub Import ---

export const parseGitHubUrl = (url: string) =>
  invoke<GitHubRepoInfo>("parse_github_url", { url });

export const listGitHubSkills = (owner: string, repo: string, branch: string, subpath?: string) =>
  invoke<AvailableSkill[]>("list_github_skills", { owner, repo, branch, subpath: subpath ?? null });

export const importGitHubSkills = (owner: string, repo: string, branch: string, skillPaths: string[]) =>
  invoke<ImportedSkill[]>("import_github_skills", { owner, repo, branch, skillPaths });

