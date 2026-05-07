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
| [plugin-path-restructure/](plugin-path-restructure/README.md) | Plugin directory restructure: fixed `skills/` subdirectory inside each plugin root, default plugin rename, and legacy path compatibility |
| [per-skill-git-repos/](per-skill-git-repos/README.md) | Per-skill git repositories: topology change from shared root repo to one `.git/` per skill, tag simplification, migration, and impact on reset/restore/publish |
| [workspace-ui-refinement/](workspace-ui-refinement/README.md) | Workspace UI polish: design review and improvement plan for Skills Overview, Refine, and Skill List Panel |
| [skill-scope-review/](skill-scope-review/README.md) | Skill scope review: advisory LLM check during skill creation — detects overly broad skills and suggests gerund-named alternatives |
| [write-eval-test-refine-loop/](write-eval-test-refine-loop/README.md) | Historical pre-clean-break eval/design doc. Keep for reference only; the Eval Workbench and Promptfoo sidecar design is the current source for active eval behavior. |
| [openhands-event-display-projection/](openhands-event-display-projection/README.md) | Product-wide rendering rule for OpenHands `conversation_event` payloads: agent-store projection into `DisplayItem`, lossless mapping, uniform consumption across Refine chat, Workflow output, feedback dialog, status header |
