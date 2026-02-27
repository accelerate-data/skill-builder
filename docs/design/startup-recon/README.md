# Startup Reconciliation

Validates the `skills` master catalog against disk artifacts on every launch, before the dashboard loads. Driver is the DB — disk is the oracle for step state.

---

## Two Paths, Three Passes

**Pass 1 — DB-driven:** Loop over every row in `skills`, branch on `skill_source`:

- `skill-builder` → full step reconciliation (scenarios 1–8, 10)
- `marketplace` → SKILL.md presence check (scenarios 11–12)
- `imported` → skip (no reconciliation)

**Pass 2 — Discovery:** Scan `{skills_path}` for directories not in the master (scenarios 9a–9c). User action required before dashboard loads.

**Pass 3 — Defensive catch-all:** Any folder still not in the master after passes 1 and 2 is moved to `{skills_path}/.trash/` and removed from the git index. `.trash/` is added to `.gitignore`.

Reconciliation operates only on `skills_path`. `{workspace_path}/.claude/skills` is intentionally excluded.

---

## Detectable Steps

The reconciler infers step completion from files in `{skills_path}/{name}/`. Only steps that write unique output files are detectable:

| Step | Evidence |
|------|----------|
| 0 | `context/clarifications.json` + `context/research-plan.md` |
| 2 | `context/decisions.md` |
| 3 | `SKILL.md` |

Step 1 edits `clarifications.json` in-place — no unique artifact, not independently detectable. `detect_furthest_step` checks steps `[0, 2, 3]` in order and stops at the first incomplete step. Partial output at a step is cleaned up defensively.

---

## Pass 1: skill-builder scenarios

Before checking step state, any `in_progress` step with no live session PID is reset to `pending` (crash/unclean shutdown recovery).

| # | Condition | Action |
|---|-----------|--------|
| 7 | Active session with live PID | Skip entirely. Notify. |
| 10 | No `workflow_runs` row | Auto-create at detected step; status `completed` if step ≥ 3. Notify. |
| 1 | DB step == disk step | Mark detectable steps completed. No notification. |
| 2 | DB step > disk step (disk doesn't confirm expected detectable) | Reset to disk step, `pending`. Clean files beyond disk step. Notify. |
| 3 | Disk step > DB step | Advance to disk step. Notify. |
| 4 | No output files, DB step > 0 | Reset to step 0, `pending`. Clean all step files. Notify. |
| 5 | Workspace dir missing | Recreate `{workspace}/{name}/context/`. No notification. |
| 6 | Completed but SKILL.md gone | Handled by `detect_furthest_step` — same path as scenario 2. |
| 8 | Step 0, no output | Clear any spurious step completions. No notification. |

After reconciling step state: if disk shows step ≥ 3 and `workflow_runs.status ≠ completed`, mark as completed.

---

## Pass 1: marketplace scenarios

| # | Condition | Action |
|---|-----------|--------|
| 11 | `SKILL.md` exists | No action. |
| 12 | `SKILL.md` missing | Delete from `skills` master. Notify. |

---

## Pass 2: Discovery scenarios

| # | Condition | Action |
|---|-----------|--------|
| 9a | Dir found, no `SKILL.md` | Auto-delete dir. Notify. No user choice. |
| 9b | `SKILL.md` + all context artifacts (detected step = 3) | User choice: **Add to library** (inserts as `skill-builder`, creates `workflow_runs` at step 3, status `completed`) or **Remove** (deletes dir). |
| 9c | `SKILL.md` + partial/no context artifacts | User choice: **Add to library** (inserts as `imported`, no `workflow_runs`) or **Remove** (deletes dir). |

---

## ACK Dialog

After all three passes, if there are any notifications or discovered skills, `ReconciliationAckDialog` is shown as a blocking modal — the dashboard does not mount until the user acknowledges all notifications and resolves all discovered skills (9b/9c). Each discovery has inline **Add to Library** / **Remove** buttons; the Acknowledge button stays disabled until all are resolved.

---

## Logging

- Every skill in Pass 1 gets a `debug` log, even if no action is taken.
- Every cleanup, reset, or master deletion produces a user notification.
- Every dir found in Pass 2 gets a `debug` log.
