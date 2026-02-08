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

export interface ParallelAgentResult {
  agent_id_a: string;
  agent_id_b: string;
}

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

export const runParallelAgents = (
  skillName: string,
  domain: string,
  workspacePath: string,
) => invoke<ParallelAgentResult>("run_parallel_agents", { skillName, domain, workspacePath });

export const packageSkill = (
  skillName: string,
  workspacePath: string,
) => invoke<PackageResult>("package_skill", { skillName, workspacePath });

// --- Clarifications ---

export interface ClarificationChoice {
  letter: string;
  text: string;
  rationale: string;
}

export interface ClarificationQuestion {
  id: string;
  title: string;
  question: string;
  choices: ClarificationChoice[];
  recommendation: string | null;
  answer: string | null;
}

export interface ClarificationSection {
  heading: string;
  questions: ClarificationQuestion[];
}

export interface ClarificationFile {
  sections: ClarificationSection[];
}

export const parseClarifications = (filePath: string) =>
  invoke<ClarificationFile>("parse_clarifications", { filePath });

export const saveClarificationAnswers = (
  filePath: string,
  file: ClarificationFile
) => invoke("save_clarification_answers", { filePath, file });

export const saveRawFile = (filePath: string, content: string) =>
  invoke("save_raw_file", { filePath, content });

// --- Files ---

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

export const checkWorkspacePath = (workspacePath: string) =>
  invoke<boolean>("check_workspace_path", { workspacePath });

export const hasRunningAgents = () =>
  invoke<boolean>("has_running_agents");
