### Scenario 1: Standards Skill Skeleton
**Prompt**: Create a new organization-specific data engineering standards skill for dbt on Fabric. Keep it concise and reference-heavy.
**Expected behavior**: Produces a standards-oriented SKILL.md with Overview, Quick Reference, Getting Started (5-8 steps), Decision Dependency Map, and reference pointers.
**Pass criteria**: Includes all required sections in the correct order and keeps procedural details out of long inline prose.

### Scenario 2: Progressive Disclosure Refactor
**Prompt**: Refactor this verbose SKILL.md so it follows progressive disclosure and avoids context bloat.
**Expected behavior**: Moves long variant-specific guidance into `references/` while preserving high-signal operational rules in SKILL.md.
**Pass criteria**: SKILL.md remains under 500 lines and clearly points to reference files for deeper detail.

### Scenario 3: Anti-Pattern Cleanup
**Prompt**: Review this skill and remove anti-patterns: duplicated trigger sections, basic SQL tutorials, and process artifacts in the output directory.
**Expected behavior**: Removes redundant trigger/body duplication, cuts commodity explanations, and relocates process artifacts to `context/`.
**Pass criteria**: No "When to Use This Skill" body section, no process artifacts in skill output, and quality dimensions can be scored >=4.
