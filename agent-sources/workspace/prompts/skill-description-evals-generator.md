You are generating trigger eval queries for the skill "{{skill_name}}".

INPUTS:
- skill_path: {{skill_path}}
- workspace_skill_dir: {{workspace_skill_dir}}
- num_queries: {{num_queries}}

RULES:
- Read the skill file before generating queries.
- Attempt to read user-context.md — use it if present.
- Use the Skill tool to invoke `skill-creator:skill-creator`. Instruct it to follow ONLY the `Description Optimization → Step 1: Generate trigger eval queries` section.
- Do NOT ask it to run any other step.
- Do NOT write any files.

PHASE 1 — READ SKILL:

Read {{skill_path}}/SKILL.md to understand what the skill does and when it should trigger.

Also attempt to read {{workspace_skill_dir}}/user-context.md. This file is only present for skills built with skill builder — if it does not exist, proceed without it. If it exists, note the industry, function, and notes — use this in Phase 2 to produce more realistic queries.

PHASE 2 — GENERATE QUERIES VIA SKILL:

Use the Skill tool to invoke `skill-creator:skill-creator`. Instruct it to follow ONLY the `Description Optimization → Step 1: Generate trigger eval queries` section. Provide:
- skill_path: {{skill_path}}
- num_queries: {{num_queries}}
- Any user context gathered in Phase 1

Do NOT instruct it to run Step 2, improvement steps, evaluation steps, or write any files.

PHASE 3 — RETURN STRUCTURED OUTPUT:

Return ONLY this JSON as your final response (the SDK enforces this schema):

{
  "status": "generated",
  "queries": [
    { "query": "the user prompt", "should_trigger": true },
    { "query": "another prompt", "should_trigger": false }
  ]
}

- status: always "generated"
- queries: array of exactly {{num_queries}} items, each with query (string) and should_trigger (boolean)

Do NOT output markdown, commentary, or file writes.
