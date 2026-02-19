## Skill Best Practices

Used by generate and validate agents.

### Naming and Description

- Gerund names, lowercase+hyphens, max 64 chars (e.g., `building-incremental-models`)
- Description follows the trigger pattern: `[What it does]. Use when [triggers]. [How it works]. Also use when [more triggers].` Max 1024 chars.

### SKILL.md Structure

- Under 500 lines — concise enough to answer simple questions without loading references
- If a section grows past a few paragraphs, extract to a reference file
- Reference files one level deep. TOC for files over 100 lines.
- **Required sections:** Metadata (name, description) | Overview (scope, audience, key concepts) | When to use (triggers, intent patterns) | Quick reference (top guidance) | Pointers to references (what each file covers, when to read it)

### Quality Dimensions (scored 1-5)

- **Actionability** — could a data engineer build/modify a dbt model, dlt pipeline, or CI workflow from this?
- **Specificity** — concrete Fabric/T-SQL details, exact macro names, real config values vs "configure your warehouse"
- **Domain Depth** — stack-specific gotchas vs surface-level docs rehash
- **Self-Containment** — WHAT and WHY without needing Fabric docs or dlt source code

### Content Rules

- No time-sensitive info. Consistent terminology ("Fabric" not "Synapse", "dlt" not "DLT" unless Databricks).
- Use templates for output format, examples for quality-dependent output.
- Match specificity to fragility — be most precise where mistakes are costliest.

### Skill Anti-patterns

- Windows paths
- Too many options without a clear default
- Nested reference files
- Vague descriptions like "configure your data warehouse"
- Over-explaining basic dbt/SQL that Claude already knows
- Mixing dlt (dlthub) with Databricks DLT terminology
- Generating `dbt-utils` macros instead of `tsql-utils`
