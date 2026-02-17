## Skill Users
Data/analytics engineers who need domain context to model silver and gold layer tables. They know SQL/dbt — the skill provides WHAT and WHY (entities, metrics, business rules, pitfalls), not HOW.

## Content Principles
1. **Omit what LLMs already know** — standard schemas, tool docs, well-documented systems. Test: "Would Claude know this without the skill?"
2. **Focus on hard-to-find domain knowledge** — industry rules, edge cases, company-specific metrics, non-obvious entity relationships
3. **Guide WHAT and WHY, not HOW** — "Your customer dimension needs X because..." not "Create table dim_account with columns..." Exception: be prescriptive when exactness matters (metric formulas, business rule logic).

## Output Paths
The coordinator provides **context directory** and **skill output directory** paths. All directories already exist — never run `mkdir` or create directories. Never run `ls` or list directories. Read only the specific files named in your instructions and write directly to the provided paths. The skill output structure is `SKILL.md` at root + `references/` subfolder.
