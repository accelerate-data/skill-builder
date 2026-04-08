# Skill Scope Review

**Status:** Design complete (VU-805). Implementation pending.

Advisory feature that evaluates whether a skill is too broad during creation and suggests focused alternatives using gerund-naming conventions. Also generates recommended skill descriptions following effective description guidelines.

---

## Overview

When users create skills they often define overly broad skills (e.g. `sales-analysis`) that cover too many concerns and produce diluted, generic output. This feature evaluates the skill name, description, and purpose against the user's business context and advises decomposition when needed.

The feature is **advisory only** — it never blocks submission. The user makes the final decision.

---

## Trigger Conditions

- **When:** Create mode only (not edit mode)
- **Trigger:** A dedicated **"Validate"** button placed in the dialog footer, next to the "Next" button. The advisor fires when the user clicks Validate.
- **Next button behavior:** "Next" only advances the user to step 2. It does not trigger the LLM. The Next button remains enabled as long as all required fields are filled — the advisor result is independent.
- **Validate button behavior:** Validate is enabled only when all required fields (name, description, purpose) are non-empty **and** the advisor status is `idle`. It is disabled when status is `loading` (call in flight) or `focused` (skill already confirmed as focused — no need to re-run).
- **Re-fires:** Editing any required field resets status to `idle`, which re-enables Validate for a fresh check.
- **Fields required:** Name, description, and purpose must all be non-empty (same guard as the Next button).
- **Description is user-written** — the description field has no auto-generated ghost text. The user writes it first; the advisor evaluates it.

---

## Inputs to the LLM

| Input | Source |
|---|---|
| Skill name | Create form |
| Skill description | Create form |
| Skill purpose | Create form |
| What Claude needs to know | Create form (context questions field) |
| Industry | User settings |
| Uploaded documents | User settings (only "All Skills" scope — see below) |

Business context (industry + documents) can override a generic breadth signal. If the documents show that "revenue metrics" in this company is one tightly scoped workflow, the LLM should say it's focused — not broad.

The "What Claude needs to know" field (context questions) is included as additional signal — it often contains domain-specific constraints that help the LLM determine whether an apparently broad skill is actually scoped to a single workflow in practice.

### Document visibility in the create form

The create form shows a read-only list of documents above the Skill Name field so the user knows what business context the advisor will use. Only documents with scope `"all"` (i.e. assigned to "All Skills") are shown — skill-specific documents are not displayed because no skill exists yet at creation time. The list is display-only; to add or remove documents the user must go to Settings.

---

## Evaluation Criteria

The core test: **does the description describe exactly the process named by the skill?**

- If yes → pass
- If the description wanders into a second process → fail

The skill name (gerund) names the overarching process. The description explains what that process does and when to invoke it. They must align.

### Name rules

A good name uses the gerund pattern: `verb-ing + specific object` (kebab-case).

| Pass | Fail |
|---|---|
| `forecasting-churned-customers` | `sales-analysis` (not gerund) |
| `processing-purchase-orders` | `analyzing-data` (object too vague) |

### Description rules

A good description serves **one overarching process** — the same process named by the skill.

- Nouns must be specific — `churned customers`, `purchase orders` not `sales data`, `customers`
- The data source is **optional** — adds clarity but is not required to pass
- **Number of nouns does not matter** — many nouns are fine as long as they all fall under the one process named by the skill
- **Pass:** `validating-grain-feed-compliance` covers quality testing, traceability docs, and supplier audits → all serve one process → pass
- **Fail:** description spans two distinct processes → split
- **Always fail:** nouns from different business functions → split

**How process boundaries are determined:**
- The LLM uses general business knowledge by default
- Uploaded documents from user settings can override — if documents establish that certain activities form one unified process in this company, that takes precedence

---

## Four Evaluation Cases

### Case 1 — Name fails (too broad/vague or not gerund), description fits one process → `name-needs-improvement`

The name fails if it is:
- Too broad or vague — e.g. `sales-analysis`, `understand-procurement-processes`
- Not in gerund form — e.g. `procurement-process` (noun, not gerund), `sales-report` (noun)

The description is already focused on one process. The LLM derives the correct gerund name directly from the description.

- **Chips:** 1 — correct gerund name derived from the description, with the **original description unchanged**. The description is already good; only the name needs fixing.
- **Reason example:** *"Your name doesn't follow the gerund pattern. We derived a focused gerund name from your description, which was kept as-is."*
- **Note:** if the description is also vague or imprecise, use Case 3 (`both-need-improvement`) instead.

### Case 2 — Skill covers a recognizable business domain spanning multiple processes → `too-broad`

The skill references a broad business function and the LLM can infer (from business knowledge or documents) what distinct sub-processes it covers. This applies **even if the description does not explicitly list the sub-processes** — umbrella business terms like "recruitment", "sales", "procurement" inherently span multiple workflows.

Example A: name = `sales-analysis`, description = `Analyzes revenue trends, pipeline health, and rep performance.` (explicitly lists processes)

Example B: name = `understand-recruitment-processes`, description = `Understand recruitment processes of the company.` (umbrella term — hiring, onboarding, interview scheduling, etc. can be inferred)

