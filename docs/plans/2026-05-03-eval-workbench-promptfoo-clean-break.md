# Eval Workbench Promptfoo Clean Break Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Eval tab and Description Optimization tab with an app-owned Eval Workbench backed by a dedicated Promptfoo sidecar, with performance and trigger modes sharing one prompt-set/results model.

**Architecture:** This is a clean break from the current `evals/evals.json` workflow and the Claude-sidecar description optimizer. Rust owns OpenHands execution, workspace setup, SQLite persistence, cancellation, and Tauri events. A new Promptfoo sidecar owns only Promptfoo Node API evaluation orchestration and calls back into Rust for app-owned performance and trigger provider operations.

**Tech Stack:** Tauri/Rust, React/TypeScript, Promptfoo Node API, SQLite, OpenHands Agent Server, JSONL sidecar protocol, Vitest, cargo test, Playwright E2E.

**Design Spec:** `docs/design/eval-workbench-promptfoo-sidecar/README.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `app/promptfoo-sidecar/package.json` | New app-bundled Node package for Promptfoo runtime dependencies and build scripts |
| `app/promptfoo-sidecar/src/protocol.ts` | JSONL request/response/event contract between Rust and Promptfoo sidecar |
| `app/promptfoo-sidecar/src/runner.ts` | Sidecar entrypoint; reads jobs, builds Promptfoo suites in memory, streams progress/results |
| `app/promptfoo-sidecar/src/providers/performance.ts` | Promptfoo provider that asks Rust to run the real skill through OpenHands |
| `app/promptfoo-sidecar/src/providers/trigger.ts` | Promptfoo provider that asks Rust to run OpenHands against a stub skill and detect invocation |
| `app/promptfoo-sidecar/src/result-normalizer.ts` | Converts Promptfoo results into app `EvalRunResult` payloads |
| `app/src-tauri/src/agents/promptfoo_sidecar/` | Rust process manager, JSONL transport, request correlation, startup/shutdown, error handling |
| `app/src-tauri/src/commands/eval_workbench/` | New Tauri commands and data model for prompt sets, runs, cases, and result history |
| `app/src-tauri/src/commands/eval_workbench/providers.rs` | Rust provider bridge for `skill-performance` and `skill-trigger` sidecar callbacks |
| `app/src-tauri/src/commands/eval_workbench/description.rs` | Candidate-description generation and ranking orchestration |
| `app/src-tauri/src/db/eval_workbench.rs` | SQLite persistence for prompt sets, prompt cases, runs, candidates, and case results |
| `app/src/components/workspace/workspace-evals.tsx` | Replace current eval UI with workbench performance mode |
| `app/src/components/workspace/workspace-description.tsx` | Replace current optimizer UI with trigger mode and candidate comparison |
| `app/src/components/workspace/eval-workbench/` | Shared prompt-set editor, mode selector, result table, history, and send-to-Refine UI |
| `app/src/lib/eval-workbench.ts` | Frontend workbench types and pure ranking/progress helpers |
| `app/src/lib/tauri-command-types.ts` | Remove old eval/description command entries; add workbench command map |
| `app/src/lib/tauri.ts` | Remove old eval/description wrappers; add typed workbench wrappers |
| `app/src-tauri/src/commands/evals.rs` | Delete after new workbench command surface replaces it |
| `app/src-tauri/src/commands/description/` | Delete old iterative optimizer, Claude routing eval, direct Anthropic improve call, and query persistence |
| `agent-sources/prompts/skill-generation.txt` | Stop telling step 3 to create `evals/evals.json` |
| `agent-sources/workspace/skills/creating-skills/SKILL.md` | Stop requiring base eval files during skill generation |
| `repo-map.json` | Update module descriptions and file inventory |
| `TEST_MAP.md` | Replace old `@description` and eval-path mappings with workbench mappings |

---

## Task 1: Remove Generation-Owned Eval Artifacts From Step 3

**Files:**

- Modify: `agent-sources/prompts/skill-generation.txt`
- Modify: `agent-sources/workspace/skills/creating-skills/SKILL.md`
- Modify: `docs/design/creating-skills-generator-verifier/README.md`
- Modify: `app/src-tauri/src/commands/workflow/tests.rs`
- Modify: `app/src-tauri/src/cleanup.rs`
- Modify: `app/src/__tests__/lib/canonical-format.test.ts`

- [ ] **Step 1: Write failing prompt/agent structural expectations**

Add or update tests that prove workflow step 3 no longer asks for `evals/evals.json` or `write-evals`.

Expected assertions:

```ts
expect(renderedPrompt).not.toContain("evals/evals.json");
expect(renderedPrompt).not.toContain("write-evals");
expect(renderedPrompt).toContain("Eval Workbench");
expect(renderedPrompt).toContain("non-persistent eval ideas");
```

For Rust prompt tests in `app/src-tauri/src/commands/workflow/tests.rs`, replace the old positive assertions:

```rust
assert!(!prompt.contains("evals/evals.json"));
assert!(!prompt.contains("write-evals"));
assert!(prompt.contains("Eval Workbench"));
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
cd app && npm run test:agents:structural
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
```

Expected: tests fail because the generation prompt and guidance still require eval artifacts.

- [ ] **Step 3: Remove eval-file requirements from generation prompts**

In `agent-sources/prompts/skill-generation.txt`:

- remove `Eval definitions file: {{workspace_dir}}/evals/evals.json`;
- remove instructions to create `evals/`;
- remove the `evals.json` JSON shape;
- remove `write-evals` from required `call_trace`;
- add:

```text
Do not create eval artifacts during generation. If useful evaluation ideas
come up while writing the skill, include them as non-persistent suggestions in
the final result. The app Eval Workbench owns durable prompt cases, assertions,
runs, and history after generation.
```

In `agent-sources/workspace/skills/creating-skills/SKILL.md`, remove requirements that the skill writes base eval definitions. Replace them with:

```markdown
If evaluation ideas are useful, return them as suggestions for the app Eval
Workbench. Do not create `evals/evals.json`, iteration folders, review HTML, or
Promptfoo config files during skill generation.
```

- [ ] **Step 4: Update cleanup assumptions**

In `app/src-tauri/src/cleanup.rs`, keep cleanup tolerant of old `evals/` folders from existing workspaces, but remove tests that require step 3 to create evals.

Expected behavior:

```rust
// Existing evals directories are still safe to delete when present.
if skill_dir.join("evals").is_dir() {
    files.push("evals/".to_string());
}
```

Do not add any new creation path for `evals/evals.json`.

- [ ] **Step 5: Run verification**

Run:

```bash
cd app && npm run test:agents:structural
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow cleanup
```

Expected: tests pass and no prompt/agent structural checks require generated eval artifacts.

- [ ] **Step 6: Commit**

```bash
git add agent-sources/prompts/skill-generation.txt agent-sources/workspace/skills/creating-skills/SKILL.md docs/design/creating-skills-generator-verifier/README.md app/src-tauri/src/commands/workflow/tests.rs app/src-tauri/src/cleanup.rs app/src/__tests__/lib/canonical-format.test.ts
git commit -m "VU-XXXX: remove generation-owned eval artifacts"
```

---

## Task 2: Add Promptfoo Sidecar Package And Protocol

**Files:**

- Create: `app/promptfoo-sidecar/package.json`
- Create: `app/promptfoo-sidecar/tsconfig.json`
- Create: `app/promptfoo-sidecar/src/protocol.ts`
- Create: `app/promptfoo-sidecar/src/runner.ts`
- Create: `app/promptfoo-sidecar/src/result-normalizer.ts`
- Create: `app/promptfoo-sidecar/src/__tests__/protocol.test.ts`
- Create: `app/promptfoo-sidecar/src/__tests__/result-normalizer.test.ts`
- Modify: `app/package.json`
- Modify: `app/src-tauri/tauri.conf.json`

- [ ] **Step 1: Add sidecar package skeleton**

Create `app/promptfoo-sidecar/package.json`:

```json
{
  "name": "@skill-builder/promptfoo-sidecar",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run src/__tests__"
  },
  "dependencies": {
    "promptfoo": "0.121.9"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "typescript": "~6.0.2",
    "vitest": "^4.1.5"
  }
}
```

Create `app/promptfoo-sidecar/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 2: Define JSONL protocol**

