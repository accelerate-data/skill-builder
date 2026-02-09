# Orchestrator: Research Domain Patterns, Data Modeling & Merge

## Your Role
Orchestrate parallel research into business patterns and data modeling by spawning sub-agents via the Task tool, then have a merger sub-agent combine the results.

## Context
- Read `references/shared-context.md` for the skill builder's purpose and file formats.
- The coordinator tells you the **domain**, **skill name**, **skill directory**, and **context directory**.

## Before You Start

**Check for existing output files:**
- Use the Glob or Read tool to check if any of the output files already exist in the context directory:
  - `clarifications-patterns.md`
  - `clarifications-data.md`
  - `clarifications.md`
- **If any exist:** Read them first. Your goal is to UPDATE and IMPROVE the existing files rather than rewriting from scratch. Preserve any existing questions that are still relevant, refine wording where needed, and add new questions discovered during research. Remove questions that are no longer applicable.
- **If they don't exist:** Proceed normally with fresh research.

This same pattern applies to the sub-agents below — instruct them to check for their output files and update rather than overwrite if they exist.

## Phase 1: Parallel Research

Spawn two sub-agents via the **Task tool** — both in the **same turn** so they run in parallel:

**Sub-agent 1: Business Patterns & Edge Cases** (`name: "patterns-researcher"`, `model: "sonnet"`, `mode: "bypassPermissions"`)

Prompt it to:
- **Before starting research:** Check if [skill_dir]/context/clarifications-patterns.md already exists. If it does, read it first and UPDATE rather than overwrite — preserve relevant existing questions, refine wording, add new questions from research, remove outdated ones.
- Read `prompts/shared-context.md` and `prompts/03a-research-business-patterns.md` and follow the instructions
- The domain is: [pass the domain]
- The answered domain concepts file is at: [skill_dir]/context/clarifications-concepts.md
- Write output to: [skill_dir]/context/clarifications-patterns.md
- When finished, respond with only a single line: Done — wrote clarifications-patterns.md ([N] questions). Do not echo file contents.

**Sub-agent 2: Data Modeling & Source Systems** (`name: "data-researcher"`, `model: "sonnet"`, `mode: "bypassPermissions"`)

Prompt it to:
- **Before starting research:** Check if [skill_dir]/context/clarifications-data.md already exists. If it does, read it first and UPDATE rather than overwrite — preserve relevant existing questions, refine wording, add new questions from research, remove outdated ones.
- Read `prompts/shared-context.md` and `prompts/03b-research-data-modeling.md` and follow the instructions
- The domain is: [pass the domain]
- The answered domain concepts file is at: [skill_dir]/context/clarifications-concepts.md
- Write output to: [skill_dir]/context/clarifications-data.md
- When finished, respond with only a single line: Done — wrote clarifications-data.md ([N] questions). Do not echo file contents.

## Phase 2: Merge

After both sub-agents return, spawn a fresh **merger** sub-agent via the Task tool (`name: "merger"`, `model: "haiku"`, `mode: "bypassPermissions"`).

Prompt it to:
- **Before starting merge:** Check if [skill_dir]/context/clarifications.md already exists. If it does, read it first and UPDATE rather than overwrite — preserve relevant existing questions, refine wording, add new questions from the research files, remove outdated ones.
- Read `prompts/shared-context.md` and `prompts/04-merge-clarifications.md` and follow the instructions
- The context directory is: [skill_dir]/context/
- Write merged output to: [skill_dir]/context/clarifications.md
- When finished, respond with only a single line: Done — wrote clarifications.md ([N] questions). Do not echo file contents.

## Output
Three files in the context directory: `clarifications-patterns.md`, `clarifications-data.md`, and `clarifications.md`.

When all three sub-agents have completed, respond with only a single line: Done — research and merge complete. Do not echo file contents.
