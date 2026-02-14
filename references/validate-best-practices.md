# Skill Best Practices

> Embedded from platform.claude.com. Referenced by validate agents.
> Last updated: 2026-02-14

## Core Principles

### Concise is Key

The context window is a public good. Your Skill shares the context window with everything else Claude needs to know, including the system prompt, conversation history, other Skills' metadata, and the actual request.

**Default assumption**: Claude is already very smart. Only add context Claude doesn't already have. Challenge each piece of information:
- "Does Claude really need this explanation?"
- "Can I assume Claude knows this?"
- "Does this paragraph justify its token cost?"

### Set Appropriate Degrees of Freedom

Match the level of specificity to the task's fragility and variability.

- **High freedom** (text-based instructions): Use when multiple approaches are valid, decisions depend on context, or heuristics guide the approach.
- **Medium freedom** (pseudocode or scripts with parameters): Use when a preferred pattern exists but some variation is acceptable.
- **Low freedom** (specific scripts, few or no parameters): Use when operations are fragile and error-prone, consistency is critical, or a specific sequence must be followed.

### Test with All Models You Plan to Use

Skills act as additions to models, so effectiveness depends on the underlying model. What works perfectly for Opus might need more detail for Haiku. Aim for instructions that work well with all target models.

## Skill Structure

### Naming Conventions

Use **gerund form** (verb + -ing) for Skill names (e.g., `processing-pdfs`, `analyzing-spreadsheets`). The `name` field must use lowercase letters, numbers, and hyphens only (max 64 characters). Avoid vague names like `helper`, `utils`, `tools`.

### Writing Effective Descriptions

The `description` field enables Skill discovery and should include both what the Skill does and when to use it.

- **Always write in third person.** The description is injected into the system prompt, and inconsistent point-of-view can cause discovery problems.
- **Be specific and include key terms.** Include both what the Skill does and specific triggers/contexts for when to use it.
- Maximum 1024 characters, non-empty, no XML tags.

### Progressive Disclosure Patterns

SKILL.md serves as an overview that points Claude to detailed materials as needed, like a table of contents.

- Keep SKILL.md body under 500 lines for optimal performance.
- Split content into separate files when approaching this limit.
- All reference files should link directly from SKILL.md (one level deep) to ensure Claude reads complete files when needed.

### Structure Longer Reference Files with Table of Contents

For reference files longer than 100 lines, include a table of contents at the top so Claude can see the full scope of available information even when previewing with partial reads.

## Content Guidelines

### Avoid Time-sensitive Information

Don't include information that will become outdated. Use "old patterns" sections with collapsed details for deprecated approaches.

### Use Consistent Terminology

Choose one term and use it throughout the Skill. Consistency helps Claude understand and follow instructions.

## Common Patterns

### Template Pattern

Provide templates for output format. Match the level of strictness to your needs:
- **Strict requirements** (API responses, data formats): Use exact template structures.
- **Flexible guidance** (when adaptation is useful): Provide sensible defaults with "adjust as needed."

### Examples Pattern

For Skills where output quality depends on seeing examples, provide input/output pairs. Examples help Claude understand the desired style and level of detail more clearly than descriptions alone.

### Conditional Workflow Pattern

Guide Claude through decision points with clear branching logic.

## Workflows and Feedback Loops

### Use Workflows for Complex Tasks

Break complex operations into clear, sequential steps. For particularly complex workflows, provide a checklist that Claude can copy and check off as it progresses.

### Implement Feedback Loops

Run validator, fix errors, repeat. This pattern greatly improves output quality.

## Evaluation and Iteration

### Build Evaluations First

Create evaluations BEFORE writing extensive documentation. This ensures your Skill solves real problems rather than documenting imagined ones.

1. **Identify gaps**: Run Claude on representative tasks without a Skill. Document specific failures or missing context.
2. **Create evaluations**: Build three scenarios that test these gaps.
3. **Establish baseline**: Measure Claude's performance without the Skill.
4. **Write minimal instructions**: Create just enough content to address the gaps and pass evaluations.
5. **Iterate**: Execute evaluations, compare against baseline, and refine.

### Develop Skills Iteratively with Claude

Work with one instance of Claude ("Claude A") to create a Skill that will be used by other instances ("Claude B"). Claude A helps design and refine instructions, while Claude B tests them in real tasks.

## Checklist for Effective Skills

### Core Quality
- Description is specific and includes key terms
- Description includes both what the Skill does and when to use it
- SKILL.md body is under 500 lines
- Additional details are in separate files (if needed)
- No time-sensitive information (or in "old patterns" section)
- Consistent terminology throughout
- Examples are concrete, not abstract
- File references are one level deep
- Progressive disclosure used appropriately
- Workflows have clear steps

### Testing
- At least three evaluations created
- Tested with target models
- Tested with real usage scenarios
- Team feedback incorporated (if applicable)

## Anti-patterns to Avoid

- **Windows-style paths**: Always use forward slashes in file paths.
- **Too many options**: Provide a default with an escape hatch rather than multiple approaches.
- **Deeply nested references**: Keep references one level deep from SKILL.md.
- **Vague descriptions**: Be specific about what the Skill does and when to use it.
- **Over-explaining what Claude already knows**: Focus on domain-specific knowledge and hard-to-find context.
