import type {
  AppSettings,
  AvailablePlugin,
  AvailableSkill,
  AnswerEvaluationOutput,
  BenchmarkData,
  DeviceFlowResponse,
  EvalBenchmark,
  GitHubRepoInfo,
  GitHubAuthResult,
  GitHubUser,
  ImportedSkill,
  IterationMeta,
  LibraryPlugin,
  MarketplaceImportResult,
  MarketplaceUpdateResult,
  ModelInfo,
  PendingEval,
  RefineFinalizeResult,
  RefineSessionInfo,
  ReconciliationResult,
  SkillCommit,
  SkillEvalContext,
  SkillFileContent,
  SkillFileMeta,
  SkillMetadataOverride,
  SkillSummary,
  StartupDeps,
  TestCase,
} from "@/lib/types";
import type { EvalQuery, OptimizationResult } from "@/lib/description-optimization";

export type NoArgs = Record<string, never>;

export interface FieldSuggestions {
  description: string;
  domain: string;
  audience: string;
  challenges: string;
  scope: string;
  unique_setup: string;
  claude_mistakes: string;
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

export interface TauriCommandMap {
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
  test_api_key: { args: { apiKey: string }; result: boolean };
  get_data_dir: { args: NoArgs; result: string };
  get_default_skills_path: { args: NoArgs; result: string };
  list_models: { args: { apiKey: string }; result: ModelInfo[] };
  set_log_level: { args: { level: string }; result: void };
  check_startup_deps: { args: NoArgs; result: StartupDeps };
  reconcile_startup: { args: NoArgs | { apply: true }; result: ReconciliationResult };
  record_reconciliation_cancel: {
    args: { notificationCount: number; discoveredCount: number };
    result: void;
  };
  github_start_device_flow: { args: NoArgs; result: DeviceFlowResponse };
  github_poll_for_token: { args: { deviceCode: string }; result: GitHubAuthResult };
  github_get_user: { args: NoArgs; result: GitHubUser | null };
  github_logout: { args: NoArgs; result: void };
  delete_skill: { args: { workspacePath: string; name: string }; result: void };
  update_skill_metadata: {
    args: {
      skillName: string;
      pluginSlug: string;
      purpose: string | null;
      tags: string[] | null;
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
  rename_skill: {
    args: { oldName: string; newName: string; workspacePath: string };
    result: void;
  };
  export_skill_as_file: {
    args: { skillName: string; pluginSlug: string; destPath: string };
    result: void;
  };
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
  get_dashboard_skill_names: { args: NoArgs; result: string[] };
  list_skills: {
    args: { workspacePath: string; sourceUrl: string | null };
    result: SkillSummary[];
  };
  list_imported_skills: {
    args: { sourceUrl: string | null };
    result: ImportedSkill[];
  };
  delete_imported_skill: { args: { skillId: string }; result: void };
  list_plugins: { args: NoArgs; result: LibraryPlugin[] };
  delete_plugin: { args: { pluginSlug: string }; result: void };
  set_plugin_upgrade_lock: {
    args: { pluginSlug: string; locked: boolean };
    result: void;
  };
  create_plugin_from_skills: {
    args: { pluginName: string; skillKeys: string[] };
    result: string;
  };
  move_skill_to_plugin: {
    args: { skillKey: string; pluginSlug: string };
    result: void;
  };
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
  run_optimization_loop: {
    args: {
      skillName: string;
      pluginSlug: string;
      workspacePath: string;
      model: string;
      evalQueries: EvalQuery[];
    };
    result: OptimizationResult;
  };
  cancel_description_optimization: { args: NoArgs; result: void };
  apply_description: {
    args: {
      skillName: string;
      pluginSlug: string;
      workspacePath: string;
      description: string;
    };
    result: string;
  };
  save_eval_queries: {
    args: {
      skillName: string;
      pluginSlug: string;
      workspacePath: string;
      evalQueries: Array<Pick<EvalQuery, "query" | "should_trigger">>;
    };
    result: void;
  };
  load_eval_queries: {
    args: { skillName: string; pluginSlug: string; workspacePath: string };
    result: EvalQuery[];
  };
  start_generate_desc_evals: {
    args: {
      agentId: string;
      skillName: string;
      pluginSlug: string;
      workspaceSkillDir: string;
      model: string;
      numEvalQueries: number;
    };
    result: string;
  };
  write_desc_opt_log: {
    args: { skillName: string; pluginSlug: string; workspacePath: string; message: string };
    result: void;
  };
  read_latest_benchmark: {
    args: { skillName: string; workspacePath: string };
    result: { iteration: number; data: BenchmarkData } | null;
  };
  list_test_cases: {
    args: { skillName: string; workspacePath: string; pluginSlug: string };
    result: TestCase[];
  };
  save_test_case: {
    args: { skillName: string; workspacePath: string; pluginSlug: string; testCase: TestCase };
    result: TestCase;
  };
  delete_test_case: {
    args: { skillName: string; workspacePath: string; pluginSlug: string; id: number };
    result: void;
  };
  list_iterations: {
    args: { skillName: string; workspacePath: string; pluginSlug: string };
    result: IterationMeta[];
  };
  create_next_iteration_dir: {
    args: { skillName: string; workspacePath: string; pluginSlug: string };
    result: [number, string];
  };
  materialize_eval_benchmark: {
    args: {
      iterDir: string;
      skillName: string;
      workspacePath: string;
      pluginSlug: string;
      iteration: number;
      evalIds: number[];
      runCount: number;
      comparisonMode: string | null;
    };
    result: EvalBenchmark;
  };
  read_iteration_result: {
    args: {
      iterationPath: string;
      skillName: string | null;
      workspacePath: string | null;
      pluginSlug: string | null;
    };
    result: [EvalBenchmark, string[]];
  };
  read_grading: { args: { gradingPath: string }; result: Record<string, unknown> };
  read_skill_context_for_eval_gen: {
    args: { skillName: string; workspacePath: string; pluginSlug: string };
    result: SkillEvalContext;
  };
  read_pending_eval: {
    args: { skillName: string; workspacePath: string; pluginSlug: string };
    result: PendingEval;
  };
  discard_pending_eval: {
    args: { skillName: string; workspacePath: string; pluginSlug: string };
    result: void;
  };
  build_eval_prompt: {
    args: {
      skillName: string;
      pluginSlug: string;
      workspacePath: string;
      skillPath: string;
      evalIds: number[];
      runCount: number;
      iteration: number;
      iterDir: string;
      comparisonMode: string | null;
    };
    result: [string, string];
  };
  build_eval_gen_prompt: {
    args: {
      skillName: string;
      skillPath: string;
      outputPath: string;
      userIntent: string;
      userContextFile: string;
    };
    result: [string, string];
  };
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
  answer_refine_question: {
    args: {
      sessionId: string;
      agentId: string;
      toolUseId: string;
      questions: unknown;
      answers: Record<string, unknown>;
    };
    result: void;
  };
  send_refine_message: {
    args: {
      sessionId: string;
      userMessage: string;
      pluginSlug: string;
      workspacePath: string;
      targetFiles: string[] | null;
      command: string | null;
    };
    result: string;
  };
  finalize_refine_run: {
    args: {
      skillName: string;
      workspacePath: string;
      pluginSlug: string;
      structuredOutput: unknown | null;
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
  get_clarifications_content: { args: { skillName: string; workspacePath: string }; result: string };
  save_clarifications_content: {
    args: { skillName: string; workspacePath: string; content: string };
    result: void;
  };
  get_decisions_content: { args: { skillName: string; workspacePath: string }; result: string };
  save_decisions_content: {
    args: { skillName: string; workspacePath: string; content: string };
    result: void;
  };
  get_context_file_content: {
    args: { skillName: string; workspacePath: string; fileName: string };
    result: string;
  };
  log_gate_decision: {
    args: { skillName: string; verdict: string; decision: string };
    result: void;
  };
}

export type TauriCommandName = keyof TauriCommandMap;
export type TauriCommandArgs<Name extends TauriCommandName> = TauriCommandMap[Name]["args"];
export type TauriCommandResult<Name extends TauriCommandName> = TauriCommandMap[Name]["result"];
export type TauriCommandInvocation = {
  [Name in TauriCommandName]: [command: Name, args: TauriCommandArgs<Name>];
}[TauriCommandName];
