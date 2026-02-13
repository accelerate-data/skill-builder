---
name: close-linear-issue
description: |
  Closes a completed Linear issue after testing. Merges the PR, moves the issue to Done, and cleans up.
  Triggers on "close <issue-id>", "complete <issue-id>", "merge <issue-id>", "ship <issue-id>", or "/close-issue".
---

# Close Linear Issue

You are a **coordinator**. Orchestrate sub-agents via `Task` — do not run git commands or resolve conflicts yourself.

## Autonomy

Proceed autonomously. Only confirm with the user:
- Unverified test plan items (Verify)
- Merge conflicts that require human judgment (Merge)

## Outcomes

Track these based on the issue's state:

- Issue, PR, and worktree identified
- Test plan verified (or user accepted risk)
- PR merged into main
- Linear issue moved to Done
- Worktree and branches cleaned up

## Identify

Gather the issue details, its PR, and its worktree location. Use the issue's `gitBranchName` to find the PR (`gh pr list --head`) and match the worktree (expected at `../worktrees/<gitBranchName>`).

If already **Done**, skip to Close (cleanup only). If no PR exists, stop.

Report to user: issue status, PR URL, worktree path.

## Verify Test Plan

Fetch the PR body and check the **## Test plan** section. If all checkboxes are checked, proceed. If unchecked items exist, show them to the user and ask how to proceed — they may confirm all verified (check them off on the PR), defer to test now, report issues needing fixes, or skip. If no test plan section is found, warn the user and ask whether to proceed without one.

## Merge (do these steps exactly)

Spawn a **single `general-purpose` sub-agent** with the worktree path, `gitBranchName`, and PR number. It must:

1. Rebase the branch onto `origin/main` (from the worktree directory)
2. If conflicts occur, attempt to resolve. Escalate to coordinator (who asks the user) if human judgment is needed.
3. Push with `--force-with-lease`
4. Wait for CI to pass (`gh pr checks --watch`)
5. Merge the PR with `--delete-branch` (prefer squash if allowed)
6. Return: merge commit SHA

If CI or merge fails, report to user and stop.

## Close (do these steps exactly)

Run in **parallel** (two `Task` calls in one turn):

- Move issue to **Done** via `linear-server:update_issue`. Add a closing comment via `linear-server:create_comment` with the PR URL and merge commit. (model: `haiku`)
- From the **main repo directory** (not the worktree): remove the worktree, delete the local branch, pull latest main. If worktree has uncommitted changes, report back — coordinator will ask user before force-removing.

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
| Multiple PRs for branch | Use most recent open PR |
