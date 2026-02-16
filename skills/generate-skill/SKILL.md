---
name: generate-skill
description: Generate domain-specific Claude skills through a guided multi-agent workflow. Use when user asks to create, build, or generate a new skill for data/analytics engineers. Orchestrates research, clarification review, decision-making, skill generation, and validation phases with human review gates. Also use when the user mentions "new skill", "skill builder", or "create a domain skill".
---

# Skill Builder — Coordinator

You are the coordinator for the Skill Builder workflow. You orchestrate a 7-step process to create skills for data/analytics engineers. Skills can be platform, domain, source, or data-engineering focused.

## Contents
- [Path Resolution]
- [Context Conservation Rules]
- [Single-Skill Mode]
- [Workflow]
  - [Step 0: Initialization]
  - [Agent Type Prefix]
  - [Step 1: Research]
  - [Step 2: Human Gate — Review]
  - [Step 3: Detailed Research]
  - [Step 4: Human Gate — Detailed Review]
  - [Step 5: Confirm Decisions]
  - [Step 6: Generate Skill]
  - [Step 7: Validate Skill]
- [Error Recovery]
- [Progress Display]
- [Agent Instructions]
  - [Protocols]
  - [Skill Users]
  - [Content Principles]
  - [Output Paths]
- [File Formats]
  - [Clarifications]
  - [Decisions]
- [Skill Best Practices]

## Path Resolution

Set the plugin root at the start of the session:

PLUGIN_ROOT=$(echo $CLAUDE_PLUGIN_ROOT)

Output layout in the user's CWD:
- `./<skillname>/context/` — working files (clarifications, decisions, logs)
- `./<skillname>/` — the deployable skill (SKILL.md + references/)

## Context Conservation Rules

Never read agent output files into your context — relay the summary each agent returns.
Prefer subagents over inline work. Dispatch independent steps as parallel Task calls.

## Single-Skill Mode

Only one skill is active at a time. The coordinator works on the skill the user names and does not switch between skills mid-session.

## Workflow

### Step 0: Initialization

1. Ask the user: "What type of skill is this?
     1. Platform — Tool/platform-specific (dbt, Fabric, Databricks)
     2. Domain — Business domain knowledge (Finance, Marketing, Supply Chain)
     3. Source — Source system extraction patterns (Salesforce, SAP, Workday)
     4. Data Engineering — Technical patterns (SCD Type 2, Incremental Loads)"

   Store the selection as kebab-case: `platform`, `domain`, `source`, `data-engineering`. Default to `domain` if the user's response is unclear.

2. Ask a type-appropriate follow-up question:
   - Platform: "Which platform or tool?" (e.g., dbt, Fabric, Databricks)
   - Domain: "What functional domain?" (e.g., sales pipeline, HR analytics)
   - Source: "Which source system?" (e.g., Salesforce, SAP, Workday)
   - Data Engineering: "Which pipeline pattern?" (e.g., SCD Type 2, CDC, Incremental)

   Store the answer as `<domain>`.

3. Derive the skill name from the answer (lowercase, kebab-case, e.g., "sales-pipeline")
4. Confirm with the user: "I'll create the skill as `<skillname>`. Does this name work?"

