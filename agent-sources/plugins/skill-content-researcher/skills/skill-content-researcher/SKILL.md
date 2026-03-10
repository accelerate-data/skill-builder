---
name: skill-content-researcher
description: >
  User-invocable wrapper that runs plugin-owned research and returns canonical research_output (plus derived counts).
user_invocable: true
argument_hint: >
  No arguments. This skill will ask you a few questions (you can skip any optional ones).
---

# Skill Content Researcher Plugin

This plugin embeds the internal `research` skill under `skills/research/` and exposes a stable, user-invocable entrypoint
that delegates to the plugin agent `skill-content-researcher:research-agent`.

## Runtime contract (inputs → output)

- Input:
  - Collected interactively via `AskUserQuestion`
- Output (JSON only):
  - `research_output` (canonical clarifications object)
  - `dimensions_selected` (integer)
  - `question_count` (integer)

## Step 1: User Inputs

Use `AskUserQuestion` to collect the inputs below. Every question must include:

- `Skip` (so the user can leave it blank)
- `Other` (so the user can enter free text when the options don’t fit)

1. Ask for `purpose` as a single-select with these options (plus `Skip` and `Other`):

   - Business process knowledge (`domain`)
   - Source system customizations (`source`)
   - Organization specific data engineering standards (`data-engineering`)
   - Organization specific Azure or Fabric standards (`platform`)
   - Skip
   - Other

2. Ask for `description` as a single-select with: `Skip` and `Other` (free text).
3. Ask for `industry` as a single-select with: `Skip` and `Other` (free text).
4. Ask for `function_role` as a single-select with: `Skip` and `Other` (free text).

## Step 2: Call the agent to research and return results

1. Construct a markdown “user context” block from the collected fields (do not ask the user for a blob). Use this structure:

    - `## User Context`
    - `### Skill`
      - `**Purpose**: <purpose>` (omit if skipped)
      - `**Description**: <description>` (omit if skipped)
    - `### About You`
      - `**Industry**: <industry>` (omit if skipped)
      - `**Function**: <function_role>` (omit if skipped)

2. Construct the agent input JSON internally with:

   - `purpose`: the selected purpose token (or empty string if skipped)
   - `skill_name`: a placeholder string (e.g. `"skill"`) — do not prompt the user for this
   - `user_context`: the constructed markdown block

3. Invoke `skill-content-researcher:research-agent`.
4. Return JSON only, exactly as returned by the agent.
