# VU-1145 OpenHands Native Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Use independent subagents for implementation slices and required quality gates.

**Goal:** Implement VU-1145 by making OpenHands the native one-shot workflow runtime, agent topology, generated workspace layout, and provider configuration model while preserving Skill Builder's Rust/frontend JSONL runtime boundary.

**Architecture:** The Node sidecar remains the process boundary used by Rust and React. Inside that boundary, workflow one-shot requests route to the OpenHands runner and named OpenHands file agents under `.agents/`, while refine streaming returns an explicit unsupported gap until the separate `AskUserQuestion` custom-tool work lands. Claude Code router/sub-agent/plugin compatibility is removed from workflow generation after deterministic parity tests cover the new contracts.

**Tech Stack:** Tauri v2, Rust, React/TypeScript, Node sidecar, Python OpenHands runner, PyInstaller packaging, Vitest, cargo test, Promptfoo/OpenCode eval harness.

---

## Source Traceability

- Linear issue: VU-1145
- Functional spec: `not_applicable` per user-approved User Flow gate waiver for this runtime/platform issue.
- Primary design: `docs/design/openhands-native-migration/README.md`
- Runtime boundary design: `docs/design/agent-runtime-boundary/README.md`
- Detailed task plan: `docs/superpowers/plans/2026-05-02-openhands-native-migration.md`
- Related completed issues: VU-1133, VU-1143

## Manual Test Policy

No manual test is required for this migration.

The required coverage is deterministic tests plus automated OpenHands smoke/eval coverage:

- Unit/integration tests cover runtime config, event processing, workflow routing, `.agents` artifact layout, settings persistence, packaging path resolution, and unsupported refine behavior.
- Prompt/eval coverage covers OpenHands-native agent instructions and inline research behavior.
- Live provider execution, when credentials and runner dependencies are available, runs as an automated eval or smoke command with recorded output. If credentials are unavailable, the command must skip with the exact missing environment variable; it is not a manual test.
- Cross-platform PyInstaller packaging is verified by build scripts and CI/release-stage checks. Local implementation validates the current platform path resolver and staged artifact contract.

If implementation discovers a scenario that cannot be validated through automation, pause and amend this plan with the exact manual test before performing it.

## Implementation Slices

### Slice 1: Runtime Request Contract

Update the sidecar and Rust config contracts for OpenHands-native fields.

Expected changes:

- `app/sidecar/config.ts`
- `app/sidecar/runtime/types.ts`
- `app/sidecar/runtime/openhands-runtime.ts`
- `app/sidecar/openhands/runner.py`
- `app/src-tauri/src/agents/sidecar.rs`
- Sidecar config/runtime tests

Automated coverage:

- `cd app/sidecar && npx vitest run __tests__/config.test.ts __tests__/runtime-types.test.ts __tests__/openhands-runtime.test.ts`
- Rust serialization tests for `modelBaseUrl` and runner path fields.

### Slice 2: Workflow Routing And Output Contracts

Route workflow steps to named OpenHands agents and preserve one-shot structured output contracts.

Expected changes:

- `app/src-tauri/src/commands/workflow/step_config.rs`
- `app/src-tauri/src/commands/workflow/runtime.rs`
- `app/src-tauri/src/commands/workflow/tests.rs`

Automated coverage:

- `cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow`
- Tests asserting steps 0-3 do not include `AskUserQuestion`, `Agent`, or `Skill` tools.
- Tests asserting output schemas are selected by step, not by ambiguous shared agent name alone.

### Slice 3: OpenHands Agent And Skill Sources

Replace Claude Code workflow agent topology with OpenHands file agents and inline research.

Expected changes:

- `agent-sources/plugins/skill-content-researcher/agents/research-agent.md`
- `agent-sources/plugins/skill-content-researcher/agents/answer-evaluator.md`
- `agent-sources/plugins/skill-creator/agents/skill-writer-agent.md`
- `agent-sources/plugins/skill-content-researcher/skills/research/SKILL.md`
- Removed obsolete workflow agent files named in the design.
- Agent structural tests and eval fixtures.

Automated coverage:

- `cd app && npm run test:agents:structural`
- `cd tests/evals && npm test`
- Targeted eval package for OpenHands-native workflow prompts or updated existing workflow prompt evals.

### Slice 4: `.agents` Workspace Deployment

Generate OpenHands workspace artifacts under `.agents/agents/` and `.agents/skills/`.

Expected changes:

- `app/src-tauri/src/skill_paths.rs`
- `app/src-tauri/src/commands/workflow/deploy.rs`
- `app/src-tauri/src/commands/workflow/claude_md.rs`
- `app/plugin-paths.json` only if new path templates are needed.
- Tests for workspace deployment and cleanup.

Automated coverage:

- Rust tests asserting deployed workflow workspaces contain `.agents/agents/research-agent.md`, `.agents/agents/skill-writer-agent.md`, `.agents/skills/research/SKILL.md`, and no generated workflow `.claude-plugin/plugin.json`.
- Existing marketplace/import tests remain green to prove unrelated Claude-plugin marketplace flows were not accidentally removed.

### Slice 5: LiteLLM Provider Settings

Introduce provider/model/key/base URL settings for OpenHands.

Expected changes:

- `app/src-tauri/src/types/settings.rs`
- `app/src-tauri/src/db/migrations.rs`
- `app/src-tauri/src/db/settings.rs`
- `app/src-tauri/src/commands/settings.rs`
- `app/src-tauri/src/commands/workflow/settings.rs`
- `app/src/hooks/use-settings-form.ts`
- `app/src/pages/settings.tsx`
- `app/src/lib/types.ts`

