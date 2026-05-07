# Design Docs

| Directory | What it covers |
|---|---|
| [agent-specs/](agent-specs/README.md) | Agent layer architecture: workflow steps, artifact contracts, infrastructure files, storage layout |
| [product-architecture/](product-architecture/README.md) | Product-level architecture entrypoint: UI, Rust backend, OpenHands runtime, persistent state, and doc routing |
| [openhands-runtime-model/](openhands-runtime-model/README.md) | Canonical OpenHands runtime model: frontend-to-backend product commands, backend-to-OpenHands session primitives, persistent versus throwaway sessions, workspace ownership, and surface mapping |
| [skill-purpose-taxonomy/](skill-purpose-taxonomy/README.md) | Skill purpose taxonomy: three live create-skill purposes, harness-owned exclusions, and source-system-semantics boundaries |
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
| [shared-eval-harness/](shared-eval-harness/README.md) | Shared Promptfoo/OpenCode eval harness: framework boundary, runtime state model, package contract, and extraction path |
| [eval-workbench/](eval-workbench/README.md) | Canonical Eval Workbench design: Promptfoo-style scenario model, scenario-scoped suggestion, performance-always-on behavior, optional trigger coverage, and app-local Promptfoo run history |
| [workflow-artifact-storage/](workflow-artifact-storage/README.md) | Workflow artifact storage boundary: SQLite-owned canonical state for clarifications/decisions/gates, runtime-only workspace files, and shipped skill output separation |
| [startup-recon/](startup-recon/README.md) | Startup reconciliation: three-pass state machine, discovery scenarios, ACK dialog |
| [plugin-path-restructure/](plugin-path-restructure/README.md) | Plugin directory restructure: fixed `skills/` subdirectory inside each plugin root, default plugin rename, and legacy path compatibility |
| [per-skill-git-repos/](per-skill-git-repos/README.md) | Per-skill git repositories: topology change from shared root repo to one `.git/` per skill, tag simplification, migration, and impact on reset/restore/publish |
| [workspace-ui-refinement/](workspace-ui-refinement/README.md) | Workspace UI polish: design review and improvement plan for Skills Overview, Refine, and Skill List Panel |
| [skill-scope-review/](skill-scope-review/README.md) | Skill scope review: advisory LLM check during skill creation — detects overly broad skills and suggests gerund-named alternatives |
| [write-eval-test-refine-loop/](write-eval-test-refine-loop/README.md) | Historical pre-clean-break eval/design doc. Keep for reference only; the Eval Workbench and Promptfoo sidecar design is the current source for active eval behavior. |
| [openhands-event-display-projection/](openhands-event-display-projection/README.md) | Product-wide rendering rule for OpenHands `conversation_event` payloads: agent-store projection into `DisplayItem`, lossless mapping, uniform consumption across Refine chat, Workflow output, feedback dialog, status header |