5. **Detect start mode** by scanning the filesystem for output artifacts:

   Check for these files in order to determine the highest completed step:

   | Step | Output File | Meaning |
   |------|------------|---------|
   | 1 | `./<skillname>/context/clarifications.md` | Research complete |
   | 2 | (inferred — if step 3 output exists, step 2 was completed) | Human Review complete |
   | 3 | `./<skillname>/context/clarifications-detailed.md` | Detailed Research complete |
   | 4 | (inferred — if step 5 output exists, step 4 was completed) | Human Review — Detailed complete |
   | 5 | `./<skillname>/context/decisions.md` | Confirm Decisions complete |
   | 6 | `./<skillname>/SKILL.md` | Generate Skill complete |
   | 7 | `./<skillname>/context/agent-validation-log.md` AND `./<skillname>/context/test-skill.md` | Validate Skill complete |

   **Mode A — Resume** (any output files from the table above exist):
   The user is continuing a previous session.
   - Scan the output files above from step 7 down to step 1. The highest step whose output file exists and has content is the last completed step.
   - Show the user which step was last completed.
   - If the `skill_type` is not known from the conversation, ask the user for the skill type using the prompt in item 1 above.
   - Ask: "Continue from step N+1, or start fresh (this deletes all progress)?"
   - If continue: skip to the next step after the highest completed step.
   - If start fresh: delete `./<skillname>/` then fall through to Mode C.

   **Mode B — Modify existing skill** (`./<skillname>/SKILL.md` exists but NO context/ output files exist):
   The user has a finished skill and wants to improve it.
   - Tell the user: "Found an existing skill at `./<skillname>/`. I'll start from the confirm decisions step so you can refine it."
   - Determine `skill_type`: inspect the existing `./<skillname>/SKILL.md` for a skill type indicator. If none is found, ask the user for the skill type using the prompt in item 1 above.
   - Create `./<skillname>/context/` if it doesn't exist.
   - Skip to Step 5 (Confirm Decisions). The confirm-decisions agent will read the existing skill files + any context/ files to identify gaps and produce updated decisions, then the generate-skill agent will revise the skill.

   **Mode C — Scratch** (no `./<skillname>/` directory and no output files):
   Fresh start — full workflow.
   - Create the directory structure:
     ```
     ./<skillname>/
     ├── context/
     └── references/
     ```

6. Create the agent team:
   ```
   TeamCreate(team_name: "skill-builder-<skillname>", description: "Building <domain> skill")
   ```

### Agent Type Prefix

The `skill_type` collected during initialization (or confirmed on resume) determines which agent variants to use.

Derive the prefix once after initialization (or resume) and use it for all subsequent agent dispatches:

- If `skill_type` is `data-engineering`, set `type_prefix` to `de`
- Otherwise, set `type_prefix` to the `skill_type` value as-is (e.g., `platform`, `domain`, `source`)

Type-specific agents are referenced as `skill-builder:{type_prefix}-<agent>`. Shared agents are referenced as `skill-builder:<agent>` (no type prefix).

### Step 1: Research

1. Create a task in the team task list:
   ```
   TaskCreate(subject: "Research <domain>", description: "Research concepts, practices, and implementation. Write consolidated output to ./<skillname>/context/clarifications.md")
   ```
2. Spawn the research orchestrator agent as a teammate. This single agent internally handles all sub-orchestration (concepts, practices, implementation, consolidation) and writes `clarifications.md` to the context directory:
   ```
   Task(
     subagent_type: "skill-builder:{type_prefix}-research",
     team_name: "skill-builder-<skillname>",
     name: "research",
     prompt: "You are on the skill-builder-<skillname> team. Claim the 'Research' task.

     Skill type: <skill_type>
     Domain: <domain>
     Context directory: ./<skillname>/context/

     Return a 5-10 bullet summary of the key questions you generated."
   )
   ```
3. Relay the agent's summary to the user.

### Step 2: Human Gate — Review

1. Tell the user:
   "Please review and answer the questions in `./<skillname>/context/clarifications.md`.

   Open the file, fill in the **Answer:** field for each question, then tell me when you're done."
2. Wait for the user to confirm they've answered the questions.

### Step 3: Detailed Research

1. Create a task in the team task list:
   ```
   TaskCreate(subject: "Detailed research for <domain>", description: "Deep-dive research based on answered clarifications. Write to ./<skillname>/context/clarifications-detailed.md")
   ```
2. Spawn the detailed-research shared agent as a teammate. It reads `clarifications.md` and writes `clarifications-detailed.md` in the context directory:
   ```
   Task(
     subagent_type: "skill-builder:detailed-research",
     team_name: "skill-builder-<skillname>",
     name: "detailed-research",
     prompt: "You are on the skill-builder-<skillname> team. Claim the 'Detailed research' task.

     Skill type: <skill_type>
     Domain: <domain>
     Context directory: ./<skillname>/context/

     Return a 5-10 bullet summary of the detailed questions you generated."
   )
   ```
3. Relay the agent's summary to the user.

### Step 4: Human Gate — Detailed Review

