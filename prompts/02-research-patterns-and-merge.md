# Orchestrator: Research Domain Patterns, Data Modeling & Merge

## Your Role
Orchestrate parallel research into business patterns and data modeling by spawning sub-agents via the Task tool, then have a merger sub-agent combine the results.

## Context
- Read `shared-context.md` for the skill builder's purpose and file formats.
- The coordinator tells you the **domain**, **skill name**, **skill directory**, and **context directory**.

## Phase 1: Parallel Research

Spawn two sub-agents via the **Task tool** — both in the **same turn** so they run in parallel:

**Sub-agent 1: Business Patterns & Edge Cases** (`name: "patterns-researcher"`, `model: "sonnet"`, `mode: "bypassPermissions"`)

Prompt it to:
- Read `prompts/shared-context.md` and `prompts/03a-research-business-patterns.md` and follow the instructions
- The domain is: [pass the domain]
- The answered domain concepts file is at: [skill_dir]/context/clarifications-concepts.md
- Write output to: [skill_dir]/context/clarifications-patterns.md
- When finished, respond with only a single line: Done — wrote clarifications-patterns.md ([N] questions). Do not echo file contents.

**Sub-agent 2: Data Modeling & Source Systems** (`name: "data-researcher"`, `model: "sonnet"`, `mode: "bypassPermissions"`)

Prompt it to:
- Read `prompts/shared-context.md` and `prompts/03b-research-data-modeling.md` and follow the instructions
- The domain is: [pass the domain]
- The answered domain concepts file is at: [skill_dir]/context/clarifications-concepts.md
- Write output to: [skill_dir]/context/clarifications-data.md
- When finished, respond with only a single line: Done — wrote clarifications-data.md ([N] questions). Do not echo file contents.

## Phase 2: Merge

After both sub-agents return, spawn a fresh **merger** sub-agent via the Task tool (`name: "merger"`, `model: "haiku"`, `mode: "bypassPermissions"`).

Prompt it to:
- Read `prompts/shared-context.md` and `prompts/04-merge-clarifications.md` and follow the instructions
- The context directory is: [skill_dir]/context/
- Write merged output to: [skill_dir]/context/clarifications.md
- When finished, respond with only a single line: Done — wrote clarifications.md ([N] questions). Do not echo file contents.

## Output
Three files in the context directory: `clarifications-patterns.md`, `clarifications-data.md`, and `clarifications.md`.

When all three sub-agents have completed, respond with only a single line: Done — research and merge complete. Do not echo file contents.
