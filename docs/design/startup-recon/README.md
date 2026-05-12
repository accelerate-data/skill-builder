# Startup Reconciliation

Defines the target startup behavior for keeping app-owned state sane without treating missing skill files as a startup reconciliation problem.

This document covers startup normalization, startup health checks, and startup UX around repairable app state. It does not cover release artifact contents, bundled `uv`, or first-launch OpenHands package bootstrap details; those belong in [docs/design/release/README.md](/Users/hbanerjee/src/skill-builder/docs/design/release/README.md).

---

## Goal

Startup should make the app boot reliably on a fresh install and after upgrades, but it should not rewrite library truth based on missing skill files.

The target model is:

1. Normalize legacy app-owned layouts into the current canonical layout.
2. Clean app-owned startup debris that is safe to remove automatically.
3. Verify runtime prerequisites needed for the app to function.
4. Leave tracked skills and plugins alone unless the user performs an explicit operation that targets them.

Missing `SKILL.md` files, missing references, or missing skill directories are operation-time failures, not startup reconciliation events.

---

## Source-Of-Truth Model

The target contract separates three concerns:

### 1. App-owned startup state

Examples:

- app-local conversation temp directories
- empty legacy DB files
- legacy workspace/library layouts created by older versions
- incomplete benchmark iterations

Startup owns this state and may repair or remove it automatically.

### 2. Tracked skill and plugin records

Examples:

- `skills` rows
- `plugins` rows
- `workflow_runs`
- saved skill metadata

Startup must not delete, downgrade, or recreate these rows based only on missing on-disk skill artifacts.

### 3. Skill content on disk

Examples:

- `SKILL.md`
- `references/**`
- plugin manifests under the skills library

These files are validated by the operation that needs them. If they are missing, that operation fails with a clear error and points the user at the missing asset.

---

## Canonical Layout

The canonical library layout remains plugin-organized:

```text
{skills_path}/{plugin_slug}/.claude-plugin/plugin.json
{skills_path}/{plugin_slug}/skills/{skill_name}/SKILL.md
```

The canonical workspace layout remains plugin-organized:

```text
{workspace_path}/{plugin_slug}/skills/{skill_name}/...
```

Startup may migrate older layouts into this structure because layout normalization is an app-owned upgrade concern.

Startup may not infer that a tracked skill should be deleted or reset just because a canonical file path is missing after normalization.

---

## What Startup Is Allowed To Do

### Allowed

- migrate flat workspace folders into plugin-organized layout
- normalize legacy library folder layouts into canonical plugin layout
- repair plugin ownership schema and other internal DB migrations
- clean incomplete app-local conversation folders
- remove empty legacy DB files
- clean incomplete benchmark iterations
- verify the presence of runtime prerequisites needed for first use
- surface warnings or health issues discovered during startup

### Not allowed

- delete a tracked skill because its library directory is missing
- delete a plugin because one of its files is missing
- recreate `workflow_runs` because a skill file was found on disk
- reset a workflow step because `SKILL.md` is missing
- auto-discover disk skills into the library at startup
- auto-apply content-level reconciliation to tracked skills

Those are all content or operation concerns, not startup repair concerns.

---

## Operation-Time Failure Model

When a feature needs a skill file, that feature should validate the file at the point of use.

Examples:

- opening or rendering a skill should fail if `SKILL.md` is missing
- refine should fail if the target skill root is incomplete
- marketplace import/update should fail if the installed plugin contents are malformed
- runtime agent construction should fail if required agent skill assets are missing

These failures should be explicit, local, and actionable. Startup should not try to predict every future file access and mutate DB state ahead of time.

---

## Startup Flow

The target startup flow has two layers:

1. `reconcile_startup`
2. a small set of app-startup UI decisions

### `reconcile_startup`

The command should do only the following:

1. Read `workspace_path` and `skills_path` from settings.
2. Normalize legacy workspace and library layouts into canonical layout.
3. Reconcile orphaned app sessions and other clearly app-owned records.
4. Clean safe app-local debris.
5. Run runtime/bootstrap checks needed for the current release model.
6. Return warnings, cleanup counts, and bootstrap status needed by the startup UI.
7. Record preview/apply/cancel audit events only if the startup flow still has explicit user acknowledgement.

It should not perform library-content reconciliation.

### Startup UI

Startup UI may block only for cases that are truly startup-owned, for example:

- bootstrap download required before first use
- permission or path problems that prevent the app from functioning at all
- explicit upgrade repair that changes app-owned state

The startup UI should not ask the user to resolve discovered disk skills or missing `SKILL.md` files as part of app launch.

---

## Runtime Bootstrap Boundary

Runtime bootstrap is adjacent to startup but distinct from skill reconciliation.

Startup may:

- check whether bundled `uv` is present
- check whether OpenHands Agent Server packages are already available
- trigger a first-launch package download if the release model requires it
- report bootstrap failure clearly if the network or install step fails

Startup may not use runtime bootstrap checks as a reason to rewrite skill-library DB state.

---

## Logging and Diagnostics

Startup should log:

- legacy layout migrations
- app-local cleanup actions
- bootstrap readiness checks
- bootstrap downloads or failures
- warnings about missing skill content that may affect later operations

Warnings about skill content should be diagnostic only unless the missing content prevents the app itself from starting.

---

## Relationship To Release Design

This document defines startup behavior.

[docs/design/release/README.md](/Users/hbanerjee/src/skill-builder/docs/design/release/README.md) defines:

- what ships in the bundle
- how bundled `uv` is staged
- how first-launch OpenHands dependencies are obtained
- what startup must verify before the app can use the runtime

If the runtime bootstrap contract changes, update the release design first, then update this document only where startup behavior changes as a result.
