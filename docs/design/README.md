# Design Docs

| Directory | What it covers |
|---|---|
| [agent-specs/](agent-specs/README.md) | Agent layer architecture: workflow steps, artifact contracts, infrastructure files, storage layout |
| [backend-design/](backend-design/README.md) | Tauri/Rust backend: DB schema, API surface, key data flows, agent sidecar integration — see [database.md](backend-design/database.md) for full schema |
| [clarifications-rendering/](clarifications-rendering/README.md) | Design exploration for the clarifications Q&A screen (VD-799/817) |
| [skills/](skills/README.md) | Bundled skills: purpose slots, research skill, validate-skill, skill-test skill |
| [skill-tester/](skill-tester/README.md) | Skill tester: two-agent comparison + evaluator design |
| [skill-import/](skill-import/README.md) | Import skill from file: file picker → metadata review dialog → conflict handling |
| [skills-marketplace/](skills-marketplace/README.md) | Skills marketplace design |
| [../user-guide/](../user-guide/) | User-facing docs site (VitePress). Source markdown; deployed to GitHub Pages via `docs.yml`. Route → docs URL map: `app/src/lib/help-urls.ts` |
| [branding/](branding/ad-brand.md) | Brand and visual identity |
| [release/](release/README.md) | Release pipeline: CI/CD workflows, desktop app build, credentials |
| [sdk-agent-options/](sdk-agent-options/README.md) | Claude Agent SDK option wiring: source trace for each option from UI/backend/hardcoded paths |
| [agent-unit-test-suite/](agent-unit-test-suite/README.md) | Agent test stack and Promptfoo scenario operations: maintenance, single-scenario runs, and autonomous agent test policy |
| [startup-recon/](startup-recon/README.md) | Startup reconciliation: three-pass state machine, discovery scenarios, ACK dialog |
| [workflow-state/](workflow-state/README.md) | Workflow step state machine: transitions, file deletion cascade, reset vs navigate-back, disabled-step guards |
| [write-eval-test-refine-loop/](write-eval-test-refine-loop/README.md) | Write → Eval → Test → Refine loop: one-shot skill generation, batch eval with with/without comparison, feedback capture, iterative improvement, description optimization |
