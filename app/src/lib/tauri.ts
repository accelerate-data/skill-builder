import { invoke } from "@tauri-apps/api/core";

// --- Types ---

export interface AppSettings {
  anthropic_api_key: string | null;
  workspace_path: string | null;
}

export interface SkillSummary {
  name: string;
  domain: string | null;
  current_step: string | null;
  status: string | null;
  last_modified: string | null;
}

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
  domain: string
) => invoke("create_skill", { workspacePath, name, domain });

export const deleteSkill = (workspacePath: string, name: string) =>
  invoke("delete_skill", { workspacePath, name });

// --- Node.js ---

export interface NodeStatus {
  available: boolean;
  version: string | null;
  meets_minimum: boolean;
  error: string | null;
}

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
) => invoke<string>("start_agent", { agentId, prompt, model, cwd, allowedTools, maxTurns, sessionId });

export const cancelAgent = (agentId: string) =>
  invoke("cancel_agent", { agentId });

// --- Workflow ---

export interface PackageResult {
  file_path: string;
  size_bytes: number;
}

export const runWorkflowStep = (
  skillName: string,
  stepId: number,
  domain: string,
  workspacePath: string,
) => invoke<string>("run_workflow_step", { skillName, stepId, domain, workspacePath });

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
) => invoke("save_workflow_state", { skillName, domain, currentStep, status, stepStatuses });

// --- Files ---

export const saveRawFile = (filePath: string, content: string) =>
  invoke("save_raw_file", { filePath, content });

export interface FileEntry {
  name: string;
  relative_path: string;
  absolute_path: string;
  is_directory: boolean;
  is_readonly: boolean;
  size_bytes: number;
}

export const listSkillFiles = (workspacePath: string, skillName: string) =>
  invoke<FileEntry[]>("list_skill_files", { workspacePath, skillName });

export const readFile = (filePath: string) =>
  invoke<string>("read_file", { filePath });

// --- Lifecycle ---

export const hasRunningAgents = () =>
  invoke<boolean>("has_running_agents");

export const getWorkspacePath = () =>
  invoke<string>("get_workspace_path");

// --- Chat ---

export interface ChatSessionRow {
  id: string;
  skill_name: string;
  mode: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
}

export const createChatSession = (skillName: string, mode: string) =>
  invoke<ChatSessionRow>("create_chat_session", { skillName, mode });

export const listChatSessions = (skillName: string) =>
  invoke<ChatSessionRow[]>("list_chat_sessions", { skillName });

export const addChatMessage = (sessionId: string, role: string, content: string) =>
  invoke<ChatMessageRow>("add_chat_message", { sessionId, role, content });

export const getChatMessages = (sessionId: string) =>
  invoke<ChatMessageRow[]>("get_chat_messages", { sessionId });

export const runChatAgent = (skillName: string, sessionId: string, message: string, workspacePath: string) =>
  invoke<string>("run_chat_agent", { skillName, sessionId, message, workspacePath });

// --- Diff ---

export interface DiffResult {
  file_path: string;
  old_content: string;
  new_content: string;
  has_changes: boolean;
}

export const generateDiff = (filePath: string, newContent: string) =>
  invoke<DiffResult>("generate_diff", { filePath, newContent });

export const applySuggestion = (filePath: string, newContent: string) =>
  invoke("apply_suggestion", { filePath, newContent });

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
