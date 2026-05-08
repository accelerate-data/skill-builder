export interface ModelInfo {
  id: string;
  displayName: string;
}

export const PURPOSES = ["platform", "domain", "source", "data-engineering"] as const;
export type Purpose = typeof PURPOSES[number];
export const CREATE_PURPOSES = ["domain", "source", "data-engineering"] as const;

export const PURPOSE_LABELS: Record<Purpose, string> = {
  domain: "Business process knowledge",
  source: "Source system semantics",
  "data-engineering": "Organization specific data engineering standards",
  platform: "Organization specific Azure or Fabric standards",
};

export const PURPOSE_SHORT_LABELS: Record<Purpose, string> = {
  domain: "Business Process",
  source: "Source Semantics",
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

export interface ModelSettings {
  provider: string | null
  model: string | null
  api_key: string | null
  base_url: string | null
  api_version?: string | null
  temperature?: number | null
  max_output_tokens?: number | null
  timeout_seconds?: number | null
  num_retries?: number | null
  reasoning_effort?: string | null
  extra_headers?: Record<string, string> | null
  input_cost_per_token?: number | null
  output_cost_per_token?: number | null
  usage_id?: string | null
}

export interface AppSettings {
  model_settings?: ModelSettings | null
  workspace_path: string | null
  skills_path: string | null
  log_level: string
  extended_context?: boolean
  refine_prompt_suggestions?: boolean
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

export interface Document {
  id: number
  name: string
  source_type: "file" | "url" | "folder"
  source_url: string | null
  file_path: string
  scope: "all" | "skill"
  skill_ids: number[]
  created_at: string
  updated_at: string
}

export interface SkillUpdateInfo {
  name: string
  path: string
  version: string
  source_url?: string
}

export interface MarketplaceUpdateResult {
  library: SkillUpdateInfo[]
  workspace: SkillUpdateInfo[]
  registry_name: string | null
  registry_names?: { source_url: string; registry_name: string }[]
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
  library_key?: string | null
  current_step: string | null
  status: string | null
  last_modified: string | null
  created_at?: string | null
  tags: string[]
  purpose: string | null
  skill_source?: string | null
  author_login: string | null
  author_avatar: string | null
  intake_json: string | null
  source?: string | null
  description?: string | null
  version?: string | null
  /** camelCase to match Rust serde rename. */
  userInvocable?: boolean | null
  /** camelCase to match Rust serde rename. */
  disableModelInvocation?: boolean | null
  plugin_slug: string
  plugin_display_name: string
  is_default_plugin: boolean
}

export interface SkillCommit {
  sha: string
  message: string
  timestamp: string
  version?: string
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

export interface RefineFinalizeResult {
  files: SkillFileContent[]
  diff: RefineDiff
  commit_sha: string | null
}

export interface ConversationMessage {
  role: string
  content: string
}

export interface RestoredConversationEvent {
  event_class: string
  event: Record<string, unknown>
  timestamp: number
  tool_call_id?: string | null
  parent_tool_call_id?: string | null
}

export interface RefineSessionInfo {
  conversation_id: string
  skill_name: string
  created_at: string
  /** Agent names discovered from allowed refine plugins (e.g. "skill-creator:rewrite-skill"). */
  available_agents: string[]
  restored_messages: ConversationMessage[]
  restored_transcript_events: RestoredConversationEvent[]
}

export interface RefineDispatchResult {
  agent_id: string
  conversation_id: string
}


export interface NodeStatus {
  available: boolean
  version: string | null
  meets_minimum: boolean
  error: string | null
  source: string
}

export interface DepStatus {
  code?: string | null
  failure_kind?: string | null
  name: string
  ok: boolean
  detail: string
  remediation?: string | null
}

export interface StartupDeps {
  all_ok: boolean
  checks: DepStatus[]
}

export interface OrphanSkill {
  skill_name: string
  purpose: string
}

export interface DiscoveredSkill {
  name: string
  plugin_slug?: string | null
  plugin_display_name?: string | null
  is_default_plugin?: boolean | null
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

interface BenchmarkExpectation {
  text: string;
  passed: boolean;
  evidence?: string;
}

interface BenchmarkRunResult {
  pass_rate: number;
  passed: number;
  failed: number;
  total: number;
  time_seconds?: number;
  tokens?: number;
  tool_calls?: number;
  errors?: number;
}

interface BenchmarkRun {
  eval_id: number;
  eval_name?: string;
  configuration: string;
  run_number: number;
  result: BenchmarkRunResult;
  expectations?: BenchmarkExpectation[];
  notes?: string | string[];
}

interface BenchmarkStat {
  mean: number;
  stddev: number;
  min: number;
  max: number;
}

export interface BenchmarkConfigSummary {
  pass_rate: BenchmarkStat;
  time_seconds?: BenchmarkStat;
  tokens?: BenchmarkStat;
}

export interface BenchmarkDelta {
  pass_rate: string;
  time_seconds?: string;
  tokens?: string;
}

interface BenchmarkMetadata {
  skill_name?: string;
  timestamp?: string;
  evals_run?: number[];
  runs_per_configuration?: number;
}

export interface BenchmarkData {
  metadata?: BenchmarkMetadata;
  runs?: BenchmarkRun[];
  run_summary?: Record<string, BenchmarkConfigSummary | BenchmarkDelta>;
  notes?: string | string[];
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

export interface UsageByDay {
  date: string        // "YYYY-MM-DD"
  total_cost: number
  total_tokens: number
  run_count: number
}

export interface ImportedSkill {
  skill_id: string
  skill_name: string
  library_key: string | null
  description: string | null
  is_active: boolean
  disk_path: string
  imported_at: string
  is_bundled: boolean
  purpose: string | null
  version: string | null
  user_invocable: boolean | null
  disable_model_invocation: boolean | null
  /** Source registry URL this skill was imported from. null for bundled/manually uploaded skills. */
  marketplace_source_url: string | null
  plugin_slug: string
  plugin_display_name: string
  is_default_plugin: boolean
}

export interface LibraryPlugin {
  id: number
  slug: string
  display_name: string
  version: string | null
  source_type: string
  source_url: string | null
  is_default: boolean
  upgrade_locked: boolean
}

/**
 * The common shape required to edit skill metadata, shared by SkillSummary (builder)
 * and ImportedSkill (marketplace/imported). Workflow-only fields (status, current_step)
 * are null for marketplace/imported skills.
 */
export interface EditableSkill {
  name: string
  plugin_slug: string
  skill_source?: string | null
  purpose: string | null
  description?: string | null
  tags: string[]
  intake_json: string | null
  version?: string | null
  userInvocable?: boolean | null
  disableModelInvocation?: boolean | null
  status: string | null
  current_step: string | null
}

/** Convert an ImportedSkill to the EditableSkill shape expected by SkillDialog. */
export function toEditableSkill(skill: ImportedSkill): EditableSkill {
  return {
    name: skill.skill_name,
    plugin_slug: skill.plugin_slug,
    skill_source: skill.marketplace_source_url ? 'marketplace' : 'imported',
    purpose: skill.purpose ?? null,
    description: skill.description ?? null,
    tags: [],
    intake_json: null,
    version: skill.version ?? null,
    userInvocable: skill.user_invocable ?? null,
    disableModelInvocation: skill.disable_model_invocation ?? null,
    status: null,
    current_step: null,
  }
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
  user_invocable: boolean | null
  disable_model_invocation: boolean | null
}

export interface AvailablePlugin {
  path: string
  name: string
  description: string | null
  version: string | null
  skill_count: number
  skill_names: string[]
}

export interface SkillMetadataOverride {
  name: string
  description: string
  purpose?: string | null
  version?: string | null
  user_invocable?: boolean | null
  disable_model_invocation?: boolean | null
}

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
  user_invocable: boolean | null
  disable_model_invocation: boolean | null
}

// ─── Workflow command DTOs ───────────────────────────────────────────────────

export interface StepResetPreview {
  step_id: number
  step_name: string
  files: string[]
}

export interface WorkflowRunRow {
  skill_name: string
  current_step: number
  status: string
  purpose: string
  created_at: string
  updated_at: string
  author_login?: string | null
  author_avatar?: string | null
  display_name?: string | null
  intake_json?: string | null
  source?: string
}

export interface WorkflowStepRow {
  skill_name: string
  step_id: number
  status: string
  started_at: string | null
  completed_at: string | null
}

export interface WorkflowStateResponse {
  run: WorkflowRunRow | null
  steps: WorkflowStepRow[]
}

export interface StepStatusUpdate {
  step_id: number
  status: string
}

export type DiscoveryResolutionAction = "add-skill-builder" | "add-imported" | "remove"

// ─── Workflow step structured outputs ────────────────────────────────────────

/** Structured output for the OpenHands research workflow step. */
export interface ResearchStepOutput {
  status: "research_complete"
  question_count: number
  research_output: unknown
}

/** Structured output for the OpenHands detailed-research workflow step. */
export interface DetailedResearchOutput {
  status: "detailed_research_complete"
  refinement_count: number
  section_count: number
  clarifications_json: unknown
}

/** Structured output for the OpenHands decision-confirmation workflow step. */
export interface DecisionsOutput {
  version: string
  metadata: unknown
  decisions: unknown[]
}

/** Structured output for workflow step 3 (generate-skill, rewrite-skill, or benchmark-skill agent). */
export type GenerateSkillOutput =
  | { status: "generated"; skipped?: boolean; benchmark_path?: string }
  | { status: "rewritten"; skipped?: boolean; benchmark_path?: string }
  | { status: "complete" | "partial" | "skipped"; benchmark_path?: string }

/** Discriminated union narrowing `structuredOutput` per workflow step index. */
export type WorkflowStepStructuredOutput =
  | ({ stepId: 0 } & ResearchStepOutput)
  | ({ stepId: 1 } & DetailedResearchOutput)
  | ({ stepId: 2 } & DecisionsOutput)
  | ({ stepId: 3 } & GenerateSkillOutput)

// ─── Answer evaluator structured output ──────────────────────────────────────

/** Per-question verdict entry within an {@link AnswerEvaluationOutput}. Matches `PerQuestionEntry` in `workflow_artifacts.rs`. */
export interface PerQuestionEntry {
  question_id: string
  verdict: "clear" | "needs_refinement" | "not_answered" | "vague" | "contradictory"
  reason?: string | null
  contradicts?: string | null
}

/** Structured output produced by the answer-evaluator agent. Matches `AnswerEvaluationOutput` in `workflow_artifacts.rs`. */
export interface AnswerEvaluationOutput {
  verdict: "sufficient" | "mixed" | "insufficient"
  answered_count: number
  empty_count: number
  vague_count: number
  contradictory_count: number
  total_count: number
  reasoning: string
  /** Routing verdict returned in the gate agent's structured output: skip research, run it, or revise the spec first. */
  gate_decision?: "skip_research" | "run_research" | "revise" | null
  per_question: PerQuestionEntry[]
}

// --- Test case management (Eval Workbench) ---

export interface TestCase {
  id: number
  eval_name: string
  slug: string
  prompt: string
  files: string[]
  expectations: string[]
}

export interface EvalsFile {
  skill_name: string
  evals: TestCase[]
}

export interface IterationMeta {
  iteration: number
  path: string
}

/** Eval generated by skill-evals-generator before user review — no id or files yet. */
export interface PendingEval {
  eval_name: string
  slug: string
  prompt: string
  expectations: string[]
}

/** Skill content + existing evals provided to the eval generator agent. */
export interface SkillEvalContext {
  skill_content: string
  existing_evals: TestCase[]
}

// --- Eval Workbench run output ---

/** Per-eval summary within one benchmark run. */
export interface EvalRunEvalSummary {
  eval_id: number
  eval_name: string
  slug: string
  grading_path: string
  summary: { passed: number; failed: number; total: number; pass_rate: number }
}

/** One run (run_index 0..run_count-1) from benchmark.json. */
export interface EvalBenchmarkRun {
  run_index: number
  evals: EvalRunEvalSummary[]
  run_summary: { passed: number; failed: number; total: number; pass_rate: number }
}

export interface EvalAggregateSummary {
  avg_pass_rate: number
  total_passed: number
  total_failed: number
  total_assertions: number
  has_failures: boolean
}

/** Full benchmark.json-style aggregate produced by the Eval Workbench runtime. */
export interface EvalBenchmark {
  skill_name: string
  comparison_mode?: "with_skill_only" | "with_without_skill" | "current_vs_previous"
  iteration: number
  run_count: number
  eval_ids: number[]
  runs: EvalBenchmarkRun[]
  /** Only present when comparison_mode is "with_without_skill" or "current_vs_previous". */
  baseline_runs?: EvalBenchmarkRun[]
  aggregate_summary: EvalAggregateSummary
  /** Only present when baseline_runs is present. */
  baseline_aggregate_summary?: EvalAggregateSummary
}

/** Structured run summary emitted when the full Eval Workbench pipeline completes.
 *  The benchmark is computed by Rust from grading files — not carried in this event.
 *  SDK enforces this shape via output_format_for_agent.
 */
export interface EvalCompleteEvent {
  status: "complete"
  iteration: number
  results: string[]
}