Create `app/promptfoo-sidecar/src/protocol.ts`:

```ts
export type EvalMode = "performance" | "trigger";

export type EvalCase = {
  id: string;
  prompt: string;
  expected?: string;
  shouldTrigger?: boolean;
  assertions: Array<{ type: "equals" | "contains" | "javascript"; value: string }>;
};

export type EvalCandidate = {
  id: string;
  label: string;
  description?: string;
};

export type RunEvalRequest = {
  id: string;
  type: "run_eval";
  mode: EvalMode;
  skillName: string;
  pluginSlug: string;
  candidates: EvalCandidate[];
  cases: EvalCase[];
};

export type ProviderCallRequest = {
  id: string;
  type: "provider_call";
  mode: EvalMode;
  skillName: string;
  pluginSlug: string;
  candidate?: EvalCandidate;
  testCase: EvalCase;
};

export type SidecarRequest = RunEvalRequest;

export type SidecarEvent =
  | { id: string; type: "progress"; completed: number; total: number; caseId?: string; candidateId?: string }
  | { id: string; type: "provider_call"; request: ProviderCallRequest }
  | { id: string; type: "result"; result: EvalRunResult }
  | { id: string; type: "error"; message: string };

export type ProviderCallResponse = {
  id: string;
  type: "provider_result";
  output: unknown;
};

export type EvalCaseResult = {
  caseId: string;
  candidateId: string;
  passed: boolean;
  score: number;
  output: unknown;
  reason?: string;
};

export type EvalRunResult = {
  mode: EvalMode;
  total: number;
  passed: number;
  failed: number;
  results: EvalCaseResult[];
};
```

