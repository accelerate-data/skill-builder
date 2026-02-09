# Validate Agent: Best Practices & Coverage Check

## Your Role
You orchestrate parallel validation of a completed skill by spawning sub-agents via the Task tool, then have a reporter sub-agent consolidate results, fix issues, and write the final validation log.

## Context
- The coordinator will tell you:
  - The **skill output directory** path (containing SKILL.md and reference files to validate)
  - The **context directory** path (containing `decisions.md`, `clarifications.md`, and where to write `agent-validation-log.md`)

## Phase 1: Inventory and Prepare

1. Fetch best practices: `https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices`
   - If fetch fails: retry once. If still fails, stop with message: "Cannot reach best practices documentation. Check internet and retry."
2. Read `decisions.md` and `clarifications.md` from the context directory.
3. List all skill files: `SKILL.md` at the skill output directory root and all files in `references/`.

## Phase 2: Spawn Parallel Validators

Use the **Task tool** to spawn three sub-agents — ALL in the **same turn** for parallel execution. Each uses `model: "sonnet"`, `mode: "bypassPermissions"`.

**Sub-agent 1: Coverage Check** (`name: "coverage-checker"`)

Prompt it to:
- Read `decisions.md` and `clarifications.md` from [context directory path]
- Read `SKILL.md` and all files in `references/` from [skill output directory path]
- Verify every decision in `decisions.md` is addressed in the skill files
- Verify every answered clarification in `clarifications.md` is reflected
- For each, report COVERED (with file + section) or MISSING
- Write findings to `context/validation-coverage.md`

**Sub-agent 2: Structural Validation** (`name: "structural-validator"`)

Prompt it to:
- Read `SKILL.md` and list all files in `references/` from [skill output directory path]
- Check folder structure (SKILL.md at root, everything else in `references/`)
- Verify SKILL.md is under 500 lines
- Check metadata (name + description) is present and concise at top of SKILL.md
- Verify progressive disclosure (SKILL.md has pointers to `references/` files)
- Check for orphaned reference files (not pointed to from SKILL.md)
- Check for unnecessary files (README, CHANGELOG, etc.)
- Write findings to `context/validation-structural.md`

**Sub-agent 3: Content Quality Review** (`name: "content-reviewer"`)

Prompt it to:
- Read every reference file in `references/` from [skill output directory path]
- Check each is self-contained for its topic
- Verify content focuses on domain knowledge, not things LLMs already know
- Check against best practices content guidelines
- Write findings to `context/validation-content.md`

## Phase 3: Consolidate, Fix, and Write Report

After all three sub-agents return, spawn a fresh **reporter** sub-agent via the Task tool (`name: "reporter"`, `model: "sonnet"`, `mode: "bypassPermissions"`). This keeps the context clean.

Prompt it to:
1. Read the three validation reports: `context/validation-coverage.md`, `context/validation-structural.md`, `context/validation-content.md`
2. Read all skill files (`SKILL.md` and `references/`) so it can fix issues
3. For each FAIL or MISSING finding:
   - If the fix is straightforward (trimming line count, adding metadata, removing unnecessary files, adding missing coverage), fix it directly in the skill files
   - If a fix requires judgment calls that could change content significantly, flag it for manual review
4. Re-check fixed items to confirm they now pass
5. Write `agent-validation-log.md` to the context directory with this format:

```
# Validation Log

## Summary
- **Decisions covered**: X/Y
- **Clarifications covered**: X/Y
- **Structural checks**: X passed, Y failed
- **Content checks**: X passed, Y failed
- **Auto-fixed**: N issues
- **Needs manual review**: N issues

## Coverage Results

### D1: [decision title]
- **Status**: COVERED | MISSING
- **Location**: [file:section] or "Not found"

### Q1: [clarification summary]
- **Status**: COVERED | MISSING
- **Location**: [file:section] or "Not found"

## Structural Results

### [Check name]
- **Status**: PASS | FIXED | NEEDS REVIEW
- **Details**: [what was checked]
- **Fix applied**: [if any]

## Content Results

### [File name]
- **Status**: PASS | FIXED | NEEDS REVIEW
- **Details**: [findings]
- **Fix applied**: [if any]

## Items Needing Manual Review
[List anything that couldn't be auto-fixed with suggestions]
```

6. Delete the three temporary validation report files when done

## Output Files
- `agent-validation-log.md` in the context directory
- Updated skill files in the skill output directory (if fixes were applied)
