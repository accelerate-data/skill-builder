import fs from "fs";
import { createRequire } from "module";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  analyzeTauriCommandPolicy,
}: {
  analyzeTauriCommandPolicy: (options: {
    repoRoot: string;
    sourceRoot?: string;
    wrapperRelativePath?: string;
    unsafeWrapperCommandAllowlist?: string[];
  }) => {
    rawTauriImportOffenders: string[];
    rawInvokeCallOffenders: string[];
    wrapperRawInvokeCallOffenders: string[];
    unsafeCallOffenders: string[];
    wrapperUnsafeCommandOffenders: string[];
    wrapperNonLiteralUnsafeCalls: string[];
    wrapperAllowedUnsafeCommands: string[];
    invokeCommandExportCount: number;
    invokeUnsafeExportCount: number;
  };
} = require("../../../../tests/evals/assertions/tauri-command-policy.js");

const sourceRoot = path.resolve(__dirname, "../../");
const repoRoot = path.resolve(sourceRoot, "../..");
const tauriWrapperPath = path.join(sourceRoot, "lib/tauri.ts");
const tauriCommandTypesPath = path.join(sourceRoot, "lib/tauri-command-types.ts");

const vu1140Commands = [
  "get_skill_content_at_path",
  "get_selected_skill_content",
  "select_skill_openhands_session",
  "pause_openhands_session",
  "get_skill_history",
  "restore_skill_version",
  "get_skill_files_at_sha",
  "run_answer_evaluator",
  "materialize_answer_evaluation_output",
  "log_gate_decision",
] as const;