1. Tell the user:
   "Please review and answer the detailed questions in `./<skillname>/context/clarifications-detailed.md`.

   Open the file, fill in the **Answer:** field for each question, then tell me when you're done."
2. Wait for the user to confirm.

### Step 5: Confirm Decisions

1. Spawn the confirm-decisions shared agent:
   ```
   Task(
     subagent_type: "skill-builder:confirm-decisions",
     team_name: "skill-builder-<skillname>",
     name: "confirm-decisions",
     prompt: "You are on the skill-builder-<skillname> team.

     Skill type: <skill_type>
     Context directory: ./<skillname>/context/

     Analyze all answered clarifications and produce decisions.
     Think thoroughly about contradictions, gaps, and implications across all provided answers.
     Consider multiple interpretations where answers are ambiguous.
     Verify your analysis is internally consistent before presenting conclusions.
     The agent handles conditional user interaction internally:
     - If contradictions/ambiguities/conflicts are found, it presents numbered options and waits for the user to choose
     - If no issues, it proceeds directly to writing decisions
     Write: ./<skillname>/context/decisions.md

     Return your reasoning summary (key conclusions, assumptions, conflicts, follow-ups)."
   )
   ```
2. Relay the reasoning summary to the user.
3. **Validate** that `./<skillname>/context/decisions.md` exists. If missing, run the confirm-decisions agent again.
4. **Human Gate**: "Do you agree with these decisions? Any corrections?"
5. If the user has corrections, send them to the confirm-decisions agent via SendMessage and let it re-analyze.
6. Once confirmed, proceed.

### Step 6: Generate Skill

1. Spawn the generate-skill agent:
   ```
   Task(
     subagent_type: "skill-builder:{type_prefix}-generate-skill",
     team_name: "skill-builder-<skillname>",
     name: "generate-skill",
     prompt: "You are on the skill-builder-<skillname> team.

     Skill type: <skill_type>
     Domain: <domain>
     Context directory: ./<skillname>/context/
     Skill directory: ./<skillname>/

     Plan the skill structure before writing. Verify all decisions are reflected in the output.
     Read decisions.md and create the skill files.
     Return the proposed folder structure and a summary of what was created."
   )
   ```
2. Relay the structure and summary to the user.
3. **Human Gate**: "Does this structure look right? Any changes needed?"

### Step 7: Validate Skill

1. Spawn the validate-skill shared agent:
   ```
   Task(
     subagent_type: "skill-builder:validate-skill",
     team_name: "skill-builder-<skillname>",
     name: "validate-skill",
     prompt: "You are on the skill-builder-<skillname> team.

     Skill type: <skill_type>
     Domain: <domain>
     Skill directory: ./<skillname>/
     Context directory: ./<skillname>/context/

     Validate the skill against best practices and generate test prompts to evaluate coverage.
     Auto-fix straightforward issues found during validation.

     Return summary: validation checks (passed/fixed/needs review) and test results (total/passed/partial/failed)."
   )
   ```
2. Relay results to the user.
3. **Human Gate**: "Review the validation log at `./<skillname>/context/agent-validation-log.md` and test results at `./<skillname>/context/test-skill.md`. Would you like to loop back to the generate step to address gaps, or finalize?"
4. If rebuild: go back to Step 6.
5. If finalize:
   a. Package the skill:
      ```bash
      cd ./<skillname> && zip -r ../<skillname>.skill . && cd -
      ```
   b. Shut down all teammates before deleting the team. Send a `shutdown_request` to each agent that was spawned during the workflow:
      ```
      SendMessage(type: "shutdown_request", recipient: "research", content: "Workflow complete, shutting down.")
      SendMessage(type: "shutdown_request", recipient: "detailed-research", content: "Workflow complete, shutting down.")
      SendMessage(type: "shutdown_request", recipient: "confirm-decisions", content: "Workflow complete, shutting down.")
      SendMessage(type: "shutdown_request", recipient: "generate-skill", content: "Workflow complete, shutting down.")
      SendMessage(type: "shutdown_request", recipient: "validate-skill", content: "Workflow complete, shutting down.")
      ```
      Wait for each agent to acknowledge the shutdown before proceeding. If an agent is already shut down, the request is a no-op.
   c. Clean up the team:
      ```
      TeamDelete()
      ```
   d. Tell the user:
      "Skill built successfully!
      - Skill files: `./<skillname>/`
      - Archive: `./<skillname>.skill`
      - Working files: `./<skillname>/context/`"

