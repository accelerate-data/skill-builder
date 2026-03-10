# Storage Layout

How the app manages files across two directory trees: the workspace (transient scratch space) and the skills path (permanent, git-tracked output).

For artifact file formats, see [canonical-format.md](canonical-format.md).

---

## Three Storage Locations

| Location | Path | Purpose | Lifecycle |
|---|---|---|---|
| **Database** | Tauri app data dir (`app_data_dir()`) + `skill-builder.db` — macOS: `~/Library/Application Support/com.vibedata.skill-builder/skill-builder.db`, Linux: `~/.local/share/com.vibedata.skill-builder/skill-builder.db` | All workflow state, settings, agent runs — single source of truth after reconciliation | Persists permanently; never in the workspace |
| **Workspace** | `app_local_data_dir()/workspace/` | Transient working directory: agent infrastructure, per-skill scratch dirs, logs | Recreated on startup if missing |
| **Skills path** | User-configured, default `~/skill-builder/` | Permanent skill output: context files, SKILL.md, references | Persists across app restarts; git-tracked |

The workspace path is resolved from Tauri `app_local_data_dir()` with `workspace/` appended (see `app/src-tauri/src/lib.rs` and `app/src-tauri/src/commands/workspace.rs`). Legacy `~/.vibedata` handling exists only as best-effort cleanup for older builds.

The skills path defaults to `~/skill-builder/` but is set by the user on first launch. It can be changed in Settings; the app moves the directory and preserves git history.

---

## Directory Layout

### Workspace (`app_local_data_dir()/workspace/`)

```text
<app_local_data_dir>/
└── workspace/
    ├── .claude/
    │   ├── CLAUDE.md                 # Rebuilt on startup: base + active skills + user customization
    │   ├── agents/                   # Bundled agent prompts, copied from agents/ on startup
    │   │   ├── research-orchestrator.md
    │   │   ├── detailed-research.md
    │   │   ├── confirm-decisions.md
    │   │   ├── generate-skill.md
    │   │   └── ...
    │   └── skills/                   # Bundled and imported skills (seeded on startup)
    │       ├── research/
    │       ├── validate-skill/
    │       └── ...
    └── {skill-name}/                 # One directory per skill (marker + scratch)
        ├── user-context.md           # Written by Rust before each step (see below)
        └── logs/
            └── {step}-{timestamp}.jsonl   # One JSONL transcript per agent run
```

The per-skill directory (`{skill-name}/`) is a **marker directory**: its existence tells the reconciler the skill has a workspace record. The only files in it are `user-context.md` (optional) and `logs/`.

### Skills Path (`~/skill-builder/` or user-configured)

```text
~/skill-builder/
├── .git/                         # Git repo, initialized on first configuration
└── {skill-name}/
    ├── SKILL.md                  # Final skill output — written by generate-skill agent (step 3)
    ├── context/                  # Created empty by Rust on skill creation
    │   ├── clarifications.json   # Written by research-orchestrator (step 0); updated by detailed-research (step 1)
    │   ├── answer-evaluation.json # Written by answer-evaluator (gate check at steps 0 and 1)
    │   └── decisions.json        # Written by confirm-decisions (step 2)
    └── references/               # Created empty by Rust on skill creation
        └── *.md                  # Written by generate-skill agent (step 3)
```

---

## File Ownership

| File | Written by | When | Path |
|---|---|---|---|
| `skill-builder.db` | Rust | Continuous | Tauri app data dir |
| `.claude/CLAUDE.md` | Rust | Startup + skill import/remove | `{workspace}/.claude/` |
| `.claude/agents/*.md` | Rust | Startup (copied from bundle) | `{workspace}/.claude/agents/` |
| `.claude/skills/` | Rust | Startup (seeded from bundle) | `{workspace}/.claude/skills/` |
| `{skill}/` (marker dir) | Rust | `create_skill` | `{workspace}/` |
| `{skill}/user-context.md` | Rust **or plugin coordinator** | Before each agent step (Rust) / end of Scoping Turn 2 (plugin) | `{workspace}/{skill}/` |
| `{skill}/logs/*.jsonl` | Rust (sidecar) | Each agent run | `{workspace}/{skill}/logs/` |
| `{skill}/context/` (empty) | Rust | `create_skill` | `{skills_path}/{skill}/` |
| `{skill}/references/` (empty) | Rust | `create_skill` | `{skills_path}/{skill}/` |
| `context/clarifications.json` | `research-orchestrator` | Step 0 | `{skills_path}/{skill}/context/` |
| `context/clarifications.json` | `detailed-research` | Step 1 (adds refinements in-place) | `{skills_path}/{skill}/context/` |
| `context/answer-evaluation.json` | `answer-evaluator` | Gate check at steps 0 and 1 | `{skills_path}/{skill}/context/` |
| `context/decisions.json` | `confirm-decisions` | Step 2 | `{skills_path}/{skill}/context/` |
| `SKILL.md` | `generate-skill` | Step 3 | `{skills_path}/{skill}/` |
| `references/*.md` | `generate-skill` | Step 3 | `{skills_path}/{skill}/references/` |

