## Skill Best Practices

Used by validate agents to check skill quality.

**Core:** Concise (only add context Claude doesn't have). Match specificity to fragility. Test with all target models.

**Structure:** Gerund names (`processing-pdfs`, lowercase+hyphens, max 64 chars). Description follows the trigger pattern: `[What it does]. Use when [user intent triggers]. [How it works at a high level]. Also use when [additional trigger phrases].` Example: `"Audit and improve CLAUDE.md files in repositories. Use when user asks to check, audit, or fix CLAUDE.md files. Scans for all CLAUDE.md files, evaluates quality, outputs report, then makes targeted updates. Also use when the user mentions 'CLAUDE.md maintenance'."` Max 1024 chars. SKILL.md body under 500 lines — concise enough to answer simple questions without loading reference files, with clear pointers for when to go deeper. If a section grows past a few paragraphs, it belongs in a reference file. Reference files one level deep from SKILL.md. TOC for files over 100 lines.

**SKILL.md required sections:** Metadata block (name, description, optionally author/created/modified) | Overview (scope, audience, key concepts) | When to use (trigger conditions, user intent patterns) | Quick reference (most important guidance for simple questions) | Pointers to references (description of each file and when to read it).

**Quality dimensions** (each scored 1-5): Actionability (could an engineer follow this?), Specificity (concrete details vs generic boilerplate), Domain Depth (hard-to-find knowledge vs surface-level), Self-Containment (WHAT and WHY without external lookups).

**Content:** No time-sensitive info. Consistent terminology. Use templates for output format, examples for quality-dependent output. Feedback loops: validate, fix, repeat.

**Checklist:** Specific description with key terms | under 500 lines | separate reference files if needed | no stale info | consistent terms | concrete examples | one-level refs | progressive disclosure | clear workflow steps | 3+ evaluations | tested with target models and real scenarios

**Anti-patterns:** Windows paths | too many options (default + escape hatch) | nested refs | vague descriptions | over-explaining what Claude knows