- [ ] **Step 3: Add minimal runner and tests**

Implement `runner.ts` so it reads newline-delimited JSON from stdin, validates `type === "run_eval"`, and returns an error for unsupported requests. Keep provider/evaluate implementation for Task 5.

Test protocol parsing and result normalization with:

```bash
cd app/promptfoo-sidecar && npm test
```

Expected: sidecar protocol tests pass.

- [ ] **Step 4: Wire app build and Tauri resource**

In `app/package.json`, add scripts:

```json
"promptfoo-sidecar:install": "cd promptfoo-sidecar && npm install",
"promptfoo-sidecar:build": "cd promptfoo-sidecar && npm ci && npm run build"
```

Update `postinstall`:

```json
"postinstall": "cd sidecar && npm install && cd ../promptfoo-sidecar && npm install"
```

Update `app/src-tauri/tauri.conf.json` resources:

```json
"../promptfoo-sidecar/dist/": "promptfoo-sidecar/dist"
```

- [ ] **Step 5: Run verification**

Run:

```bash
cd app/promptfoo-sidecar && npm install && npm run build && npm test
cd app && npm run build
```

Expected: Promptfoo sidecar package builds and app build still passes.

- [ ] **Step 6: Commit**

```bash
git add app/package.json app/package-lock.json app/promptfoo-sidecar app/src-tauri/tauri.conf.json
git commit -m "VU-XXXX: add app Promptfoo sidecar package"
```

---

## Task 3: Add Rust Promptfoo Sidecar Manager

**Files:**

