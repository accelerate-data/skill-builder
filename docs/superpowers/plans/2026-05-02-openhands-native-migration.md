# OpenHands Native Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`. Do not implement this plan as a single-agent linear edit pass. Each task below must be assigned to an isolated implementation subagent with a narrow file scope and its own commit.

**Issue:** VU-1145

**Goal:** Replace Skill Builder's Claude Code-specific runtime, agent topology, and generated workspace layout with the OpenHands-native design in `docs/design/openhands-native-migration/README.md`.

**Architecture:** Keep the app-owned Rust/frontend boundary stable: the Node sidecar still emits the existing JSONL `display_item`, `agent_event`, `refine_question`, and `run_result` envelopes. Inside that boundary, make OpenHands the native one-shot workflow runtime, move workflow routing to named OpenHands file agents, emit artifacts under `.agents/`, and remove Claude SDK/plugin compatibility once parity is validated. Refine streaming remains explicitly unsupported until the separate `AskUserQuestion` custom-tool migration lands.

**Tech Stack:** Tauri v2, Rust, React/TypeScript, Node.js sidecar, Python OpenHands runner, PyInstaller, Vitest, cargo test, agent structural tests.

---

## Source Context

- Linear issue: VU-1145
- Functional spec: `not_applicable` per user-approved User Flow gate waiver for this runtime/platform issue.
- Primary design: `docs/design/openhands-native-migration/README.md`
- Runtime boundary prerequisite: `docs/design/agent-runtime-boundary/README.md`
- Repo implementation plan: `docs/plan/2026-05-02-vu-1145-openhands-native-migration.md`
- Earlier completed groundwork: VU-1133 and VU-1143
- Superseded plan: `docs/superpowers/plans/2026-05-01-openhands-runtime-migration.md`

The older plan kept Claude as a compatibility fallback while adding OpenHands as a selectable provider. This plan follows the newer clean-break design: OpenHands becomes the native workflow runtime, generated artifacts move from `.claude/plugins/` to `.agents/`, and Claude Code router/sub-agent mechanics are removed.

## Execution Mode

Implementation must run in subagent mode.

- Assign each numbered task to a scoped implementation subagent.
- Do not let one subagent own both implementation and quality review for the same task.
- Keep task commits small and reviewable.
- After every task, run the listed deterministic tests before starting the next task.
- If a task changes scope, update this plan before continuing.

## Independent Quality Gates

Each implementation task has two gates:

1. **Implementation gate:** the task subagent runs the task-specific commands listed in that task.
2. **Independent review gate:** a separate quality subagent reviews the diff for that task, checks the task acceptance bullets, and reruns or inspects the relevant tests without sharing implementation context.

The independent quality subagent must verify:

- no Claude Code-only runtime, tool, plugin, or prompt dependency remains in the changed workflow path;
- one-shot workflow requests cannot ask user questions;
- generated workflow artifacts use `.agents/agents/` and `.agents/skills/`;
- app-facing JSONL envelopes remain `display_item`, `agent_event`, `refine_question`, and `run_result`;
- all changed scenarios are covered by deterministic tests or eval/smoke automation.

Do not proceed to PR preparation until every task has an implementation gate and an independent review gate recorded in the implementation notes.

## Manual Test Policy

No manual test is required for this migration. The required coverage is deterministic tests plus automated OpenHands smoke/eval coverage. If implementation discovers a scenario that cannot be validated through automation, pause and amend this plan with the exact manual test before performing it.

## Current State To Preserve

- `app/sidecar/runtime/types.ts` already defines the runtime boundary and rejects `AskUserQuestion` in one-shot runs.
- `app/sidecar/runtime/openhands-runtime.ts`, `app/sidecar/openhands/runner.py`, and `app/sidecar/openhands-event-processor.ts` exist as the VU-1143 spike.
- `app/src-tauri/src/commands/workflow/step_config.rs` still routes workflow steps through Claude Code agent names and Claude tool names.
- `agent-sources/plugins/skill-content-researcher/` and `agent-sources/plugins/skill-creator/` still use `.claude-plugin/plugin.json`, Claude Code agents, and sub-agent fan-out instructions.
- `app/src-tauri/src/skill_paths.rs`, `app/src-tauri/src/marketplace_manifest.rs`, and app startup/deploy code still generate and read Claude plugin layout.
- Settings still use `anthropic_api_key` and bare/preconfigured Claude model strings as the primary runtime configuration.

## File Structure

