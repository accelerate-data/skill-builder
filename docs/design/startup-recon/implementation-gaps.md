# Startup Reconciliation Implementation Gaps

This document compares the target startup model in [README.md](/Users/hbanerjee/src/skill-builder/docs/design/startup-recon/README.md) with the current implementation.

The target model is:

- startup may normalize legacy layout and clean app-owned state
- startup may verify runtime/bootstrap readiness
- startup must not mutate tracked skills or plugins because skill files are missing
- missing skill content must fail at operation time

---

## High-Priority Gaps

### 1. Startup still deletes tracked plugins when folders are missing

Current behavior:

- `reconcile_on_startup` removes non-default DB plugins whose folders are gone from `skills_path`

Current code:

- [app/src-tauri/src/reconciliation/mod.rs](/Users/hbanerjee/src/skill-builder/app/src-tauri/src/reconciliation/mod.rs:351)

Why this is a gap:

- the target model does not allow startup to delete tracked plugins because their disk folder is missing
- a later plugin operation should fail explicitly instead

Required change:

- remove startup DB deletion of plugin rows based on disk absence
- replace it with warning-only diagnostics if needed

### 2. Startup still auto-discovers disk skills into the library

Current behavior:

- `reconcile_on_startup` scans `skills_path`, creates plugin rows, creates skill rows, and inserts or updates `workflow_runs` for discovered skills

Current code:

- [app/src-tauri/src/reconciliation/mod.rs](/Users/hbanerjee/src/skill-builder/app/src-tauri/src/reconciliation/mod.rs:398)

Why this is a gap:

- the target model explicitly removes “discover disk skills into DB during startup”
- startup should not treat arbitrary on-disk skill content as something to import automatically

Required change:

- remove startup discovery/import of skill directories into DB
- move any explicit import/adoption flow behind user-triggered operations

### 3. Startup still deletes marketplace plugins when `SKILL.md` is missing

Current behavior:

- marketplace plugins are deleted from DB and disk if any installed marketplace skill folder lacks `SKILL.md`

Current code:

- [app/src-tauri/src/reconciliation/mod.rs](/Users/hbanerjee/src/skill-builder/app/src-tauri/src/reconciliation/mod.rs:545)

Why this is a gap:

- malformed plugin content should cause marketplace operations or plugin usage to fail
- startup should not destructively remove installed content because a file is missing

Required change:

- replace destructive startup cleanup with non-destructive validation or operation-time failure

### 4. Startup still deletes tracked skills whose library directory is missing

Current behavior:

- phase `1e` removes active DB skills with no resolvable directory in `skills_path`

Current code:

- [app/src-tauri/src/reconciliation/mod.rs](/Users/hbanerjee/src/skill-builder/app/src-tauri/src/reconciliation/mod.rs:659)

Why this is a gap:

- the target model says tracked skills remain tracked even when their files are missing
- missing files should fail when a user opens, refines, runs, or otherwise targets the skill

Required change:

- remove this startup deletion pass
- add operation-time missing-content validation where needed

### 5. Startup still resets workflow state when `SKILL.md` is missing

Current behavior:

- incomplete `skill-builder` workflows are reset from step `3+` back to step `3` when `SKILL.md` is not present

Current code:

- [app/src-tauri/src/reconciliation/skill_builder.rs](/Users/hbanerjee/src/skill-builder/app/src-tauri/src/reconciliation/skill_builder.rs:258)

Why this is a gap:

- the target model rejects content-level workflow reconciliation at startup
- publish output being missing should break the publish-dependent operation, not rewrite workflow progress

Required change:

- remove step reset logic driven by missing `SKILL.md`
- preserve workflow state unless an explicit repair flow is invoked

### 6. Startup still recreates `workflow_runs` based on disk content

Current behavior:

- when a skill exists without a `workflow_runs` row, startup recreates the row using DB artifact presence plus `SKILL.md` detection

Current code:

- [app/src-tauri/src/reconciliation/skill_builder.rs](/Users/hbanerjee/src/skill-builder/app/src-tauri/src/reconciliation/skill_builder.rs:80)

Why this is a gap:

- startup should not synthesize tracked workflow state from skill files
- missing or corrupt workflow state should be handled by explicit repair tooling, migration logic, or the operation that depends on it

Required change:

- narrow startup repair to clearly app-owned schema/migration concerns
- remove content-derived workflow reconstruction from startup

---

## Medium-Priority Gaps

### 7. Startup UI still models discovered skills as a reconciliation action

Current behavior:

- the startup dialog still renders discovered-skill resolution actions such as “Add to Library” and “Remove”

Current code:

- [app/src/components/reconciliation-ack-dialog.tsx](/Users/hbanerjee/src/skill-builder/app/src/components/reconciliation-ack-dialog.tsx:132)

Why this is a gap:

- the target model removes startup-time disk skill discovery and user resolution

Required change:

- simplify the dialog to startup-owned repairs and bootstrap issues only
- remove discovery-resolution UX from startup

### 8. Startup hook still auto-applies discovery-driven reconciliation

Current behavior:

- the startup hook auto-applies preview results when they contain only notifications or only discovered skills

Current code:

- [app/src/hooks/use-app-startup.ts](/Users/hbanerjee/src/skill-builder/app/src/hooks/use-app-startup.ts:128)

Why this is a gap:

- once startup stops reconciling skill content, this auto-apply branch should shrink to app-owned cleanup/bootstrap work only

Required change:

- redefine the returned startup result shape around cleanup/bootstrap warnings instead of discovery actions

---

## Low-Priority Or Follow-On Gaps

### 9. Terminology and result shapes still reflect the old reconciliation model

Current behavior:

- `ReconciliationResult` and related frontend code still carry fields like `discovered_skills`

Why this is a gap:

- the target model needs startup status centered on cleanup, warnings, and bootstrap readiness, not library discovery

Required change:

- rename or replace result fields after behavior changes land

### 10. Operation-time validation coverage needs to replace startup repair

Current behavior:

- startup does some missing-file handling that will need to move closer to actual operations

Why this is a gap:

- removing startup mutation without adding targeted operation checks would just defer failures without improving clarity

Required change:

- audit operations that require `SKILL.md`, references, plugin manifests, or runtime agent assets
- add explicit missing-content errors at those call sites

---

## Parts Of The Current Startup Logic That Still Fit The Target Model

These behaviors appear compatible with the target design and likely remain:

- workspace/layout normalization
- app-local conversation cleanup
- empty legacy DB cleanup
- orphaned session reconciliation
- incomplete benchmark cleanup
- startup audit logging for app-owned repair work

Those areas should be retained while content-level skill reconciliation is removed.
