# Canonical Workflow Artifact Formats

Authoritative format spec for all artifacts produced and consumed during the skill-builder workflow. This is the agent ↔ app contract: what agents write and what the app expects to parse.

---

## Contract Enforcement

This spec is normative. If examples and implementation diverge, treat this document as the source of truth and update prompts/parsers/tests in the same change.

### Required test gates for contract changes

When changing any format in this file, run all applicable checks before merge:

| Changed area | Required checks |
|---|---|
| Agent prompts in `agents/*.md` | `cd app && npm run test:agents:structural` |
| Workspace agent instructions in `agent-sources/workspace/**` | `cd app && npm run test:agents:structural` |
| Parser-facing artifacts (`app/sidecar/mock-templates/**`, `app/e2e/fixtures/agent-responses/**`) | `cd app && npm run test:unit` |
| Rust parser logic (`app/src-tauri/src/commands/workflow.rs`) | `cd app && cargo test --manifest-path src-tauri/Cargo.toml commands::workflow` |
| Agent behavior contract changes | `cd app && FORCE_PLUGIN_TESTS=1 npm run test:agents:smoke` |

### Enforcement layers

| Layer | What it guarantees | Command |
|---|---|---|
| Structural (static) | Prompt inventory, frontmatter/model tiers, anti-pattern bans, and key policy-text invariants | `cd app && npm run test:agents:structural` |
| Unit parser checks | App-side parsing stays compatible with canonical artifacts | `cd app && npm run test:unit` |
| Promptfoo smoke (live) | End-to-end behavior still produces contract-compliant outputs in representative scenarios | `cd app && FORCE_PLUGIN_TESTS=1 npm run test:agents:smoke` |

### Promptfoo scenario ownership

Promptfoo smoke scenarios are defined in:

- `app/agent-tests/promptfoo/promptfooconfig.yaml` (scenario matrix + assertions)
- `app/agent-tests/promptfoo/provider.mjs` (fixture setup + agent invocation + schema-level validations)

Scenarios currently covering the behavior contract:

- `research-orchestrator`
- `answer-evaluator`
- `confirm-decisions`
- `refine-skill`

---

# Canonical `clarifications.json` Format

Written by the research skill (via `research-orchestrator`, Step 0). Updated in-place by `detailed-research` (Step 1). Read by `answer-evaluator`, `detailed-research`, `confirm-decisions`, and guard logic in downstream agents.

---

## JSON Schema

```json
{
  "version": "1",
  "metadata": {
    "title": "Clarifications: {Domain Name}",
    "question_count": 26,
    "section_count": 6,
    "refinement_count": 0,
    "must_answer_count": 3,
    "priority_questions": ["Q1", "Q2", "Q3"],
    "duplicates_removed": 17,
    "scope_recommendation": false
  },
  "sections": [
    {
      "id": "S1",
      "title": "Section Name",
      "description": "Brief section summary.",
      "questions": [
        {
          "id": "Q1",
          "title": "Short title",
          "must_answer": true,
          "text": "Full question text...",
          "consolidated_from": ["Metrics Research", "Business Rules"],
          "choices": [
            {"id": "A", "text": "Choice A", "is_other": false},
            {"id": "B", "text": "Choice B", "is_other": false},
            {"id": "C", "text": "Choice C", "is_other": false},
            {"id": "D", "text": "Other (please specify)", "is_other": true}
          ],
          "recommendation": "A — rationale",
          "answer_choice": null,
          "answer_text": null,
          "refinements": []
        }
      ]
    }
  ],
  "notes": [
    {
      "type": "inconsistency",
      "title": "Contradiction title",
      "body": "What is inconsistent and why it matters."
    }
  ]
}
```

### Rules

- `version` is fixed to `"1"`.
- `question_count` must equal total `sections[].questions[]` length.
- `section_count` must equal total `sections[]` length.
- `must_answer_count` must equal questions where `must_answer: true`.
- `priority_questions` must list all question IDs where `must_answer: true`.
- `refinement_count` is `0` at step 0; incremented by `detailed-research`.
- Every question must include 2-4 concrete choices plus final `"Other (please specify)"`.
- `answer_choice` and `answer_text` start as `null`.
- `refinements` starts as `[]` and is populated in step 1 for targeted follow-up.

