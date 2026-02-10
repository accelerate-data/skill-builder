# Feature Flow — Team-Based Workflow

This reference covers the full feature path from user thought to requirements.

**Key principles:**
- The codebase is always reviewed — but only for **feasibility and scope assessment**
- The issue itself stays at the **product level**: user experience, feature behavior, API contracts
- Code-level findings (file names, components, architecture) are internal context only — they never appear in the issue

## Step 1: Proceed or Explore?

After classification and clarification, ask the user:

```
AskUserQuestion:
  question: "How would you like to proceed with this feature?"
  options:
    - label: "Implement as described"
      description: "I'll assess feasibility and define product requirements for this approach"
    - label: "Explore alternatives first"
      description: "A team will research options and propose 2-3 product-level approaches"
```

**In both cases, the codebase is reviewed internally** to ensure requirements are realistic. The difference is scope — direct path assesses one approach, exploration path compares several.

## Step 2a: Direct Path

Spawn a single sub-agent to review the codebase for feasibility and draft product-level requirements.

### Sub-agent prompt for direct path:

```
You are assessing feasibility and defining product requirements for a feature.

**Project root**: [path]
**Feature**: [user's description + clarifications]

Your job:
1. Review the codebase to assess whether this feature is feasible and estimate scope
2. Identify any constraints that affect the product requirements (e.g., existing behavior that would change, API contracts that exist)
3. Write product-level functional requirements (numbered list)
4. Write testable acceptance criteria (checkbox list)

IMPORTANT — output format:
- Requirements describe **user-facing behavior**: what the user sees, what the API returns, how the feature works from the outside
- Acceptance criteria are **testable from a product perspective**: a PM could verify them without reading code
- Do NOT include file names, component names, architecture details, or implementation approach
- DO include: user flows, API behavior, edge cases, error states, UI behavior

Return two sections:

**INTERNAL (for coordinator's context only — will NOT go in the issue):**
- Feasibility: feasible / partially feasible / needs significant rework
- Scope signal: XS / S / M / L / XL with brief justification
- Any constraints the coordinator should know about

**FOR THE ISSUE (product-level only):**
- **Requirements**: [numbered list, each 1-2 sentences, user/API/feature behavior only]
- **Acceptance Criteria**: [checkbox list, each testable by a PM]
```

## Step 2b: Exploration Path — Team Approach

Spawn a single **exploration team lead** sub-agent. This agent coordinates a team — it spawns its own sub-agents, synthesizes findings, and returns product-level options.

The team lead should NOT try to do everything itself. It spawns sub-agents for parallel work and focuses on synthesis.

### Exploration team lead prompt:

```
You are leading an exploration team to evaluate approaches for a feature.

**Project root**: [path]
**Feature request**: [user's description + clarifications]
**Original approach**: [what the user initially described]

You are a team lead. Your job is to coordinate research and return 2-3 product-level options. You MUST spawn sub-agents for parallel work — do not do it all yourself.

## Your process:

### Phase A: Parallel Research
Spawn these sub-agents simultaneously:

1. **Codebase Analyst**: Reviews the project to assess feasibility of different approaches, identifies constraints, existing behavior that would be affected, and scope. Returns: feasibility assessment, scope signals, constraints. (This is internal context — it will NOT go in the issue.)

2. **External Researcher**: Searches the internet for how similar features are typically done in similar products, common UX patterns, best practices. Returns: 2-3 product-level approaches with pros/cons from a user experience perspective.

### Phase B: Synthesis
Once both sub-agents return:
1. Filter external approaches through feasibility — drop anything that's unrealistic given the codebase constraints
2. Always include the user's original approach as one option
3. Add 1-2 alternatives that are meaningfully different (not minor variations)
4. Describe each option in product terms: what the user experiences, not how it's built

### Phase C: Return Consensus Options

Return exactly this structure for each option (2-3 total):

**Option [N]: [Short name]**
- **Summary**: 1-2 sentences describing the user experience
- **How it works for the user**: What the user sees/does, API behavior if relevant
- **Scope**: XS / S / M / L / XL
- **Tradeoffs**: 1-2 bullet points (product-level pros and cons)

No file names, no component names, no architecture details in the options.

End with a 1-sentence recommendation of which option balances effort vs. user impact best. Present all options neutrally — the user decides.
```

### Sub-agent prompts the team lead should use:

**Codebase Analyst:**
```
Assess the feasibility and scope of a feature in this codebase.

**Project root**: [path]
**Feature context**: [description]

Find and return:
1. Is this feasible with the current architecture? Any blockers?
2. What existing behavior would be affected or need to change?
3. Rough scope: how much of the codebase is involved?
4. Any constraints that would shape the product requirements (e.g., "there's no real-time pipeline, so live updates would need a new system")

This is internal analysis — it will be used to filter options and estimate scope, NOT included in any issue. Be specific and direct.
```

**External Researcher:**
```
Research how this type of feature is typically done in similar products.

**Feature**: [description]
**Product context**: [type of product, if known]

Search the internet for:
1. How similar products handle this feature (UX patterns, user flows)
2. Best practices from a product perspective
3. Common pitfalls or edge cases to consider

Return 2-3 distinct product-level approaches with:
- What the user experience looks like
- Pros and cons from a user perspective
- Whether it's a common or novel pattern

Keep it practical — focus on product patterns, not technology choices.
```

## Step 3: User Picks an Approach

After the team returns options, present them to the user via `AskUserQuestion`. Each option becomes a choice with its summary and scope as the description.

## Step 4: Requirements Definition

For the chosen approach, spawn a sub-agent to write product-level requirements. The codebase has already been assessed internally, so feasibility is confirmed.

### Sub-agent prompt for requirements:

```
You are defining product requirements for a chosen feature approach.

**Project root**: [path]
**Chosen approach**: [selected option details]
**Internal context**: [feasibility notes, constraints from exploration phase]

Write:
1. Product-level functional requirements (numbered, 1-2 sentences each)
2. Testable acceptance criteria (checkbox list)

Requirements describe:
- What the user sees and does
- How the feature behaves (happy path and edge cases)
- API inputs/outputs if relevant
- Error states and how they're communicated to the user

Requirements do NOT include:
- File names, component names, or architecture
- Implementation approach or technical decisions
- Internal data models or database schema

Return two sections:

**INTERNAL (for coordinator only):**
- Estimated Complexity: XS / S / M / L / XL with justification

**FOR THE ISSUE:**
- **Requirements**: [numbered list, product-level]
- **Acceptance Criteria**: [checkbox list, PM-testable]
```

## Step 5: User Refinement

Present requirements to user. They may:
- Accept → proceed to issue creation
- Want changes → update and re-present
- Want to re-scope → go back to options

Max 2 refinement rounds, then move on with what we have.
