import { invokeCommand } from "@/lib/tauri";
import type { SaveEvalPromptSet } from "@/lib/eval-workbench";
import type { AppSettings } from "@/lib/types";

declare const settings: AppSettings;
declare const promptSet: SaveEvalPromptSet;

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

// @ts-expect-error run_workflow_step requires workflowSessionId to be string or null, not number
void invokeCommand("run_workflow_step", {
  skillName: "demo",
  stepId: 1,
  workspacePath: "/tmp/workspace",
  workflowSessionId: 123,
});

// @ts-expect-error get_workspace_path uses the typed no-args convention
void invokeCommand("get_workspace_path", { apply: true });

// @ts-expect-error get_decisions requires a skillId string
void invokeCommand("get_decisions", {});

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

void invokeCommand("list_eval_prompt_sets", {
  pluginSlug: "skills",
  skillName: "demo",
  mode: "performance",
});

void invokeCommand("save_eval_prompt_set", { promptSet });

void invokeCommand("run_eval_workbench", {
  request: {
    runId: "run-1",
    promptSetId: "prompt-set-1",
    candidateIds: ["current-skill"],
  },
});

void invokeCommand("suggest_description_candidates", {
  request: {
    promptSetId: "prompt-set-1",
    baselineDescription: "Route invoice reconciliation requests",
    candidateCount: 3,
  },
});

// @ts-expect-error workbench run request requires runId and candidateIds
void invokeCommand("run_eval_workbench", {
  request: {
    promptSetId: "prompt-set-1",
  },
});

// @ts-expect-error apply_description_candidate requires candidateId
void invokeCommand("apply_description_candidate", {
  pluginSlug: "skills",
  skillName: "demo",
});
