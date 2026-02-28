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
| [release/](release/README.md) | Release pipeline: CI/CD workflows, desktop app build, plugin package assembly, credentials |
| [startup-recon/](startup-recon/README.md) | Startup reconciliation: three-pass state machine, discovery scenarios, ACK dialog |
