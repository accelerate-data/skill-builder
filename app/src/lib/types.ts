export const SKILL_TYPES = ["platform", "domain", "source", "data-engineering"] as const;
export type SkillType = typeof SKILL_TYPES[number];

export const SKILL_TYPE_LABELS: Record<SkillType, string> = {
  platform: "Platform",
  domain: "Domain",
  source: "Source",
  "data-engineering": "Data Engineering",
};

export const SKILL_TYPE_DESCRIPTIONS: Record<string, string> = {
  platform: "Tools and platform-specific skills (dbt, Fabric, Databricks)",
  domain: "Business domain knowledge (Finance, Marketing, HR)",
  source: "Source system extraction patterns (Salesforce, SAP, Workday)",
  "data-engineering": "Technical patterns and practices (SCD, Incremental Loads)",
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
  log_level: string
  extended_context: boolean
  extended_thinking: boolean
  splash_shown: boolean
  github_oauth_token: string | null
  github_user_login: string | null
  github_user_avatar: string | null
  github_user_email: string | null
  remote_repo_owner: string | null
  remote_repo_name: string | null
  max_dimensions: number
  industry: string | null
  function_role: string | null
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
  intake_json: string | null
}

export interface SkillFileContent {
  path: string
  content: string
}

export interface RefineFileDiff {
  path: string
  status: string
  diff: string
}

export interface RefineDiff {
  stat: string
  files: RefineFileDiff[]
}

export interface RefineSessionInfo {
  session_id: string
  skill_name: string
  created_at: string
}

export const INTAKE_PLACEHOLDERS: Record<string, {
  audience: string; challenges: string; scope: string;
  unique_setup: string; claude_mistakes: string;
}> = {
  platform: {
    audience: "e.g., Data engineers building ELT pipelines, platform admins managing environments",
    challenges: "e.g., Complex dependency management, environment promotion, cost optimization",
    scope: "e.g., Focus on development workflow and CI/CD, exclude administration and security",
    unique_setup: "e.g., Multi-tenant Fabric workspace with custom capacity management",
    claude_mistakes: "e.g., Generates generic dbt configs instead of platform-specific overrides",
  },
  domain: {
    audience: "e.g., Business analysts in finance, data scientists building forecasting models",
    challenges: "e.g., Data quality issues in revenue recognition, reconciliation across systems",
    scope: "e.g., Focus on revenue analytics and reporting, exclude operational finance",
    unique_setup: "e.g., Multi-currency with daily FX snapshots and retroactive adjustments",
    claude_mistakes: "e.g., Misses industry-specific compliance requirements like ASC 606",
  },
  source: {
    audience: "e.g., Integration engineers connecting Salesforce to data warehouse",
    challenges: "e.g., API rate limits, incremental extraction, schema drift handling",
    scope: "e.g., Focus on Sales Cloud objects and custom objects, exclude Marketing Cloud",
    unique_setup: "e.g., Custom Salesforce objects with complex record type hierarchies",
    claude_mistakes: "e.g., Uses bulk API for real-time objects, misses soft-delete patterns",
  },
  "data-engineering": {
    audience: "e.g., Analytics engineers implementing SCD patterns, data platform teams",
    challenges: "e.g., Late-arriving dimensions, retroactive corrections, audit trail requirements",
    scope: "e.g., Focus on Type 2 SCD with effectivity dates, exclude Type 6 hybrid patterns",
    unique_setup: "e.g., Bi-temporal design with both transaction time and valid time tracking",
    claude_mistakes: "e.g., Generates Type 1 overwrites when Type 2 history tracking is needed",
  },
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

export interface PackageResult {
  file_path: string
  size_bytes: number
}

export interface OrphanSkill {
  skill_name: string
  domain?: string
  skill_type: string
}

export interface ReconciliationResult {
  orphans: OrphanSkill[]
  notifications: string[]
  auto_cleaned: number
}

export interface AgentRunRecord {
  agent_id: string
  skill_name: string
  step_id: number
  model: string
  status: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_cost: number
  duration_ms: number
  num_turns: number
  stop_reason: string | null
  duration_api_ms: number | null
  tool_use_count: number
  compaction_count: number
  session_id: string | null
  started_at: string
  completed_at: string | null
}

export interface WorkflowSessionRecord {
  session_id: string
  skill_name: string
  min_step: number
  max_step: number
  steps_csv: string
  agent_count: number
  total_cost: number
  total_input_tokens: number
  total_output_tokens: number
  total_cache_read: number
  total_cache_write: number
  total_duration_ms: number
  started_at: string
  completed_at: string | null
}

export interface UsageSummary {
  total_cost: number
  total_runs: number
  avg_cost_per_run: number
}

export interface UsageByStep {
  step_id: number
  step_name: string
  total_cost: number
  run_count: number
}

export interface UsageByModel {
  model: string
  total_cost: number
  run_count: number
}

export interface ImportedSkill {
  skill_id: string
  skill_name: string
  domain: string | null
  description: string | null
  is_active: boolean
  disk_path: string
  trigger_text: string | null
  imported_at: string
}

export interface GitHubRepoInfo {
  owner: string
  repo: string
  branch: string
  subpath: string | null
}

export interface AvailableSkill {
  path: string
  name: string
  domain: string | null
  description: string | null
}

export interface TeamRepoSkill {
  path: string
  name: string
  domain: string | null
  description: string | null
  creator: string | null
  created_at: string | null
}

export interface PushResult {
  pr_url: string
  pr_number: number
  branch: string
  version: number
  is_new_pr: boolean
}

export interface SkillBuilderManifest {
  version: string
  creator: string | null
  created_at: string
  app_version: string
}

export interface GitHubRepo {
  full_name: string
  owner: string
  name: string
  description: string | null
  is_private: boolean
}

export interface SkillFileEntry {
  name: string
  relative_path: string
  absolute_path: string
  is_directory: boolean
  is_readonly: boolean
  size_bytes: number
}

