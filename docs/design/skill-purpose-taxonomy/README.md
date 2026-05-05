# Skill Purpose Taxonomy

> **Status:** Draft
> **Related issue:** VU-1162

## Overview

The skill-creation flow should stop treating platform standards as a user-owned
research purpose. Harness-owned concerns such as workspace naming, lakehouse
naming, security, deployment topology, monitoring, endpoint behavior, identity,
and environment promotion are set by the runtime and should not be elicited by
the research workflow.

This design collapses the active purpose taxonomy from four options to three
for new skills, updates the create-skill UI to match, and tightens the source
research lens so extraction mechanics are asked only when the source is
DB-based or legacy and those mechanics materially affect transformations.

## Design Scope

**Covers**

- The purpose taxonomy shown in the create-skill UI.
- The research and detailed-research purpose lenses used by `skill-creator`.
- Purpose-aware eval coverage for the revised taxonomy.
- Backward-compatible display handling for existing persisted `platform`
  skills.

**Does not cover**

- Migrating or rewriting existing persisted skill metadata.
- Harness implementation details for deployment, monitoring, or naming.
- General app taxonomy cleanup outside the skill-creation and research flow.

## Key Decisions

| Decision | Rationale |
|---|---|
| New skills expose three active purposes | `platform` no longer represents a user-owned research area once harness-owned concerns are excluded. |
| Keep legacy `platform` display support | Existing persisted skills may still carry `platform`; removing read support would create unnecessary migration risk. |
| Rename `source` to `Source system semantics` | The source lens is about business meaning and customization, not only extraction mechanics. |
| Gate extraction mechanics to DB-based or legacy sources | CDC, delete handling, schema drift, and extraction details are material for replication-oriented systems, not a default interview path for SaaS semantics. |
| Ban harness-owned platform questions in the research contract | Workspace naming, lakehouse naming, security boundaries, deployment topology, monitoring, managed identity, endpoint behavior, environment promotion, and model organization are not user-owned skill decisions. |
| Replace the four-purpose eval matrix with a three-purpose matrix plus source-context split | The risky boundary is not just purpose count; it is whether the source lens over-asks extraction mechanics for SaaS systems. |

## Active Purpose Model

New skills use these three purposes:

- `domain` — Business process knowledge
- `data-engineering` — Organization specific data engineering standards
- `source` — Source system semantics

Legacy persisted skills may still render `platform`, but the create-skill UI
must not offer it as a new selection.

## Purpose Boundaries

### Business process knowledge

Focus on:

- business rules
- metrics and calculation logic
- grain, dimensions, and hierarchies
- reconciliation expectations
- exclusions, exceptions, and edge cases

Do not drift into:

- raw-data location
- extraction-path choice
- file or API mechanics

unless the user context explicitly makes ingestion behavior part of the skill.

### Data engineering standards

Focus on:

- modeling standards
- data quality checks
- reconciliation patterns
- dbt naming conventions
- transformation and historization standards
- layer semantics
- incremental and SCD behavior
- deployment or review expectations that materially change skill behavior

Do not ask about:

- model organization
- workspace naming
- lakehouse naming

because those are harness-owned.

### Source system semantics

Focus on:

- source business rules
- flexfields and custom fields
- custom objects
- custom statuses, stages, and workflows
- source-specific semantics
- source-to-lakehouse mapping assumptions

Ask about extraction mechanics only when the source is DB-based or legacy, or
when the user context explicitly says those mechanics materially affect
ingestion or transformation behavior. Relevant examples include:

- CDC
- delete handling
- schema drift
- replication or export behavior
- pagination or rate limits for legacy integration paths

For SaaS-app semantics skills, default toward custom fields, custom objects,
business rules, and semantic mapping rather than replication mechanics.

## Harness-Owned Exclusions

Research, detailed research, and confirm-decisions normalization must not ask
the user to define:

- workspace naming
- lakehouse naming
- security boundaries
- deployment topology
- monitoring
- managed identity or access model
- endpoint behavior
- environment promotion
- model organization

Those concerns are owned by the harness and should be treated as fixed runtime
context rather than skill requirements.

## Create-Skill UI Impact

The create-skill dialog should:

- remove `platform` from the purpose selector
- relabel `source` as `Source system semantics`
- keep the stored purpose token as `source` for compatibility

The broader app can continue to display legacy `platform` skills where they
already exist, but no new-skill workflow should route users into that purpose.

## Eval Impact

The research and detailed-research eval suites should cover:

- business-process behavior
- data-engineering behavior
- source-system-semantics behavior for SaaS contexts
- source-system-semantics behavior for DB-based or legacy contexts

The source split is required to prove both sides of the rule:

- SaaS source skills do not default to CDC/delete/schema-drift questions
- DB-based or legacy source skills may ask those questions when material

## Relationship to Existing Design Specs

| Spec | Relationship |
|---|---|
| [workflow-research-clean-break](../workflow-research-clean-break/README.md) | Narrows the internal purpose lenses and removes platform as an active research purpose. |
| [workflow-detailed-research-clean-break](../workflow-detailed-research-clean-break/README.md) | Applies the same taxonomy and harness-owned boundaries to step 1 refinements. |
| [skills](../skills/README.md) | Legacy skill-purpose descriptions should align to the revised three-purpose model over time. |

## Key Source Files

| File | Purpose |
|---|---|
| `app/src/lib/types.ts` | Canonical purpose labels and create-skill purpose options |
| `app/src/components/skill-dialog.tsx` | Create-skill purpose selector |
| `app/src-tauri/src/commands/workflow/prompt.rs` | User-context purpose label rendering for workflow prompts |
| `app/src-tauri/src/commands/skill/suggestions.rs` | Purpose-aware suggestion framing and labels |
| `agent-sources/workspace/skills/researching-skill-requirements/SKILL.md` | Purpose lens contract and invariants |
| `agent-sources/prompts/research.txt` | Step 0 research prompt |
| `agent-sources/prompts/detailed-research.txt` | Step 1 detailed research prompt |
| `agent-sources/prompts/confirm_decisions.txt` | Step 2 normalization prompt |
| `tests/evals/packages/skill-content-researcher-research/` | Step 0 purpose-matrix evals |
| `tests/evals/packages/skill-content-researcher-detailed-research/` | Step 1 purpose-matrix evals |
