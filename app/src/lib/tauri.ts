import { invoke } from "@tauri-apps/api/core";

// --- Types ---

export interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string | null;
}

export interface DeviceFlowResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface DeviceFlowPollResult {
  status: "pending" | "complete";
  token?: string;
}

export interface AppSettings {
  anthropic_api_key: string | null;
  github_token: string | null;
  github_repo: string | null;
  workspace_path: string | null;
  auto_commit: boolean;
  auto_push: boolean;
}

export interface SkillSummary {
  name: string;
  domain: string | null;
  current_step: string | null;
  status: string | null;
  last_modified: string | null;
}

// --- Auth ---

export const startDeviceFlow = () =>
  invoke<DeviceFlowResponse>("start_login");

export const pollDeviceFlow = (deviceCode: string) =>
  invoke<DeviceFlowPollResult>("poll_login", { deviceCode });

export const getCurrentUser = (token: string) =>
  invoke<GitHubUser>("get_current_user", { token });

export const logoutUser = () => invoke("logout");

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

// --- GitHub Repos ---

export interface GitHubRepo {
  full_name: string;
  name: string;
  private: boolean;
  description: string | null;
  clone_url: string;
}

export const listGithubRepos = (token: string) =>
  invoke<GitHubRepo[]>("list_github_repos", { token });

// --- Git ---

export interface CloneResult {
  path: string;
  created_readme: boolean;
  created_gitignore: boolean;
}

export const cloneRepo = (repoUrl: string, destPath: string, token: string) =>
  invoke<CloneResult>("clone_repo", { repoUrl, destPath, token });

export const commitAndPush = (repoPath: string, message: string, token: string) =>
  invoke<string>("commit_and_push", { repoPath, message, token });

// --- Git (extended) ---

export interface PullResult {
  commits_pulled: number;
  up_to_date: boolean;
}

export interface CommitResult {
  oid: string;
  message: string;
  changed_files: number;
}

export interface GitDiff {
  files: GitDiffEntry[];
}

export interface GitDiffEntry {
  path: string;
  status: string;
  hunks?: DiffHunk[];
}

export interface DiffHunk {
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  content: string;
}

export interface GitLogEntry {
  oid: string;
  message: string;
  author: string;
  timestamp: string;
}

export interface GitFileStatusEntry {
  path: string;
  status: string;
}

export const gitPull = (repoPath: string, token: string) =>
  invoke<PullResult>("git_pull", { repoPath, token });

export const gitCommit = (repoPath: string, message: string) =>
  invoke<CommitResult>("git_commit", { repoPath, message });

export const gitDiff = (repoPath: string, filePath?: string) =>
  invoke<GitDiff>("git_diff", { repoPath, filePath });

export const gitLog = (repoPath: string, limit?: number, filePath?: string) =>
  invoke<GitLogEntry[]>("git_log", { repoPath, limit, filePath });

export const gitFileStatus = (repoPath: string) =>
  invoke<GitFileStatusEntry[]>("git_file_status", { repoPath });

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

export const autoCommitStep = (
  skillName: string,
  stepName: string,
  workspacePath: string,
) => invoke<string | null>("auto_commit_step", { skillName, stepName, workspacePath });

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