function withTempSource(files: Record<string, string>, run: (tempSourceRoot: string) => void) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tauri-policy-"));
  const tempSourceRoot = path.join(tempRoot, "src");

  try {
    for (const [relativePath, source] of Object.entries(files)) {
      const filePath = path.join(tempSourceRoot, relativePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, source);
    }

    run(tempSourceRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe("Tauri command policy", () => {
  const vu1138CommandNames = [
    "delete_skill",
    "update_skill_metadata",
    "rename_skill",
    "export_skill_as_file",
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

  it("detects raw Tauri command bypasses by AST structure", () => {
    const policy = analyzeTauriCommandPolicy({
      repoRoot,
      sourceRoot,
    });

    expect(policy.rawTauriImportOffenders).toEqual([]);
    expect(policy.rawInvokeCallOffenders).toEqual([]);
    expect(policy.wrapperRawInvokeCallOffenders).toEqual([]);
    expect(policy.unsafeCallOffenders).toEqual([]);
    expect(policy.wrapperUnsafeCommandOffenders).toEqual([]);
    expect(policy.wrapperNonLiteralUnsafeCalls).toEqual([]);
  });

  it("exposes exactly one typed invokeCommand gateway and one explicit raw escape hatch", () => {
    const source = fs.readFileSync(tauriWrapperPath, "utf8");
    const policy = analyzeTauriCommandPolicy({
      repoRoot,
      sourceRoot,
    });

    expect(source).toContain("export const invokeCommand");
    expect(source).toContain("export const invokeUnsafe");
    expect(source).not.toContain("export { invoke }");
    expect(policy.invokeCommandExportCount).toBe(1);
    expect(policy.invokeUnsafeExportCount).toBe(1);
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

  it("keeps AskUserQuestion vestige commands off the wrapper and command types (VU-1155)", () => {
    // The OpenHands SDK ships no AskUserQuestion equivalent. The bring-it-back
    // work is tracked separately as VU-1158. Until that lands, neither
    // command may appear in the typed wrapper or the command-type map —
    // otherwise a future PR can quietly re-introduce dead state.
    const wrapperSource = fs.readFileSync(tauriWrapperPath, "utf8");
    const typeSource = fs.readFileSync(tauriCommandTypesPath, "utf8");

    for (const forbidden of [
      "answer_refine_question",
      "answer_workflow_step_question",
      "answerRefineQuestion",
      "answerWorkflowStepQuestion",
    ]) {
      expect(wrapperSource).not.toContain(forbidden);
      expect(typeSource).not.toContain(forbidden);
    }
  });

  it("catches aliased raw invoke and aliased invokeUnsafe calls", () => {
    withTempSource(
      {
        "lib/tauri.ts":
          'import { invoke } from "@tauri-apps/api/core";\nexport const invokeCommand = () => null;\nexport const invokeUnsafe = invoke;\n',
        "feature.ts":
          'import { invoke as rawInvoke } from "@tauri-apps/api/core";\nconst aliasedInvoke = rawInvoke;\naliasedInvoke("raw_command", {});\n',
        "unsafe.ts":
          'import { invokeUnsafe as raw } from "@/lib/tauri";\nconst run = raw;\nrun("unsafe_command", {});\n',
        "relative-unsafe.ts":
          'import { invokeUnsafe as raw } from "./lib/tauri";\nraw("relative_command", {});\n',
        "namespace-unsafe.ts":
          'import * as tauri from "@/lib/tauri";\ntauri.invokeUnsafe("namespace_command", {});\n',
      },
      (tempSourceRoot) => {
        const policy = analyzeTauriCommandPolicy({
          repoRoot,
          sourceRoot: tempSourceRoot,
          unsafeWrapperCommandAllowlist: [],
        });

        expect(policy.rawTauriImportOffenders).toEqual(["feature.ts"]);
        expect(policy.rawInvokeCallOffenders).toHaveLength(1);
        expect(policy.unsafeCallOffenders).toHaveLength(3);
      },
    );
  });

  it("catches direct raw invoke command calls in the wrapper outside invokeCommand", () => {
    withTempSource(
      {
        "lib/tauri.ts": [
          'import { invoke } from "@tauri-apps/api/core";',
          "export const invokeCommand = () => invoke('typed_gateway', {});",
          "export const invokeUnsafe = invoke;",
          'export const bypass = () => invoke("raw_wrapper_command", {});',
        ].join("\n"),
      },
      (tempSourceRoot) => {
        const policy = analyzeTauriCommandPolicy({
          repoRoot,
          sourceRoot: tempSourceRoot,
          unsafeWrapperCommandAllowlist: [],
        });

        expect(policy.wrapperRawInvokeCallOffenders).toHaveLength(1);
      },
    );
  });

  it("normalizes configured wrapper paths before comparing source files", () => {
    withTempSource(
      {
        "lib/tauri.ts":
          'import { invoke } from "@tauri-apps/api/core";\nexport const invokeCommand = () => invoke("typed_gateway", {});\nexport const invokeUnsafe = invoke;\n',
      },
      (tempSourceRoot) => {
        const policy = analyzeTauriCommandPolicy({
          repoRoot,
          sourceRoot: tempSourceRoot,
          wrapperRelativePath: "lib\\tauri.ts",
          unsafeWrapperCommandAllowlist: [],
        });

        expect(policy.invokeCommandExportCount).toBe(1);
        expect(policy.wrapperRawInvokeCallOffenders).toEqual([]);
      },
    );
  });

  it("catches non-literal invokeUnsafe command expressions in the wrapper", () => {
    withTempSource(
      {
        "lib/tauri.ts": [
          'import { invoke } from "@tauri-apps/api/core";',
          "export const invokeCommand = () => null;",
          "export const invokeUnsafe = invoke;",
          'const command = "dynamic_command";',
          "invokeUnsafe(command, {});",
        ].join("\n"),
      },
      (tempSourceRoot) => {
        const policy = analyzeTauriCommandPolicy({
          repoRoot,
          sourceRoot: tempSourceRoot,
          unsafeWrapperCommandAllowlist: [],
        });

        expect(policy.wrapperNonLiteralUnsafeCalls).toHaveLength(1);
      },
    );
  });
});
