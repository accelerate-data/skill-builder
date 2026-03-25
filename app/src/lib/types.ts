export interface ModelInfo {
  id: string;
  displayName: string;
}

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
  interleaved_thinking_beta?: boolean
  sdk_effort?: string | null
  fallback_model?: string | null
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
  model?: string | null
  argumentHint?: string | null
  userInvocable?: boolean | null
  disableModelInvocation?: boolean | null
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

export interface RefineSessionInfo {
  session_id: string
  skill_name: string
  created_at: string
  /** Agent names discovered from allowed refine plugins (e.g. "skill-creator:rewrite-skill"). */
  available_agents: string[]
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
  argument_hint?: string | null
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
  model: string | null
  argument_hint: string | null
  user_invocable: boolean | null
  disable_model_invocation: boolean | null
}

// ─── Workflow step structured outputs ────────────────────────────────────────

/** Structured output for workflow step 0 (research-orchestrator agent). */
export interface ResearchStepOutput {
  status: "research_complete"
  dimensions_selected: number
  question_count: number
  research_output: unknown
}

/** Structured output for workflow step 1 (detailed-research agent). */
export interface DetailedResearchOutput {
  status: "detailed_research_complete"
  refinement_count: number
  section_count: number
  clarifications_json: unknown
}

/** Structured output for workflow step 2 (confirm-decisions agent). */
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
  per_question: PerQuestionEntry[]
}

// --- Test case management (Evals tab) ---

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

// --- Eval run (evaluate-skill agent output) ---

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

/** Full benchmark.json produced by the evaluate-skill agent. */
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

/** structuredOutput emitted by evaluate-skill after each eval is graded. */
export interface EvalGradedEvent {
  type: "eval_graded"
  runIndex: number
  evalIndex: number
  totalEvals: number
  totalRuns: number
  evalId: number
  evalName: string
  grading: { passed: number; failed: number; total: number; pass_rate: number }
  /** Present only in comparison modes. */
  variant?: "with_skill" | "without_skill" | "current" | "previous"
}

/** structuredOutput emitted by evaluate-skill when the full pipeline completes. */
export interface EvalCompleteEvent {
  type: "complete"
  iteration: number
  benchmark: EvalBenchmark
  analyst_notes: string[]
}
