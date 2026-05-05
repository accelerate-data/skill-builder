import type {
  AgentRunRecord,
  AnswerEvaluationOutput,
  AppSettings,
  AvailablePlugin,
  AvailableSkill,
  DetailedResearchOutput,
  DecisionsOutput,
  DeviceFlowResponse,
  DiscoveryResolutionAction,
  Document,
  GenerateSkillOutput,
  GitHubAuthResult,
  GitHubRepoInfo,
  GitHubUser,
  ImportedSkill,
  LibraryPlugin,
  MarketplaceImportResult,
  MarketplaceUpdateResult,
  ModelSettings,
  ResearchStepOutput,
  ReconciliationResult,
  RefineFinalizeResult,
  RefineSessionInfo,
  SkillCommit,
  SkillFileContent,
  SkillFileEntry,
  SkillFileMeta,
  SkillMetadataOverride,
  SkillSummary,
  StartupDeps,
  UsageByDay,
  UsageByModel,
  UsageByStep,
  UsageSummary,
  WorkflowSessionRecord,
} from "@/lib/types";
import type {
  ApplyDescriptionCandidateResponse,
  DescriptionCandidate,
  EvalRun,
  EvalWorkbenchMode,
  RefineImprovementBrief,
  RunEvalWorkbenchRequest,
  ScenarioDto,
  SuggestAssertionsRequest,
  SuggestDescriptionCandidatesRequest,
} from "@/lib/eval-workbench";
import type {
  ClarificationVerdictUpdate,
  ClarificationsDto,
  DecisionsDto,
} from "@/generated/contracts";

export type NoArgs = Record<string, never>;

export interface FieldSuggestions {
  description: string;
  domain: string;
  audience: string;
  challenges: string;
  scope: string;
  unique_setup: string;
  agent_mistakes: string;
  context_questions: string;
}

export interface ScopeReviewSuggestion {
  name: string;
  description: string;
}

export interface ScopeReviewResult {
  status: string;
  reason: string;
  suggested_skills: ScopeReviewSuggestion[];
}

export interface StepResetPreview {
  step_id: number;
  step_name: string;
  files: string[];
}

interface WorkflowRunRow {
  skill_name: string;
  current_step: number;
  status: string;
  purpose: string;
  created_at: string;
  updated_at: string;
}