### Refinement object schema (added by `detailed-research`)

```json
{
  "id": "R6.1",
  "parent_question_id": "Q6",
  "title": "Refinement title",
  "text": "Why this follow-up is needed.",
  "choices": [
    {"id": "A", "text": "Choice A", "is_other": false},
    {"id": "B", "text": "Choice B", "is_other": false},
    {"id": "C", "text": "Choice C", "is_other": false},
    {"id": "D", "text": "Other (please specify)", "is_other": true}
  ],
  "recommendation": "B",
  "must_answer": false,
  "answer_choice": null,
  "answer_text": null,
  "refinements": []
}
```

Refinement IDs follow `R{parent}.{n}` (for example `R6.1`, `R6.2`) and must keep `parent_question_id` aligned.

---

# Canonical `decisions.md` Format

Written by `confirm-decisions` (Step 5). Read by `generate-skill` and `validate-skill`.

---

## YAML Frontmatter

```yaml
---
decision_count: 12          # required — total D-level decisions
conflicts_resolved: 2       # required — number of conflict-resolved decisions
round: 1                    # required — iteration count (1 for first pass)
contradictory_inputs: true  # optional — set ONLY when answers are logically incompatible
scope_recommendation: true  # optional — set when scope is too broad (stub file)
---
```

### Required fields

| Field | Type | Description |
|---|---|---|
| `decision_count` | integer | Total number of `### D{N}:` decision entries |
| `conflicts_resolved` | integer | Count of decisions with `status: conflict-resolved` |
| `round` | integer | Iteration number (1 on first write, incremented on re-analysis) |

### Optional fields

| Field | Type | Description |
|---|---|---|
| `contradictory_inputs` | boolean | Set `true` only when user answers are logically incompatible — not just different approaches |
| `scope_recommendation` | boolean | Set `true` in the stub file when scope is too broad |

---

## Decision Entry Template

```markdown
### D1: Customer Hierarchy Depth
- **Original question:** How many levels should the customer hierarchy support?
- **Decision:** Two levels — parent company and subsidiary
- **Implication:** Need a self-referencing FK in dim_customer; gold layer aggregates must roll up at both levels
- **Status:** resolved
```

### Field-by-field spec

| Field | Format | Required | Notes |
|---|---|---|---|
| Heading | `### D{N}: Title` | yes | H3, D-numbered sequentially |
| Original question | `- **Original question:** text` | yes | Source question text (verbatim or summarized) |
| Decision | `- **Decision:** text` | yes | What was decided |
| Implication | `- **Implication:** text` | yes | Design/engineering consequence |
| Status | `- **Status:** value` | yes | One of: `resolved`, `conflict-resolved`, `needs-review` |

### Status values

| Value | When to use |
|---|---|
| `resolved` | Clean answer, direct derivation |
| `conflict-resolved` | Contradiction detected, agent picked most reasonable option with documented reasoning |
| `needs-review` | Ambiguous or insufficient information for a confident decision |

### Rules

- All field labels use `**Field:**` (colon inside bold), matching the clarifications convention.
- Every answered question (first-round and refinements) produces at least one decision with an implication.
- Contradictions are resolved with reasoning in the `**Implication:**` field — user reviews and can override.
- File is a clean snapshot, not a log — written from scratch each time.

---

## Scope Recommendation Stub

When the scope is too broad, `confirm-decisions` writes a minimal stub instead of decisions:

```markdown
---
scope_recommendation: true
decision_count: 0
---
## Scope Recommendation Active

The research planner determined the skill scope is too broad. See `clarifications.json` for recommended narrower skills. No decisions were generated.
```

---

# Canonical `research-plan.md` Format

Written by the research skill (via `research-orchestrator`, Step 0). Read by `companion-recommender` (Step 7). Rendered as markdown in the UI.

## YAML Frontmatter

```yaml
---
purpose: domain                       # required — purpose token
domain: Sales Pipeline                # required — domain name
topic_relevance: relevant             # required — "relevant" or "not_relevant"
dimensions_evaluated: 6               # required — total dimensions scored
dimensions_selected: 4                # required — dimensions chosen for research
---
```

## Structure

