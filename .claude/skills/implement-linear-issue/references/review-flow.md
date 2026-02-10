# Review Flow — Code Review and Test Verification

This reference covers the code review, test verification, and final quality gate before moving to Review.

## Step 1: Code Review

After all implementation streams complete, spawn a **code review sub-agent**.

### Code review sub-agent prompt:

```
You are reviewing code changes for a Linear issue implementation.

**Worktree path**: [path]
**Issue ID**: [e.g., VD-383]
**Branch**: [branch name]
**What was implemented**: [brief summary from team status reports]

Your job:
1. Review all changes on this branch (use git diff against the base branch)
2. Check for:
   - Correctness: Does the code do what the requirements ask?
   - Best practices: Clean code, proper error handling, no obvious bugs
   - Consistency: Does it follow existing patterns in the codebase?
   - Edge cases: Are obvious edge cases handled?
   - Security: Any obvious security issues?
3. Check that tests exist for behavior changes
4. Identify any missing tests

Return:

**Verdict**: PASS / NEEDS FIXES

**Issues found** (if any):
1. [Severity: high/medium/low] [Description] [Location hint — area of the product, not file names in the Linear issue]
2. ...

**Missing tests** (if any):
1. [What behavior is untested]
2. ...

**Best practice suggestions** (non-blocking):
1. [Suggestion]
2. ...

Keep it concise. Prioritize issues by severity.
```

## Step 2: Fix Issues

If the review finds issues:

1. **High severity** → must fix before proceeding
2. **Medium severity** → fix if straightforward, otherwise note for follow-up
3. **Low severity / best practice** → fix if trivial, otherwise leave as notes

Spawn fix sub-agents for high and medium issues. They can run in parallel if they touch different areas.

### Fix sub-agent prompt:

```
You are fixing code review issues in a codebase.

**Worktree path**: [path]
**Issues to fix**:
[list from the review]

Fix each issue. After fixing, run relevant tests to make sure you haven't broken anything.

Return a brief summary of what you fixed.
```

After fixes, spawn another review sub-agent for a quick re-review of the fixed areas. Max 2 review cycles — after that, move forward with any remaining low-severity notes.

## Step 3: Test Verification

Check that tests cover the implementation. The review sub-agent will have flagged missing tests.

If tests are missing:

### Test sub-agent prompt:

```
You are adding tests for a feature implementation.

**Worktree path**: [path]
**What needs tests**: [list of untested behaviors from review]
**Existing test patterns**: Look at existing tests in the codebase to match style and framework

Write tests that verify:
- The happy path works as expected
- Edge cases are handled
- Error states are properly managed

Follow the existing test patterns in the project. Return a summary of tests added.
```

## Step 4: Run All Tests

Spawn a sub-agent to run the full test suite.

### Test runner sub-agent prompt:

```
You are running the full test suite for a project.

**Worktree path**: [path]

Run ALL tests — both frontend and backend:
1. Find the test commands (look at package.json scripts, Makefile, or CI config)
2. Run frontend tests
3. Run backend tests
4. Report results

Return:
- **Frontend tests**: PASS / FAIL (X passed, Y failed)
- **Backend tests**: PASS / FAIL (X passed, Y failed)
- **Failures** (if any): [test name and brief failure reason for each]
```

If tests fail:
1. Spawn fix sub-agents targeting the specific failures
2. Re-run the full suite
3. Max 3 attempts — after that, report to the user with the failure details

## Step 5: Final Linear Update

After review and tests pass, spawn a sub-agent to write the final implementation update to the Linear issue.

### Final update sub-agent prompt:

```
You have access to Linear MCP tools.

Update issue [issue ID] with the final implementation status.

1. Rewrite the Implementation Updates section to reflect final state:
   - Status: Ready for Review
   - All completed work listed
   - All tests listed
   - Any review notes or known limitations

2. Check off any acceptance criteria that are now complete.
   NEVER remove existing acceptance criteria.
   Add any new criteria discovered during implementation with a (NEW) prefix.

3. Add a "Reviewer Notes" subsection with:
   - Key decisions made during implementation
   - Anything non-obvious the reviewer should pay attention to
   - Any follow-up work identified but not in scope

Return the issue ID and confirmation that the update was made.
```

## Step 6: Move to Review

After the final update, spawn a sub-agent to move the Linear issue status to "Review" (or equivalent status in the workspace).

Only do this if:
- All tests pass
- Code review is clean (no outstanding high-severity issues)
- The Linear issue has been updated with final notes

If any of these fail, report to the user instead of moving to Review.
