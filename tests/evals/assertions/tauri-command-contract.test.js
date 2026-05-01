const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

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
