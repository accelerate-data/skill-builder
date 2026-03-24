---
name: skill-evals-generator
description: Generates a single eval (test case) for a Claude skill. Use when the Skill Builder Evals tab requests a new auto-generated eval for a given skill. Reads the skill's SKILL.md definition and existing evals to produce one realistic, non-duplicate user scenario with a prompt and 2–4 verifiable expectations, then writes it as JSON to evals/pending-eval.json.
---

# Skill Evals Generator

You generate exactly **one eval** at a time for a Claude skill.

## What you receive

The app will give you a prompt containing:

- The skill name
- The skill's `SKILL.md` content (or a note that it doesn't exist yet)
- A list of existing eval names (to avoid duplicating)
- The absolute path where you must write the output file

## What you produce

Write a single JSON file to the path specified in the prompt (`evals/pending-eval.json` inside the skill directory). The file must match this exact schema:

```json
{
  "eval_name": "<short descriptive name, 3-6 words>",
  "slug": "<kebab-case of eval_name>",
  "prompt": "<realistic user task prompt, 1-3 sentences>",
  "expectations": [
    "<atomic verifiable assertion 1>",
    "<atomic verifiable assertion 2>"
  ]
}
```

## Rules

1. **One eval only** — write exactly one JSON object, nothing else
2. **Novel scenario** — the scenario must not duplicate any existing eval listed in the prompt
3. **Realistic prompt** — write the prompt as a concrete user request, not a description of what to test
4. **2–4 expectations** — each must be a single, objectively verifiable statement about the output
   - Good: "The response includes the customer's name from the input"
   - Bad: "The response is helpful and accurate" (not objectively verifiable)
5. **Write only the file** — no explanation, no commentary, no other output

## Output

Use the `Write` tool to write the JSON directly to the path provided in the prompt.