- **Chips:** 3–5 split suggestions, names anchored to the original name
- **Reason example:** *"This skill covers three separate processes. Consider splitting into focused skills."*

### Case 3 — Both name and description so vague the business domain is unclear → `both-need-improvement`

The name and description give no signal about what area of the business is involved. The LLM cannot infer sub-processes because there is no domain anchor.

Example: name = `analyzing-data`, description = `Analyzes data for the team.` — data about what? Which team? No domain signal at all.

**Key distinction:** if the LLM can name the business domain (recruitment, sales, procurement, etc.) → use Case 2 (`too-broad`). Only use Case 3 when the domain itself is unclear.

- **Chips:** 3–5 best-guess alternatives
- **Reason example:** *"Both the name and description are too vague to be certain — these suggestions are our best guess. Add more detail for a more accurate recommendation."*

### Case 4 — Name focused, description wanders into a second process → `description-needs-improvement`

Example: name = `forecasting-churned-customers`, description = `Forecasts churn risk and tracks renewal pipeline health.`

The name is correct. The description has one valid process + one stray. Split into two skills.

- **Chips:** 1 per process found — original name + trimmed description, then one additional chip per stray process (new gerund name + description for each). Total chips = 1 + number of stray processes.
- **Reason example:** *"Your skill name is focused, but the description covers additional processes — renewal pipeline tracking. We've split these into focused skills."*

### Examples by case

| Case | Name | Description | Verdict |
|---|---|---|---|
| Pass | `forecasting-churned-customers` | Forecasts which customers are at risk of churning | ✓ Focused |
| Pass | `validating-grain-feed-compliance` | Validates quality testing, traceability docs, and supplier audits for grain ingredients | ✓ Focused (many nouns, one process) |
| Case 1a | `sales-analysis` | Forecasts which customers are at risk of churning | `name-needs-improvement` — not gerund, derive from description |
| Case 1b | `procurement-process` | Validates grain quality testing and traceability docs for compliance | `name-needs-improvement` — noun not gerund, derive from description |
| Case 2a | `sales-analysis` | Analyzes revenue, pipeline health, and rep performance | `too-broad` — explicitly lists multiple processes |
| Case 2b | `understand-recruitment-processes` | Understand recruitment processes of the company | `too-broad` — umbrella business term, sub-processes inferred |
| Case 3 | `analyzing-data` | Analyzes data for the team | `both-need-improvement` — no identifiable business domain |
| Case 4 | `forecasting-churned-customers` | Forecasts churn risk and tracks renewal pipeline health | `description-needs-improvement` — 1 chip per process found |

**Domain context:** These skills are used to build data warehouses and lakehouses — OLAP systems, not OLTP. The data source (e.g. Salesforce, Snowflake, S3) is valuable context when present, but is not compulsory. A skill with no named source can still pass if it acts on one specific noun.

The LLM uses industry and uploaded documents as context. A description that sounds multi-domain generically may resolve to a single workflow in the user's specific business context — that is a valid pass.

---

## Model

**Claude Sonnet** — the judgment call of "is this too broad given your business context" benefits from stronger reasoning. Haiku is insufficient for nuanced domain judgment.

---

## Response Contract

```json
{
  "status": "focused" | "too-broad" | "name-needs-improvement" | "description-needs-improvement" | "both-need-improvement",
  "reason": string,
  "suggested_skills": [
    {
      "name": string,
      "description": string
    }
  ]
}
```

- `status` is one of five values (see States below)
- `reason` is always populated — a short diagnostic sentence shown below the banner
- `suggested_skills` contains 3–5 items for all non-focused statuses, empty array when `focused`
- All suggested `name` values must use gerund-naming
- All suggested `description` values must follow the effective description guidelines

---

## Gerund-Naming Convention

All suggested skill names must use the `verb-ing + object` pattern.

| Correct | Incorrect |
|---|---|
| `forecasting-churned-customers` | `churn-forecast` |
| `calculating-opportunity-mrr` | `opportunity-mrr-calculation` |
| `analyzing-rep-performance` | `rep-performance-analysis` |
| `segmenting-enterprise-accounts` | `enterprise-account-segmentation` |

Rules:

- Start with a present-participle verb (`forecasting`, `calculating`, `analyzing`, `segmenting`, `tracking`, `reporting`)
- Follow with a specific object — not a generic noun like `data`, `metrics`, `analysis`
- Kebab-case throughout
- No acronyms unless industry-standard (e.g. `mrr`, `arr`, `crm`)

The prompt must include these examples and the rule explicitly. The LLM must not suggest non-gerund names.

---

## Effective Description Guidelines

The description field enables skill discovery. Claude uses it to choose the right skill from potentially 100+ available skills. The description must provide enough detail for Claude to know when to select this skill.

**Writing rules:**

- Always write in third person. The description is injected into the system prompt, and inconsistent point-of-view causes discovery problems.
- Include both what the skill does **and** when to use it (specific triggers/contexts).
- Be specific — include key terms that appear in real user requests.

**Good examples:**

