# Bug Flow — Detailed Workflow

This reference covers the full bug path from user report to a product-level bug issue.

**Key principle:** The issue describes the bug as the **user experiences it** — symptoms, reproduction steps, expected vs. actual behavior. Code-level investigation happens internally for scope/estimate purposes but does not appear in the issue.

## Step 1: Gather Initial Info

From the user's short sentence, determine:
- What's broken or unexpected from the user's perspective?
- When did they notice it?
- Any error messages or visual issues?

If the user has reproduction steps, take them. If not, spawn a sub-agent to investigate.

## Step 2: Investigation

Spawn a sub-agent to investigate the bug. The agent reviews code and git history to understand the bug — but the output is split into internal context (for estimates) and issue-facing content (user-level).

### Sub-agent prompt for bug investigation:

```
You are investigating a bug report in this codebase.

**Project root**: [path]
**Bug report**: [user's description]
**Additional context**: [any clarifications from user]

Your job:
1. **Find relevant code**: Search for areas related to the reported behavior
2. **Check recent git history**: Look at recent commits and PRs that touched these areas
   - Use: git log --oneline -20 -- [relevant paths]
   - Use: git log --all --oneline --since="2 weeks ago" -- [relevant paths]
   - Check if any recent changes could have introduced this issue
3. **Understand the bug**: What's actually going wrong from the user's perspective?
4. **Draft reproduction steps**: Write clear steps as a user would follow them
5. **Assess severity**: How does this impact the user?

Return TWO sections:

**INTERNAL (for coordinator's context only — will NOT go in the issue):**
- Likely root cause: [1-2 sentences, code-level]
- Affected area scope: [rough sense of how deep the fix goes]
- Recent relevant changes: [any commits/PRs that may relate]
- Estimated fix complexity: XS / S / M / L / XL

**FOR THE ISSUE (product-level only):**
- **What happens**: [1-2 sentences — the user-visible symptom]
- **Reproduction Steps**:
  1. [Step 1 — what the user does]
  2. [Step 2]
  3. [Expected behavior vs. actual behavior]
- **Severity**: [Impact on user — data loss? broken flow? visual glitch? degraded experience?]
- **Frequency**: [Always? Sometimes? Under specific conditions?]

Be concise. Focus on facts.
```

## Step 3: Present Findings

Show the user the **product-level findings only**:
1. What's happening (the symptom)
2. The reproduction steps
3. The severity assessment

Ask the user to confirm or correct. They may:
- Confirm → proceed to issue creation
- Add detail → update the report
- Disagree → incorporate their perspective

## Step 4: Estimate

The sub-agent's internal assessment gives the scope signal. Map to t-shirt sizes:

| Size | What it means |
|------|---------------|
| XS | Trivial — obvious quick fix |
| S | Small — isolated, clear path to resolution |
| M | Moderate — needs some investigation |
| L | Significant — affects multiple user flows |
| XL | Major — deep issue, potentially broad impact |

When uncertain, default to M and note the uncertainty.
