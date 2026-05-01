import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve(__dirname, "../../");
const tauriWrapperPath = path.join(sourceRoot, "lib/tauri.ts");
const tauriCommandTypesPath = path.join(sourceRoot, "lib/tauri-command-types.ts");

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
] as const;

function walkSourceFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules" || entry.name === "test") continue;
      files.push(...walkSourceFiles(fullPath));
      continue;
    }

    if ((entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) && !entry.name.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("Tauri command policy", () => {
  const vu1138CommandNames = [
    "delete_skill",
    "update_skill_metadata",
    "rename_skill",
    "export_skill_as_file",
    "generate_suggestions",
    "review_skill_scope",
    "get_dashboard_skill_names",
    "list_skills",
    "list_imported_skills",
    "delete_imported_skill",
    "list_plugins",
    "delete_plugin",
    "set_plugin_upgrade_lock",
    "create_plugin_from_skills",
    "move_skill_to_plugin",
    "remove_skill_from_plugin",
    "parse_github_url",
    "check_marketplace_url",
    "list_github_skills",
    "list_github_plugins",
    "import_marketplace_to_library",
    "import_marketplace_plugin_to_library",
    "check_marketplace_updates",
    "check_skill_customized",
    "parse_skill_file",
    "import_skill_from_file",
  ];

  it("centralizes raw Tauri invoke access in lib/tauri.ts", () => {
    const offenders: string[] = [];

    for (const filePath of walkSourceFiles(sourceRoot)) {
      const relPath = path.relative(sourceRoot, filePath).replace(/\\/g, "/");
      const source = fs.readFileSync(filePath, "utf8");

      if (source.includes("@tauri-apps/api/core") && relPath !== "lib/tauri.ts") {
        offenders.push(relPath);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps invokeUnsafe private to the wrapper module", () => {
    const offenders: string[] = [];

    for (const filePath of walkSourceFiles(sourceRoot)) {
      const relPath = path.relative(sourceRoot, filePath).replace(/\\/g, "/");
      if (relPath === "lib/tauri.ts") continue;

      const source = fs.readFileSync(filePath, "utf8");
      if (source.includes("invokeUnsafe")) offenders.push(relPath);
    }

    expect(offenders).toEqual([]);
  });

  it("exposes typed invokeCommand and names the raw escape hatch explicitly", () => {
    const source = fs.readFileSync(tauriWrapperPath, "utf8");

    expect(source).toContain("export const invokeCommand");
    expect(source).toContain("export const invokeUnsafe");
    expect(source).not.toContain("export { invoke }");
  });

  it("keeps VU-1138 skill library and marketplace commands off invokeUnsafe", () => {
    const source = fs.readFileSync(path.join(sourceRoot, "lib/tauri.ts"), "utf8");
    const unsafeCommandPattern = /invokeUnsafe(?:<[^>]+>)?\("([^"]+)"/g;
    const unsafeCommands = Array.from(source.matchAll(unsafeCommandPattern), (match) => match[1]);
    const offenders = vu1138CommandNames.filter((command) => unsafeCommands.includes(command));

    expect(offenders).toEqual([]);
  });

  it("keeps VU-1140 command wrappers on the typed invokeCommand path", () => {
    const wrapperSource = fs.readFileSync(tauriWrapperPath, "utf8");
    const typeSource = fs.readFileSync(tauriCommandTypesPath, "utf8");
    const missingMapEntries: string[] = [];
    const missingTypedWrappers: string[] = [];
    const unsafeWrappers: string[] = [];

    for (const command of vu1140Commands) {
      if (!new RegExp(`${command}:`).test(typeSource)) {
        missingMapEntries.push(command);
      }
      if (!wrapperSource.includes(`invokeCommand("${command}"`)) {
        missingTypedWrappers.push(command);
      }
      if (new RegExp(`invokeUnsafe(?:<[^>]+>)?\\("${command}"`).test(wrapperSource)) {
        unsafeWrappers.push(command);
      }
    }

    expect(missingMapEntries).toEqual([]);
    expect(missingTypedWrappers).toEqual([]);
    expect(unsafeWrappers).toEqual([]);
  });
});
