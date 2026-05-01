# VU-927 Typed Tauri Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a typed frontend command surface for Tauri IPC and migrate the Settings command area so command names, argument objects, and return values are checked by TypeScript.

**Architecture:** Keep raw `@tauri-apps/api/core` access private to `app/src/lib/tauri.ts`. Add a `TauriCommandMap` type map and `invokeCommand()` helper, then migrate Settings wrappers to the typed helper as the proof-of-concept feature area. Use TypeScript compile checks, Vitest guard tests, and deterministic eval-harness tests to enforce the convention without manual testing.

**Tech Stack:** TypeScript 6, Tauri v2 `invoke`, Vitest, Node test runner for deterministic eval-harness checks, Markdown guidance.

---

## Context

- Linear issue: VU-927, `Enforce type-safe Tauri command calls from the frontend`.
- Functional spec: `not_applicable` for this repo; no `docs/functional/` tree exists.
- Related design docs:
  - `docs/design/data-contracts/README.md` documents the existing VU-996 Specta data-contract work and explicitly leaves Tauri command call typing as separate scope.
  - `docs/design/backend-design/api.md` is the closest backend API overview.
- Related implementation plan: this file.
- Manual tests: **No manual tests required.** All VU-927 scenarios are covered by compile-time checks, static guard tests, deterministic eval-harness tests, and targeted unit/typecheck commands.

## File Structure

- Create `app/src/lib/tauri-command-types.ts`
  - Owns the command-name to `{ args, result }` type map.
  - Exports `TauriCommandName`, `TauriCommandArgs`, `TauriCommandResult`, and `NoArgs`.
- Modify `app/src/lib/tauri.ts`
  - Keeps raw `invoke` private.
  - Exports `invokeCommand()` as the typed command surface.
  - Migrates Settings wrappers to `invokeCommand()`.
  - Exports `invokeUnsafe()` only as an explicit escape hatch with a code comment.
- Create `app/src/lib/tauri-command-types.typecheck.ts`
  - Compile-only checks with `@ts-expect-error` for invalid command names, invalid argument shapes, and invalid return assignment.
- Create `app/src/__tests__/guards/tauri-command-policy.test.ts`
  - Static guard ensuring raw Tauri core imports remain centralized and the raw invoke escape hatch is named explicitly.
- Create `tests/evals/assertions/tauri-command-contract.test.js`
  - Deterministic eval-harness check that validates the typed IPC convention from source.
- Modify `.claude/rules/codegen.md`
  - Documents the command wrapper convention beside the existing generated contract rule.
- Modify `TEST_MANIFEST.md`
  - Adds the typed command contract guard and eval-harness check to the shared infrastructure map.

---

### Task 1: Add Typed Command Surface

**Files:**

- Create: `app/src/lib/tauri-command-types.ts`
- Modify: `app/src/lib/tauri.ts`
- Create: `app/src/lib/tauri-command-types.typecheck.ts`

- [x] **Step 1: Write the compile-time command contract file**

Create `app/src/lib/tauri-command-types.ts`:

```ts
import type {
  AppSettings,
  DeviceFlowResponse,
  GitHubAuthResult,
  GitHubUser,
  ModelInfo,
  ReconciliationResult,
  StartupDeps,
} from "@/lib/types";

export type NoArgs = Record<string, never>;

export interface TauriCommandMap {
  get_settings: { args: NoArgs; result: AppSettings };
  save_settings: { args: { settings: AppSettings }; result: void };
  update_user_settings: { args: { settings: AppSettings }; result: void };
  update_github_identity: {
    args: {
      login: string | null;
      avatar: string | null;
      email: string | null;
      token: string | null;
    };
    result: void;
  };
  test_api_key: { args: { apiKey: string }; result: boolean };
  get_data_dir: { args: NoArgs; result: string };
  get_default_skills_path: { args: NoArgs; result: string };
  list_models: { args: { apiKey: string }; result: ModelInfo[] };
  set_log_level: { args: { level: string }; result: void };
  check_startup_deps: { args: NoArgs; result: StartupDeps };
  reconcile_startup: { args: NoArgs | { apply: true }; result: ReconciliationResult };
  record_reconciliation_cancel: { args: { notificationCount: number; discoveredCount: number }; result: void };
  github_start_device_flow: { args: NoArgs; result: DeviceFlowResponse };
  github_poll_for_token: { args: { deviceCode: string }; result: GitHubAuthResult };
  github_get_user: { args: NoArgs; result: GitHubUser | null };
  github_logout: { args: NoArgs; result: void };
}

export type TauriCommandName = keyof TauriCommandMap;
export type TauriCommandArgs<Name extends TauriCommandName> = TauriCommandMap[Name]["args"];
export type TauriCommandResult<Name extends TauriCommandName> = TauriCommandMap[Name]["result"];
```

