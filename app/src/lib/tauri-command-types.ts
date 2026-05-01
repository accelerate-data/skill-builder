import type {
  AppSettings,
  BenchmarkData,
  DeviceFlowResponse,
  EvalBenchmark,
  GitHubAuthResult,
  GitHubUser,
  IterationMeta,
  ModelInfo,
  PendingEval,
  ReconciliationResult,
  SkillEvalContext,
  StartupDeps,
  TestCase,
} from "@/lib/types";
import type { EvalQuery, OptimizationResult } from "@/lib/description-optimization";

export type NoArgs = Record<string, never>;

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
}

export type TauriCommandName = keyof TauriCommandMap;
export type TauriCommandArgs<Name extends TauriCommandName> = TauriCommandMap[Name]["args"];
export type TauriCommandResult<Name extends TauriCommandName> = TauriCommandMap[Name]["result"];
export type TauriCommandInvocation = {
  [Name in TauriCommandName]: [command: Name, args: TauriCommandArgs<Name>];
}[TauriCommandName];
