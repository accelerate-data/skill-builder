# VU-1145 Dead Code Cleanup Plan

**Goal:** Remove the remaining Claude, Anthropic, and Claude SDK-era code,
storage contracts, copy, and compatibility shims so this branch is genuinely
OpenHands-only end to end.

**Status (verified 2026-05-04):** Cleanup is not complete. The branch no
longer runs the Claude Agent SDK, but it still carries Claude-era runtime
contracts, workspace files, UI copy, direct Anthropic API usage, and stale
documentation.

---

## Verified Current State

The following is true in the current branch code and the live app DB under
`~/Library/Application Support/com.vibedata.skill-builder/`:

- The primary workflow runtime is OpenHands, not Claude SDK.
- The app still rebuilds `workspace/CLAUDE.md` and preserves
  `workspace/.claude/**` compatibility logic at startup.
- The skill marketplace and reconciliation layers still treat
  `.claude-plugin/` as the canonical plugin manifest location.
- Settings and UI defaults still assume Anthropic or Claude in several places.
- The sidecar config and agent-event contracts still expose Claude-era naming
  such as `runtimeProvider: "claude" | "openhands"` and `sdk_ready`.
- `app/src-tauri/src/commands/skill/suggestions.rs` still makes a direct
  `https://api.anthropic.com/v1/messages` call in production code.
- The live SQLite schema has no Claude-specific tables to drop. The cleanup
  work is in generic tables and JSON payloads, not schema removal.

---

## DB Table Review

### No schema deletions required

The current DB tables are generic application tables:

- `settings`
- `plugins`
- `imported_skills`
- `skills`
- `workflow_*`
- `agent_runs`
- `chat_*`
- `documents`
- `clarifications` / `decisions`
- `eval_*`
- `reconciliation_events`

There is no dedicated `claude_*`, `anthropic_*`, or `sdk_*` table to remove.

### DB cleanup that is still required

- `settings.value` for `key = 'app_settings'` is the main migration target.
  The schema is only `key TEXT PRIMARY KEY, value TEXT NOT NULL`, so all model,
  registry, and workspace compatibility cleanup is inside JSON payloads.
- The live `app_settings` row no longer uses an Anthropic model for workflow
  execution, but it still contains marketplace registry entries such as
  `anthropics/knowledge-work-plugins` and `anthropics/claude-plugins-official`.
- `plugins` and `imported_skills` do not currently contain Anthropic rows in
  the sampled live DB, but both tables can persist marketplace source URLs and
  metadata if the plugin contract is renamed.
- `imported_skills.model` is generic metadata. No schema change is required,
  but decide whether Claude model hints should be preserved, nulled, or mapped
  when imported skills are re-saved under the new contract.

### DB conclusion

- No table drops.
- No column drops.
- One settings/data migration is still needed.
- Possible plugin/import metadata rewrites are needed if the on-disk marketplace
  contract stops using `.claude-plugin`.

---

## Remaining Cleanup Work

### 1. Remove Claude workspace compatibility from runtime startup

**Why this is still real work**

The app still treats Claude-era workspace files as first-class:

- `app/src-tauri/src/commands/workspace.rs`
- `app/src-tauri/src/commands/workflow/claude_md.rs`
- `app/src-tauri/src/commands/workflow/deploy.rs`
- `app/src-tauri/src/logging.rs`

**What needs to change**

- Delete `commands/workflow/claude_md.rs`.
- Remove all startup rebuild logic for `workspace/CLAUDE.md`.
- Stop preserving `## Customization` from `CLAUDE.md`; move any still-needed
  user-editable workspace instructions to an OpenHands-neutral file or drop the
  feature entirely.
- Stop creating, preserving, or special-casing `workspace/.claude/**`.
- Expand `migrate_workspace_layout()` so it removes the remaining dead
  Claude-era workspace artifacts, not just the nested-file subset.
- Keep workspace prompt deployment under `.agents/**` only.
- Remove `.claude`-specific exclusions and comments from logging and startup
  cleanup code.

**Code review note**

This is the most important storage-contract cleanup. Until it is done, the app
still advertises a Claude workspace model even though the runtime engine is
OpenHands.

### 2. Remove the real Anthropic-backed suggestions path

**Why this is still real work**