interface WorkflowStepRow {
  skill_name: string;
  step_id: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface WorkflowStateResponse {
  run: WorkflowRunRow | null;
  steps: WorkflowStepRow[];
}

export interface StepStatusUpdate {
  step_id: number;
  status: string;
}

export interface CreateGithubIssueRequest {
  title: string;
  body: string;
  labels: string[];
}

export interface CreateGithubIssueResponse {
  url: string;
  number: number;
}

export interface LatestBenchmarkResult {
  iteration: number;
  data: import("@/lib/types").BenchmarkData;
}

export interface SkillIdName {
  id: number;
  name: string;
  plugin_slug: string;
  plugin_display_name: string;
  is_default_plugin: boolean;
}

type SkillPurpose = string | null;
type DocumentScope = "all" | "skill";
type WorkflowStepStructuredOutput =
  | ResearchStepOutput
  | DetailedResearchOutput
  | DecisionsOutput
  | GenerateSkillOutput;

type SkillMetadataArgs = {
  skillName: string;
  pluginSlug: string;
  purpose: SkillPurpose;
  tags: string[] | null;
  intakeJson: string | null;
  description: string | null;
  version: string | null;
  model: string | null;
  argumentHint: string | null;
  userInvocable: boolean | null;
  disableModelInvocation: boolean | null;
};

export interface TauriCommandMap {
  log_frontend: { args: { level: "info" | "warn" | "error" | "debug"; message: string }; result: void };
  get_settings: { args: NoArgs; result: AppSettings };
  save_settings: { args: { settings: AppSettings }; result: void };
  update_user_settings: { args: { settings: AppSettings }; result: void };
  update_github_identity: {
    args: {
      login: string | null;
      avatar: string | null;
      email: string | null;
      token: string | null;
    };
    result: void;
  };
  test_model_connection: { args: { settings: ModelSettings }; result: boolean };
  get_data_dir: { args: NoArgs; result: string };
  get_default_skills_path: { args: NoArgs; result: string };
  set_log_level: { args: { level: string }; result: void };
  check_startup_deps: { args: NoArgs; result: StartupDeps };
  reconcile_startup: { args: NoArgs | { apply: true }; result: ReconciliationResult };
  record_reconciliation_cancel: {
    args: { notificationCount: number; discoveredCount: number };
    result: void;
  };
  delete_skill: { args: { workspacePath: string; name: string }; result: void };
  update_skill_metadata: { args: SkillMetadataArgs; result: void };
  rename_skill: { args: { oldName: string; newName: string; workspacePath: string }; result: void };
  export_skill_as_file: { args: { skillName: string; pluginSlug: string; destPath: string }; result: void };
  generate_suggestions: {
    args: {
      skillName: string;
      purpose: string;
      industry: string | null;
      functionRole: string | null;
      domain: string | null;
      scope: string | null;
      audience: string | null;
      challenges: string | null;
      fields: string[] | null;
    };
    result: FieldSuggestions;
  };
  review_skill_scope: {
    args: {
      skillName: string;
      description: string;
      purpose: string;
      contextQuestions: string | null;
      industry: string | null;
    };
    result: ScopeReviewResult;
  };
  run_workflow_step: {
    args: { skillName: string; stepId: number; workspacePath: string; workflowSessionId: string | null };
    result: string;
  };
  materialize_workflow_step_output: {
    args: { skillName: string; stepId: 0 | 1 | 2 | 3; structuredOutput: WorkflowStepStructuredOutput };
    result: void;
  };
  reset_workflow_step: { args: { workspacePath: string; skillName: string; fromStepId: number }; result: void };
  navigate_back_to_step: {
    args: { workspacePath: string; skillName: string; targetStepId: number };
    result: void;
  };
  preview_step_reset: {
    args: { workspacePath: string; skillName: string; fromStepId: number };
    result: StepResetPreview[];
  };
  verify_step_output: { args: { workspacePath: string; skillName: string; stepId: number }; result: boolean };
  get_disabled_steps: { args: { skillName: string }; result: number[] };
  get_workflow_state: { args: { skillName: string }; result: WorkflowStateResponse };
  save_workflow_state: {
    args: {
      skillName: string;
      currentStep: number;
      status: string;
      stepStatuses: StepStatusUpdate[];
      purpose: string;
    };
    result: void;
  };
  read_file: { args: { filePath: string }; result: string };
  write_file: { args: { path: string; content: string }; result: void };
  list_skill_files: { args: { workspacePath: string; skillName: string }; result: SkillFileEntry[] };
  get_workspace_path: { args: NoArgs; result: string };
  graceful_shutdown: { args: NoArgs; result: void };
  allow_app_exit: { args: NoArgs; result: void };
  create_workflow_session: { args: { sessionId: string; skillName: string }; result: void };
  end_workflow_session: { args: { sessionId: string }; result: void };
  resolve_orphan: { args: { skillName: string; action: "delete" | "keep" }; result: void };
  resolve_discovery: {
    args: { skillName: string; action: DiscoveryResolutionAction; pluginSlug: string | null };
    result: void;
  };
  create_github_issue: { args: { request: CreateGithubIssueRequest }; result: CreateGithubIssueResponse };
  github_start_device_flow: { args: NoArgs; result: DeviceFlowResponse };
  github_poll_for_token: { args: { deviceCode: string }; result: GitHubAuthResult };
  github_get_user: { args: NoArgs; result: GitHubUser | null };
  github_logout: { args: NoArgs; result: void };
  acquire_lock: { args: { skillName: string }; result: void };
  release_lock: { args: { skillName: string }; result: void };
  get_externally_locked_skills: { args: NoArgs; result: string[] };
  get_usage_summary: {
    args: { hideCancelled: boolean; startDate: string | null; skillName: string | null };
    result: UsageSummary;
  };
  get_recent_workflow_sessions: {
    args: { limit: number; hideCancelled: boolean; startDate: string | null; skillName: string | null };
    result: WorkflowSessionRecord[];
  };
  get_step_agent_runs: { args: { skillName: string; stepId: number }; result: AgentRunRecord[] };
  get_agent_runs: {
    args: {
      hideCancelled: boolean;
      startDate: string | null;
      skillName: string | null;
      modelFilter: string | null;
      limit: number;
    };
    result: AgentRunRecord[];
  };
  get_usage_by_step: {
    args: { hideCancelled: boolean; startDate: string | null; skillName: string | null };
    result: UsageByStep[];
  };
  get_usage_by_model: {
    args: { hideCancelled: boolean; startDate: string | null; skillName: string | null };
    result: UsageByModel[];
  };
  get_usage_by_day: {
    args: { hideCancelled: boolean; startDate: string | null; skillName: string | null };
    result: UsageByDay[];
  };
  get_workflow_skill_names: { args: NoArgs; result: string[] };
  reset_usage: { args: NoArgs; result: void };
  get_dashboard_skill_names: { args: NoArgs; result: string[] };
  list_skills: { args: { workspacePath: string; sourceUrl: string | null }; result: SkillSummary[] };
  list_imported_skills: { args: { sourceUrl: string | null }; result: ImportedSkill[] };
  delete_imported_skill: { args: { skillId: string }; result: void };
  list_plugins: { args: NoArgs; result: LibraryPlugin[] };
  delete_plugin: { args: { pluginSlug: string }; result: void };
  set_plugin_upgrade_lock: { args: { pluginSlug: string; locked: boolean }; result: void };
  create_plugin_from_skills: { args: { pluginName: string; skillKeys: string[] }; result: string };
  move_skill_to_plugin: { args: { skillKey: string; pluginSlug: string }; result: void };
  remove_skill_from_plugin: { args: { skillKey: string }; result: void };
  parse_github_url: { args: { url: string }; result: GitHubRepoInfo };
  check_marketplace_url: { args: { url: string }; result: string };
  list_github_skills: {
    args: { owner: string; repo: string; branch: string; subpath: string | null };
    result: AvailableSkill[];
  };
  list_github_plugins: {
    args: { owner: string; repo: string; branch: string; subpath: string | null };
    result: AvailablePlugin[];
  };
  import_marketplace_to_library: {
    args: {
      sourceUrl: string;
      skillPaths: string[];
      metadataOverrides: Record<string, SkillMetadataOverride> | null;
    };
    result: MarketplaceImportResult[];
  };
  import_marketplace_plugin_to_library: {
    args: { sourceUrl: string; pluginPath: string; pluginName: string };
    result: MarketplaceImportResult[];
  };
  check_marketplace_updates: { args: NoArgs; result: MarketplaceUpdateResult };
  check_skill_customized: { args: { skillName: string }; result: boolean };
  get_skill_content_at_path: { args: { path: string }; result: SkillFileContent[] };
  get_skill_content_for_refine: {
    args: { skillName: string; workspacePath: string; pluginSlug: string };
    result: SkillFileContent[];
  };
  start_refine_session: {
    args: { skillName: string; pluginSlug: string; workspacePath: string };
    result: RefineSessionInfo;
  };
  close_refine_session: { args: { sessionId: string }; result: void };
  cancel_refine_turn: { args: { sessionId: string }; result: void };
  cancel_agent_run: { args: { skillName: string; agentId: string }; result: void };
  cancel_workflow_step: { args: { agentId: string }; result: void };
  send_refine_message: {
    args: {
      sessionId: string;
      userMessage: string;
      pluginSlug: string;
      workspacePath: string;
      targetFiles: string[] | null;
    };
    result: string;
  };
  finalize_refine_run: {
    args: {
      skillName: string;
      workspacePath: string;
      pluginSlug: string;
      structuredOutput: unknown;
    };
    result: RefineFinalizeResult;
  };
  clean_benchmark_snapshot: {
    args: { skillName: string; workspacePath: string; pluginSlug: string };
    result: void;
  };
  get_skill_history: {
    args: { workspacePath: string; skillName: string; pluginSlug: string; limit: number | null };
    result: SkillCommit[];
  };
  restore_skill_version: {
    args: { workspacePath: string; skillName: string; pluginSlug: string; sha: string };
    result: string;
  };
  get_skill_files_at_sha: {
    args: { workspacePath: string; skillName: string; pluginSlug: string; sha: string };
    result: SkillFileContent[];
  };
  run_answer_evaluator: { args: { skillName: string; workspacePath: string }; result: string };
  materialize_answer_evaluation_output: {
    args: { skillName: string; workspacePath: string; structuredOutput: AnswerEvaluationOutput };
    result: void;
  };
  // VU-1157: typed Tauri commands backed by SQLite workflow_artifacts tables.
  get_clarifications: { args: { skillId: string }; result: ClarificationsDto | null };
  update_clarification_answer: {
    args: {
      skillId: string;
      questionId: string;
      answerChoice: string | null;
      answerText: string | null;
    };
    result: void;
  };
  update_clarification_verdicts: {
    args: { skillId: string; updates: ClarificationVerdictUpdate[] };
    result: void;
  };
  get_decisions: { args: { skillId: string }; result: DecisionsDto | null };
  save_decisions_edit: {
    args: {
      skillId: string;
      items: Array<{
        decision_id: string;
        decision: string;
        implication: string;
        status: string;
      }>;
    };
    result: void;
  };
  log_gate_decision: {
    args: { skillName: string; verdict: string; decision: string };
    result: void;
  };
  parse_skill_file: { args: { filePath: string }; result: SkillFileMeta };
  import_skill_from_file: {
    args: {
      filePath: string;
      name: string;
      description: string;
      version: string;
      model: string | null;
      argumentHint: string | null;
      userInvocable: boolean | null;
      disableModelInvocation: boolean | null;
    };
    result: string;
  };
  create_skill: {
    args: {
      workspacePath: string;
      name: string;
      tags: string[] | null;
      purpose: SkillPurpose;
      intakeJson: string | null;
      description: string | null;
      version: string | null;
      model: string | null;
      argumentHint: string | null;
      userInvocable: boolean | null;
      disableModelInvocation: boolean | null;
    };
    result: void;
  };
  get_all_tags: { args: NoArgs; result: string[] };
  read_latest_benchmark: {
    args: { skillName: string; workspacePath: string };
    result: LatestBenchmarkResult | null;
  };
  list_scenarios: {
    args: { pluginSlug: string; skillName: string };
    result: ScenarioDto[];
  };
  save_scenario: {
    args: { pluginSlug: string; skillName: string; scenario: ScenarioDto };
    result: ScenarioDto;
  };
  delete_scenario: {
    args: { pluginSlug: string; skillName: string; scenarioName: string };
    result: void;
  };
  generate_scenarios: {
    args: { pluginSlug: string; skillName: string };
    result: ScenarioDto[];
  };
  run_eval_workbench: {
    args: { request: RunEvalWorkbenchRequest };
    result: EvalRun;
  };
  cancel_eval_workbench_run: {
    args: { runId: string };
    result: void;
  };
  list_eval_runs: {
    args: {
      pluginSlug: string;
      skillName: string;
      mode: EvalWorkbenchMode | null;
      limit: number | null;
    };
    result: EvalRun[];
  };
  read_eval_run: {
    args: { runId: string };
    result: EvalRun | null;
  };
  suggest_description_candidates: {
    args: { request: SuggestDescriptionCandidatesRequest };
    result: DescriptionCandidate[];
  };
  suggest_assertions: {
    args: { request: SuggestAssertionsRequest };
    result: { type: string; value: string }[];
  };
  apply_description_candidate: {
    args: { pluginSlug: string; skillName: string; candidateId: string };
    result: ApplyDescriptionCandidateResponse;
  };
  build_refine_improvement_brief: {
    args: { runId: string };
    result: RefineImprovementBrief;
  };
  list_documents: { args: NoArgs; result: Document[] };
  list_skills_for_documents: { args: NoArgs; result: SkillIdName[] };
  add_document_file: {
    args: { name: string; content: string; scope: DocumentScope; skillIds: number[] };
    result: Document;
  };
  add_document_url: {
    args: { name: string; url: string; scope: DocumentScope; skillIds: number[] };
    result: Document;
  };
  add_document_folder: {
    args: { name: string; folderPath: string; scope: DocumentScope; skillIds: number[] };
    result: Document[];
  };
  update_document: { args: { id: number; scope: DocumentScope; skillIds: number[] }; result: Document };
  delete_document: { args: { id: number }; result: void };
}

export type TauriCommandName = keyof TauriCommandMap;
export type TauriCommandArgs<Name extends TauriCommandName> = TauriCommandMap[Name]["args"];
export type TauriCommandResult<Name extends TauriCommandName> = TauriCommandMap[Name]["result"];
export type TauriCommandInvocation = {
  [Name in TauriCommandName]: [command: Name, args: TauriCommandArgs<Name>];
}[TauriCommandName];
