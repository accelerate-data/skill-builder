# Design Docs

| Directory | What it covers |
|---|---|
| [agent-specs/](agent-specs/README.md) | Agent layer architecture: workflow steps, artifact contracts, infrastructure files, storage layout |
| [agent-runtime-boundary/](agent-runtime-boundary/README.md) | Agent runtime boundary: one-shot runs, streaming sessions, runtime adapters, and OpenHands migration shape |
| [openhands-agent-server-runtime/](openhands-agent-server-runtime/README.md) | OpenHands Agent Server runtime: Rust-managed local server process, REST/WebSocket calls, workspace ownership, event normalization, and clean-break deletion plan |
| [openhands-sdk-runner/](openhands-sdk-runner/README.md) | OpenHands SDK runner invocation contract: one `skill-creator` agent, prompt loading, AgentSkills, tools, conversations, and progress events |
| [workflow-research-clean-break/](workflow-research-clean-break/README.md) | Workflow research clean break: one inline research flow, internal scope and candidate scoring, and final clarifications-only output |
| [workflow-detailed-research-clean-break/](workflow-detailed-research-clean-break/README.md) | Workflow detailed research clean break: app-owned step 1 prompt, `skill-creator` routing, and additive sections/questions/refinements |
| [creating-skills-generator-verifier/](creating-skills-generator-verifier/README.md) | Creating skills generator-verifier: runtime `creating-skills` guidance under `agent-sources/workspace/skills`, app-owned workflow context loading, and fresh-context validation |
| [backend-design/](backend-design/README.md) | Tauri/Rust backend: DB schema, API surface, key data flows, agent sidecar integration — see [database.md](backend-design/database.md) for full schema |
| [cheap-ci-design/](cheap-ci-design/README.md) | Release, help docs, and cheap CI design: release resource staging, docs freshness, and scoped PR validation |
| [clarifications-rendering/](clarifications-rendering/README.md) | Design exploration for the clarifications Q&A screen (VD-799/817) |
| [skills/](skills/README.md) | Bundled skills: purpose slots, research skill, skill-test skill |
| [skill-tester/](skill-tester/README.md) | Skill tester: two-agent comparison + evaluator design |
| [skill-import/](skill-import/README.md) | Import skill from file: file picker → metadata review dialog → conflict handling |
| [skills-marketplace/](skills-marketplace/README.md) | Skills marketplace design |
| [model-settings/](model-settings/README.md) | Model settings: clean-break OpenHands LLM settings UI, app settings contract, sidecar request shape, and workspace boundary |
| [../user-guide/](../user-guide/) | User-facing docs site (VitePress). Source markdown; deployed to GitHub Pages via `docs.yml`. Route → docs URL map: `app/src/lib/help-urls.ts` |
| [branding/](branding/ad-brand.md) | Brand and visual identity |
| [release/](release/README.md) | Release pipeline: CI/CD workflows, desktop app build, credentials |
| [sdk-agent-options/](sdk-agent-options/README.md) | Claude Agent SDK option wiring: source trace for each option from UI/backend/hardcoded paths |
| [agent-unit-test-suite/](agent-unit-test-suite/README.md) | Agent test stack and Promptfoo scenario operations: maintenance, single-scenario runs, and autonomous agent test policy |
| [shared-eval-harness/](shared-eval-harness/README.md) | Shared Promptfoo/OpenCode eval harness: framework boundary, runtime state model, package contract, and extraction path |
| [eval-workbench-promptfoo-sidecar/](eval-workbench-promptfoo-sidecar/README.md) | App-owned Eval Workbench and Promptfoo sidecar: the current user-facing eval path for prompt sets, run history, description candidate ranking, and Refine handoff |
| [workflow-artifact-storage/](workflow-artifact-storage/README.md) | Workflow artifact storage boundary: SQLite-owned canonical state for clarifications/decisions/gates, runtime-only workspace files, and shipped skill output separation |
| [startup-recon/](startup-recon/README.md) | Startup reconciliation: three-pass state machine, discovery scenarios, ACK dialog |
| [workflow-state/](workflow-state/README.md) | Workflow step state machine: transitions, file deletion cascade, reset vs navigate-back, disabled-step guards |
| [workspace-ui-refinement/](workspace-ui-refinement/README.md) | Workspace UI polish: design review and improvement plan for Skills Overview, Refine, and Skill List Panel |
| [skill-scope-review/](skill-scope-review/README.md) | Skill scope review: advisory LLM check during skill creation — detects overly broad skills and suggests gerund-named alternatives |
| [write-eval-test-refine-loop/](write-eval-test-refine-loop/README.md) | Historical pre-clean-break eval/design doc. Keep for reference only; the Eval Workbench and Promptfoo sidecar design is the current source for active eval behavior. |
| [refine-openhands-migration/](refine-openhands-migration/README.md) | Refine tab migration from Claude Code sidecar streaming to OpenHands multi-turn conversation: lifecycle, cancel vs close, new Rust infrastructure |
| [openhands-event-display-projection/](openhands-event-display-projection/README.md) | Product-wide rendering rule for OpenHands `conversation_event` payloads: agent-store projection into `DisplayItem`, lossless mapping, uniform consumption across Refine chat, Workflow output, feedback dialog, status header |
| [openhands-workspace-management/](openhands-workspace-management/README.md) | OpenHands Agent Server workspace management: `OH_CONVERSATIONS_PATH` env var for the conversation persistence root, two-tier SHA-gated `.agents/` deployment cache, agent working directory policy |