- [x] **Step 2: Run typecheck and verify the new file compiles**

Run:

```bash
cd app && npx tsc --noEmit
```

Expected: PASS. If it fails because imported types are not exported from `@/lib/types`, replace the imports with the existing source types used by `app/src/lib/tauri.ts`.

- [x] **Step 3: Add `invokeCommand()` and explicit escape hatch**

In `app/src/lib/tauri.ts`, replace the raw invoke re-export:

```ts
import { invoke } from "@tauri-apps/api/core";
import type {
  TauriCommandArgs,
  TauriCommandName,
  TauriCommandResult,
} from "@/lib/tauri-command-types";

export const invokeCommand = <Name extends TauriCommandName>(
  command: Name,
  args: TauriCommandArgs<Name>,
) => invoke<TauriCommandResult<Name>>(command, args);

/** Escape hatch for commands that have not joined `TauriCommandMap` yet. Prefer `invokeCommand`. */
export const invokeUnsafe = invoke;
```

- [x] **Step 4: Migrate Settings wrappers to typed `invokeCommand()`**

Change these wrappers in `app/src/lib/tauri.ts`:

```ts
export const getSettings = () => invokeCommand("get_settings", {});

export const saveSettings = (settings: AppSettings) =>
  invokeCommand("save_settings", { settings });

export const updateUserSettings = (settings: AppSettings) =>
  invokeCommand("update_user_settings", { settings });

export const updateGithubIdentity = (
  login: string | null,
  avatar: string | null,
  email: string | null,
  token: string | null,
) => invokeCommand("update_github_identity", { login, avatar, email, token });

export const testApiKey = (apiKey: string) =>
  invokeCommand("test_api_key", { apiKey });

export const getDataDir = () => invokeCommand("get_data_dir", {});

export const getDefaultSkillsPath = () => invokeCommand("get_default_skills_path", {});

export const listModels = (apiKey: string) =>
  invokeCommand("list_models", { apiKey });

export const setLogLevel = (level: string) =>
  invokeCommand("set_log_level", { level });

export const checkStartupDeps = () =>
  invokeCommand("check_startup_deps", {});

export const reconcileStartup = (apply = false) =>
  apply
    ? invokeCommand("reconcile_startup", { apply: true })
    : invokeCommand("reconcile_startup", {});

export const recordReconciliationCancel = (
  notificationCount: number,
  discoveredCount: number,
) =>
  invokeCommand("record_reconciliation_cancel", {
    notificationCount,
    discoveredCount,
  });

export const githubStartDeviceFlow = () =>
  invokeCommand("github_start_device_flow", {});

export const githubPollForToken = (deviceCode: string) =>
  invokeCommand("github_poll_for_token", { deviceCode });

export const githubGetUser = () =>
  invokeCommand("github_get_user", {});

export const githubLogout = () =>
  invokeCommand("github_logout", {});
```

- [x] **Step 5: Add compile-time negative checks**

Create `app/src/lib/tauri-command-types.typecheck.ts`:

```ts
import { invokeCommand } from "@/lib/tauri";
import type { AppSettings } from "@/lib/types";

declare const settings: AppSettings;

void invokeCommand("get_settings", {});
void invokeCommand("save_settings", { settings });

// @ts-expect-error command names must be declared in TauriCommandMap
void invokeCommand("get_settingz", {});

// @ts-expect-error argument names must match the command contract
void invokeCommand("test_api_key", { api_key: "sk-ant-test" });

// @ts-expect-error command result is AppSettings, not string
const invalidSettingsResult: Promise<string> = invokeCommand("get_settings", {});
void invalidSettingsResult;
```