- Modify `app/sidecar/config.ts`: replace Claude-specific runtime fields with OpenHands-native request fields while keeping old fields only where non-workflow paths still compile during intermediate commits.
- Modify `app/sidecar/runtime/types.ts`: add OpenHands-native fields such as `modelBaseUrl`, keep one-shot contracts, and make unsupported streaming explicit.
- Modify `app/sidecar/runtime/openhands-runtime.ts`: resolve the bundled runner path, pass LiteLLM model/key/base URL, map `maxTurns` to `max_iterations`, and remove dev-only `python3 runner.py` assumptions.
- Modify `app/sidecar/openhands/runner.py`: use OpenHands file agents and AgentSkills from `.agents/`, emit raw JSONL only on stdout, and keep JSON extraction in the Node event processor.
- Modify `app/sidecar/openhands-event-processor.ts`: preserve current display/run-result envelopes and add coverage for usage/error/status events exposed by the runner.
- Modify `app/sidecar/build.js`: build or stage the OpenHands runner and stop copying the Claude SDK binary after the switch.
- Modify `app/src-tauri/src/agents/sidecar.rs`: replace `resolve_sdk_cli_path` with `resolve_openhands_runner_path` and remove `pathToClaudeCodeExecutable` after sidecar callers stop using it.
- Modify `app/src-tauri/src/commands/workflow/step_config.rs`: route steps 0-3 to `research-agent`, `research-agent`, `skill-writer-agent`, and `skill-writer-agent`.
- Modify `app/src-tauri/src/commands/workflow/runtime.rs`: stop injecting Claude router directives, pass OpenHands-native agent names, set `runtime_provider` to `openhands`, and keep `AskUserQuestion` out of one-shot requests.
- Modify `app/src-tauri/src/commands/workflow/settings.rs`, `app/src-tauri/src/types/settings.rs`, `app/src-tauri/src/db/migrations.rs`, `app/src-tauri/src/db/settings.rs`, `app/src/hooks/use-settings-form.ts`, and `app/src/pages/settings.tsx`: introduce provider/model/key/base-URL settings for LiteLLM provider strings.
- Modify `app/src-tauri/src/skill_paths.rs`, `app/src-tauri/src/marketplace_manifest.rs`, and workspace deployment code under `app/src-tauri/src/commands/workflow/`: generate `.agents/agents/` and `.agents/skills/` for workflow outputs.
- Modify `agent-sources/plugins/skill-content-researcher/agents/` and `agent-sources/plugins/skill-creator/agents/`: replace five Claude Code workflow agents with the OpenHands-native three-agent topology.
- Modify `agent-sources/plugins/skill-content-researcher/skills/research/SKILL.md`: remove parallel sub-agent fan-out and replace it with inline dimension research.
- Modify `repo-map.json`, `TEST_MAP.md`, `README.md`, and design docs only where the implemented structure or commands change.

## Task 1: Pin Runtime Contract And Runner Shape

**Files:**

- Modify: `app/sidecar/runtime/types.ts`
- Modify: `app/sidecar/config.ts`
- Modify: `app/sidecar/openhands/runner.py`
- Modify: `app/sidecar/runtime/openhands-runtime.ts`
- Test: `app/sidecar/__tests__/runtime-types.test.ts`
- Test: `app/sidecar/__tests__/config.test.ts`
- Test: `app/sidecar/__tests__/openhands-runtime.test.ts`

- [ ] Update `RuntimeRequestBase` in `app/sidecar/runtime/types.ts` to carry `modelBaseUrl?: string` and document that `model` is a full LiteLLM provider string for OpenHands, for example `anthropic/claude-sonnet-4-6`.
- [ ] Update `SidecarConfig` in `app/sidecar/config.ts` to accept `modelBaseUrl?: string`.
- [ ] Add validation in `parseSidecarConfig`:

```ts
assertOptString(c, "modelBaseUrl");
```

- [ ] Add config tests:

```ts
it("accepts modelBaseUrl for OpenHands-compatible providers", () => {
  expect(parseSidecarConfig({ ...baseConfig, modelBaseUrl: "http://localhost:11434" }).modelBaseUrl).toBe(
    "http://localhost:11434",
  );
});

it("rejects non-string modelBaseUrl", () => {
  expect(() => parseSidecarConfig({ ...baseConfig, modelBaseUrl: 123 })).toThrow(
    "Invalid SidecarConfig: modelBaseUrl must be a string",
  );
});
```

