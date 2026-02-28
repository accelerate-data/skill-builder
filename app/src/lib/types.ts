export const PURPOSES = ["platform", "domain", "source", "data-engineering"] as const;
export type Purpose = typeof PURPOSES[number];

export const PURPOSE_LABELS: Record<Purpose, string> = {
  domain: "Business process knowledge",
  source: "Source system customizations",
  "data-engineering": "Organization specific data engineering standards",
  platform: "Organization specific Azure or Fabric standards",
};

export const PURPOSE_SHORT_LABELS: Record<Purpose, string> = {
  domain: "Business Process",
  source: "Source Systems",
  "data-engineering": "Data Engineering",
  platform: "Azure / Fabric",
};

export const PURPOSE_COLORS: Record<Purpose, string> = {
  platform: "bg-[#E8F4F5] text-[#0E7C86] dark:bg-[#0E7C86]/15 dark:text-[#2EC4B6]",
  domain: "bg-[#EBF3EC] text-[#2D7A35] dark:bg-[#2D7A35]/15 dark:text-[#5D9B62]",
  source: "bg-[#FDF0EB] text-[#A85A33] dark:bg-[#A85A33]/15 dark:text-[#D4916E]",
  "data-engineering": "bg-[#F0ECF5] text-[#5E4B8B] dark:bg-[#5E4B8B]/15 dark:text-[#A08DC4]",
};

export interface MarketplaceRegistry {
  name: string
  source_url: string
  enabled: boolean
}

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
  marketplace_registries: MarketplaceRegistry[]
  marketplace_initialized: boolean
  max_dimensions: number
  industry: string | null
  function_role: string | null
  dashboard_view_mode: string | null
  auto_update: boolean
}

export interface SkillUpdateInfo {
  name: string
  path: string
  version: string
}

export interface MarketplaceUpdateResult {
  library: SkillUpdateInfo[]
  workspace: SkillUpdateInfo[]
  registry_name: string | null
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
  current_step: string | null
  status: string | null
  last_modified: string | null
  tags: string[]
  purpose: string | null
  skill_source?: string | null
  author_login: string | null
  author_avatar: string | null
  intake_json: string | null
  source?: string | null
  description?: string | null
  version?: string | null
  model?: string | null
  argumentHint?: string | null
  userInvocable?: boolean | null
  disableModelInvocation?: boolean | null
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
  purpose: string
}

export interface DiscoveredSkill {
  name: string
  detected_step: number
  scenario: string
}

export interface ReconciliationResult {
  orphans: OrphanSkill[]
  notifications: string[]
  auto_cleaned: number
  discovered_skills: DiscoveredSkill[]
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
  description: string | null
  is_active: boolean
  disk_path: string
  imported_at: string
  is_bundled: boolean
  purpose: string | null
  version: string | null
  model: string | null
  argument_hint: string | null
  user_invocable: boolean | null
  disable_model_invocation: boolean | null
  /** Source registry URL this skill was imported from. null for bundled/manually uploaded skills. */
  marketplace_source_url: string | null
}

/** Workspace skill stored in the workspace_skills table (Settings > Skills tab). */
export interface WorkspaceSkill {
  skill_id: string
  skill_name: string
  description: string | null
  is_active: boolean
  is_bundled: boolean
  disk_path: string
  imported_at: string
  purpose: string | null
  version: string | null
  model: string | null
  argument_hint: string | null
  user_invocable: boolean | null
  disable_model_invocation: boolean | null
  /** Source registry URL this skill was imported from. null for bundled/manually uploaded skills. */
  marketplace_source_url: string | null
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
  /** Plugin name from `plugin.json`, used to display `{plugin_name}:{name}` in the browse dialog. */
  plugin_name: string | null
  description: string | null
  purpose: string | null
  version: string | null
  model: string | null
  argument_hint: string | null
  user_invocable: boolean | null
  disable_model_invocation: boolean | null
}

export interface SkillMetadataOverride {
  name: string
  description: string
  purpose?: string | null
  version?: string | null
  model?: string | null
  argument_hint?: string | null
  user_invocable?: boolean | null
  disable_model_invocation?: boolean | null
}

export const PURPOSE_OPTIONS = [
  { value: "test-context", label: "Skill Test" },
  { value: "research", label: "Research" },
  { value: "validate", label: "Validate" },
  { value: "skill-building", label: "Skill Standards" },
] as const

export interface MarketplaceImportResult {
  skill_name: string
  success: boolean
  error: string | null
}

export interface SkillFileEntry {
  name: string
  relative_path: string
  absolute_path: string
  is_directory: boolean
  is_readonly: boolean
  size_bytes: number
}

export interface SkillFileMeta {
  name: string | null
  description: string | null
  version: string | null
  model: string | null
  argument_hint: string | null
  user_invocable: boolean | null
  disable_model_invocation: boolean | null
}