`app/src-tauri/src/commands/skill/suggestions.rs` is not dead text. It still:

- strips `anthropic/` from the selected model;
- frames prompts as "loaded into Claude Code";
- calls the Anthropic Messages API directly.

**What needs to change**

- Replace the direct Anthropic HTTP call with the same canonical model execution
  path used elsewhere by OpenHands-backed model settings, or intentionally
  re-scope suggestions to another generic LLM client.
- Remove the assumption that the selected provider is Anthropic-compatible.
- Rename `claude_mistakes` and any similar fields if they are still exposed in
  product UX or persisted payloads.
- Update the prompt templates under `agent-sources/prompts/` so they no longer
  talk about Claude or Claude Code.

**Files**

- `app/src-tauri/src/commands/skill/suggestions.rs`
- `agent-sources/prompts/skill-suggestions.txt`
- `agent-sources/prompts/research.txt`
- `agent-sources/prompts/detailed-research.txt`
- `agent-sources/prompts/confirm_decisions.txt`
- related frontend types and form renderers that still expose
  `claude_mistakes`-style labels

### 3. Remove Claude-specific settings defaults and UI naming

**Why this is still real work**

The settings UX is still branded around SDK/Anthropic defaults:

- `app/src/components/settings/sdk-section.tsx`
- `app/src/pages/settings.tsx`
- `app/src/stores/settings-store.ts`
- `app/src/hooks/use-settings-form.ts`
- `app/src/hooks/use-app-startup.ts`
- `app/src/lib/models.ts`
- `app/src-tauri/src/types/settings.rs`
- `app/src-tauri/src/db/settings.rs`

**What needs to change**

- Rename `SdkSection` to a neutral name such as `ModelsSection`.
- Remove `"anthropic"` as the implicit fallback provider in frontend and Rust
  normalization paths.
- Stop using Claude model IDs as default examples/placeholders.
- Remove Anthropic-specific labels like `sk-ant-...` unless that provider is
  still intentionally supported as a generic model backend.
- Decide the post-cleanup default behavior when no provider/model is configured:
  explicit null state, first catalog provider, or app-managed default.
- Add a settings migration that rewrites or clears stale default-only Claude
  values in `settings.value`.

**DB impact**

- No schema change.
- One migration/update path for `settings.app_settings`.

### 4. Remove Claude-era sidecar and event contract names

**Why this is still real work**

The code still exposes SDK-era names in contracts and generated types:

- `app/sidecar/config.ts`
- `app/sidecar/generated/contracts.ts`
- `app/src-tauri/src/contracts/agent_events.rs`
- `app/src/generated/contracts.ts`
- components/tests that refer to `sdk_ready`

**What needs to change**

- Remove `runtimeProvider: "claude" | "openhands"` if the runtime is no longer
  selectable. If the field still has value, collapse it to an OpenHands-only
  contract or remove it entirely.
- Rename `sdk_ready` to a neutral runtime stage such as `runtime_ready` or
  `agent_runtime_ready`.
- Remove SDK-specific comments like "Used for plugin discovery and SDK
  settings" or "Used as SDK cwd".
- Regenerate contracts after the Rust or TS contract changes.

**Validation**

- Regenerate codegen outputs.
- Update frontend event consumers and initialization indicators.
- Replace stale fixture data in unit tests.

### 5. Replace `.claude-plugin` as the canonical plugin-marketplace contract

**Why this matters**

If the goal is to completely remove Claude from the codebase and storage
contract, this cannot remain:

- `app/src-tauri/src/marketplace_manifest.rs`
- `app/src-tauri/src/reconciliation/mod.rs`
- `docs/design/skills-marketplace/README.md`

The current code still uses `.claude-plugin/marketplace.json` and
`.claude-plugin/plugin.json` as the canonical plugin manifest layout.

**What needs to change**

- Choose a neutral manifest contract for registry root and plugin metadata.
- Migrate read/write helpers in `marketplace_manifest.rs`.
- Update reconciliation so plugin detection no longer keys off
  `.claude-plugin`.
- Add an on-disk migration from old manifest locations to the new contract.
- Update import/export flows, docs, and tests to the renamed layout.

**DB impact**

- `settings.marketplace_registries` may need default registry renames or
  replacements.
