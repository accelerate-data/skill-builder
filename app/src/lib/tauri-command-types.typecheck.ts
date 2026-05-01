import { invokeCommand } from "@/lib/tauri";
import type { EvalQuery } from "@/lib/description-optimization";
import type { AppSettings } from "@/lib/types";

declare const settings: AppSettings;
declare const evalQueries: EvalQuery[];

void invokeCommand("get_settings", {});
void invokeCommand("save_settings", { settings });
void invokeCommand("delete_skill", { workspacePath: "/tmp/skills", name: "demo-skill" });
void invokeCommand("import_marketplace_to_library", {
  sourceUrl: "https://github.com/acme/skills",
  skillPaths: ["plugins/demo/skills/demo-skill"],
  metadataOverrides: null,
});

// @ts-expect-error command names must be declared in TauriCommandMap
void invokeCommand("get_settingz", {});

// @ts-expect-error VU-1138 command names must be declared in TauriCommandMap
void invokeCommand("delete_skills", { workspacePath: "/tmp/skills", name: "demo-skill" });

// @ts-expect-error argument names must match the command contract
void invokeCommand("test_api_key", { api_key: "sk-ant-test" });

// @ts-expect-error VU-1138 argument names must match the command contract
void invokeCommand("delete_skill", { workspace_path: "/tmp/skills", name: "demo-skill" });

// @ts-expect-error command result is AppSettings, not string
const invalidSettingsResult: Promise<string> = invokeCommand("get_settings", {});
void invalidSettingsResult;

// @ts-expect-error VU-1138 command result is MarketplaceImportResult[], not string
const invalidMarketplaceImportResult: Promise<string> = invokeCommand("import_marketplace_to_library", {
  sourceUrl: "https://github.com/acme/skills",
  skillPaths: ["plugins/demo/skills/demo-skill"],
  metadataOverrides: null,
});
void invalidMarketplaceImportResult;

import type { TauriCommandName } from "@/lib/tauri-command-types";

declare const maybeCommand: TauriCommandName;
declare const unsafeWorkflowCommand: "run_workflow_step" | "save_workflow_state";

// @ts-expect-error widened command names must not decouple command and args
void invokeCommand(maybeCommand, {});

// @ts-expect-error widened workflow command names must not bypass command-specific args
void invokeCommand(unsafeWorkflowCommand, {});

void invokeCommand("run_workflow_step", {
  skillName: "demo",
  stepId: 1,
  workspacePath: "/tmp/workspace",
  workflowSessionId: null,
});

void invokeCommand("get_workspace_path", {});

void invokeCommand("resolve_discovery", {
  skillName: "demo",
  action: "add-skill-builder",
  pluginSlug: null,
});

void invokeCommand("cancel_workflow_step", { agentId: "demo-step-agent" });
void invokeCommand("get_context_file_content", {
  skillName: "demo",
  workspacePath: "/tmp/workspace",
  fileName: "clarifications.json",
});

// @ts-expect-error run_workflow_step requires workflowSessionId to be string or null, not number
void invokeCommand("run_workflow_step", {
  skillName: "demo",
  stepId: 1,
  workspacePath: "/tmp/workspace",
  workflowSessionId: 123,
});

// @ts-expect-error get_workspace_path uses the typed no-args convention
void invokeCommand("get_workspace_path", { apply: true });

// @ts-expect-error resolve_discovery action and pluginSlug must match the contract
void invokeCommand("resolve_discovery", {
  skillName: "demo",
  action: 42,
  pluginSlug: false,
});

// @ts-expect-error resolve_discovery only accepts known discovery actions
void invokeCommand("resolve_discovery", {
  skillName: "demo",
  action: "keep",
  pluginSlug: null,
});

// @ts-expect-error get_context_file_content requires a context fileName
void invokeCommand("get_context_file_content", {
  skillName: "demo",
  workspacePath: "/tmp/workspace",
});

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

// @ts-expect-error refine command requires camelCase sessionId
void invokeCommand("close_refine_session", { session_id: "session-1" });

// @ts-expect-error send_refine_message requires nullable targetFiles and command fields
void invokeCommand("send_refine_message", {
  sessionId: "session-1",
  userMessage: "Update this skill",
  pluginSlug: "skills",
  workspacePath: "/tmp/workspace",
});

// @ts-expect-error answer evaluator output must match AnswerEvaluationOutput
void invokeCommand("materialize_answer_evaluation_output", {
  skillName: "demo",
  workspacePath: "/tmp/workspace",
  structuredOutput: { verdict: "ok" },
});

// @ts-expect-error git history limit must be number or null
void invokeCommand("get_skill_history", {
  workspacePath: "/tmp/workspace",
  skillName: "demo",
  pluginSlug: "skills",
  limit: "10",
});
