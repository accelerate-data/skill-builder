import { invokeCommand } from "@/lib/tauri";
import type { EvalQuery } from "@/lib/description-optimization";
import type { AppSettings } from "@/lib/types";

declare const settings: AppSettings;
declare const evalQueries: EvalQuery[];

void invokeCommand("get_settings", {});
void invokeCommand("save_settings", { settings });

// @ts-expect-error command names must be declared in TauriCommandMap
void invokeCommand("get_settingz", {});

// @ts-expect-error argument names must match the command contract
void invokeCommand("test_api_key", { api_key: "sk-ant-test" });

// @ts-expect-error command result is AppSettings, not string
const invalidSettingsResult: Promise<string> = invokeCommand("get_settings", {});
void invalidSettingsResult;

import type { TauriCommandName } from "@/lib/tauri-command-types";

declare const maybeCommand: TauriCommandName;

// @ts-expect-error widened command names must not decouple command and args
void invokeCommand(maybeCommand, {});

void invokeCommand("run_optimization_loop", {
  skillName: "dbt-analytics",
  pluginSlug: "skills",
  workspacePath: "/workspace",
  model: "claude-sonnet-4-6",
  evalQueries,
});

// @ts-expect-error run_optimization_loop requires evalQueries
void invokeCommand("run_optimization_loop", {
  skillName: "dbt-analytics",
  pluginSlug: "skills",
  workspacePath: "/workspace",
  model: "claude-sonnet-4-6",
});

void invokeCommand("save_eval_queries", {
  skillName: "dbt-analytics",
  pluginSlug: "skills",
  workspacePath: "/workspace",
  // @ts-expect-error save_eval_queries preserves should_trigger in query entries
  evalQueries: [{ query: "run dbt", shouldTrigger: true }],
});

void invokeCommand("create_next_iteration_dir", {
  skillName: "dbt-analytics",
  workspacePath: "/workspace",
  pluginSlug: "skills",
});

// @ts-expect-error create_next_iteration_dir returns [number, string], not string
const invalidIterationDirResult: Promise<string> = invokeCommand("create_next_iteration_dir", {
  skillName: "dbt-analytics",
  workspacePath: "/workspace",
  pluginSlug: "skills",
});
void invalidIterationDirResult;

// @ts-expect-error read_grading returns a record, not an array
const invalidGradingResult: Promise<unknown[]> = invokeCommand("read_grading", {
  gradingPath: "/workspace/skill/evals/grading.json",
});
void invalidGradingResult;
