const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const vu1140Commands = [
  "get_skill_content_at_path",
  "get_skill_content_for_refine",
  "start_refine_session",
  "close_refine_session",
  "cancel_refine_turn",
  "cancel_agent_run",
  "cancel_workflow_step",
  "answer_refine_question",
  "send_refine_message",
  "finalize_refine_run",
  "clean_benchmark_snapshot",
  "get_skill_history",
  "restore_skill_version",
  "get_skill_files_at_sha",
  "run_answer_evaluator",
  "materialize_answer_evaluation_output",
  "get_clarifications_content",
  "save_clarifications_content",
  "get_decisions_content",
  "save_decisions_content",
  "get_context_file_content",
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
    "test_api_key",
    "get_data_dir",
    "get_default_skills_path",
    "list_models",
    "set_log_level",
    "check_startup_deps",
    "reconcile_startup",
    "record_reconciliation_cancel",
    "github_start_device_flow",
    "github_poll_for_token",
    "github_get_user",
    "github_logout",
    "start_agent",
    "run_workflow_step",
    "materialize_workflow_step_output",
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
    "cleanup_skill_sidecar",
    "graceful_shutdown",
    "allow_app_exit",
    "create_workflow_session",
    "end_workflow_session",
    "resolve_orphan",
    "resolve_discovery",
    "cancel_workflow_step",
    "get_clarifications_content",
    "save_clarifications_content",
    "get_decisions_content",
    "save_decisions_content",
    "get_context_file_content",
  ];

  for (const command of migratedCommands) {
    assert.match(typeSource, new RegExp(`${command}:`));
    assert.match(tauriSource, new RegExp(`invokeCommand\\("${command}"`));
  }

  assert.match(typeSource, /export type TauriCommandInvocation =/);
  assert.match(typecheckSource, /@ts-expect-error command names must be declared/);
  assert.match(typecheckSource, /@ts-expect-error argument names must match/);
  assert.match(typecheckSource, /@ts-expect-error command result is AppSettings/);
  assert.match(typecheckSource, /@ts-expect-error widened command names must not decouple command and args/);
  assert.match(typecheckSource, /@ts-expect-error run_workflow_step requires workflowSessionId/);
  assert.match(typecheckSource, /@ts-expect-error get_workspace_path uses the typed no-args convention/);
  assert.match(typecheckSource, /@ts-expect-error resolve_discovery only accepts known discovery actions/);
  assert.match(typecheckSource, /@ts-expect-error get_context_file_content requires a context fileName/);
});

test("direct invokeUnsafe imports stay out of application code", () => {
  const sourceRoot = path.join(repoRoot, "app/src");
  const offenders = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["__tests__", "node_modules", "test"].includes(entry.name)) continue;
        walk(fullPath);
        continue;
      }
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;

      const relPath = path.relative(sourceRoot, fullPath).replace(/\\/g, "/");
      if (relPath === "lib/tauri.ts") continue;

      if (fs.readFileSync(fullPath, "utf8").includes("invokeUnsafe")) {
        offenders.push(relPath);
      }
    }
  }

  walk(sourceRoot);
  assert.deepEqual(offenders, []);
});

test("VU-1140 scoped commands stay on the typed invokeCommand path", () => {
  const tauriSource = read("app/src/lib/tauri.ts");
  const typeSource = read("app/src/lib/tauri-command-types.ts");

  const missingMapEntries = [];
  const missingTypedWrappers = [];
  const unsafeWrappers = [];

  for (const command of vu1140Commands) {
    if (!new RegExp(`${command}:`).test(typeSource)) {
      missingMapEntries.push(command);
    }
    if (!tauriSource.includes(`invokeCommand("${command}"`)) {
      missingTypedWrappers.push(command);
    }
    if (new RegExp(`invokeUnsafe(?:<[^>]+>)?\\("${command}"`).test(tauriSource)) {
      unsafeWrappers.push(command);
    }
  }

  assert.deepEqual(missingMapEntries, []);
  assert.deepEqual(missingTypedWrappers, []);
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