- Create: `app/src-tauri/src/agents/promptfoo_sidecar/mod.rs`
- Create: `app/src-tauri/src/agents/promptfoo_sidecar/process.rs`
- Create: `app/src-tauri/src/agents/promptfoo_sidecar/protocol.rs`
- Create: `app/src-tauri/src/agents/promptfoo_sidecar/tests.rs`
- Modify: `app/src-tauri/src/agents/mod.rs`
- Modify: `app/src-tauri/src/agents/sidecar_path.rs`

- [ ] **Step 1: Write Rust protocol tests**

Add tests in `app/src-tauri/src/agents/promptfoo_sidecar/tests.rs` for:

- serializing `RunEvalRequest`;
- deserializing progress events;
- rejecting unknown event types;
- correlating `provider_call` responses by `id`.

Expected test command:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml agents::promptfoo_sidecar
```

Expected: fails because the module does not exist yet.

- [ ] **Step 2: Implement protocol structs**

Create `protocol.rs` with Rust mirrors of the TypeScript protocol:

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvalMode {
    Performance,
    Trigger,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EvalCase {
    pub id: String,
    pub prompt: String,
    pub expected: Option<String>,
    pub should_trigger: Option<bool>,
    pub assertions: Vec<EvalAssertion>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EvalCandidate {
    pub id: String,
    pub label: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RunEvalRequest {
    pub id: String,
    #[serde(rename = "type")]
    pub message_type: String,
    pub mode: EvalMode,
    pub skill_name: String,
    pub plugin_slug: String,
    pub candidates: Vec<EvalCandidate>,
    pub cases: Vec<EvalCase>,
}
```

Use `serde(rename_all = "camelCase")` where needed to match TypeScript payload names.

- [ ] **Step 3: Implement process manager**

Create `process.rs` with:

- `PromptfooSidecarProcess::start(app: &tauri::AppHandle)`;
- resource path resolution for `promptfoo-sidecar/dist/runner.js`;
- stdin/stdout JSONL reader;
- idle shutdown hook;
- redacted stderr logging.

Do not reuse the Claude sidecar pool. This manager is separate and only serves Promptfoo jobs.

- [ ] **Step 4: Run verification**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml agents::promptfoo_sidecar
```

Expected: protocol and manager tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/agents/promptfoo_sidecar app/src-tauri/src/agents/mod.rs app/src-tauri/src/agents/sidecar_path.rs
git commit -m "VU-XXXX: add Promptfoo sidecar manager"
```

---

## Task 4: Replace Eval Storage With Workbench Storage

**Files:**

- Create: `app/src-tauri/src/db/eval_workbench.rs`
- Modify: `app/src-tauri/src/db/mod.rs`
- Modify: `app/src-tauri/src/db/migrations.rs`
- Create: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Create: `app/src-tauri/src/commands/eval_workbench/types.rs`
- Modify: `app/src-tauri/src/commands/mod.rs`
- Modify: `app/src-tauri/src/lib.rs`

- [ ] **Step 1: Write migration and DB tests first**

Add DB tests for:

- creating a prompt set with `mode = performance`;
- creating a prompt set with `mode = trigger`;
- saving prompt cases with `should_trigger` only for trigger mode;
- recording a run with candidate results;
- listing latest runs by skill and mode.

