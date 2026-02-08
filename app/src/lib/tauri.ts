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
) => invoke<string>("start_agent", { agentId, prompt, model, cwd, allowedTools, maxTurns });

export const cancelAgent = (agentId: string) =>
  invoke("cancel_agent", { agentId });
