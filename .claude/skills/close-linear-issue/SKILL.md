---
name: close-linear-issue
description: |
  Closes a completed Linear issue after manual testing. Rebases the feature branch onto main,
  merges the PR, moves the issue to Done, and cleans up the worktree and remote branch.
  Triggers on "close VD-123", "complete VD-123", "merge VD-123", "ship VD-123", or "/close-issue".
---

# Close Linear Issue

You are a **coordinator**. Orchestrate sub-agents via `Task` — do not run git commands or resolve conflicts yourself.

## Autonomy

Proceed autonomously. Only confirm with the user:
- Manual testing status (Phase 2)
- Merge conflicts that require human judgment (Phase 3)

## Progress Checklist

```
- [ ] Phase 1: Identify issue, PR, and worktree
- [ ] Phase 2: Confirm manual testing
- [ ] Phase 3: Rebase + merge
- [ ] Phase 4: Close Linear issue + clean up
```

## Workflow

### Phase 1: Identify

Run in **parallel** (multiple `Task` calls in one turn):

- **Sub-agent A**: Fetch the issue via `linear-server:get_issue`. Return the `gitBranchName` field — this is the branch name for the PR and worktree.
- **Sub-agent B**: List active worktrees via `git worktree list`.

Then use `gitBranchName` to find the PR (`gh pr list --head <gitBranchName>`) and match the worktree (expected at `../worktrees/<gitBranchName>`).

If already **Done**, skip to Phase 4 (cleanup only). If no PR exists, stop.

Report to user: issue status, PR URL, worktree path.

### Phase 2: Confirm Manual Testing

Ask the user if manual testing passed. If issues remain, stop — use the implement skill to fix first.

### Phase 3: Rebase + Merge

Spawn a **single `general-purpose` sub-agent** with the worktree path, `gitBranchName`, and PR number. It handles the full flow:

1. Rebase the branch onto `origin/main` (from the worktree directory)
2. If conflicts occur, attempt to resolve. Escalate to coordinator (who asks the user) if human judgment is needed.
3. Push with `--force-with-lease`
4. Wait for CI to pass (`gh pr checks --watch`)
5. Merge the PR with `--delete-branch` (prefer squash if allowed)
6. Return: merge commit SHA

If CI or merge fails, report to user and stop.

### Phase 4: Close Linear Issue + Clean Up

Run in **parallel** (two `Task` calls in one turn):

- **Sub-agent A** (model: `haiku`): Move issue to **Done** via `linear-server:update_issue`. Add a closing comment via `linear-server:create_comment` with the PR URL and merge commit.
- **Sub-agent B**: From the **main repo directory** (not the worktree): remove the worktree, delete the local branch, pull latest main. If worktree has uncommitted changes, report back — coordinator will ask user before force-removing.

Report to user: issue closed, PR merged, worktree and branches removed.

## Sub-agent Type Selection

| Task | subagent_type | model |
|---|---|---|
| Fetch Linear issue | general-purpose | haiku |
| List worktrees | Bash | default |
| Rebase + merge | general-purpose | default |
| Close Linear issue | general-purpose | haiku |
| Git cleanup | general-purpose | default |

## Error Recovery

| Situation | Action |
|---|---|
| No PR found | Stop, tell user to create one via implement skill |
| No worktree found | Skip worktree cleanup, continue with PR and Linear |
| CI fails after rebase | Stop, report failing checks, let user decide |
| Merge conflicts | Sub-agent attempts resolution; escalates to user if needed |
| Issue already Done | Skip Linear update, proceed with cleanup only |
| Worktree has uncommitted changes | Ask user before force-removing |