Automated coverage:

- `cargo test --manifest-path app/src-tauri/Cargo.toml db:: settings`
- `cd app && npm run test:unit -- settings.test.tsx use-settings-form.test.ts`
- Tests for Anthropic/OpenAI/Google/Ollama provider string assembly and Ollama no-key behavior.

### Slice 6: Runner Packaging

Bundle and resolve the OpenHands runner.

Expected changes:

- `app/sidecar/openhands/build.sh`
- `app/sidecar/openhands/requirements.txt`
- `app/sidecar/build.js`
- `app/src-tauri/tauri.conf.json`
- `app/src-tauri/src/agents/sidecar.rs`
- `app/src-tauri/src/commands/node.rs`

Automated coverage:

- `cd app && npm run sidecar:build`
- `cargo test --manifest-path app/src-tauri/Cargo.toml agents::sidecar`
- Release-stage verification for staged sidecar resources.

### Slice 7: Remove Workflow Claude Compatibility

Remove Claude Code workflow runtime assumptions after OpenHands tests pass.

Expected changes:

- `app/sidecar/options.ts`
- `app/sidecar/runtime/claude-runtime.ts` if no non-workflow path still imports it.
- `app/sidecar/package.json`
- `app/sidecar/package-lock.json`
- `app/sidecar/run-agent.ts`
- `app/sidecar/persistent-mode.ts`
- `app/src/components/about-dialog.tsx`
- `app/src-tauri/src/lib.rs`
- `repo-map.json`
- `TEST_MAP.md`

Automated coverage:

- `cd app/sidecar && npx vitest run`
- `cd app && npm run test:unit`
- `cargo test --manifest-path app/src-tauri/Cargo.toml`
- Static search gate: no workflow path references Claude Code `Agent`, `Skill`, `allowedTools`, `permissionMode`, `.claude/plugins`, or `pathToClaudeCodeExecutable`.

## Independent Quality Gates

Each implementation slice must run in subagent mode with two gates before the next slice starts:

1. Implementation gate: the scoped implementation subagent runs the slice-specific commands and creates a reviewable commit.
2. Independent review gate: a separate reviewer subagent checks the slice diff against the slice requirements and automation evidence.

Do not let the same subagent implement and approve the same slice.

Run these full-implementation gates before final handoff:

- Code review subagent: review issue, design docs, implementation plan, diff, and verification output.
- Simplification subagent: review changed code for unnecessary compatibility layers, duplication, and unclear boundaries.
- Test coverage subagent: verify every acceptance criterion has deterministic unit/integration/eval coverage or a documented automated-live skip condition.
- Acceptance criteria subagent: compare VU-1145 ACs to final diff and evidence.

Use `superpowers:receiving-code-review` before applying any gate feedback.

## Final Verification Matrix

- `cd app/sidecar && npx vitest run`
- `cd app && npm run test:agents:structural`
- `cd app && npm run test:unit`
- `cargo test --manifest-path app/src-tauri/Cargo.toml`
- `cd tests/evals && npm test`
- `cd app && bash tests/run.sh e2e --tag @workflow --tag @settings --tag @refine`
- Targeted Promptfoo/OpenCode eval for OpenHands-native agent/prompt behavior. Update or replace old Claude-router eval packages with OpenHands-native packages for `research-agent`, `answer-evaluator`, `skill-writer-agent` decisions, and `skill-writer-agent` generation.
- Release-stage verification when runner packaging changes.
- `rg` static checks for removed Claude workflow assumptions.

## Acceptance-Criteria Coverage Map

| VU-1145 criterion | Required automation/eval coverage |
|---|---|
| Workflow one-shot steps run through OpenHands and preserve JSONL envelopes | Sidecar Vitest for `OpenHandsRuntime` and `OpenHandsEventProcessor`, including message/tool/result/error fixtures, terminal `run_result`, `structured_output_missing`, and no API key leakage. |
| Step routing uses named OpenHands agents | Rust workflow tests assert `research-agent`, `answer-evaluator`, and `skill-writer-agent` routing with no router identity or sub-agent directive. |
| Generated artifacts use `.agents/agents` and `.agents/skills` | Rust deployment tempdir tests assert `.agents` files exist and workflow `.claude/plugins`, `.claude-plugin/plugin.json`, and generated `CLAUDE.md` are absent. |
| Three-agent topology only | Agent structural tests assert the OpenHands agent names/frontmatter and absence of deleted Claude workflow agents. |
| Tool constraints and skill activation use OpenHands frontmatter | Agent structural tests assert `tools:` and `skills:` frontmatter; Rust tests keep one-shot user-question tools absent. |
| LiteLLM provider strings and base URL | Rust settings tests and frontend settings tests cover Anthropic, OpenAI, Google, and Ollama no-key/base-URL behavior. |
| Bundled `openhands-runner` path | Rust sidecar/node tests plus sidecar runtime tests verify staged runner path resolution and no `python3 runner.py` production path. |
| Claude SDK/CLI/tool/sub-agent/plugin workflow assumptions removed | Static tests/search gates assert no workflow references to `@anthropic-ai/claude-agent-sdk`, `pathToClaudeCodeExecutable`, `permissionMode`, `allowedTools`, `Agent`, `Skill`, `.claude/plugins`, or `subagent_directive`. |
| Refine/streaming unsupported gap | Sidecar, Rust, frontend, and mocked E2E coverage assert OpenHands refine returns a clear unsupported runtime-gap error. |
