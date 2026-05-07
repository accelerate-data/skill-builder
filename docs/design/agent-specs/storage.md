# Storage Layout

Current storage ownership for Skill Builder is split across three durable
domains:

- the SQLite database
- the runtime workspace under app-local data
- the user-configured skills path

For runtime session semantics, see
[../openhands-runtime-model/README.md](../openhands-runtime-model/README.md).

## Three Storage Domains

| Domain | Current path | Owner | Purpose |
|---|---|---|---|
| Database | `<app_local_data_dir>/db/skill-builder.db` | Rust | Canonical state: settings, skills, workflow artifacts, usage, eval history, conversation IDs |
| Workspace | `<app_local_data_dir>/workspace/` | Rust + OpenHands runtime | Runtime scratch space: deployed `.agents/**`, per-skill workspaces, conversations, logs, temp files |
| Skills path | User-configured, default `~/skill-builder/` | Rust + user filesystem | Durable skill outputs: `SKILL.md`, `references/`, eval scenarios, per-skill git repos |

Notes:

- `init_db` migrates any legacy database at `<app_local_data_dir>/skill-builder.db`
  into `<app_local_data_dir>/db/skill-builder.db`.
- `init_workspace` resolves the runtime workspace at
  `<app_local_data_dir>/workspace/`.
- The skills path is persisted in app settings and normalized through the
  settings command path.

## Canonical Path Templates

The canonical plugin-aware path templates live in
`app/plugin-paths.json`.

Current templates:

```json
{
  "skill_dir": "{root}/{plugin_slug}/skills/{skill_name}",
  "eval_dir": "{root}/{plugin_slug}/evals/{skill_name}",
  "workspace_skill_dir": "{workspace}/{plugin_slug}/skills/{skill_name}"
}
```

Rust helpers in `app/src-tauri/src/skill_paths.rs` are the source of truth for
resolving these paths.

## Database Ownership

The database is the authoritative store for app state.

### Current DB-owned workflow state

| Artifact | Storage |
|---|---|
| Clarifications | Normalized rows in `clarifications`, `clarification_sections`, `clarification_questions`, `clarification_choices`, `clarification_notes` |
| Decisions | Normalized rows in `decisions`, `decision_items` |
| Workflow settings and skill metadata | App settings / skills tables |
| Saved skill conversation IDs | `skill_conversations` |
| Usage and agent run history | usage / agent run tables |

Steps 0, 1, and 2 are DB-authoritative. Filesystem detection only matters for
step 3 output existence.

## Workspace Ownership

The workspace is runtime scratch space, not canonical business state.

### Workspace root

`init_workspace` ensures:

- old `CLAUDE.md` and `.claude/` layout is removed
- bundled OpenHands agents and skills are deployed under `.agents/`
- stale pre-migration files are cleaned up best-effort

### Root-level workspace contents

```text
<app_local_data_dir>/workspace/
  .agents/
    agents/
    skills/
  {plugin_slug}/skills/{skill_name}/
    .agents/
    conversations/
    logs/
```

The root `.agents/` directory is the source for per-skill deployment.

### Per-skill workspace contents

Each skill gets a runtime workspace at:

```text
{workspace}/{plugin_slug}/skills/{skill_name}/
```

Typical contents:

- `.agents/agents/`
- `.agents/skills/`
- `conversations/`
- `logs/`
- runtime scratch files as needed

What is not canonical anymore:

- `user-context.md`
- `clarifications.json`
- `decisions.json`
- `answer-evaluation.json`

Those older files may still appear in fixtures or cleanup paths, but they are
not the intended active storage model.

## Skills Path Ownership

The skills path holds durable skill output, not runtime scratch state.

Canonical skill output directory:

```text
{skills_path}/{plugin_slug}/skills/{skill_name}/
```

Typical contents:

```text
{skill_name}/
  SKILL.md
  references/
  evals/
```

The runtime reads and writes skill content here for refine and generation, but
workflow artifacts for steps 0–2 are not stored here.

## Git Ownership

The repo now uses per-skill git repositories rather than one shared repo at the
skills-path root.

That migration is owned by `commands/workspace.rs` and documented in
[../per-skill-git-repos/README.md](../per-skill-git-repos/README.md).

## Reconciliation Rules

Startup reconciliation normalizes legacy layouts and reconciles DB state with
detectable on-disk state.

Important current rule:

- `detect_furthest_step(...)` only detects step `3` by checking whether
  `SKILL.md` exists in the resolved skill output directory.
- Steps `0`, `1`, and `2` are not inferred from workspace files.

Source files:

- `app/src-tauri/src/reconciliation/mod.rs`
- `app/src-tauri/src/fs_validation.rs`
- `app/src-tauri/src/commands/workspace.rs`

## Key Source Files

| File | Purpose |
|---|---|
| `app/src-tauri/src/db/mod.rs` | Database initialization and legacy DB migration |
| `app/src-tauri/src/db/workflow_artifacts.rs` | Normalized artifact row store |
| `app/src-tauri/src/commands/workspace.rs` | Workspace initialization, cleanup, and skills-path migration hooks |
| `app/src-tauri/src/skill_paths.rs` | Canonical path resolution |
| `app/src-tauri/src/reconciliation/mod.rs` | Layout normalization and startup reconciliation |
| `app/src-tauri/src/fs_validation.rs` | Detectable step-on-disk logic |
