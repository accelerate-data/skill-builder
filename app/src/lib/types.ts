export const SKILL_TYPES = ["platform", "domain", "source", "data-engineering"] as const;
export type SkillType = typeof SKILL_TYPES[number];

export const SKILL_TYPE_LABELS: Record<SkillType, string> = {
  platform: "Platform",
  domain: "Domain",
  source: "Source",
  "data-engineering": "Data Engineering",
};

export const SKILL_TYPE_COLORS: Record<SkillType, string> = {
  platform: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  domain: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  source: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  "data-engineering": "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
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
  github_pat: string | null
}

export interface SkillSummary {
  name: string
  domain: string | null
  current_step: string | null
  status: string | null
  last_modified: string | null
  tags: string[]
  skill_type: string | null
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

