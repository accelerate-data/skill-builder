---
name: close-linear-issue
description: |
  Closes a completed Linear issue after manual testing. Rebases the feature branch onto main,
  merges the PR, moves the issue to Done, and cleans up the worktree and remote branch.
  Triggers on "close VD-123", "complete VD-123", "merge VD-123", "ship VD-123", or "/close-issue".
---

# Close Linear Issue

Post-implementation workflow: rebase, merge, close, clean up.

## Autonomy

Proceed autonomously through each phase. Only confirm with the user:
- Manual testing status (Phase 2)
- Merge conflicts that require human decisions (Phase 3)

## Progress Checklist

Copy and track:
```
- [ ] Phase 1: Identify issue, PR, and worktree
- [ ] Phase 2: Confirm manual testing
- [ ] Phase 3: Rebase onto main
- [ ] Phase 4: Merge PR
- [ ] Phase 5: Close Linear issue
- [ ] Phase 6: Clean up
```

## Workflow

### Phase 1: Identify

1. Fetch the issue via `linear-server:get_issue`. Get: ID, title, status, branch name.
2. Verify the issue is in **In Review** or **In Progress**. If already **Done**, skip to Phase 6 (cleanup only).
3. Find the PR:
   ```bash
   gh pr list --head <branchName> --json number,url,title,state
   ```
4. Find the worktree: `git worktree list` — look for the branch at `../worktrees/<branchName>`.
5. Report findings to the user: issue status, PR URL, worktree path. If no PR exists, stop.

### Phase 2: Confirm Manual Testing

Ask the user: "Has manual testing passed?" If they report issues, stop — they should fix via the implement skill first.

### Phase 3: Rebase onto Main

Run in the **worktree directory**:

```bash
git fetch origin
git rebase origin/main
```

**If conflicts occur:**
1. List the conflicting files for the user
2. Help resolve each conflict (read files, apply fixes)
3. `git add <resolved-files> && git rebase --continue`
4. Repeat until clean

After successful rebase, push the updated branch:

```bash
git push --force-with-lease
```

Wait for CI: `gh pr checks <number> --watch`. If CI fails, report and stop.

### Phase 4: Merge PR

First, check the repo's merge strategy:

```bash
gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed
```

Then merge using the first allowed strategy (prefer squash > merge > rebase):

```bash
gh pr merge <number> --squash --delete-branch
```

The `--delete-branch` flag removes the remote branch automatically.

### Phase 5: Close Linear Issue

1. Move to **Done**: `linear-server:update_issue` with `state: "Done"`.
2. Add a closing comment with `linear-server:create_comment`:
   - PR URL and merge commit
   - Brief summary of what was delivered

### Phase 6: Clean Up

Return to the **main repo directory** (not the worktree) before running these commands.

1. Remove the worktree:
   ```bash
   git worktree remove ../worktrees/<branchName>
   ```
   If it fails due to uncommitted changes, use `--force` after confirming with the user.

2. Delete the local branch:
   ```bash
   git branch -d <branchName>
   ```
   Use `-D` only if `-d` fails (unmerged warning) and the PR was already merged.

3. Update local main:
   ```bash
   git checkout main && git pull
   ```

4. Report to user: issue closed, PR merged, worktree and branches removed.

## Error Recovery

| Situation | Action |
|---|---|
| No PR found | Stop, tell user to create one via implement skill |
| No worktree found | Skip worktree cleanup, continue with PR and Linear |
| CI fails after rebase | Stop, report failing checks, let user decide |
| Merge conflicts during rebase | Help resolve interactively |
| Issue already Done | Skip Linear update, proceed with cleanup only |
| Worktree has uncommitted changes | Ask user before `--force` removing |
