# Skill Builder — Agent Instructions

Auto-loaded into every agent's system prompt. Do not read manually.

## Protocols

### Sub-agent Spawning
Use the Task tool. Launch ALL Task calls in the **same turn** so they run in parallel. Standard sub-agent config: `model: "sonnet"`, `mode: "bypassPermissions"`. Name sub-agents descriptively (e.g., `"writer-<topic>"`, `"reviewer"`, `"tester-N"`).

Sub-agents return their complete output as text — they do not write files. The orchestrator captures the returned text and passes it to downstream agents by including it directly in the prompt. Include this directive in every sub-agent prompt:
> Do not provide progress updates. Return your complete output as text. Do not write files.

---

## Skill Users
Data/analytics engineers who need domain context to model silver and gold layer tables. They know SQL/dbt — the skill provides WHAT and WHY (entities, metrics, business rules, pitfalls), not HOW.

## Content Principles
1. **Omit what LLMs already know** — standard schemas, tool docs, well-documented systems. Test: "Would Claude know this without the skill?"
2. **Focus on hard-to-find domain knowledge** — industry rules, edge cases, company-specific metrics, non-obvious entity relationships
3. **Guide WHAT and WHY, not HOW** — "Your customer dimension needs X because..." not "Create table dim_account with columns..." Exception: be prescriptive when exactness matters (metric formulas, business rule logic).

## Output Paths
The coordinator provides **context directory** and **skill output directory** paths. All directories already exist — never run `mkdir` or create directories. Never run `ls` or list directories. Read only the specific files named in your instructions and write directly to the provided paths. The skill output structure is `SKILL.md` at root + `references/` subfolder.

## File Formats

IMPORTANT: All output files use YAML frontmatter (`---` delimited, first thing in file). Always include frontmatter with updated counts when rewriting.

### Clarifications (`clarifications.md` and `clarifications-detailed.md`)
```
---
question_count: 12
sections: ["Entity Model", "Metrics & KPIs"]
duplicates_removed: 3  # clarifications.md only (post-consolidation)
---
## [Section]
### Q1: [Title]
**Question**: [text]
**Choices**:
  a) [Choice] — [rationale]
  b) [Choice] — [rationale]
  c) Other (please specify)
**Recommendation**: [letter] — [why]
**Answer**: [PM's choice, or empty for unanswered]
```
**Auto-fill rule:** Empty `**Answer**:` fields → use the `**Recommendation**:` as the answer. Do not ask for clarification — use the recommendation and proceed.

### Decisions (`decisions.md`)
Clean snapshot, not a log. Write the complete file from scratch each time.
```
---
decision_count: 5
conflicts_resolved: 2
round: 2
---
### D1: [Title]
- **Question**: [original question]
- **Decision**: [chosen answer]
- **Implication**: [design impact]
- **Status**: resolved | conflict-resolved | needs-review
```
Frontmatter counts give the user an at-a-glance summary: total decisions, how many had contradictions that the agent resolved (review these first). Each decision's `**Status**` field indicates whether it was straightforward (`resolved`), required the agent to pick between contradicting answers (`conflict-resolved`), or needs user input (`needs-review`).

---

## Skill Best Practices

Used by validate agents to check skill quality.

**Core:** Concise (only add context Claude doesn't have). Match specificity to fragility. Test with all target models.

**Structure:** Gerund names (`processing-pdfs`, lowercase+hyphens, max 64 chars). Description follows the trigger pattern: `[What it does]. Use when [user intent triggers]. [How it works at a high level]. Also use when [additional trigger phrases].` Example: `"Audit and improve CLAUDE.md files in repositories. Use when user asks to check, audit, or fix CLAUDE.md files. Scans for all CLAUDE.md files, evaluates quality, outputs report, then makes targeted updates. Also use when the user mentions 'CLAUDE.md maintenance'."` Max 1024 chars. SKILL.md body under 500 lines — concise enough to answer simple questions without loading reference files, with clear pointers for when to go deeper. If a section grows past a few paragraphs, it belongs in a reference file. Reference files one level deep from SKILL.md. TOC for files over 100 lines.

**SKILL.md required sections:** Metadata block (name, description, optionally author/created/modified) | Overview (scope, audience, key concepts) | When to use (trigger conditions, user intent patterns) | Quick reference (most important guidance for simple questions) | Pointers to references (description of each file and when to read it).

**Quality dimensions** (each scored 1-5): Actionability (could an engineer follow this?), Specificity (concrete details vs generic boilerplate), Domain Depth (hard-to-find knowledge vs surface-level), Self-Containment (WHAT and WHY without external lookups).

**Content:** No time-sensitive info. Consistent terminology. Use templates for output format, examples for quality-dependent output. Feedback loops: validate, fix, repeat.

**Checklist:** Specific description with key terms | under 500 lines | separate reference files if needed | no stale info | consistent terms | concrete examples | one-level refs | progressive disclosure | clear workflow steps | 3+ evaluations | tested with target models and real scenarios

**Anti-patterns:** Windows paths | too many options (default + escape hatch) | nested refs | vague descriptions | over-explaining what Claude knows

## Customization

Add your workspace-specific instructions below. This section is preserved across app updates and skill changes.
