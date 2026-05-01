# Release, Help Docs, and Cheap CI Design

## Context

Skill Builder already runs repository-aware validation in the `raising-linear-pr`
workflow before a branch is pushed for review. GitHub CI should therefore stay
fast and cheap on ordinary PRs, while release and docs workflows should provide
targeted confidence for artifacts that cannot be fully validated locally.

The current release workflow also has a packaging mismatch: Tauri declares
runtime resources under `agent-sources/**`, `workspace`, and `sidecar/dist`,
while the Windows release staging step still copies old `agents` and
`references` directories. That can produce a release archive that builds
successfully but lacks the files needed by the app at runtime.

## Goals

- Fix release packaging so Windows and macOS artifacts include the same runtime
  resources the app expects.
- Add deterministic release artifact checks that fail before upload when a
  staged archive is missing required files.
- Regenerate or refresh user help files where they are stale, then make docs CI
  deterministic.
- Keep PR CI cheap by making GitHub enforce structural, freshness, and targeted
  checks instead of duplicating the heavier local PR-raising validation.
- Preserve manual or release-only confidence checks for expensive platform work.

## Non-Goals

- Replace the release toolchain or move away from Tauri packaging.
- Add live LLM evals to GitHub CI.
- Make GitHub CI the source of truth for all validation. The `raising-linear-pr`
  flow remains responsible for changed-area validation before PR creation.
- Redesign the docs site information architecture beyond the fixes needed for
  correct help output and deterministic deployment.

## Release Pipeline Design

The release workflow should treat `app/src-tauri/tauri.conf.json` as the source
of truth for bundled resources. The implementation should replace stale
Windows-only staging paths with paths matching the Tauri resource contract:

- `app/sidecar/dist/` staged as `sidecar/dist`
- `agent-sources/plugins/` staged as `agent-sources/plugins`
- `agent-sources/skills/` staged as `agent-sources/skills`
- `agent-sources/workspace/` staged as `workspace`

The packaging steps should share a small verification script or shell block that
asserts the staged artifact contains the required executable, sidecar entry
files, SDK manifest, plugin sources, skill sources, and workspace content. This
check should run before `upload-artifact`.

Release notes generation can continue to attempt Anthropic-generated notes when
`ANTHROPIC_API_KEY` is available, but that path must remain non-blocking. Any
API, `curl`, or response parsing failure should fall back to commit-list release
notes.

## Help Docs Design

The generated help surface is `docs/user-guide/**`, with the docs site built by
VitePress from `docs/.vitepress`. The repair should do two things:

- Refresh stale user-guide pages so the published help reflects the current app.
- Add a cheap freshness check that verifies route/help URL references and
  VitePress sidebar links resolve to existing guide files.

The docs deployment workflow should become deterministic by using `npm ci` and
triggering when `docs/package-lock.json` changes. It should remain scoped to
published docs inputs: guide pages, VitePress config, and docs package files.

## PR CI Design

GitHub PR CI should move toward fast policy and freshness checks:

- Keep docs-build checks only for docs-related changes.
- Keep agent structural checks path-scoped to `agent-sources/**`, `app/sidecar/**`,
  and agent response fixtures.
- Keep eval harness self-tests path-scoped to `tests/evals/**`.
- Expand repo-map audit path coverage for structural areas introduced in this
  branch, including `.github/**`, `scripts/**`, and `tests/evals/**` where
  relevant.
- Keep test-map audit focused on Rust command and E2E surface changes.

The expensive multi-platform `cargo test`, `clippy`, full frontend unit tests,
and integration tests should not be mandatory for every PR when the changed area
does not need them. They should either be path-filtered, run on `main`, run on
manual dispatch, or run in release validation. This keeps GitHub cheap while the
PR-raising flow continues to run the changed-area validation from
`repo-map.json`.

## Testing Strategy

The implementation should be testable without manual release publication:

- Run the release package verification logic against a staged fixture or a dry
  staging directory.
- Run docs build locally with `cd docs && npm ci && npm run build` when docs
  package files or VitePress config change.
- Run any new help-link checker directly and in the policy workflow.
- Validate workflow YAML syntax locally after edits.
- Run the existing eval harness unit tests only when `tests/evals/**` changes.

Manual release execution may still be needed before an actual public release,
but correctness of resource selection and docs freshness should be covered by
automation.

## Open Decisions

- Whether expensive platform jobs should be removed from PRs entirely or kept as
  manual/label-triggered jobs. The recommended first step is manual or
  main/release-only execution so required PR checks stay predictable.
- Whether help regeneration should be a pure checker plus refreshed markdown, or
  a command that rewrites guide files from an app-owned source. The recommended
  first step is refreshed markdown plus link/freshness checks, because there is
  no current canonical generator to preserve.
