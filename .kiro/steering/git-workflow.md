---
inclusion: always
---

# Git Workflow

## Parallel Development with Worktrees

The primary way work is parallelized is through **git worktrees** — multiple Claude Code instances in parallel, each in its own worktree.

### Creating a Worktree

Always branch from `feature/desktop-ui`:

```bash
git worktree add ~/src/skill-builder-<task-name> -b <task-name> feature/desktop-ui
cd ~/src/skill-builder-<task-name>/app && npm install
cd sidecar && npm install && npm run build && cd ..
```

### Cleanup After Merge

```bash
git merge <task-name>
git worktree remove ~/src/skill-builder-<task-name>
git branch -d <task-name>
```

### Worktree Rules

- **Keep branches focused** — one feature, fix, or refactor per branch
- **Avoid overlapping file edits** to minimize merge conflicts
- **Frontend, backend, and sidecar are independent** — safe to work on in parallel
- **Verify before committing**: `npx tsc --noEmit` + `cargo check`

## Commits

**Make granular commits.** Each commit should be a single logical change that compiles and passes tests.

### Guidelines

- **One concern per commit** — don't mix changes
- **Commit as you go** — don't accumulate large diffs
- **Descriptive messages** — explain what and why, not how
- **Run tests before each commit**: `npm test` + `cargo test`
- **Stage specific files** — use `git add <file>` not `git add .`

### Good Examples

```
Add chat session SQLite schema and CRUD functions
Add chat store with session and message state
Add chat page with message bubbles and input
Wire chat route into TanStack Router
```

### Bad Examples

```
Add chat feature                    # Too broad
Fix stuff                           # No context
Update files                        # Meaningless
Add chat and also fix sidebar bug   # Two unrelated changes
```
