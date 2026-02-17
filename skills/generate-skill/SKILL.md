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
  - [Agent Names]
  - [Step 1: Research]
  - [Step 2: Human Gate — Review]
  - [Step 3: Detailed Research]
  - [Step 4: Human Gate — Detailed Review]
  - [Step 5: Confirm Decisions]
  - [Step 6: Generate Skill]
  - [Step 7: Validate Skill]
- [Error Recovery]
- [Progress Display]
- [Reference Files]
- [Passing Agent Instructions]

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
   | 1 | `./<skillname>/context/clarifications.md` (without Refinements) | Research complete |
   | 2 | (inferred — if step 3 output exists, step 2 was completed) | Human Review complete |
   | 3 | `./<skillname>/context/clarifications.md` (with `#### Refinements` subsections) | Detailed Research complete |
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

### Agent Names

All agents use bare names (no type prefix). Reference agents as `skill-builder:<agent-name>`:
- `skill-builder:research-orchestrator` — research orchestrator
- `skill-builder:detailed-research` — detailed research
- `skill-builder:confirm-decisions` — confirm decisions
- `skill-builder:generate-skill` — generate skill
- `skill-builder:validate-skill` — validate skill

### Step 1: Research

1. Create a task in the team task list:
   ```
   TaskCreate(subject: "Research <domain>", description: "Research relevant dimensions for this domain. Write consolidated output to ./<skillname>/context/clarifications.md")
   ```
2. Spawn the research orchestrator agent as a teammate. This agent uses an opus planner to select relevant dimensions from 18 available research agents, launches them in parallel, and consolidates results into `clarifications.md`. If the planner selects more dimensions than the configured threshold, the orchestrator spawns the scope-advisor agent instead, which writes a scope recommendation to `clarifications.md` (with `scope_recommendation: true` in frontmatter). When this happens, downstream steps (detailed research, confirm decisions, generate skill, validate skill) detect the flag and gracefully no-op.
   ```
   Task(
     subagent_type: "skill-builder:research-orchestrator",
     team_name: "skill-builder-<skillname>",
     name: "research",
     prompt: "You are on the skill-builder-<skillname> team. Claim the 'Research' task.

     Skill type: <skill_type>
     Domain: <domain>
     Context directory: ./<skillname>/context/

     <agent-instructions>
     {content of references/protocols.md}
     {content of references/file-formats.md}
     </agent-instructions>

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
   TaskCreate(subject: "Detailed research for <domain>", description: "Deep-dive research based on answered clarifications. Read answered clarifications.md and insert #### Refinements subsections in-place")
   ```
2. Spawn the detailed-research shared agent as a teammate. It reads the answered `clarifications.md` (containing user's answers from step 2) and inserts `#### Refinements` subsections under each question that warrants follow-up:
   ```
   Task(
     subagent_type: "skill-builder:detailed-research",
     team_name: "skill-builder-<skillname>",
     name: "detailed-research",
     prompt: "You are on the skill-builder-<skillname> team. Claim the 'Detailed research' task.

     Skill type: <skill_type>
     Domain: <domain>
     Context directory: ./<skillname>/context/

     <agent-instructions>
     {content of references/protocols.md}
     {content of references/file-formats.md}
     </agent-instructions>

     Read the answered clarifications.md and insert #### Refinements subsections for questions that need deeper exploration based on the user's answers.

     Return a 5-10 bullet summary of the refinement questions you generated."
   )
   ```
3. Relay the agent's summary to the user.

### Step 4: Human Gate — Detailed Review

1. Tell the user:
   "Please review and answer the refinement questions in `./<skillname>/context/clarifications.md`.

   Look for the `#### Refinements` subsections under answered questions, fill in the **Answer:** field for each refinement, then tell me when you're done."
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

     <agent-instructions>
     {content of references/file-formats.md}
     </agent-instructions>

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
     subagent_type: "skill-builder:generate-skill",
     team_name: "skill-builder-<skillname>",
     name: "generate-skill",
     prompt: "You are on the skill-builder-<skillname> team.

     Skill type: <skill_type>
     Domain: <domain>
     Context directory: ./<skillname>/context/
     Skill directory: ./<skillname>/

     <agent-instructions>
     {content of references/protocols.md}
     {content of references/content-guidelines.md}
     {content of references/best-practices.md}
     </agent-instructions>

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

     <agent-instructions>
     {content of references/protocols.md}
     {content of references/content-guidelines.md}
     {content of references/best-practices.md}
     </agent-instructions>

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

## Reference Files

Agent instructions are packaged as reference files in `$PLUGIN_ROOT/skills/generate-skill/references/`. These contain the protocols, file formats, content guidelines, and best practices that agents need during execution.

| File | Contains | Used by steps |
|------|----------|---------------|
| `protocols.md` | Sub-agent spawning rules, output handling | 1, 3, 6, 7 |
| `file-formats.md` | Clarifications and Decisions file format specs | 1, 3, 5 |
| `content-guidelines.md` | Skill Users, Content Principles, Output Paths | 6, 7 |
| `best-practices.md` | Skill structure rules, validation checklist, anti-patterns | 6, 7 |

## Passing Agent Instructions

Before dispatching any sub-agent, read the relevant reference files (per the table above) and include their content in the sub-agent prompt within `<agent-instructions>` tags. This ensures agents have file formats, protocols, and best practices regardless of the user's local environment.

Example:
```
Task(
  subagent_type: "skill-builder:...",
  prompt: "...

  <agent-instructions>
  {content of references/protocols.md}
  {content of references/file-formats.md}
  </agent-instructions>

  Return ...")
```
