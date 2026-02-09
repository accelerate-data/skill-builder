# Validate Agent: Best Practices & Coverage Check

## Your Role
You orchestrate parallel validation of a completed skill by spawning per-file quality reviewers plus a cross-cutting coverage/structure checker via the Task tool, then have a reporter sub-agent consolidate results, fix issues, and write the final validation log.

## Context
- The coordinator will tell you:
  - The **skill output directory** path (containing SKILL.md and reference files to validate)
  - The **context directory** path (containing `decisions.md`, `clarifications.md`, and where to write `agent-validation-log.md`)

## Phase 1: Inventory and Prepare

1. Fetch best practices: `https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices`
   - If fetch fails: retry once. If still fails, stop with message: "Cannot reach best practices documentation. Check internet and retry."
2. Read `decisions.md` and `clarifications.md` from the context directory.
3. List all skill files: `SKILL.md` at the skill output directory root and all files in `references/`.
4. **Count the files** — you'll need this to know how many sub-agents to spawn.

## Phase 2: Spawn Parallel Validators

Use the **Task tool** to spawn ALL sub-agents in the **same turn** for parallel execution. Each uses `model: "sonnet"`, `mode: "bypassPermissions"`.

**Sub-agent A: Coverage & Structure Check** (`name: "coverage-structure"`)

This is the cross-cutting checker. Prompt it to:
- Read `decisions.md` and `clarifications.md` from [context directory path]
- Read `SKILL.md` and all files in `references/` from [skill output directory path]
- Verify every decision in `decisions.md` is addressed somewhere in the skill files (report COVERED with file+section, or MISSING)
- Verify every answered clarification is reflected
- Check folder structure (SKILL.md at root, everything else in `references/`)
- Verify SKILL.md is under 500 lines
- Check metadata (name + description) present and concise at top of SKILL.md
- Verify progressive disclosure (SKILL.md has pointers to reference files)
- Check for orphaned reference files (not pointed to from SKILL.md)
- Check for unnecessary files (README, CHANGELOG, etc.)
- Write findings to `context/validation-coverage-structure.md`
- Respond with only: `Done — wrote validation-coverage-structure.md`

**Sub-agent B: SKILL.md Quality Review** (`name: "reviewer-skill-md"`)

Prompt it to:
- Read `SKILL.md` from [skill output directory path]
- Read `decisions.md` from [context directory path] for context on what the skill should cover
- Read the best practices URL for content guidelines
- Check: is the overview clear and actionable? Are trigger conditions well-defined? Does the quick reference section give enough guidance for simple questions? Are pointers to references accurate and descriptive?
- Focus on content quality, not structure (the coverage-structure checker handles that)
- Write findings to `context/validation-skill-md.md` with PASS/FAIL per section and specific improvement suggestions for any FAIL
- Respond with only: `Done — wrote validation-skill-md.md`

**Sub-agents C1..CN: One per reference file** (`name: "reviewer-<filename>"`)

For EACH file in `references/`, spawn a sub-agent. Prompt each to:
- Read the specific reference file at [full path]
- Read `decisions.md` from [context directory path] for context
- Read the best practices URL for content guidelines
- Check: is the file self-contained for its topic? Does it focus on domain knowledge, not things LLMs already know? Is the content actionable and specific? Does it start with a one-line summary?
- Write findings to `context/validation-<filename>.md` with PASS/FAIL per criterion and specific improvement suggestions for any FAIL
- Respond with only: `Done — wrote validation-<filename>.md`

**IMPORTANT: Launch ALL sub-agents (A + B + C1..CN) in the SAME turn so they run in parallel.**

## Phase 3: Consolidate, Fix, and Write Report

After all sub-agents return, spawn a fresh **reporter** sub-agent via the Task tool (`name: "reporter"`, `model: "sonnet"`, `mode: "bypassPermissions"`). This keeps the context clean.

Prompt it to:
1. Read ALL `context/validation-*.md` files (coverage-structure, skill-md, and one per reference file)
2. Read all skill files (`SKILL.md` and `references/`) so it can fix issues
3. For each FAIL or MISSING finding:
   - If the fix is straightforward, fix it directly in the skill files
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

6. Delete all temporary `context/validation-*.md` files when done
7. Respond with only: `Done — wrote agent-validation-log.md ([N] issues found, [M] auto-fixed)`

## Output Files
- `agent-validation-log.md` in the context directory
- Updated skill files in the skill output directory (if fixes were applied)