- [ ] Update `app/sidecar/openhands/runner.py` request parsing so it accepts `modelBaseUrl`, `maxTurns`, `agentName`, `workspaceRootDir`, and `workspaceSkillDir`.
- [ ] In `runner.py`, map `maxTurns` to OpenHands `max_iterations`; default to 50 when absent.
- [ ] Keep the stdout protocol limited to these JSONL shapes:

```json
{"type":"openhands_event","event_kind":"message","text":"...","timestamp":123}
{"type":"openhands_event","event_kind":"tool_call","tool_name":"...","summary":"...","timestamp":123}
{"type":"openhands_result","status":"success","result_text":"...","structured_output":null,"timestamp":123}
```

- [ ] In `app/sidecar/runtime/openhands-runtime.ts`, pass `modelBaseUrl` through the serialized request and keep API keys only in the child environment/request, never in stderr.
- [ ] Run: `cd app/sidecar && npx vitest run __tests__/runtime-types.test.ts __tests__/config.test.ts __tests__/openhands-runtime.test.ts`
- [ ] Commit:

```bash
git add app/sidecar/runtime/types.ts app/sidecar/config.ts app/sidecar/openhands/runner.py app/sidecar/runtime/openhands-runtime.ts app/sidecar/__tests__
git commit -m "Prepare OpenHands runtime contract for native runner"
```

## Task 2: Replace Workflow Step Routing With Named OpenHands Agents

**Files:**

- Modify: `app/src-tauri/src/commands/workflow/step_config.rs`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Modify: `app/src-tauri/src/commands/workflow/tests.rs`
- Test: `app/src-tauri/src/commands/workflow/tests.rs`

- [ ] Change `get_step_config` so the step routing table is:

```text
0 -> research-agent -> context/clarifications.json
1 -> research-agent -> context/clarifications.json
2 -> skill-writer-agent -> context/decisions.json
3 -> skill-writer-agent -> skill/SKILL.md
```

- [ ] Replace Claude tool names in `tools_for_agent` with the OpenHands-native tool names used by agent frontmatter:

```rust
match agent_name {
    "research-agent" => &["file_editor", "terminal"],
    "answer-evaluator" => &["file_editor"],
    "skill-writer-agent" => &["file_editor", "terminal"],
    _ => &["file_editor"],
}
```

- [ ] Keep `one_shot_tools_for_agent` and the tests that reject `AskUserQuestion`, but add a test that none of the four workflow steps includes `AskUserQuestion` or Claude-only `Agent`/`Skill` tools.
- [ ] Update `workflow_output_format_for_agent` to map `research-agent` to the clarification schemas for steps 0 and 1, and `skill-writer-agent` to decisions or generate-skill schemas based on `step_id`. If a single function cannot distinguish step 2 from step 3 by agent name alone, introduce `workflow_output_format_for_step(step_id: u32)`.
- [ ] In `runtime.rs`, remove `subagent_directive` construction. Build prompts directly for each step and pass the step's OpenHands agent name through `agent_name`.
- [ ] Set `runtime_provider: Some("openhands".to_string())` for workflow one-shot configs.
- [ ] Keep `permission_mode`, `allowed_tools`, and `required_plugins` only until downstream sidecar config no longer needs them; add a comment marking them compatibility fields scheduled for removal in Task 5.
- [ ] Run: `cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow`
- [ ] Commit:

```bash
git add app/src-tauri/src/commands/workflow/step_config.rs app/src-tauri/src/commands/workflow/runtime.rs app/src-tauri/src/commands/workflow/tests.rs
git commit -m "Route workflow steps to OpenHands agents"
```

## Task 3: Rewrite Agent Sources To OpenHands File Agents And AgentSkills

**Files:**

- Create: `agent-sources/plugins/skill-content-researcher/agents/research-agent.md`
- Create: `agent-sources/plugins/skill-content-researcher/agents/answer-evaluator.md`
- Create: `agent-sources/plugins/skill-creator/agents/skill-writer-agent.md`
- Modify: `agent-sources/plugins/skill-content-researcher/skills/research/SKILL.md`
- Modify: `agent-sources/plugins/skill-creator/skills/skill-creator/SKILL.md`
- Delete: `agent-sources/plugins/skill-content-researcher/agents/skill-builder.md`
- Delete: `agent-sources/plugins/skill-content-researcher/agents/detailed-research.md`
- Delete: `agent-sources/plugins/skill-content-researcher/agents/confirm-decisions.md`
- Delete: `agent-sources/plugins/skill-creator/agents/generate-skill.md`
- Test: `app/agent-tests` structural suite through `npm run test:agents:structural`