- [x] **Step 6: Run typecheck and targeted unit tests**

Run:

```bash
cd app && npx tsc --noEmit
cd app && npx vitest run src/__tests__/pages/settings.test.tsx src/__tests__/hooks/use-settings-form.test.ts src/__tests__/components/settings/sdk-section.test.tsx
```

Expected: typecheck PASS; targeted tests PASS. If a listed test file does not exist, run the nearest existing test for that wrapper area and note the replacement in the final implementation update.

- [x] **Step 7: Commit Task 1**

```bash
git add app/src/lib/tauri-command-types.ts app/src/lib/tauri-command-types.typecheck.ts app/src/lib/tauri.ts
git commit -m "VU-927: add typed Tauri command surface"
```

---

### Task 2: Add Static Guard and Eval-Harness Coverage

**Files:**

- Create: `app/src/__tests__/guards/tauri-command-policy.test.ts`
- Create: `tests/evals/assertions/tauri-command-contract.test.js`
- Modify: `TEST_MANIFEST.md`

- [x] **Step 1: Add a Vitest guard for raw invoke centralization**

Create `app/src/__tests__/guards/tauri-command-policy.test.ts`:

```ts
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve(__dirname, "../../");

function walkSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
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

  it("exposes typed invokeCommand and names the raw escape hatch explicitly", () => {
    const source = fs.readFileSync(path.join(sourceRoot, "lib/tauri.ts"), "utf8");

    expect(source).toContain("export const invokeCommand");
    expect(source).toContain("export const invokeUnsafe");
    expect(source).not.toContain("export { invoke }");
  });
});
```

- [x] **Step 2: Add deterministic eval-harness assertion**

Create `tests/evals/assertions/tauri-command-contract.test.js`:

```js
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

  assert.match(tauriSource, /export const invokeCommand = <Name extends TauriCommandName>/);
  assert.match(tauriSource, /export const invokeUnsafe = invoke/);
  assert.doesNotMatch(tauriSource, /export \{ invoke \}/);

  for (const command of [
    "get_settings",
    "save_settings",
    "update_user_settings",
    "test_api_key",
    "list_models",
    "set_log_level",
  ]) {
    assert.match(typeSource, new RegExp(`${command}: \\\\{ args:`));
    assert.match(tauriSource, new RegExp(`invokeCommand\\\\("${command}"`));
  }

  assert.match(typecheckSource, /@ts-expect-error command names must be declared/);
  assert.match(typecheckSource, /@ts-expect-error argument names must match/);
  assert.match(typecheckSource, /@ts-expect-error command result is AppSettings/);
});
```

- [x] **Step 3: Update TEST_MANIFEST**

In `TEST_MANIFEST.md`, add `src/lib/tauri-command-types.ts` and `src/lib/tauri-command-types.typecheck.ts` to Shared Infrastructure and add a quick-reference command:

```md
- `src/lib/tauri-command-types.ts` — typed Tauri command name/args/result contract
- `src/lib/tauri-command-types.typecheck.ts` — compile-time negative checks for typed Tauri commands
```

Add under Quick Reference:

```bash
cd app && npm run test:guard                   # Static frontend policy guards
cd tests/evals && npm test                     # Deterministic eval harness contracts
```

- [x] **Step 4: Run guard and eval-harness tests**

Run:

```bash
cd app && npm run test:guard
cd tests/evals && npm test
```

Expected: both PASS.

- [x] **Step 5: Commit Task 2**

```bash
git add app/src/__tests__/guards/tauri-command-policy.test.ts tests/evals/assertions/tauri-command-contract.test.js TEST_MANIFEST.md
git commit -m "VU-927: guard typed Tauri command policy"
```

---

### Task 3: Document the Convention and Verify End-to-End

**Files:**

- Modify: `.claude/rules/codegen.md`
- Modify: `docs/superpowers/plans/2026-05-01-vu-927-typed-tauri-commands.md`
- Potentially modify: `app/src/lib/tauri-command-types.ts`, `app/src/lib/tauri.ts` if final validation finds a missed Settings command.

- [x] **Step 1: Document the typed command convention**

Append this section to `.claude/rules/codegen.md`:

```md
## Tauri Command Wrapper Contract

When adding or changing frontend calls to Rust Tauri commands:

1. Add or update the command entry in `app/src/lib/tauri-command-types.ts`.
2. Call Rust through `invokeCommand()` in `app/src/lib/tauri.ts`, not raw `invoke(...)`.
3. Keep raw `invokeUnsafe()` only for explicitly justified migration gaps.
4. Add or update `app/src/lib/tauri-command-types.typecheck.ts` when a new command shape needs compile-time negative coverage.
5. Run `cd app && npx tsc --noEmit` and `cd app && npm run test:guard`.
```

- [x] **Step 2: Run full changed-area validation**

Run:

```bash
cd app && npx tsc --noEmit
cd app && npm run test:unit
cd app && npm run test:guard
cd tests/evals && npm test
```

Expected: all PASS.

- [x] **Step 3: Run repo-map audit**

Run:

```bash
find app/src/stores -maxdepth 1 -type f -name '*.ts' ! -name 'index.ts' | sort
find app/src/pages -maxdepth 1 -type f \( -name '*.ts' -o -name '*.tsx' \) | sort
find app/src-tauri/src/commands -maxdepth 1 -type f -name '*.rs' | sort
find app/src-tauri/src/commands/workflow -maxdepth 1 -type f -name '*.rs' | sort
find app/src-tauri/src/commands/imported_skills -maxdepth 1 -type f -name '*.rs' | sort
find app/src-tauri/src/commands/github_import -maxdepth 1 -type f -name '*.rs' | sort
```

Expected: no `repo-map.json` update needed because this issue adds no stores, pages, command files, or command submodules.

- [x] **Step 4: Run markdown/instruction lint for changed docs**

Run:

```bash
npx markdownlint-cli2 ".claude/rules/codegen.md" "TEST_MANIFEST.md" "docs/superpowers/plans/2026-05-01-vu-927-typed-tauri-commands.md"
bash app/scripts/lint-agent-docs.sh
```

Expected: PASS. Fix line length, heading, or instruction-doc issues if reported.

- [x] **Step 5: Update Linear implementation note**

Post a Linear comment on VU-927:

```md
## Implementation update

Implemented typed Tauri command proof of concept for the Settings command area.

Source traceability:
- Functional spec: not_applicable
- Related design: `docs/design/data-contracts/README.md`
- Implementation plan: `docs/superpowers/plans/2026-05-01-vu-927-typed-tauri-commands.md`

Verification:
- `cd app && npx tsc --noEmit`
- `cd app && npm run test:unit`
- `cd app && npm run test:guard`
- `cd tests/evals && npm test`

Manual tests: none required; scenarios are covered by automation and deterministic eval-harness checks.
```

- [x] **Step 6: Final commit**

```bash
git add .claude/rules/codegen.md docs/superpowers/plans/2026-05-01-vu-927-typed-tauri-commands.md
git commit -m "VU-927: document typed command workflow"
```

---

## Acceptance Criteria Mapping

- Typed command surface rejects invalid names: Task 1 type map, `invokeCommand()`, and `tauri-command-types.typecheck.ts`.
- Argument and return types are typed: Task 1 command map and compile-time negative checks.
- One complete feature area migrated: Task 1 migrates Settings, GitHub auth, startup dependency, and startup reconciliation wrappers used by Settings/setup surfaces.
- CI/freshness enforcement: Task 2 guard test plus deterministic eval-harness assertion; existing PR CI typecheck catches type-level regressions.
- Repo guidance: Task 3 `.claude/rules/codegen.md` update.
- Escape hatches justified: Task 1 names `invokeUnsafe()` explicitly and Task 2 prevents re-exporting raw `invoke`.

## Verification Summary

- `cd app && npx tsc --noEmit`
- `cd app && npm run test:unit`
- `cd app && npm run test:guard`
- `cd tests/evals && npm test`
- `npx markdownlint-cli2 ".claude/rules/codegen.md" "TEST_MANIFEST.md" "docs/superpowers/plans/2026-05-01-vu-927-typed-tauri-commands.md"`
- `bash app/scripts/lint-agent-docs.sh`

No live Promptfoo smoke evals and no manual tests are required for this issue.