```markdown
# Research Plan

## Skill: [domain name] ([purpose])

## Dimension Scores

| Dimension | Score | Reason | Companion Note |
|-----------|-------|--------|----------------|
| [slug] | [1-5] | [one-sentence] | [optional — for scores 2-3] |

## Selected Dimensions

| Dimension | Focus |
|-----------|-------|
| [slug] | [tailored focus line] |
```

---

# Canonical `test-skill.md` Format

Written by `validate-skill` orchestrator (Step 7). Rendered as markdown in the UI.

## YAML Frontmatter

```yaml
---
test_date: 2026-01-01        # required — ISO date
total_tests: 5                # required — total test count
passed: 4                     # required — PASS count
partial: 1                    # required — PARTIAL count
failed: 0                     # required — FAIL count
scope_recommendation: true    # optional — stub indicator
---
```

## Structure

```markdown
# Skill Test Report

## Summary
- **Total**: 5 | **Passed**: 4 | **Partial**: 1 | **Failed**: 0

## Test Results

### Test 1: [Prompt text]
- **Category**: [category] | **Result**: PASS | PARTIAL | FAIL
- **Skill coverage**: [evidence from skill files]
- **Gap**: [what's missing, or "None"]

## Skill Content Issues
### Uncovered Topic Areas
### Vague Content Needing Detail
### Missing SKILL.md Pointers

## Suggested PM Prompts
```

---

# Canonical `agent-validation-log.md` Format

Written by `validate-skill` orchestrator (Step 7). Rendered as markdown in the UI. No YAML frontmatter (unless scope recommendation stub).

## Structure

```markdown
# Validation Log

## Structural Checks
- [PASS] Check description
- [FAIL] Check description — details

## Content Quality Checks
### [filename]
- Actionability: N/5 — description
- Specificity: N/5 — description

## Decision Coverage
- D1 (Title): Covered in [file:section]
- D8 (Title): Not deeply covered (minor gap)

## Issues Found
- N critical issues
- N minor gaps
- N items auto-fixed

## Summary
[One-sentence verdict]
```

---

# Canonical `companion-skills.md` Format

Written by `validate-skill` orchestrator (Step 7). YAML frontmatter parsed programmatically by the app; markdown body rendered in the UI.

## YAML Frontmatter

```yaml
---
skill_name: sales-pipeline
purpose: domain
companions:
  - name: Salesforce Extraction
    slug: salesforce-extraction
    type: source
    dimension: field-semantics
    dimension_score: 3
    priority: high
    reason: "Description of why this companion is needed"
    trigger_description: "When to use this companion skill"
    template_match: null
---
```

### Companion entry fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Human-readable companion name |
| `slug` | string | yes | Kebab-case identifier |
| `type` | string | yes | `domain`, `source`, `platform`, or `data-engineering` |
| `dimension` | string | yes | Research dimension slug this companion covers |
| `dimension_score` | integer | yes | Score from research planner (2-3 range) |
| `priority` | string | yes | `high`, `medium`, or `low` |
| `reason` | string | yes | Why this companion is needed |
| `trigger_description` | string | yes | When an engineer should use it |
| `template_match` | string/null | yes | Matched template slug, or null |

## Markdown Body

```markdown
# Companion Skill Recommendations

## 1. [Name] ([type] skill)

**Priority**: [High/Medium/Low] | **Dimension**: [slug] (score: N)

**Why**: [Reason text]

**Suggested trigger**: [Trigger description]

**Template match**: [Match or "No matching template found"]
```

---

# Canonical `user-context.md` Format

Generated at runtime by Rust (desktop app) or by the plugin coordinator's Scoping phase, written to the per-skill workspace directory (`app_local_data_dir()/workspace/{skill-name}/`) so agents can read it. Source data: user settings and intake/scoping answers.

## Structure

```markdown
# User Context

### Skill
**Name**: dbt-fabric-patterns
**Purpose**: Organization specific data engineering standards
**Description**: Standards for dbt model layering and testing
**Tags**: dbt, silver-layer

### About You
**Industry**: Financial Services
**Function**: Analytics Engineering

### What Claude Needs to Know
Multi-region Snowflake deployment with strict SCD Type 2 requirements

### Configuration
**Version**: 1.0.0
**Model**: sonnet
```

### Rules

- Top-level heading is always `## User Context` (H2)
- Sections use `### SubHeading` format (H3)
- Fields within sections use `**Label**: value` (bold label, no dash prefix)
- Sections are only written if at least one field in that section has a non-empty value
- If the skill name is present but no optional fields have values, only the `### Skill` section with `**Name**` is written