- [ ] Create `research-agent.md` with this frontmatter:

```md
---
name: research-agent
description: Produces clarification questions by researching relevant dimensions inline and consolidating them into clarifications.json.
tools:
  - file_editor
  - terminal
skills:
  - research
---
```

- [ ] Create `answer-evaluator.md` with OpenHands tool names and instructions that preserve the existing `answer-evaluation.json` output contract.
- [ ] Create `skill-writer-agent.md` with this frontmatter:

```md
---
name: skill-writer-agent
description: Produces decisions.json for step 2 and writes SKILL.md plus base evals for step 3.
tools:
  - file_editor
  - terminal
skills:
  - skill-creator
---
```

- [ ] Move the useful step-2 confirm-decisions instructions into the body of `skill-writer-agent.md`. The prompt for step 2 must ask for `decisions.json`; the prompt for step 3 must ask for generated skill artifacts.
- [ ] In `research/SKILL.md`, replace the parallel sub-agent section with inline sequential dimension research:

```text
For each selected dimension:
1. Read references/dimensions/{name}.md.
2. Research that dimension inline in this same context.
3. Capture the dimension-specific findings before moving to the next dimension.

After all dimensions are researched, use references/consolidation-handoff.md to consolidate findings into the required clarifications_json payload.
```

- [ ] Remove references to Claude Code `Agent`, `Skill`, `Task`, `TaskOutput`, `allowedTools`, and sub-agent wait/merge mechanics from the workflow agent files and skills.
- [ ] Run: `cd app && npm run test:agents:structural`
- [ ] Commit:

```bash
git add agent-sources/plugins/skill-content-researcher agent-sources/plugins/skill-creator
git commit -m "Convert workflow agents to OpenHands native topology"
```

## Task 4: Generate `.agents` Workspace Layout

**Files:**

- Modify: `app/src-tauri/src/skill_paths.rs`
- Modify: `app/src-tauri/src/marketplace_manifest.rs`
- Modify: `app/src-tauri/src/commands/workflow/deploy.rs`
- Modify: `app/src-tauri/src/commands/workflow/claude_md.rs`
- Modify: `app/src-tauri/src/commands/workflow/tests.rs`
- Modify: `app/plugin-paths.json`
- Test: Rust workflow/deploy tests

- [ ] Add helpers in `skill_paths.rs`:

```rust
pub fn workspace_agents_dir(workspace_skill_dir: &Path) -> PathBuf {
    workspace_skill_dir.join(".agents")
}

pub fn workspace_agent_files_dir(workspace_skill_dir: &Path) -> PathBuf {
    workspace_agents_dir(workspace_skill_dir).join("agents")
}

pub fn workspace_agent_skills_dir(workspace_skill_dir: &Path) -> PathBuf {
    workspace_agents_dir(workspace_skill_dir).join("skills")
}
```

- [ ] Update workflow deployment code to copy workflow agent files to `.agents/agents/` and AgentSkills to `.agents/skills/`.
- [ ] Stop generating `.claude/plugins/<slug>/.claude-plugin/plugin.json` for workflow runtime artifacts.
- [ ] Stop generating `CLAUDE.md` for OpenHands workflow workspaces; keep `AGENTS.md` as the only always-on instruction file.
- [ ] Keep marketplace/import code paths scoped to existing marketplace features if they still need Claude plugin manifests. Do not delete marketplace support for unrelated flows in this task.
- [ ] Add tests asserting a newly deployed workflow workspace contains `.agents/agents/research-agent.md`, `.agents/agents/skill-writer-agent.md`, `.agents/skills/research/SKILL.md`, and no generated workflow `.claude-plugin/plugin.json`.
- [ ] Run: `cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow`
- [ ] Commit:

```bash
git add app/src-tauri/src/skill_paths.rs app/src-tauri/src/marketplace_manifest.rs app/src-tauri/src/commands/workflow app/plugin-paths.json
git commit -m "Deploy workflow artifacts in OpenHands agents layout"
```

## Task 5: Add LiteLLM Provider Settings

**Files:**

