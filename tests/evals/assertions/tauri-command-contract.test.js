const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  analyzeTauriCommandPolicy,
} = require("./tauri-command-policy.js");

const repoRoot = path.resolve(__dirname, "../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const vu1140Commands = [
  "get_skill_content_at_path",
  "get_skill_history",
  "restore_skill_version",
  "get_skill_files_at_sha",
  "run_answer_evaluator",
  "materialize_answer_evaluation_output",
  "get_clarifications",
  "update_clarification_answer",
  "update_clarification_verdicts",
  "get_decisions",
  "save_decisions_edit",
  "log_gate_decision",
];

test("typed Tauri command contract is the only non-test command policy", () => {
  const tauriSource = read("app/src/lib/tauri.ts");
  const typeSource = read("app/src/lib/tauri-command-types.ts");
  const typecheckSource = read("app/src/lib/tauri-command-types.typecheck.ts");

  assert.match(tauriSource, /export const invokeCommand = <Invocation extends TauriCommandInvocation>/);
  assert.match(tauriSource, /export const invokeUnsafe = invoke/);
  assert.doesNotMatch(tauriSource, /export \{ invoke \}/);

  const migratedCommands = [
    "get_settings",
    "save_settings",
    "update_user_settings",
    "update_github_identity",
    "test_model_connection",
    "get_data_dir",
    "get_default_skills_path",
    "set_log_level",
    "check_startup_deps",
    "reconcile_startup",
    "record_reconciliation_cancel",
    "github_start_device_flow",
    "github_poll_for_token",
    "github_get_user",
    "github_logout",
    "run_workflow_step",
    "reset_workflow_step",
    "navigate_back_to_step",
    "preview_step_reset",
    "verify_step_output",
    "get_disabled_steps",
    "get_workflow_state",
    "save_workflow_state",
    "read_file",
    "write_file",
    "list_skill_files",
    "get_workspace_path",
    "graceful_shutdown",
    "allow_app_exit",
    "create_workflow_session",
    "end_workflow_session",
  ];

  for (const command of migratedCommands) {
    assert.match(typeSource, new RegExp(`${command}:`));
    assert.match(tauriSource, new RegExp(`invokeCommand\\("${command}"`));
  }

  assert.match(typeSource, /export type TauriCommandInvocation =/);
  assert.match(typecheckSource, /@ts-expect-error command names must be declared/);
  assert.match(typecheckSource, /@ts-expect-error .*argument names must match/);
  assert.match(typecheckSource, /@ts-expect-error command result is AppSettings/);
  assert.match(typecheckSource, /@ts-expect-error widened command names must not decouple command and args/);
  assert.match(typecheckSource, /@ts-expect-error widened workflow command names must not bypass command-specific args/);
  assert.match(typecheckSource, /@ts-expect-error get_workspace_path uses the typed no-args convention/);
  assert.match(typecheckSource, /@ts-expect-error get_decisions requires a skillId string/);
});

test("direct invokeUnsafe imports stay out of application code", () => {
  const policy = analyzeTauriCommandPolicy({ repoRoot });

  assert.deepEqual(policy.rawTauriImportOffenders, []);
  assert.deepEqual(policy.rawInvokeCallOffenders, []);
  assert.deepEqual(policy.wrapperRawInvokeCallOffenders, []);
  assert.deepEqual(policy.unsafeCallOffenders, []);
  assert.deepEqual(policy.wrapperUnsafeCommandOffenders, []);
  assert.deepEqual(policy.wrapperNonLiteralUnsafeCalls, []);
  assert.equal(policy.invokeCommandExportCount, 1);
  assert.equal(policy.invokeUnsafeExportCount, 1);
});

test("VU-1140 scoped commands stay on the typed invokeCommand path", () => {
  const typeSource = read("app/src/lib/tauri-command-types.ts");
  const typedUsageSource = [
    read("app/src/lib/tauri.ts"),
    read("app/src/lib/queries/clarifications.ts"),
    read("app/src/lib/queries/decisions.ts"),
    read("app/src/hooks/use-workflow-autosave.ts"),
    read("app/src/hooks/use-workflow-gate.ts"),
  ].join("\n");

  const missingMapEntries = [];
  const missingTypedUsage = [];
  const unsafeWrappers = [];

  for (const command of vu1140Commands) {
    if (!new RegExp(`${command}:`).test(typeSource)) {
      missingMapEntries.push(command);
    }
    if (!typedUsageSource.includes(`invokeCommand("${command}"`)) {
      missingTypedUsage.push(command);
    }
    if (new RegExp(`invokeUnsafe(?:<[^>]+>)?\\("${command}"`).test(typedUsageSource)) {
      unsafeWrappers.push(command);
    }
  }

  assert.deepEqual(missingMapEntries, []);
  assert.deepEqual(missingTypedUsage, []);
  assert.deepEqual(unsafeWrappers, []);
});

test("wrapper commands use invokeCommand unless explicitly allowlisted", () => {
  const tauriSource = read("app/src/lib/tauri.ts");
  const allowedUnsafeCommands = {};
  const unsafeCommands = Array.from(
    tauriSource.matchAll(/invokeUnsafe(?:<[^)]*>)?\(\s*"([^"]+)"/g),
    (match) => match[1],
  );

  const undocumentedCommands = unsafeCommands.filter(
    (command) => !allowedUnsafeCommands[command],
  );

  assert.deepEqual(undocumentedCommands, []);
});

test("published Eval Workbench command surface omits legacy and no-op commands", () => {
  const apiSource = read("docs/design/backend-design/api.md");

  for (const command of [
    "list_scenarios",
    "load_scenario",
    "create_scenario",
    "save_scenario",
    "delete_scenario",
    "define_eval_scenario",
  ]) {
    assert.ok(apiSource.includes(`| \`${command}\` |`));
  }

  assert.equal(apiSource.includes("| `generate_suggestions` |"), false);

  for (const staleCommand of [
    "generate_scenarios",
    "run_optimization_loop",
    "save_eval_queries",
    "load_eval_queries",
    "start_generate_desc_eval_queries",
    "materialize_eval_benchmark",
    "suggest_description_candidates",
    "apply_description_candidate",
  ]) {
    assert.equal(apiSource.includes(`| \`${staleCommand}\` |`), false);
  }
});

test("Eval Workbench design omits retired description-generation surfaces", () => {
  const evalWorkbenchSource = read("docs/design/eval-workbench/README.md");

  for (const staleReference of [
    "workspace-description.tsx",
    "suggest_description_candidates",
    "apply_description_candidate",
  ]) {
    assert.equal(evalWorkbenchSource.includes(staleReference), false);
  }

  assert.match(evalWorkbenchSource, /One-tab Eval Workbench shell/);
  assert.match(evalWorkbenchSource, /one-scenario editor UI/);
});

test("invokeUnsafe call expressions are rejected outside documented exceptions", () => {
  const tauriSource = read("app/src/lib/tauri.ts");

  assert.doesNotMatch(tauriSource, /\binvokeUnsafe\s*\(/);
});

test("raw invoke calls stay behind the typed invokeCommand gateway", () => {
  const tauriSource = read("app/src/lib/tauri.ts");
  const sourceWithoutGateway = tauriSource.replace(
    /export const invokeCommand = <Invocation extends TauriCommandInvocation>\(\n\s+\.\.\.\[command, args\]: Invocation\n\) => invoke<TauriCommandResult<Invocation\[0\]>>\(command, args\);/,
    "",
  );

  assert.doesNotMatch(sourceWithoutGateway, /\binvoke(?:<[^)]*>)?\(/);
});