---

# Canonical `answer-evaluation.json` Format

Written by `answer-evaluator`. Runs at two gates: after Step 2 (Q-level answers) and after Step 4 (Q-level and R-level answers). Read by the app and by `detailed-research`.

## JSON Schema

```json
{
  "verdict": "sufficient",
  "answered_count": 8,
  "empty_count": 0,
  "vague_count": 0,
  "contradictory_count": 0,
  "total_count": 8,
  "reasoning": "All 8 questions have detailed, specific answers.",
  "per_question": [
    { "question_id": "Q1", "verdict": "needs_refinement" },
    { "question_id": "Q2", "verdict": "clear" },
    { "question_id": "Q3", "verdict": "vague", "reason": "Missing concrete thresholds and examples." },
    { "question_id": "Q4", "verdict": "contradictory", "contradicts": "Q2", "reason": "Conflicts with Q2 because this answer picks the opposite source of truth." }
  ]
}
```

### Field spec

| Field | Type | Required | Values |
|---|---|---|---|
| `verdict` | string | yes | `"sufficient"`, `"mixed"`, `"insufficient"` |
| `answered_count` | integer | yes | Count of substantive answers (`clear` + `needs_refinement`) |
| `empty_count` | integer | yes | Count of empty/whitespace answers |
| `vague_count` | integer | yes | Count of vague answers (<5 words, "TBD", etc.) |
| `contradictory_count` | integer | no | Count of contradictory answers |
| `total_count` | integer | yes | Total question count |
| `reasoning` | string | yes | Single sentence explaining the verdict |
| `per_question` | array | yes | Array of per-question verdict entries. Required keys always: `question_id`, `verdict` |

### Rules

- `answered_count + empty_count + vague_count == total_count` (where `answered_count` includes both `clear` and `needs_refinement`)
- If present, `answered_count + empty_count + vague_count + contradictory_count == total_count`
- `verdict` logic: `sufficient` when all answered, `insufficient` when none answered, `mixed` otherwise
- Per-question verdict values: `"clear"`, `"needs_refinement"`, `"not_answered"`, `"vague"`, `"contradictory"`
- `vague` entries must include non-empty `reason`
- `contradictory` entries must include non-empty `reason` and `contradicts` (question ID); reason text should reference the conflicting ID
- Output must be valid JSON with no markdown fences or extra text

---

# Canonical `logs/{step}-{timestamp}.jsonl` Format

Written by the Rust sidecar layer (`sidecar_pool.rs`) for every agent run. Stored at `{workspace}/{skill-name}/logs/`. Not read by agents — used for debugging and observability.

## Filename

```text
{step-label}-{timestamp}.jsonl
```

- `step-label` — derived from the agent ID (e.g. `step0`, `step2`, `step4`, `step5`)
- `timestamp` — local time in `YYYY-MM-DDTHH-MM-SS` format

## Format

One JSON object per line (JSONL). The file is **not** valid JSON as a whole.

**Line 1** — request config (written before the agent runs):

```json
{
  "prompt": "The domain is: ...",
  "model": "claude-sonnet-4-5-20250929",
  "apiKey": "[REDACTED]",
  "cwd": "/Users/alice/.vibedata",
  "allowedTools": ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task", "Skill"],
  "maxTurns": 50,
  "permissionMode": "bypassPermissions",
  "sessionId": null,
  "agentName": "research-orchestrator"
}
```

`apiKey` is always redacted. All other fields are included as sent to the SDK.

**Lines 2+** — raw SDK stdout events, one per line. Each line is a JSON object emitted by the `@anthropic-ai/claude-agent-sdk`. Common event shapes:

```json
{ "type": "assistant", "message": { "content": [...] } }
{ "type": "tool_use", "name": "Read", "input": { "file_path": "..." } }
{ "type": "tool_result", "content": "..." }
{ "type": "result", "subtype": "success", "total_cost": 0.042 }
```

## Rules

- Line 1 is always the config object; agent output begins at line 2.
- The file is created before the agent runs; if the agent fails to start, line 1 may be the only content.
- Transcripts are non-fatal: if the log file cannot be created, the agent still runs.