- Modify: `app/src-tauri/src/types/settings.rs`
- Modify: `app/src-tauri/src/db/migrations.rs`
- Modify: `app/src-tauri/src/db/settings.rs`
- Modify: `app/src-tauri/src/commands/settings.rs`
- Modify: `app/src-tauri/src/commands/workflow/settings.rs`
- Modify: `app/src/hooks/use-settings-form.ts`
- Modify: `app/src/pages/settings.tsx`
- Modify: `app/src/lib/types.ts`
- Test: `app/src-tauri/src/db/tests.rs`
- Test: `app/src/__tests__/pages/settings.test.tsx`
- Test: `app/src/__tests__/hooks/use-settings-form.test.ts`

- [ ] Add settings fields for OpenHands/LiteLLM:

```rust
pub openhands_provider: Option<String>,
pub openhands_api_key: Option<String>,
pub openhands_model: Option<String>,
pub openhands_base_url: Option<String>,
```

- [ ] Add a migration that preserves existing Anthropic values by setting `openhands_provider = "anthropic"` and `openhands_model` to `anthropic/{preferred_model}` only when the existing model is not already provider-prefixed.
- [ ] In `read_workflow_settings`, read the selected OpenHands key/model/base URL. Keep a clear error if no key is configured for cloud providers.
- [ ] In `runtime.rs`, pass the full LiteLLM provider string in `model`, the provider key in `api_key`, and `modelBaseUrl` when present.
- [ ] Update the Settings page with provider choices for Anthropic, OpenAI, Google, and Ollama. Ollama must not require an API key and must allow a base URL.
- [ ] Add frontend tests for provider selection, provider-prefixed model strings, and Ollama base URL save behavior.
- [ ] Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml db:: settings
cd app && npm run test:unit -- settings.test.tsx use-settings-form.test.ts
```

- [ ] Commit:

```bash
git add app/src-tauri/src/types/settings.rs app/src-tauri/src/db app/src-tauri/src/commands/settings.rs app/src-tauri/src/commands/workflow/settings.rs app/src-tauri/src/commands/workflow/runtime.rs app/src/hooks/use-settings-form.ts app/src/pages/settings.tsx app/src/lib/types.ts app/src/__tests__
git commit -m "Add OpenHands LiteLLM provider settings"
```

## Task 6: Bundle And Resolve `openhands-runner`

**Files:**

- Create: `app/sidecar/openhands/build.sh`
- Create: `app/sidecar/openhands/requirements.txt` if absent or incomplete
- Modify: `app/sidecar/build.js`
- Modify: `app/src-tauri/tauri.conf.json`
- Modify: `app/src-tauri/src/agents/sidecar.rs`
- Modify: `app/src-tauri/src/commands/node.rs`
- Test: `app/src-tauri/src/agents/sidecar.rs`

- [ ] Add `app/sidecar/openhands/build.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 -m pip install -r requirements.txt
python3 -m PyInstaller runner.py --onefile --name openhands-runner
```

- [ ] Update `build.js` to stage the built runner under `app/sidecar/dist/openhands/openhands-runner` or `openhands-runner.exe`.
- [ ] Replace `resolve_sdk_cli_path_public` with `resolve_openhands_runner_path_public`.
- [ ] Implement resource resolution in Rust for:

```text
sidecar/dist/openhands/openhands-runner
sidecar/dist/openhands/openhands-runner.exe
```

- [ ] Update `OpenHandsRuntime` so production uses the resolved runner path instead of spawning `python3 app/sidecar/openhands/runner.py`.
- [ ] Remove the Claude SDK binary copy from `build.js` only after no code path reads `pathToClaudeCodeExecutable`.
- [ ] Run:

```bash
cd app && npm run sidecar:build
cargo test --manifest-path app/src-tauri/Cargo.toml agents::sidecar
```

- [ ] Commit:

```bash
git add app/sidecar/openhands app/sidecar/build.js app/src-tauri/tauri.conf.json app/src-tauri/src/agents/sidecar.rs app/src-tauri/src/commands/node.rs
git commit -m "Bundle OpenHands runner for Tauri"
```

## Task 7: Remove Claude Runtime Compatibility From Workflow

**Files:**

- Modify: `app/sidecar/package.json`
- Modify: `app/sidecar/package-lock.json`
- Modify: `app/sidecar/options.ts`
- Modify: `app/sidecar/runtime/claude-runtime.ts`
- Modify: `app/sidecar/run-agent.ts`
- Modify: `app/sidecar/persistent-mode.ts`
- Modify: `app/src-tauri/src/agents/sidecar.rs`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Modify: `app/src/components/about-dialog.tsx`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `repo-map.json`
- Test: full sidecar suite

- [ ] Remove workflow dependence on `ClaudeRuntime`, `options.ts`, `permissionMode`, `allowedTools`, `requiredPlugins`, and `pathToClaudeCodeExecutable`.
- [ ] Keep non-workflow refine streaming on its current path only if it still compiles and returns the explicit unsupported OpenHands gap for OpenHands workflow mode.
- [ ] If no remaining code imports `@anthropic-ai/claude-agent-sdk`, remove it from sidecar package files.
- [ ] Update About/credits text from Claude Agent SDK to OpenHands and Tauri/React.
- [ ] Update `repo-map.json` entries for sidecar runtime, agent prompts, build resources, and dependencies.
- [ ] Run:

```bash
cd app/sidecar && npx vitest run
cd app && npm run test:agents:structural
cd app && npm run test:unit
cargo test --manifest-path app/src-tauri/Cargo.toml
```

- [ ] Commit:

```bash
git add app/sidecar app/src-tauri app/src repo-map.json
git commit -m "Remove Claude workflow runtime compatibility"
```

## Task 8: Add Automated Migration Smoke And Eval Coverage

**Files:**

- Modify or create: `tests/evals/packages/*`
- Modify or create: `tests/evals/scripts/*`
- Modify: `tests/evals/docs/scenario-inventory.md`
- Modify: `TEST_MAP.md`
- Test: `tests/evals`

- [ ] Add an automated OpenHands workflow smoke that exercises step 0 and step 3 without manual UI interaction.
- [ ] The smoke must assert terminal `run_result`, parseable expected artifact output, no `AskUserQuestion`, and `.agents` artifact discovery.
- [ ] Add deterministic tests or eval checks for provider-prefixed model strings, Ollama/base URL handling, runner JSONL parsing, `structured_output_missing` behavior, and unsupported refine streaming.
- [ ] If live provider credentials are required, make the smoke skip with a precise prerequisite message rather than failing opaquely.
- [ ] Run the automated smoke/eval command and record the exact command in the PR body.
- [ ] Run:

```bash
cd tests/evals && npm test
```

- [ ] Commit:

```bash
git add tests/evals TEST_MAP.md
git commit -m "Add OpenHands migration smoke coverage"
```

## Task 9: Verification, Docs, And Release Decision

**Files:**

- Modify: `docs/design/openhands-native-migration/README.md`
- Modify: `docs/design/agent-runtime-boundary/README.md`
- Modify: `README.md`
- Modify: `TEST_MAP.md`
- Modify: `repo-map.json`
- Test: repo-map audit, test-map audit, release-stage verification

- [ ] Update design docs with the implemented packaging choice and any deviations from the draft design.
- [ ] Update `TEST_MAP.md` if new OpenHands runner, packaging, settings, or artifact-layout files need mapped validation.
- [ ] Run the repo-map audit described in `AGENTS.md` before PR.
- [ ] Run:

```bash
cd app && npm run test:agents:structural
cd app && npm run test:unit
cd app/sidecar && npx vitest run
cargo test --manifest-path app/src-tauri/Cargo.toml
```

- [ ] Run the automated OpenHands workflow smoke/eval for step 0 and step 3. If credentials or local OpenHands dependencies are missing, record the exact skipped prerequisite in the PR body.
- [ ] Do not substitute manual UI testing for this smoke. If the smoke cannot be automated, stop and update this plan before implementation continues.
- [ ] Run release-stage verification if packaging changed:

```bash
node scripts/verify-release-stage.mjs
```

- [ ] Commit:

```bash
git add docs README.md TEST_MAP.md repo-map.json
git commit -m "Document OpenHands native migration"
```

## Acceptance Checklist

- [ ] VU-1145 acceptance criteria are checked against the final diff.
- [ ] `docs/design/openhands-native-migration/README.md` still matches the implemented runtime decisions.
- [ ] `repo-map.json` reflects added, removed, and renamed sidecar/runtime/agent files.
- [ ] `TEST_MAP.md` maps the new validation surface.
- [ ] No workflow one-shot config includes `AskUserQuestion`.
- [ ] No workflow prompt requires Claude Code `Agent` or `Skill` tools.
- [ ] `.agents/agents/` and `.agents/skills/` are the generated workflow runtime layout.
- [ ] The app shows a clear unsupported error for OpenHands refine streaming until the separate `AskUserQuestion` issue is implemented.
- [ ] The PR body calls out whether the live OpenHands smoke was run, skipped, or blocked.
