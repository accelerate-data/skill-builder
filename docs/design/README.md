# Design Docs

| Directory | What it covers |
|---|---|
| [openhands-runtime-contract/](openhands-runtime-contract/README.md) | Canonical OpenHands runtime contract: runtime layers, session model, storage roots, normalized event ingress, and workflow artifact authority |
| [openhands-runtime-contract/openhands-conversation-model.md](openhands-runtime-contract/openhands-conversation-model.md) | Clean-slate OpenHands-native conversation/event model: one canonical event stream, frontend send lifecycle, raw payload retention, and projection as a pure view layer |
| [product-architecture/](product-architecture/README.md) | Product-level architecture entrypoint: UI, Rust backend, OpenHands runtime, persistent state, and doc routing |
| [model-catalog/](model-catalog/README.md) | Model catalog target design: `models.dev` ingestion, SQLite cache, provider/model filtering, and OpenHands model-resolution contract |
| [skill-purpose-taxonomy/](skill-purpose-taxonomy/README.md) | Skill purpose taxonomy: three live create-skill purposes, harness-owned exclusions, and source-system-semantics boundaries |
| [creating-skills-generator-verifier/](creating-skills-generator-verifier/README.md) | Creating skills generator-verifier: runtime `creating-skills` guidance under `agent-sources/workspace/skills`, app-owned workflow context loading, and fresh-context validation |
| [backend-design/](backend-design/README.md) | Target Tauri/Rust backend architecture: DB topology, API surface, event contracts, metadata ownership, and current implementation gaps |
| [cheap-ci-design/](cheap-ci-design/README.md) | Release, help docs, and cheap CI design: release resource staging, docs freshness, and scoped PR validation |
| [plugin-path-restructure/](plugin-path-restructure/README.md) | Plugin directory restructure: fixed `skills/` subdirectory inside each plugin root, default plugin rename, and legacy path compatibility |
| [per-skill-git-repos/](per-skill-git-repos/README.md) | Per-skill git repositories: topology change from shared root repo to one `.git/` per skill, tag simplification, migration, and impact on reset/restore/publish |
| [workspace-ui-refinement/](workspace-ui-refinement/README.md) | Workspace UI polish: design review and improvement plan for Skills Overview, Refine, and Skill List Panel |
| [skill-scope-review/](skill-scope-review/README.md) | Skill scope review: advisory LLM check during skill creation — detects overly broad skills and suggests gerund-named alternatives |
| [openhands-event-display-projection/](openhands-event-display-projection/README.md) | OpenHands conversation timeline design: TypeScript-client event contract, transcript-vs-internal event split, activity-trace presentation, and status/toast handling. |
| [write-eval-test-refine-loop/](write-eval-test-refine-loop/README.md) | Historical pre-clean-break eval/design doc. Keep for reference only; the Eval Workbench design is the current source for active eval behavior. |
