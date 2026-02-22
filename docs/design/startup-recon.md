# Startup Reconciliation

How the app validates the `skills` master catalog against disk artifacts on every launch.

For storage paths and file ownership, see [agent-specs/storage.md](agent-specs/storage.md).

---

## Skills Master Table

The `skills` table is the single catalog backing the skills library, test tab, and reconciliation.

```sql
CREATE TABLE skills (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL UNIQUE,
  skill_source TEXT NOT NULL CHECK(skill_source IN ('skill-builder', 'marketplace', 'upload')),
  domain       TEXT,
  skill_type   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`workflow_runs` has a FK to the master:

```sql
ALTER TABLE workflow_runs ADD COLUMN skill_id INTEGER REFERENCES skills(id);
```

`imported_skills` is unchanged — it is plugin infrastructure (bundled skills, GitHub/zip imports for `CLAUDE.md`), NOT in the master.

### skill_source values

| Value | Origin | Has `workflow_runs` row? |
|-------|--------|--------------------------|
| `skill-builder` | Created via builder workflow, OR discovered on disk with full context artifacts | Yes — step state, run history |
| `marketplace` | Imported from marketplace | No |
| `upload` | Discovered on disk with SKILL.md only (no context artifacts). Reserved — no upload button exists today. | No |

### Write paths

| Operation | What happens |
|-----------|-------------|
| Create skill via builder | INSERT `skills` (skill-builder) → INSERT `workflow_runs` with `skill_id` FK |
| Import from marketplace | INSERT `imported_skills` (plugin) + INSERT `skills` (marketplace). No `workflow_runs`. |
| Disk discovery — all artifacts (scenario 9a) | User approves → INSERT `skills` (skill-builder) + INSERT `workflow_runs` at step 5 |
| Disk discovery — incomplete (scenario 9b) | Delete folder from disk. Notify user. |

---

## Reconciliation State Machine

### Driver

DB (skills master). Two passes:

1. **DB-driven pass**: Loop over every row in `skills` master, branch on `skill_source`, validate each against disk.
2. **Discovery pass**: Scan `{skills_path}` for dirs containing `SKILL.md` that are not in the master.

### Detectable steps

The reconciler infers step completion from files in `{skills_path}/{name}/`:

| Step | Evidence files |
|------|---------------|
| 0 | `context/clarifications.md` + `context/research-plan.md` |
| 4 | `context/decisions.md` |
| 5 | `SKILL.md` |

`detect_furthest_step` checks steps [0, 4, 5] **in order** and stops at the first incomplete step. Partial output (some but not all files for a step) is cleaned up.

### Scenarios

#### Pass 1: skill-builder — DB ↔ disk reconciliation

| # | Scenario | Tables to check | Artifacts to check | Decision |
|---|----------|-----------------|--------------------|----------|
| 1 | DB and disk agree | `skills` + `workflow_runs` (join on `skill_id`): read `current_step`, `status` | Step evidence in `{skills_path}/{name}/` | Mark confirmed steps completed in `workflow_run_steps`. No notification. |
| 2 | DB step ahead of disk | `skills` + `workflow_runs`: `current_step` = N | `detect_furthest_step` returns M where M < N | Reset `workflow_runs.current_step` to M. Clean files beyond M. Notify: "'{name}' reset from step N to M". |
| 3 | Disk ahead of DB | `skills` + `workflow_runs`: `current_step` = M | Step evidence confirms step N where N > M | Advance `workflow_runs.current_step` to N. Notify: "'{name}' advanced from step M to N". |
| 4 | No output files, DB > step 0 | `skills` + `workflow_runs`: `current_step` > 0 | No step 0/4/5 evidence in `{skills_path}/{name}/` | Reset to step 0. Clean all step files. Notify: "'{name}' reset to step 0 — no artifacts found". |
| 5 | Workspace marker missing | `skills` + `workflow_runs` | `{workspace}/{name}/` dir absent | Recreate `{workspace}/{name}/`. Notify: "'{name}' workspace directory recreated". |
| 6 | Completed but SKILL.md gone | `skills` + `workflow_runs`: `status` = completed | `{skills_path}/{name}/SKILL.md` missing. Check backwards: `context/decisions.md` (step 4), `context/clarifications.md` + `context/research-plan.md` (step 0). | Reset to last step with confirmed artifacts. Handled by `detect_furthest_step` — same path as scenario 2. Notify: "'{name}' reset from step 5 to step M — SKILL.md missing". |
| 7 | Active session | `workflow_sessions`: PID alive? | None | Skip entirely. Notify: "'{name}' skipped — active session". |
| 8 | Fresh skill (step 0, no output) | `skills` + `workflow_runs`: `current_step` = 0 | No output files | No action. No notification. |

#### Pass 1: skill-builder — FK integrity

| # | Scenario | Tables to check | Artifacts to check | Decision |
|---|----------|-----------------|--------------------|----------|
| 10 | Master row, no `workflow_runs` | `skills`: `skill_source` = 'skill-builder'. `workflow_runs` join on `skill_id` returns NULL. | Step artifacts in `{skills_path}/{name}/` | Auto-create `workflow_runs` row with `skill_id` FK. Set `current_step` to detected step, `status` = pending (or completed if step >= 5). Notify: "'{name}' workflow record recreated at step M". |

#### Pass 1: marketplace

| # | Scenario | Tables to check | Artifacts to check | Decision |
|---|----------|-----------------|--------------------|----------|
| 11 | SKILL.md exists | `skills`: `skill_source` = 'marketplace' | `{skills_path}/{name}/SKILL.md` present | No action. No notification. |
| 12 | SKILL.md missing | `skills`: `skill_source` = 'marketplace' | `{skills_path}/{name}/SKILL.md` absent | Delete row from `skills` master. Notify: "'{name}' marketplace skill removed — SKILL.md not found on disk". |

#### Pass 1: upload

Only created via discovery scenario 9. No upload button exists today.

| # | Scenario | Tables to check | Artifacts to check | Decision |
|---|----------|-----------------|--------------------|----------|
| 11u | SKILL.md exists | `skills`: `skill_source` = 'upload' | `{skills_path}/{name}/SKILL.md` present | No action. No notification. |
| 12u | SKILL.md missing | `skills`: `skill_source` = 'upload' | `{skills_path}/{name}/SKILL.md` absent | Delete row from `skills` master. Notify: "'{name}' removed — SKILL.md not found on disk". |

#### Pass 2: discovery

| # | Scenario | Tables to check | Artifacts to check | Decision |
|---|----------|-----------------|--------------------|----------|
| 9a | SKILL.md on disk, no master row, ALL artifacts present | `skills` master: no row for this name | `detect_furthest_step` returns step 5 (all context confirmed: `context/clarifications.md`, `context/research-plan.md`, `context/decisions.md`, `SKILL.md`) | **User choice required.** Present dialog: (a) "Add to library" → add as `skill-builder` (completed), auto-create `workflow_runs` at step 5. (b) "Remove from disk" → delete `{skills_path}/{name}/`. |
| 9b | SKILL.md on disk, no master row, INCOMPLETE artifacts | `skills` master: no row for this name | `detect_furthest_step` returns < 5 or None (partial or missing context) | Delete `{skills_path}/{name}/`. Notify: "'{name}' removed — incomplete artifacts on disk". No user choice. |

---

## Logging and Notification Rules

1. **Every skill gets a debug log** — in pass 1, `log::debug!("[reconcile] '{name}': skill_source={source}, action={what_happened}")` for every skill, even if no action is taken.
2. **Every cleanup produces a user notification** — whenever files are deleted, steps are reset, or master rows are removed, push to `notifications`. No silent cleanups.
3. **Every discovery gets a debug log** — in pass 2, `log::debug!("[reconcile] '{name}': discovered on disk, detected_step={step}")` for every dir found.

---

## ACK Dialog

After both passes complete, if `notifications.len() > 0` OR `discovered_skills.len() > 0`:

- Show `ReconciliationAckDialog` (modal, non-dismissible)
- Lists all notifications grouped by severity (errors first, then resets/info)
- For scenario 9a (user choice): inline action buttons per discovered skill — "Add to library" / "Remove"
- Dashboard does NOT mount until user acknowledges all notifications and resolves all discoveries

Today, notifications are returned to the frontend and shown as 5-second toasts that disappear. After this change, they block the dashboard via a modal ACK dialog.
