import { invokeCommand } from "@/lib/tauri";
import type { ScenarioDto } from "@/lib/eval-workbench";
import type { AppSettings } from "@/lib/types";

declare const settings: AppSettings;
declare const scenario: ScenarioDto;

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
  skillId: 1,
  skillName: "demo",
  stepId: 1,
});

void invokeCommand("send_conversation_message", {
  input: {
    conversationId: "conv-1",
    localEventId: "evt-1",
    message: "hello",
  },
});

void invokeCommand("get_workspace_path", {});

// @ts-expect-error get_workspace_path uses the typed no-args convention
void invokeCommand("get_workspace_path", { apply: true });

// @ts-expect-error get_decisions requires a skillId string
void invokeCommand("get_decisions", {});

// @ts-expect-error selected-skill bootstrap requires skillName, pluginSlug, and workspacePath
void invokeCommand("select_skill_openhands_session", { session_id: "session-1" });

// @ts-expect-error answer evaluator output must match AnswerEvaluationOutput
void invokeCommand("materialize_answer_evaluation_output", {
  skillName: "demo",
  workspacePath: "/tmp/workspace",
  evaluationPayload: { verdict: "ok" },
});

// @ts-expect-error git history limit must be number or null
void invokeCommand("get_skill_history", {
  workspacePath: "/tmp/workspace",
  skillName: "demo",
  pluginSlug: "skills",
  limit: "10",
});

void invokeCommand("list_scenarios", {
  pluginSlug: "skills",
  skillName: "demo",
});

void invokeCommand("load_scenario", {
  pluginSlug: "skills",
  skillName: "demo",
  scenarioName: "Regression",
});

void invokeCommand("create_scenario", {
  pluginSlug: "skills",
  skillName: "demo",
});

void invokeCommand("save_scenario", {
  pluginSlug: "skills",
  skillName: "demo",
  scenario,
  previousScenarioName: null,
});

void invokeCommand("define_eval_scenario", {
  pluginSlug: "skills",
  skillName: "demo",
  scenarioName: "Regression",
});