Expected command:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml db::eval_workbench
```

Expected: fails before migration/helpers exist.

- [ ] **Step 2: Add SQLite tables**

Add a numbered migration in `app/src-tauri/src/db/migrations.rs`:

```sql
CREATE TABLE eval_prompt_sets (
  id TEXT PRIMARY KEY,
  plugin_slug TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('performance', 'trigger')),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE eval_prompt_cases (
  id TEXT PRIMARY KEY,
  prompt_set_id TEXT NOT NULL REFERENCES eval_prompt_sets(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  expected TEXT,
  should_trigger INTEGER,
  assertions_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE eval_runs (
  id TEXT PRIMARY KEY,
  prompt_set_id TEXT NOT NULL REFERENCES eval_prompt_sets(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE eval_run_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  passed INTEGER NOT NULL,
  score REAL NOT NULL,
  output_json TEXT NOT NULL,
  reason TEXT
);

CREATE TABLE description_candidates (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  rationale TEXT,
  rank INTEGER
);
```

- [ ] **Step 3: Add command surface**

Expose Tauri commands:

- `list_eval_prompt_sets`;
- `save_eval_prompt_set`;
- `delete_eval_prompt_set`;
- `run_eval_workbench`;
- `cancel_eval_workbench_run`;
- `list_eval_runs`;
- `read_eval_run`;
- `suggest_description_candidates`;
- `apply_description_candidate`;
- `build_refine_improvement_brief`.

Keep persistence logic in `db/eval_workbench.rs`; commands should validate input and call helpers.

- [ ] **Step 4: Run verification**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml db::eval_workbench commands::eval_workbench
cd app && npm run codegen
```

Expected: DB and command tests pass; generated TypeScript contracts update.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/db app/src-tauri/src/commands/eval_workbench app/src-tauri/src/commands/mod.rs app/src-tauri/src/lib.rs app/src/generated app/sidecar/generated
git commit -m "VU-XXXX: add Eval Workbench persistence and commands"
```

---

## Task 5: Implement Promptfoo Providers Through Rust/OpenHands

**Files:**

- Create: `app/src-tauri/src/commands/eval_workbench/providers.rs`
- Create: `app/src-tauri/src/commands/eval_workbench/trigger.rs`
- Create: `app/src-tauri/src/commands/eval_workbench/performance.rs`
- Modify: `app/promptfoo-sidecar/src/providers/performance.ts`
- Modify: `app/promptfoo-sidecar/src/providers/trigger.ts`
- Modify: `app/promptfoo-sidecar/src/runner.ts`
- Modify: `app/promptfoo-sidecar/src/result-normalizer.ts`

- [ ] **Step 1: Write provider behavior tests**

Rust tests:

- trigger provider creates a stub `SKILL.md` with only `name` and `description`;
- trigger provider does not copy real references;
- trigger result returns `invoked_target_skill`;
- performance provider uses the real skill workspace.

TypeScript tests:

- Promptfoo suite includes baseline plus candidate providers;
- `shouldTrigger` assertions fail/pass correctly;
- result normalizer preserves candidate id and case id.

Commands:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::eval_workbench
cd app/promptfoo-sidecar && npm test
```

Expected: fails before providers exist.

- [ ] **Step 2: Implement trigger provider bridge**

In Rust, create an isolated workspace per candidate/case:

```text
{workspace}/{plugin_slug}/{skill_name}/eval-workbench/trigger/{run_id}/{candidate_id}/{case_id}/.agents/skills/{skill_name}/SKILL.md
```

Write stub content:

```markdown
---
name: <skill_name>
description: <candidate_description>
---

# <skill_name>

Routing eval stub. If invoked, return `triggered`.
```

Run OpenHands with only this stub skill and detect native skill invocation from normalized `conversation_event` payloads. Return:

```json
{
  "invokedTargetSkill": true,
  "invokedSkillName": "target-skill",
  "events": []
}
```

- [ ] **Step 3: Implement performance provider bridge**

Run the real skill against the prompt through the existing Rust/OpenHands path. Return:

```json
{
  "output": "...",
  "structuredOutput": null,
  "events": [],
  "usage": {}
}
```

Do not run through the Claude sidecar. Do not write `evals/evals.json`.

- [ ] **Step 4: Implement sidecar Promptfoo evaluation**

In `runner.ts`, import Promptfoo:

```ts
import promptfoo from "promptfoo";

const evaluate = promptfoo.evaluate;
```

Construct an in-memory suite with one provider per candidate and one test per prompt case. Use JavaScript assertions for trigger mode:

```ts
{
  type: "javascript",
  value: "output.invokedTargetSkill === context.vars.shouldTrigger"
}
```

For performance mode, map app assertions to Promptfoo assertion objects.

- [ ] **Step 5: Run verification**

Run:

```bash
cd app/promptfoo-sidecar && npm run build && npm test
cargo test --manifest-path app/src-tauri/Cargo.toml commands::eval_workbench agents::openhands_server
cd app && OPENHANDS_AGENT_SERVER_LIVE_SMOKE=1 npm run test:openhands:live-smoke
```

Expected: unit tests pass; live smoke runs only when the environment is configured.

- [ ] **Step 6: Commit**

```bash
git add app/promptfoo-sidecar/src app/src-tauri/src/commands/eval_workbench
git commit -m "VU-XXXX: run Eval Workbench cases through Promptfoo and OpenHands"
```

---

## Task 6: Rebuild Frontend Eval Workbench UI

**Files:**

- Create: `app/src/components/workspace/eval-workbench/prompt-set-editor.tsx`
- Create: `app/src/components/workspace/eval-workbench/mode-selector.tsx`
- Create: `app/src/components/workspace/eval-workbench/result-table.tsx`
- Create: `app/src/components/workspace/eval-workbench/run-history.tsx`
- Create: `app/src/components/workspace/eval-workbench/improvement-brief-dialog.tsx`
- Modify: `app/src/components/workspace/workspace-evals.tsx`
- Modify: `app/src/components/workspace/workspace-description.tsx`
- Create: `app/src/lib/eval-workbench.ts`
- Modify: `app/src/lib/tauri.ts`
- Modify: `app/src/lib/tauri-command-types.ts`
- Modify: `app/src/lib/types.ts`

- [ ] **Step 1: Write frontend tests first**

Add tests that verify:

- Eval tab defaults to performance mode;
- Description tab defaults to trigger mode;
- trigger cases show `should trigger` toggle;
- performance cases show assertion editor;
- Description tab shows baseline plus three candidates after a run;
- `Send to Refine` writes an improvement brief into refine state and navigates to Refine.

Run:

```bash
cd app && npm run test:integration -- workspace-evals workspace-description
```

Expected: fails before UI rewrite.

- [ ] **Step 2: Add shared workbench components**

Build reusable components under `app/src/components/workspace/eval-workbench/`.

Required props:

```ts
type EvalWorkbenchMode = "performance" | "trigger";

type PromptSetEditorProps = {
  mode: EvalWorkbenchMode;
  cases: EvalPromptCase[];
  onChange: (cases: EvalPromptCase[]) => void;
};

type ResultTableProps = {
  mode: EvalWorkbenchMode;
  run: EvalRunResult | null;
  recommendedCandidateId?: string;
};
```

Use existing shadcn/ui components and lucide icons. Keep state local unless it must survive navigation.

- [ ] **Step 3: Replace `workspace-evals.tsx` behavior**

Remove current `evals/evals.json` management:

- `listTestCases`;
- `saveTestCase`;
- `deleteTestCase`;
- `createNextIterationDir`;
- `materializeEvalBenchmark`;
- old generation/regeneration agent flow;
- old benchmark card flow.

Replace with performance-mode prompt sets and Promptfoo workbench runs.

- [ ] **Step 4: Replace `workspace-description.tsx` behavior**

Remove old iterative optimizer:

- `startGenerateDescEvalQueries`;
- `runOptimizationLoop`;
- `cancelDescriptionOptimization`;
- progress iteration train/test loop UI;
- `description:progress` listener.

Replace with trigger prompt sets, three candidate cards, baseline comparison, ranking, and explicit apply.

- [ ] **Step 5: Run verification**

Run:

```bash
cd app && npm run test:unit
cd app && npm run test:integration
cd app && npm run test:e2e -- --grep '@description|@evals'
```

Expected: updated unit/integration/E2E coverage passes.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/workspace app/src/lib app/src/__tests__ app/e2e
git commit -m "VU-XXXX: rebuild Eval and Description UI around workbench modes"
```

---

## Task 7: Delete Legacy Eval And Description Optimization Surfaces

**Files:**

- Delete: `app/src-tauri/src/commands/evals.rs`
- Delete: `app/src-tauri/src/commands/description/eval.rs`
- Delete: `app/src-tauri/src/commands/description/improve.rs`
- Delete: `app/src-tauri/src/commands/description/loop_runner.rs`
- Modify/Delete: `app/src-tauri/src/commands/description/mod.rs`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src-tauri/src/commands/mod.rs`
- Modify: `app/src-tauri/src/agents/run_persist.rs`
- Delete: `agent-sources/prompts/skill-description-evals-generator.md`
- Delete or replace: `app/src/lib/description-optimization.ts`
- Delete: `app/src/lib/description-opt-running-state.ts`
- Delete old fixtures under `app/sidecar/mock-templates/outputs/description-optimization-loop/`

- [ ] **Step 1: Remove command registrations**

In `app/src-tauri/src/lib.rs`, remove old commands:

- `commands::evals::list_test_cases`;
- `commands::evals::save_test_case`;
- `commands::evals::delete_test_case`;
- `commands::evals::list_iterations`;
- `commands::evals::create_next_iteration_dir`;
- `commands::evals::materialize_eval_benchmark`;
- `commands::evals::read_iteration_result`;
- `commands::evals::read_grading`;
- `commands::evals::read_skill_context_for_eval_gen`;
- `commands::evals::read_pending_eval`;
- `commands::evals::discard_pending_eval`;
- `commands::evals::build_eval_prompt`;
- `commands::evals::build_eval_gen_prompt`;
- `commands::description::start_generate_desc_evals`;
- `commands::description::run_optimization_loop`;
- `commands::description::save_eval_queries`;
- `commands::description::load_eval_queries`;
- `commands::description::cancel_description_optimization`;
- `commands::description::write_desc_opt_log`.

Keep or move `apply_description` only if `apply_description_candidate` does not already replace it.

- [ ] **Step 2: Delete old modules**

Delete `commands/evals.rs` and old description loop modules. If `update_skill_description` is still used by Refine rollback logic, move that pure helper into a neutral file such as:

```text
app/src-tauri/src/commands/skill/metadata.rs
```

Do not keep a `commands::description` module solely for legacy optimization.

- [ ] **Step 3: Remove old frontend command wrappers and types**

Remove old wrappers from `app/src/lib/tauri.ts` and command map entries from `app/src/lib/tauri-command-types.ts`. Delete frontend helpers that only support the old optimization loop.

Run:

```bash
cd app && npm run test:guard
```

Expected: typed command checks pass with only workbench commands.

- [ ] **Step 4: Remove old persistence hooks**

In `app/src-tauri/src/agents/run_persist.rs`, remove `persist_description_evals` and the step id for `generate-skill-description-evals`.

Expected: no code listens for `description:eval-queries-generated`.

- [ ] **Step 5: Run stale-reference scan**

Run:

```bash
rg -n "description:eval-queries-generated|run_optimization_loop|start_generate_desc_evals|evals/evals\\.json|write-evals|description-optimization-loop|commands::evals|commands::description"
```

Expected: only historical docs or this implementation plan mention old terms. Production code should not.

- [ ] **Step 6: Run verification**

Run:

```bash
cd app && npm run codegen
cd app && npm run test:unit
cd app && npm run test:guard
cargo test --manifest-path app/src-tauri/Cargo.toml
```

Expected: generated contracts and tests pass after deletion.

- [ ] **Step 7: Commit**

```bash
git add -A app/src-tauri app/src app/sidecar agent-sources/prompts
git commit -m "VU-XXXX: delete legacy eval and description optimization paths"
```

---

## Task 8: Update E2E, Docs, Repo Map, And Release Packaging

**Files:**

- Modify: `app/e2e/description/description-optimization.spec.ts`
- Modify: `app/e2e/evals/evals.spec.ts`
- Modify: `app/src/test/mocks/tauri-e2e.ts`
- Modify: `TEST_MAP.md`
- Modify: `repo-map.json`
- Modify: `docs/design/write-eval-test-refine-loop/README.md`
- Modify: `docs/design/backend-design/api.md`
- Modify: `scripts/verify-release-stage.mjs`
- Modify: `scripts/verify-release-stage.test.mjs`
- Modify: `scripts/verify-repo-map.mjs` if new inventory checks are needed

- [ ] **Step 1: Rewrite E2E around workbench modes**

Update `@evals` to cover:

- create performance prompt case;
- run Promptfoo workbench with mocked provider results;
- inspect result table;
- send improvement brief to Refine.

Update `@description` to cover:

- create trigger prompt cases;
- generate three candidate descriptions;
- run trigger comparison;
- apply selected candidate.

- [ ] **Step 2: Update test map**

In `TEST_MAP.md`, replace old description module rows with:

```md
| `app/src-tauri/src/commands/eval_workbench/` | `commands::eval_workbench` | `@evals`, `@description` |
| `app/src-tauri/src/agents/promptfoo_sidecar/` | `agents::promptfoo_sidecar` | `@evals`, `@description` |
```

Keep OpenHands Agent Server rows because providers depend on it.

- [ ] **Step 3: Update repo map**

Update `repo-map.json`:

- add `app/promptfoo-sidecar` to build systems or key directories;
- replace `commands/evals` and `commands/description` descriptions with `commands/eval_workbench`;
- remove `description-optimization.ts` from frontend lib description;
- add shared `eval-workbench` components.

Run:

```bash
cd app && npm run test:repo-map
```

Expected: repo map audit passes.

- [ ] **Step 4: Update release packaging verification**

Update release-stage verification so packaged apps include:

```text
promptfoo-sidecar/dist/
```

and no longer require old description optimization mock artifacts.

Run:

```bash
node --test scripts/verify-release-stage.test.mjs
```

Expected: release-stage tests pass.

- [ ] **Step 5: Run final validation**

Run:

```bash
npx markdownlint-cli2 docs/design/eval-workbench-promptfoo-sidecar/README.md docs/plans/2026-05-03-eval-workbench-promptfoo-clean-break.md TEST_MAP.md
cd app && npm run test:repo-map
cd app && npm run test:agents:structural
cd app && npm run test:unit
cd app && npm run test:guard
cd app && npm run test:integration
cd app && npm run test:e2e -- --grep '@evals|@description'
cargo test --manifest-path app/src-tauri/Cargo.toml
```

Expected: all local deterministic validation passes. If live OpenHands validation is configured, also run:

```bash
cd app && OPENHANDS_AGENT_SERVER_LIVE_SMOKE=1 npm run test:openhands:live-smoke
```

- [ ] **Step 6: Commit**

```bash
git add -A TEST_MAP.md repo-map.json docs app/e2e app/src/test scripts
git commit -m "VU-XXXX: update workbench tests docs and packaging"
```

---

## Self-Review Checklist

- [ ] The current `evals/evals.json` persistence model is removed from new generation and UI flows.
- [ ] The current description optimizer loop is deleted rather than wrapped.
- [ ] Trigger evaluation uses stub skills so only description routing is measured.
- [ ] Candidate generation may use the real skill context, but trigger eval never uses the real body or references.
- [ ] Promptfoo runs in a dedicated app sidecar with no Claude Agent SDK dependency.
- [ ] Rust remains the owner of OpenHands execution and SQLite persistence.
- [ ] Eval improvements flow into Refine instead of directly mutating skill files from the Eval screen.
- [ ] Repo map, test map, release packaging, command contracts, and E2E fixtures are updated in the same change set.
