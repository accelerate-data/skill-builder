export const SKILL_TYPES = ["platform", "domain", "source", "data-engineering"] as const;
export type SkillType = typeof SKILL_TYPES[number];

export const SKILL_TYPE_LABELS: Record<SkillType, string> = {
  platform: "Platform",
  domain: "Domain",
  source: "Source",
  "data-engineering": "Data Engineering",
};

export const SKILL_TYPE_COLORS: Record<SkillType, string> = {
  platform: "bg-[#E8F4F5] text-[#0E7C86] dark:bg-[#0E7C86]/15 dark:text-[#2EC4B6]",
  domain: "bg-[#EBF3EC] text-[#2D7A35] dark:bg-[#2D7A35]/15 dark:text-[#5D9B62]",
  source: "bg-[#FDF0EB] text-[#A85A33] dark:bg-[#A85A33]/15 dark:text-[#D4916E]",
  "data-engineering": "bg-[#F0ECF5] text-[#5E4B8B] dark:bg-[#5E4B8B]/15 dark:text-[#A08DC4]",
};

export interface AppSettings {
  anthropic_api_key: string | null
  workspace_path: string | null
  skills_path: string | null
  preferred_model: string | null
  debug_mode: boolean
  log_level: string
  extended_context: boolean
  extended_thinking: boolean
  splash_shown: boolean
  github_oauth_token: string | null
  github_user_login: string | null
  github_user_avatar: string | null
  github_user_email: string | null
}

export interface DeviceFlowResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export interface GitHubUser {
  login: string
  avatar_url: string
  email: string | null
}

export type GitHubAuthResult =
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'success'; user: GitHubUser }

export interface SkillSummary {
  name: string
  domain: string | null
  current_step: string | null
  status: string | null
  last_modified: string | null
  tags: string[]
  skill_type: string | null
  author_login: string | null
  author_avatar: string | null
}

export interface NodeStatus {
  available: boolean
  version: string | null
  meets_minimum: boolean
  error: string | null
  source: string
}

export interface DepStatus {
  name: string
  ok: boolean
  detail: string
}

export interface StartupDeps {
  all_ok: boolean
  checks: DepStatus[]
}

export interface WorkflowStep {
  id: number
  name: string
  description: string
  status: "pending" | "in_progress" | "waiting_for_user" | "completed" | "error"
}

export interface ParallelAgentResult {
  agent_id_a: string
  agent_id_b: string
}

export interface PackageResult {
  file_path: string
  size_bytes: number
}

export interface OrphanSkill {
  skill_name: string
  domain: string
  skill_type: string
}

export interface ReconciliationResult {
  orphans: OrphanSkill[]
  notifications: string[]
  auto_cleaned: number
}