| Skill | Effective description |
|---|---|
| PDF Processing | `Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.` |
| Excel Analysis | `Analyze Excel spreadsheets, create pivot tables, generate charts. Use when analyzing Excel files, spreadsheets, tabular data, or .xlsx files.` |
| Git Commit Helper | `Generate descriptive commit messages by analyzing git diffs. Use when the user asks for help writing commit messages or reviewing staged changes.` |

**Avoid:**

- `Helps with documents` — vague, no triggers
- `Processes data` — no specificity
- First-person phrasing: `I can help you process Excel files`
- Second-person phrasing: `You can use this to process Excel files`

**LLM prompt for generating recommended descriptions:**

The scope advisor LLM is instructed to generate suggested `description` values using this guidance: write in third person, state what the skill does and when to use it, include specific triggers and key terms, avoid vague nouns like `data`/`metrics`/`analysis`. Suggested descriptions follow the gerund name's implied action (e.g. for `forecasting-churned-customers`, the description states what the forecast does and when to invoke it).

---

## UX Flow

### Loading state — full-form overlay

When the user clicks **Validate**, a **medium-size loading indicator is centered over the form**. All form fields and buttons are disabled until the LLM call completes. The overlay prevents input changes mid-flight.

> Centered spinner with label: *"Analyzing skill details…"*

This replaces the previous small inline spinner, which was not visible enough.

### State 1 — Idle (before Validate is clicked)

No advisor UI is shown. The Validate button is enabled when required fields are filled.

### State 2 — Loading (Validate clicked, call in flight)

Full-form overlay with centered spinner. All fields and the Next/Validate/Cancel buttons are disabled.

### State 3 — Focused (`status: focused`)

Overlay removed. Green confirmation banner:

> ✓ *"This skill looks focused."*

Validate button disabled. Next and all fields return to normal.

### State 4 — Too broad (`status: too-broad`)

> ⚠ *"This skill might be too broad. Consider splitting into more focused skills."*

3–5 decomposition chips in the expanded panel.

### State 5 — Name needs improvement (`status: name-needs-improvement`)

> ⚠ *"We found better names for this skill."*

3–5 alternative gerund name chips, each with an improved description.

### State 6 — Description needs improvement (`status: description-needs-improvement`)

> ⚠ *"We found a clearer description for this skill."*

3–5 alternative description chips paired with a corrected name.

### State 7 — Both need improvement (`status: both-need-improvement`)

> ⚠ *"We found better names and descriptions for this skill."*

3–5 chips with both name and description improved.

The `reason` field is shown as a small diagnostic line below the banner message in states 4–7, e.g. *"The description covers two nouns: churned customers and pipeline health."*

### Expanded suggestions panel

Shows each suggested skill with:

- Gerund-named slug (e.g. `forecasting-churned-customers`)
- One-line description following effective description guidelines
- **Copy** button per suggestion (copies `name: description` to clipboard)

A **Copy all** button copies all suggestions as a formatted list.

A gerund-naming tip is shown in the footer: *"Gerund names: `verb-ing + object`"*

**Persistence:** Suggestions stay visible in the UI state after the panel is collapsed and re-expanded — they are not re-fetched until Validate is clicked again.

### Chip interaction

Each suggestion is a clickable chip. Clicking a chip:

1. Replaces the current form's **name** and **description** fields with that suggestion's values
2. Marks the chip as "current" (highlighted, with a "current" badge)
3. **Automatically sets advisor status to `focused`** — the LLM already judged this suggestion as a focused alternative; re-validating it is circular and unnecessary
4. Keeps the suggestions panel open so the user can see all suggestions and swap to another

The user can cycle through suggestions by clicking different chips. If the user manually edits name, description, or purpose after a chip selection, the advisor resets to `idle` and Validate can be clicked again for a fresh check.

### No "copy remaining" warning

The "copy remaining" warning on step 2 (previously shown when uncopied suggestions existed) is **removed**. The **Copy all** button in the suggestions panel is sufficient. The Next button advances to step 2 without any scope-advisor gate.

---

## Edge Cases

| Scenario | Behaviour |
|---|---|
| Already narrow skill | Show "looks focused" confirmation |
| Non-English input | Prompt instructs the LLM to respond in English only; suggested names must be English gerund-named slugs |
| LLM call fails / timeout | Overlay is removed, no banner shown, no error surfaced to user; form returns to normal enabled state |
| User clicks Next without validating | Advances normally — Validate is advisory, never blocking |
| Chip clicked | Advisor auto-sets to `focused`; no LLM call needed |
| Chip clicked then user manually edits fields | Advisor resets to `idle`; Validate re-arms for a fresh check |

---

## Out of Scope

- **Persistent suggestions panel** — saving suggestions to the skills list after dialog closes. Tracked in [VU-933](https://linear.app/acceleratedata/issue/VU-933).
- **Actionable suggestions** — pre-filling a new create form from a suggestion, queuing multiple workflows. Follow-up issue after VU-933.
- **Edit mode** — scope review fires in create mode only.
- **Implementation of the workflow steps or agent prompts** — this feature evaluates the skill metadata, not the generated skill content.
