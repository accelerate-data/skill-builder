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