- `plugins.source_url` and `imported_skills.marketplace_source_url` may need
  rewrite logic if legacy registry URLs are being retired.

**Decision note**

This is the one item that is broader than "remove Claude SDK" and reaches the
product's plugin filesystem contract. If this is intentionally out of scope,
the branch can become "OpenHands-only runtime" but not "Claude-free codebase".

### 6. Remove stale product copy and documentation

**Why this is still real work**

There are still many product-facing Claude references in shipping UI and docs:

- `app/src/components/about-dialog.tsx`
- `app/src/components/skill-dialog.tsx`
- `app/src/components/import-skill-dialog.tsx`
- `docs/architecture.md`
- `docs/design/**`
- `repo-map.json`
- `TEST_MAP.md`
- `agent-sources/workspace/**`

**What needs to change**

- Rewrite shipping UI copy: "What Claude needs to know", "Prevent Claude from
  automatically invoking this skill", "Build domain-specific Claude skills",
  and similar strings.
- Remove Anthropic and Claude Agent SDK links from the About dialog.
- Rewrite stale architecture and design docs to describe the actual OpenHands
  runtime.
- Update `repo-map.json` descriptions so they no longer describe Claude Code
  compatibility or Claude adapter templates.
- Update `TEST_MAP.md` and agent-doc guidance if `CLAUDE.md` is no longer part
  of the maintained runtime contract.
- Delete or archive Anthropic reference material only if nothing in the repo
  still intentionally depends on it for product behavior.

### 7. Clean up tests and fixtures after the contract changes

**Why this is necessary**

The branch still has many tests and fixtures using Anthropic/Claude literals.
Some are harmless fixture values, but many encode the old contract and will
fail once the cleanup lands.

**What needs to change**

- Replace `claude-sonnet-*` fixture values where they are asserting default app
  behavior rather than provider-agnostic parsing.
- Update tests that assert `SdkSection`, `sdk_ready`, or Anthropic-specific
  placeholder behavior.
- Revisit DB tests that use `anthropic`/`claude-sonnet` as canonical examples.
- Keep provider-agnostic tests where they are genuinely validating generic
  model IDs, not Claude-specific product behavior.
- Delete `app/src/lib/gate-feedback.ts` together with
  `app/src/__tests__/lib/gate-feedback.test.ts` if they remain test-only dead
  code with no production imports.
- Delete `app/src/__tests__/lib/canonical-format.test.ts` if the old canonical
  markdown/JSON artifact contract is no longer a live runtime contract. If any
  assertions still matter, move them to tests that validate the current
  contract instead of keeping the legacy suite.
- Partially trim `app/src/lib/clarifications-review.ts`: keep the live
  `ReviewFeedback` / `ReviewStatus` types and shared label/color maps, but
  remove `parseAnswerFeedback()` and `getReviewFeedbackMap()` if the editor now
  builds review feedback directly from DB-backed columns and those helpers are
  no longer imported.

---

## Proposed Execution Order

1. Remove the real Anthropic suggestions path.
2. Remove Claude workspace startup artifacts (`CLAUDE.md`, `.claude/**`).
3. Normalize settings defaults and migrate `settings.app_settings`.
4. Rename sidecar/event contracts and regenerate types.
5. Decide whether `.claude-plugin` is in scope for this issue.
6. Sweep product copy, docs, repo-map metadata, and tests.

This order minimizes half-migrated states: it removes live Anthropic behavior
first, then removes storage/runtime compatibility layers, then cleans up names
and docs.

---

## Validation Gates After Cleanup

- `cd app && npm run codegen`
- `cd app && npx tsc --noEmit`
- `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings`
- `cd app && npm run test:unit`
- `cd app && npm run test:agents:structural`
- `rg -n "claude|Claude|anthropic|\\.claude|CLAUDE\\.md|sdk_ready|Claude Agent SDK" app/src app/src-tauri/src app/sidecar agent-sources docs repo-map.json TEST_MAP.md`

Expected end state:

- no production code path calls Anthropic directly;
- no runtime startup path creates or preserves `.claude/**` or `CLAUDE.md`;
- no runtime contract exposes `runtimeProvider = claude` or `sdk_ready`;
- no product copy claims the app builds Claude skills unless that branding is
  still intentional outside this issue;
- DB schema remains unchanged, with only settings/data migrations applied.
