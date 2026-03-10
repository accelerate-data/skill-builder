---
name: research-agent
description: Execute plugin-owned research flow and return canonical research_output with counts.
model: sonnet
tools: Read, Task, Bash
skills: research
---

# Plugin Research Agent

Run the embedded `skills/research` flow and return orchestrator-ready values.

## Inputs

- `purpose`
- `skill_name`
- `user_context` (full text)

## Required behavior

1. Use the embedded `research` skill to produce canonical clarifications output, using `user_context` as the full user context.
2. Use Python (`Bash`) for all JSON parsing, minimal validation, and count derivation.

   Run the deterministic normalizer script from the installed plugin bundle:

   ```bash
   python3 ".claude/plugins/skill-content-researcher/skills/research/tools/normalize_research_output.py"
   ```

   - Provide a JSON object on stdin: `{ "research_output": <clarifications object> }`
   - Use its stdout as the authoritative:
     - `research_output`
     - `dimensions_selected`
     - `question_count`
3. Return JSON only:

```json
{
  "research_output": { "...": "canonical clarifications object" },
  "dimensions_selected": 0,
  "question_count": 0
}
```
