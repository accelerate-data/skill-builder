export interface DeviceFlowResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export interface DeviceFlowPollResult {
  status: "pending" | "complete" | "expired" | "error"
  token?: string
  error?: string
}

export interface GitHubUser {
  login: string
  avatar_url: string
  name: string | null
}

export interface AppSettings {
  anthropic_api_key: string | null
  github_token: string | null
  github_repo: string | null
  workspace_path: string | null
  auto_commit: boolean
  auto_push: boolean
}

export interface SkillSummary {
  name: string
  domain: string | null
  current_step: string | null
  status: string | null
  last_modified: string | null
}

export interface NodeStatus {
  available: boolean
  version: string | null
  meets_minimum: boolean
  error: string | null
}

export interface WorkflowStep {
  id: number
  name: string
  description: string
  status: "pending" | "in_progress" | "waiting_for_user" | "completed" | "error"
  agentModel?: string
}