## Error Recovery

If an agent fails, retry once with the error context. If it fails again, report to the user.

## Progress Display

At the start of each step, display progress to the user:
```
[Step N/7] <Step name>
```

## Agent Instructions

### Protocols

#### Sub-agent Spawning
Use the Task tool. Launch ALL Task calls in the **same turn** so they run in parallel. Standard sub-agent config: `model: "sonnet"`, `mode: "bypassPermissions"`. Name sub-agents descriptively (e.g., `"writer-<topic>"`, `"reviewer"`, `"tester-N"`).

Sub-agents return their complete output as text — they do not write files. The orchestrator captures the returned text and passes it to downstream agents by including it directly in the prompt. Include this directive in every sub-agent prompt:
> Do not provide progress updates. Return your complete output as text. Do not write files.

### Skill Users
Data/analytics engineers who need domain context to model silver and gold layer tables. They know SQL/dbt — the skill provides WHAT and WHY (entities, metrics, business rules, pitfalls), not HOW.

### Content Principles
1. **Omit what LLMs already know** — standard schemas, tool docs, well-documented systems. Test: "Would Claude know this without the skill?"
2. **Focus on hard-to-find domain knowledge** — industry rules, edge cases, company-specific metrics, non-obvious entity relationships
3. **Guide WHAT and WHY, not HOW** — "Your customer dimension needs X because..." not "Create table dim_account with columns..." Exception: be prescriptive when exactness matters (metric formulas, business rule logic).

### Output Paths
The coordinator provides **context directory** and **skill output directory** paths. Write files only to these directories — no extra subdirectories. The skill output structure is `SKILL.md` at root + `references/` subfolder.

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
Clean snapshot, not a log. Each update rewrites the file, merging existing + new decisions. Superseded entries are replaced (keep D-number), new entries added at end.
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

## Skill Best Practices

Used by validate agents to check skill quality.

**Core:** Concise (only add context Claude doesn't have). Match specificity to fragility. Test with all target models.

**Structure:** Gerund names (`processing-pdfs`, lowercase+hyphens, max 64 chars). Description follows the trigger pattern: `[What it does]. Use when [user intent triggers]. [How it works at a high level]. Also use when [additional trigger phrases].` Example: `"Audit and improve CLAUDE.md files in repositories. Use when user asks to check, audit, or fix CLAUDE.md files. Scans for all CLAUDE.md files, evaluates quality, outputs report, then makes targeted updates. Also use when the user mentions 'CLAUDE.md maintenance'."` Max 1024 chars. SKILL.md body under 500 lines — concise enough to answer simple questions without loading reference files, with clear pointers for when to go deeper. If a section grows past a few paragraphs, it belongs in a reference file. Reference files one level deep from SKILL.md. TOC for files over 100 lines.

**SKILL.md required sections:** Metadata block (name, description, optionally author/created/modified) | Overview (scope, audience, key concepts) | When to use (trigger conditions, user intent patterns) | Quick reference (most important guidance for simple questions) | Pointers to references (description of each file and when to read it).

**Quality dimensions** (each scored 1-5): Actionability (could an engineer follow this?), Specificity (concrete details vs generic boilerplate), Domain Depth (hard-to-find knowledge vs surface-level), Self-Containment (WHAT and WHY without external lookups).

**Content:** No time-sensitive info. Consistent terminology. Use templates for output format, examples for quality-dependent output. Feedback loops: validate, fix, repeat.

**Checklist:** Specific description with key terms | under 500 lines | separate reference files if needed | no stale info | consistent terms | concrete examples | one-level refs | progressive disclosure | clear workflow steps | 3+ evaluations | tested with target models and real scenarios

**Anti-patterns:** Windows paths | too many options (default + escape hatch) | nested refs | vague descriptions | over-explaining what Claude knows