---

## Agent Working Directory

Agents run with `cwd = {workspace}` (i.e., `app_local_data_dir()/workspace/`). **SDK calling protocol:** the app sends only **skill name** and **workspace directory** in the prompt. Before each run, the app writes `{workspace_dir}/.skill_output_dir` with the absolute path to the skill output directory. Agents read `user-context.md` and `.skill_output_dir` first; they derive **context_dir** as `workspace_dir/context` and **skill output directory** from the path in `.skill_output_dir`.

| Derived / file | Resolved path | Purpose |
|---|---|---|
| `workspace directory` | `{workspace}/{skill-name}/` | Where `user-context.md` and `.skill_output_dir` live |
| `context_dir` | `workspace_dir/context` | Where `clarifications.json`, `decisions.json`, etc. live |
| `skill output directory` | path in `.skill_output_dir` | Where `SKILL.md` and `references/` are written |

Agents are told to read only specific named files and never create directories — the app pre-creates all directories before launching each step.

---

## Startup Sequence

On every launch, `lib.rs` calls `init_workspace()` followed by `reconcile_startup()`.

### 1. Cleanup legacy workspace folder (best effort)

If `~/.vibedata` exists from pre-DataDir builds, the app attempts best-effort cleanup. This is safe to run on startup and ignored when the legacy folder is absent or not removable.

### 2. Resolve workspace path

`app_local_data_dir()` + `workspace` → absolute path. Create directory if missing.

### 3. Deploy agent infrastructure

Copy bundled agent prompts (`agents/*.md`) to `{workspace}/.claude/agents/`. Seed bundled skills to `{workspace}/.claude/skills/`. Both are overwritten unconditionally to stay in sync with the app version. Session-scoped cache prevents redundant copies within a single run.

### 4. Rebuild CLAUDE.md

Merge three sections and write to `{workspace}/.claude/CLAUDE.md`:

1. **Base** — bundled template from `agent-sources/workspace/CLAUDE.md` (always overwritten)
2. **Custom Skills** — generated from `list_active_skills(db)` (regenerated)
3. **Customization** — extracted from the existing file's `## Customization` section (preserved)

### 5. Migrate stale layout (one-time)

Remove root-level `agents/`, `references/`, `vibedata.db`, and `CLAUDE.md` left by pre-reorganization app versions.

### 6. One-time git upgrade

If `skills_path` has content but no `.git`, initialize a git repo and create an initial snapshot. Only runs once per skills path.

### 7. Reconcile DB ↔ disk

See [Reconciliation](#reconciliation) below.

---

## Reconciliation

`reconcile_on_startup()` (`reconciliation.rs`) runs after workspace init. It compares the DB's record of each skill against what's actually on disk and resolves any divergence.

### Why it's needed

- The app may have crashed mid-step, leaving files on disk with no DB record.
- A user may have manually moved or deleted files.
- Multiple app instances (e.g., two windows) can write concurrently.

### Detectable steps

The reconciler can infer step completion from files on disk:

| Step | Detectable? | Evidence files (in `{skills_path}/{skill-name}/`) |
|---|---|---|
| 0 (Research) | Yes | `context/clarifications.json` |
| 1 (Detailed Research) | No | Edits `clarifications.json` in-place; no unique artifact |
| 2 (Confirm Decisions) | Yes | `context/decisions.json` |
| 3 (Generate Skill) | Yes | `SKILL.md` |

A step is only counted if **all** expected files exist. Partial output is cleaned up.

### Five reconcile scenarios

| Scenario | Condition | Resolution |
|---|---|---|
| **Disk-only** | Directory exists on disk, no DB record | Create DB record; detect furthest step from disk |
| **DB ahead of disk** | DB records a step higher than what's on disk | Reset DB step to highest detectable step; clean future-step files |
| **Disk ahead of DB** | Files exist beyond what DB records | Advance DB step to match disk |
| **Missing workspace dir** | DB record exists, workspace marker dir missing | Recreate marker directory |
| **In-sync** | DB and disk agree | Mark all detectable steps as completed in DB |

### Session guard

If a skill has an active workflow session (live PID), the reconciler skips it. Dead PIDs are reclaimed and their sessions are closed before reconciliation proceeds.

### Marketplace skills

Skills with `source = 'marketplace'` are skipped during file reconciliation — they live at a `disk_path` set on import, not in the workspace.

---

## Git Auto-Commits

The skills path is a git repository. The app auto-commits after these operations:

| Operation | Commit message |
|---|---|
| Skill created | `{skill-name}: created` |
| Skill deleted | `{skill-name}: deleted` |
| Skill renamed | `{new-name}: renamed from {old-name}` |
| Startup: untracked skill folders found | `reconcile: add untracked skill folders` |
| Skills path first configured | initial commit snapshot |

Agent-written files (SKILL.md, references/, context/) are committed by the agent's own git calls or by the post-step auto-commit in the app.
