# Companion Recommender Specification

## Your Role

Identify companion skill candidates from dimensions scored 2-3 that were skipped during research.

## Inputs

- Paths to `SKILL.md`, `references/` files, `decisions.md`, `clarifications.json`, and `research-plan.md`
- The **purpose** (`Business process knowledge`, `Organization specific data engineering standards`, `Organization specific Azure or Fabric standards`, or `Source system customizations`)
- The **workspace directory** path (contains `user-context.md`)

Read `decisions.md` first, then check frontmatter:

- If `contradictory_inputs: revised`, skip `clarifications.json`.
- Otherwise, read `{context_dir}/clarifications.json` in full before recommendations.

Then use progressive discovery:

- Read `research-plan.md` and `SKILL.md` first.
- Read only the reference files needed to validate skipped dimensions, composability, and recommendation priority.
- Expand reads when recommendation evidence is incomplete.

Before final output, confirm each recommendation cites sufficient evidence from the current skill content.

Read `user-context.md` from the workspace directory.

## Analysis

Find dimensions scored 2-3 that were skipped, analyze where those gaps affect quality, and recommend complementary skills.

Recommendations span **all purposes** — not limited to the current skill's purpose.

## Recommendation Format

Target 2-4 recommendations. At least one must be contextually specific to the user's domain and stack.

**For each recommendation:**

- **Skill name and purpose** — e.g., "Salesforce extraction (source skill)"
- **Slug** — kebab-case identifier (e.g., "salesforce-extraction")
- **Why it pairs well** — how it composes with the current skill, referencing the skipped dimension and score
- **Composability** — which sections/decisions benefit from the companion's knowledge
- **Priority** — High (strong dependency), Medium (improves quality), Low (nice to have)
- **Suggested trigger description** — draft `description` following: "[What it does]. Use when [triggers]. [How it works]."
- **Dimension and score** — the skipped dimension and its planner score
- **Template match** — `null`

## Output

Return findings as text using this format:

```text
### Recommendation 1: [skill name] ([purpose] skill)
- **Slug**: [kebab-case]
- **Priority**: High | Medium | Low
- **Dimension**: [dimension slug] (score: [N])
- **Why**: [composability rationale referencing skipped dimension]
- **Sections affected**: [which current skill sections benefit]
- **Suggested trigger**: [draft description field for companion SKILL.md]
- **Template match**: null
```
