# Dynamic Research Dimensions — Design Document

> Definitive architecture for making the Skill Builder's research step dynamic.
> Each skill type declares which research dimensions it needs, and an optional planner
> agent adjusts the plan based on the specific domain.

---

## Table of Contents

1. [Recommended Architecture](#1-recommended-architecture)
2. [Research Dimension Catalog](#2-research-dimension-catalog)
3. [Planner Agent Design](#3-planner-agent-design)
4. [Config Format](#4-config-format)
5. [Template Changes](#5-template-changes)
6. [Impact on Steps 3 and Beyond](#6-impact-on-steps-3-and-beyond)
7. [Migration Path](#7-migration-path)
8. [Data Engineering Deep Dive](#8-data-engineering-deep-dive)

---

## 1. Recommended Architecture

### Decision: Approach C — Config-Driven Defaults + Planner Phase

The research orchestrator becomes dimension-aware. Each skill type declares default research
dimensions in its `config.conf`. A lightweight planner agent runs as Phase 0 of the research
orchestrator to adjust the dimension plan for the specific domain. The orchestrator then
spawns dimension agents in two phases (foundational, then exploratory), collects outputs,
and hands them to the existing consolidation agent.

### Why Approach C over A or B

| Criterion | A (Config Only) | B (Planner Only) | **C (Hybrid)** |
|-----------|----------------|-------------------|----------------|
| **Reliability** | High — deterministic | Medium — LLM may hallucinate dimensions | **High — config defaults as safety net** |
| **Extensibility** | Medium — new types need config work | High — planner adapts | **High — config for known, planner for novel** |
| **Quality** | Fixed — no domain adaptation | Variable — planner may over/under-fit | **Best of both — good defaults + smart adjustment** |
| **Complexity** | Low — just config parsing | Medium — new agent + plan format | **Medium — incremental over A** |
| **Testing** | Easy — deterministic | Hard — non-deterministic output | **Easy — test defaults, test planner as override** |

**Key reasoning:**

1. **Config defaults are the primary path.** For the 4 existing skill types, the right
   dimensions are known in advance. Config declares them, and most runs will use defaults
   with minor focus adjustments from the planner.

2. **The planner adds adaptive value without risk.** It reads defaults and the domain
   name, then outputs adjustments. If it fails, the orchestrator falls back to defaults.
   The planner's primary value is adjusting *focus lines* — telling the entities agent
   "focus on SCD surrogate keys" vs. "focus on customer hierarchies" — rather than
   adding/removing dimensions wholesale.

3. **LangGraph's Plan-and-Execute pattern validates this.** The planner produces a
   structured plan, the orchestrator executes it, and fallback to defaults provides
   the reliability LangGraph achieves through replanning.

4. **DSPy's module composition pattern validates dimension reuse.** Dimensions are
   composable research modules with typed outputs. Type configs select which modules
   to compose, like DSPy pipeline configuration.

### Architecture Overview

```
┌─────────────────────────────────────────────────┐
│           Research Orchestrator (per-type)        │
│                                                   │
│  Phase 0: Planner ─── adjusts dimension plan      │
│      │                                            │
│  Phase 1: Foundational ─── entities, metrics      │
│      │         (parallel, wait for all)            │
│      ▼                                            │
│  Phase 2: Exploratory ─── type-specific dims      │
│      │    (parallel, receive Phase 1 output)       │
│      ▼                                            │
│  Phase 3: Consolidation ─── opus merges all       │
│                          → clarifications.md       │
└─────────────────────────────────────────────────┘
```

### What Changes vs. What Stays

| Component | Change? | Details |
|-----------|---------|---------|
| Research orchestrator template | **Rewrite** | Dimension-aware, planner phase |
| research-concepts template | **Remove** | Replaced by `research-entities` + `research-metrics` shared agents |
| research-practices template | **Remove** | Replaced by type-specific exploratory dimension agents |
| research-implementation template | **Remove** | Replaced by type-specific exploratory dimension agents |
| generate-skill template | No change | Works from decisions.md as before |
| Dimension agents (new) | **Create** | 12 shared agents in `agents/shared/` |
| Research planner (new) | **Create** | 1 shared agent in `agents/shared/` |
| consolidate-research | No change | Still merges N research outputs into clarifications.md |
| detailed-research | No change | Already dynamic — reads sections from clarifications.md |
| confirm-decisions | No change | Works from clarifications.md + clarifications-detailed.md |
| validate-skill | No change | Works from SKILL.md + decisions.md |
| build-agents.sh | **Modify** | Generates orchestrator + generate-skill per type (not 5 per type) |
| config.conf per type | **Extend** | New dimension declarations alongside existing fields |
| Plugin SKILL.md coordinator | No change | Calls `{type_prefix}-research` orchestrator as before |
| App sidecar | No change | Spawns orchestrator by name as before |
| Workflow store | No change | Step structure unchanged |

### Agent File Layout (New)

```
agents/
├── shared/
│   ├── consolidate-research.md          # unchanged
│   ├── confirm-decisions.md             # unchanged
│   ├── detailed-research.md             # unchanged
│   ├── validate-skill.md                # unchanged
│   ├── research-planner.md              # NEW
│   ├── research-entities.md             # NEW (dimension)
│   ├── research-metrics.md              # NEW (dimension)
│   ├── research-pipeline-patterns.md    # NEW (dimension)
│   ├── research-data-quality.md         # NEW (dimension)
│   ├── research-historization.md        # NEW (dimension)
│   ├── research-silver-gold-design.md   # NEW (dimension)
│   ├── research-business-rules.md       # NEW (dimension)
│   ├── research-modeling-patterns.md    # NEW (dimension)
│   ├── research-api-patterns.md         # NEW (dimension)
│   ├── research-integration.md          # NEW (dimension)
│   ├── research-deployment.md           # NEW (dimension)
│   ├── research-extraction.md           # NEW (dimension)
│   ├── research-authentication.md       # NEW (dimension)
│   └── research-schema-mapping.md       # NEW (dimension)
├── data-engineering/
│   ├── research.md                      # GENERATED (orchestrator)
│   └── generate-skill.md               # GENERATED (unchanged template)
├── domain/
│   ├── research.md                      # GENERATED (orchestrator)
│   └── generate-skill.md               # GENERATED
├── platform/
│   ├── research.md                      # GENERATED (orchestrator)
│   └── generate-skill.md               # GENERATED
└── source/
    ├── research.md                      # GENERATED (orchestrator)
    └── generate-skill.md               # GENERATED
```

**Agent count: 22** (14 shared + 8 generated) — down from 24 (4 shared + 20 generated).

---

## 2. Research Dimension Catalog

### Dimension Model

Each dimension is a focused research area that produces clarification questions about one
aspect of the skill domain. Dimensions are **shared agents** — the same `research-entities`
agent is used for domain, data-engineering, platform, and source skills. Type-specific
focus is injected via the orchestrator's prompt.

Every dimension has:
- **Name & slug** — human-readable name and agent file name suffix
- **Phase** — foundational (Phase 1) or exploratory (Phase 2)
- **Role** — what this dimension researches
- **Default focus** — generic focus line (type configs can override)
- **Output** — what kind of clarification questions it produces
- **Used by** — which skill types include this dimension by default

### Foundational Dimensions (Phase 1)

These run first. Their output is passed to exploratory dimensions as context.

#### `entities` — Entity & Relationship Research

| Field | Value |
|-------|-------|
| Agent file | `agents/shared/research-entities.md` |
| Phase | Foundational |
| Role | Surface the core entities, relationships, cardinality patterns, and analysis patterns for the domain |
| Default focus | Identify domain entities, their relationships, cardinality constraints, and cross-entity analysis patterns |
| Output | Questions about which entities to model, relationship depth, key cardinality decisions |
| Used by | **all types** (domain, data-engineering, platform, source) |

Type-specific focus overrides:
- **domain**: "Focus on business entities, customer hierarchies, and organizational relationships"
- **data-engineering**: "Focus on dimensional entities (dimensions, fact tables, SCD history, surrogate keys), incremental load entities (watermarks, merge targets, change logs), and streaming entities (sources, sinks, windows)"
- **platform**: "Focus on platform resources, configuration objects, and their dependency relationships"
- **source**: "Focus on source system objects, API resource hierarchies, and data extraction entities"

#### `metrics` — Metrics & KPI Research

| Field | Value |
|-------|-------|
| Agent file | `agents/shared/research-metrics.md` |
| Phase | Foundational |
| Role | Surface metrics, KPIs, calculation nuances, and aggregation patterns that differentiate a naive implementation from a correct one |
| Default focus | Identify key metrics, calculation rules, aggregation patterns, and business rules that engineers commonly get wrong |
| Output | Questions about which metrics to support, calculation approaches, aggregation granularity |
| Used by | domain, data-engineering |

Type-specific focus overrides:
- **domain**: "Focus on business KPIs, revenue calculations, and industry-standard metric definitions"
- **data-engineering**: "Focus on pipeline health metrics, data quality scores, freshness SLAs, and reconciliation patterns"

### Exploratory Dimensions (Phase 2)

These run after foundational dimensions complete. Each receives the combined foundational
research text as input context.

#### `pipeline-patterns` — Pipeline Pattern Research

| Field | Value |
|-------|-------|
| Agent file | `agents/shared/research-pipeline-patterns.md` |
| Phase | Exploratory |
| Role | Research load strategies, merge approaches, transformation patterns, and data movement architectures |
| Default focus | Focus on load patterns (full refresh, incremental, CDC, streaming), merge strategies (SCD types, upsert), and transformation approaches (T vs ELT, materialization) |
| Output | Questions about which load patterns to recommend, merge strategies, transformation sequencing |
| Used by | **data-engineering** |

#### `data-quality` — Data Quality Research

| Field | Value |
|-------|-------|
| Agent file | `agents/shared/research-data-quality.md` |
| Phase | Exploratory |
| Role | Research validation frameworks, quality rule patterns, anomaly detection, and testing strategies |
| Default focus | Focus on validation rule patterns, data quality frameworks, anomaly detection approaches, and pipeline testing strategies |
| Output | Questions about quality rule severity, validation timing, testing approaches |
| Used by | data-engineering, source |

Type-specific focus overrides:
- **data-engineering**: "Focus on cross-layer validation, reconciliation patterns, and quality gates between silver and gold"
- **source**: "Focus on source data quality assessment, extraction validation, and schema conformance checks"

#### `historization` — Historization Strategy Research

| Field | Value |
|-------|-------|
| Agent file | `agents/shared/research-historization.md` |
| Phase | Exploratory |
| Role | Research temporal data management strategies for tracking how data changes over time |
| Default focus | Focus on SCD type selection (Type 1/2/3), snapshot strategies, event sourcing patterns, and bitemporal modeling approaches |
| Output | Questions about which historization strategies to recommend per entity type, retention policies |
| Used by | **data-engineering** |

#### `silver-gold-design` — Silver/Gold Layer Design Research

| Field | Value |
|-------|-------|
| Agent file | `agents/shared/research-silver-gold-design.md` |
| Phase | Exploratory |
| Role | Research lakehouse layer separation patterns, conformed dimensions, fact table granularity, and materialization strategies |
| Default focus | Focus on silver-to-gold promotion criteria, conformed dimension design, fact table granularity choices, and materialization/view strategies |
| Output | Questions about layer boundaries, dimension conformance, aggregation granularity, materialization approach |
| Used by | **data-engineering** |

#### `business-rules` — Business Rules Research

| Field | Value |
|-------|-------|
| Agent file | `agents/shared/research-business-rules.md` |
| Phase | Exploratory |
| Role | Research industry-specific business rules, regulatory requirements, and common encoding mistakes |
| Default focus | Focus on business rules that affect data modeling, industry-specific variations, regulatory constraints, and rules that engineers without domain expertise commonly implement incorrectly |
| Output | Questions about which business rules the skill should encode, regulatory requirements, common mistakes |
| Used by | **domain** |

#### `modeling-patterns` — Modeling Patterns Research

| Field | Value |
|-------|-------|
| Agent file | `agents/shared/research-modeling-patterns.md` |
| Phase | Exploratory |
| Role | Research silver/gold layer modeling patterns, snapshot strategies, and common modeling mistakes |
| Default focus | Focus on dimensional modeling patterns, snapshot strategies for the domain, source field coverage decisions, and modeling mistakes specific to this business area |
| Output | Questions about modeling approach, snapshot frequency, field coverage |
| Used by | **domain** |

#### `api-patterns` — API & Tool Pattern Research

| Field | Value |
|-------|-------|
| Agent file | `agents/shared/research-api-patterns.md` |
| Phase | Exploratory |
| Role | Research tool capabilities, API structures, integration constraints, and platform-specific configuration |
| Default focus | Focus on API design patterns, rate limiting, pagination, webhook support, and platform-specific configuration options |
| Output | Questions about API usage patterns, configuration approaches, capability boundaries |
| Used by | **platform** |

#### `integration` — Integration Pattern Research

| Field | Value |
|-------|-------|
| Agent file | `agents/shared/research-integration.md` |
| Phase | Exploratory |
| Role | Research integration patterns, version compatibility, and multi-tool orchestration |
| Default focus | Focus on integration patterns between tools, version compatibility constraints, configuration management, and multi-tool orchestration edge cases |
| Output | Questions about integration approach, compatibility handling, orchestration patterns |
| Used by | **platform** |

#### `deployment` — Deployment & Configuration Research

| Field | Value |
|-------|-------|
| Agent file | `agents/shared/research-deployment.md` |
| Phase | Exploratory |
| Role | Research deployment patterns, state management, and migration strategies |
| Default focus | Focus on configuration schemas, deployment patterns, state management approaches, and version migration strategies |
| Output | Questions about deployment approach, state management, migration handling |
| Used by | **platform** |

#### `extraction` — Data Extraction Research

| Field | Value |
|-------|-------|
| Agent file | `agents/shared/research-extraction.md` |
| Phase | Exploratory |
| Role | Research extraction patterns, API rate limit strategies, and data delivery edge cases |
| Default focus | Focus on extraction patterns (bulk vs incremental vs streaming), API rate limit handling, webhook vs polling trade-offs, and data delivery edge cases (ordering, exactly-once, late arrival) |
| Output | Questions about extraction approach, rate limit handling, delivery guarantees |
| Used by | **source** |

#### `authentication` — Authentication & Access Research

| Field | Value |
|-------|-------|
| Agent file | `agents/shared/research-authentication.md` |
| Phase | Exploratory |
| Role | Research authentication flows, token management, and credential handling patterns |
| Default focus | Focus on authentication mechanisms (OAuth 2.0, API keys, SAML), token refresh strategies, credential rotation, and permission/scope management |
| Output | Questions about auth approach, token management, credential handling |
| Used by | **source** |

#### `schema-mapping` — Schema Mapping Research

| Field | Value |
|-------|-------|
| Agent file | `agents/shared/research-schema-mapping.md` |
| Phase | Exploratory |
| Role | Research API-to-warehouse schema mapping, type coercion, and schema evolution handling |
| Default focus | Focus on source-to-target field mapping, data type coercion rules, schema evolution handling, and source-specific data quality gotchas |
| Output | Questions about mapping approach, type handling, evolution strategy |
| Used by | **source** |

### Dimension Assignment Matrix

| Dimension | domain | data-engineering | platform | source |
|-----------|--------|-----------------|----------|--------|
| `entities` | F | F | F | F |
| `metrics` | F | F | - | - |
| `pipeline-patterns` | - | E | - | - |
| `data-quality` | - | E | - | E |
| `historization` | - | E | - | - |
| `silver-gold-design` | - | E | - | - |
| `business-rules` | E | - | - | - |
| `modeling-patterns` | E | - | - | - |
| `api-patterns` | - | - | E | - |
| `integration` | - | - | E | - |
| `deployment` | - | - | E | - |
| `extraction` | - | - | - | E |
| `authentication` | - | - | - | E |
| `schema-mapping` | - | - | - | E |

F = Foundational (Phase 1), E = Exploratory (Phase 2), - = not used

**Agent counts per type:**
- domain: 2 foundational + 2 exploratory = 4 dimension agents
- data-engineering: 2 foundational + 4 exploratory = 6 dimension agents
- platform: 1 foundational + 3 exploratory = 4 dimension agents
- source: 1 foundational + 3 exploratory = 4 dimension agents

---

## 3. Planner Agent Design

### Agent Specification

```yaml
---
name: research-planner
description: >
  Analyzes skill type, domain, and user context to produce a customized
  research dimension plan. Called as Phase 0 of the research orchestrator.
model: opus
tools: Read, Glob, Grep
---
```

### Inputs (via prompt from orchestrator)

The orchestrator passes these in the Task tool prompt:

1. **Skill type** — `domain`, `data-engineering`, `platform`, or `source`
2. **Domain name** — e.g., "sales pipeline", "Salesforce", "dbt"
3. **User context** — any additional context the user provided during init (may be empty)
4. **Default plan** — the type's default dimension assignment from config, formatted as:
   ```
   Foundational: entities (focus: ...), metrics (focus: ...)
   Exploratory: pipeline-patterns (focus: ...), data-quality (focus: ...), ...
   ```
5. **Available dimensions** — full catalog of all dimensions with descriptions

### Output Format (returned as text)

```markdown
# Research Plan

## Skill: [domain] ([skill_type])

## Foundational Dimensions
1. **entities** — Focus: [adjusted focus or "Use default"]
   Entity examples: [adjusted examples or "Use default"]
2. **metrics** — Focus: [adjusted focus or "Use default"]

## Exploratory Dimensions
1. **pipeline-patterns** — Focus: [adjusted focus specific to this domain]
2. **data-quality** — Focus: [adjusted focus specific to this domain]
3. **historization** — Focus: [adjusted focus specific to this domain]
4. **silver-gold-design** — Focus: [adjusted focus specific to this domain]

## Adjustments Made
- [List of changes from defaults, with brief rationale]
- [Or "None — defaults are appropriate for this domain"]
```

### Orchestrator Parsing

The orchestrator reads the plan text and extracts:
1. Dimension names from `**bold**` text in each phase section
2. Focus lines from the "Focus:" values
3. Entity examples from "Entity examples:" values (foundational only)

If parsing fails or the planner returns no output, the orchestrator falls back to
the baked-in defaults from the generated template.

### Planner Behavior Guidelines

The planner prompt instructs it to:

1. **Prefer defaults.** Most domains fit their type's default dimensions well.
   The planner should adjust focus lines more often than adding/removing dimensions.

2. **Adjust focus for domain specificity.** "pipeline-patterns" for a "real-time fraud detection"
   skill should focus on streaming and CDC, while for a "financial reporting" skill it should
   focus on batch and SCD patterns.

3. **Add dimensions sparingly.** Only add a dimension from another type when the domain
   genuinely crosses type boundaries (e.g., a "Salesforce analytics" domain skill might
   add `extraction` from the source type).

4. **Never remove foundational dimensions.** `entities` is always required.
   `metrics` can be removed only for platform/source types that don't have business metrics.

5. **Keep output concise.** The plan is a configuration artifact, not an essay.

### Cost and Latency

- **Model:** opus (needs reasoning about domain-dimension fit)
- **Expected tokens:** ~500 input, ~300 output
- **Latency:** ~3-5 seconds
- **Cost:** ~$0.02 per call
- **Impact on total research step:** +5% wall time (current step is ~90-120s)

---

## 4. Config Format

### Current Format (`config.conf`)

```conf
NAME_PREFIX=de
FOCUS_LINE__research_concepts=Focus on historization strategies...
FOCUS_LINE__research_practices=Focus on transformation patterns...
FOCUS_LINE__research_implementation=Focus on historization strategies...
ENTITY_EXAMPLES=e.g., for dimensional pipelines: dimensions...
```

### New Format (`config.conf`)

```conf
# Type configuration for data-engineering agents
NAME_PREFIX=de

# Entity examples (passed to foundational dimensions that research entities)
ENTITY_EXAMPLES=e.g., for dimensional pipelines: dimensions, fact tables, SCD history, surrogate keys; for incremental loads: watermarks, merge targets, change logs; for streaming: sources, sinks, windows, state stores

# Research dimensions — declared by phase
# Foundational dimensions run first; exploratory dimensions run after and receive foundational output
DIMENSIONS_FOUNDATIONAL=entities,metrics
DIMENSIONS_EXPLORATORY=pipeline-patterns,data-quality,historization,silver-gold-design

# Per-dimension focus overrides (optional — omit to use dimension's default focus)
# Format: DIMENSION_FOCUS__<slug_with_underscores>=<focus line>
DIMENSION_FOCUS__entities=Focus on dimensional entities (dimensions, fact tables, SCD history, surrogate keys), incremental load entities (watermarks, merge targets, change logs), and streaming entities (sources, sinks, windows, state stores)
DIMENSION_FOCUS__metrics=Focus on pipeline health metrics, data quality scores, freshness SLAs, and reconciliation patterns that drive the data model design
DIMENSION_FOCUS__pipeline_patterns=Focus on load patterns (SCD types, incremental, CDC, streaming), merge strategies (MERGE INTO, upsert), and transformation approaches (T vs ELT, materialization)
DIMENSION_FOCUS__data_quality=Focus on cross-layer validation rules, reconciliation patterns, quality gates between silver and gold, and pipeline testing strategies
DIMENSION_FOCUS__historization=Focus on SCD type selection per entity (Type 1 for reference data, Type 2 for dimensions), snapshot vs event log strategies, and bitemporal modeling for audit-critical data
DIMENSION_FOCUS__silver_gold_design=Focus on silver-to-gold promotion criteria, conformed dimension design, fact table granularity choices, aggregate table patterns, and materialization vs view strategies
```

### All Four Type Configs

**domain/config.conf:**
```conf
NAME_PREFIX=domain
ENTITY_EXAMPLES=e.g., for sales: accounts, opportunities, contacts; for supply chain: suppliers, purchase orders, inventory
DIMENSIONS_FOUNDATIONAL=entities,metrics
DIMENSIONS_EXPLORATORY=business-rules,modeling-patterns
DIMENSION_FOCUS__entities=Focus on business entities, customer hierarchies, organizational relationships, and cross-entity analysis patterns
DIMENSION_FOCUS__metrics=Focus on business KPIs, revenue calculations, industry-standard metric definitions, and calculation nuances that differentiate naive implementations from correct ones
DIMENSION_FOCUS__business_rules=Focus on business rules that affect data modeling, industry-specific variations, regulatory constraints, and rules engineers commonly implement incorrectly
DIMENSION_FOCUS__modeling_patterns=Focus on silver/gold layer modeling patterns for this business domain, snapshot strategies, source field coverage decisions, and common modeling mistakes
```

**platform/config.conf:**
```conf
NAME_PREFIX=platform
ENTITY_EXAMPLES=e.g., for Terraform: providers, modules, resources; for Kubernetes: deployments, services, ingress
DIMENSIONS_FOUNDATIONAL=entities
DIMENSIONS_EXPLORATORY=api-patterns,integration,deployment
DIMENSION_FOCUS__entities=Focus on platform resources, configuration objects, state representations, and their dependency relationships
DIMENSION_FOCUS__api_patterns=Focus on tool capabilities, API design patterns, rate limiting, pagination, and platform-specific configuration options
DIMENSION_FOCUS__integration=Focus on integration patterns between tools, version compatibility constraints, configuration management, and multi-tool orchestration edge cases
DIMENSION_FOCUS__deployment=Focus on configuration schemas, deployment patterns, state management approaches, and version migration strategies
```

**source/config.conf:**
```conf
NAME_PREFIX=source
ENTITY_EXAMPLES=e.g., for Stripe: charges, subscriptions, events; for Salesforce: accounts, opportunities, custom objects
DIMENSIONS_FOUNDATIONAL=entities
DIMENSIONS_EXPLORATORY=extraction,authentication,schema-mapping,data-quality
DIMENSION_FOCUS__entities=Focus on source system objects, API resource hierarchies, data extraction entities, and relationship mapping to warehouse targets
DIMENSION_FOCUS__extraction=Focus on extraction patterns (bulk vs incremental vs streaming), API rate limit handling, webhook vs polling trade-offs, and data delivery edge cases
DIMENSION_FOCUS__authentication=Focus on authentication mechanisms (OAuth 2.0, API keys, SAML), token refresh strategies, credential rotation, and permission/scope management
DIMENSION_FOCUS__schema_mapping=Focus on source-to-target field mapping, data type coercion rules, schema evolution handling, and source-specific data quality gotchas
DIMENSION_FOCUS__data_quality=Focus on source data quality assessment, extraction validation, schema conformance checks, and handling missing or inconsistent source data
```

### Backward Compatibility

The old `FOCUS_LINE__research_concepts`, `FOCUS_LINE__research_practices`, and
`FOCUS_LINE__research_implementation` keys are ignored by the new build system.
They can be left in config for a transition period and removed in a follow-up cleanup.

---

## 5. Template Changes

### Templates Removed

| File | Reason |
|------|--------|
| `agent-sources/templates/research-concepts.md` | Replaced by shared `research-entities` + `research-metrics` |
| `agent-sources/templates/research-practices.md` | Replaced by type-specific exploratory dimensions |
| `agent-sources/templates/research-implementation.md` | Replaced by type-specific exploratory dimensions |

### Templates Modified

#### `agent-sources/templates/research.md` (Research Orchestrator)

**Complete rewrite.** The new orchestrator template:

```markdown
---
name: {{NAME_PREFIX}}-research
description: Orchestrates dynamic research by running a planner, then spawning
  dimension agents in two phases (foundational → exploratory), and consolidating
  results. Called during Step 1.
model: sonnet
tools: Read, Write, Edit, Glob, Grep, Bash, Task
---

# Research Orchestrator

<role>
## Your Role
Orchestrate parallel research by running a planner to finalize the research plan,
then spawning dimension agents in two phases, and consolidating results into a
cohesive clarifications file.
</role>

<context>
## Context
- The coordinator tells you:
  - The **domain** name
  - The **skill name**
  - The **skill type** ({{SKILL_TYPE}})
  - The **context directory** path (write `clarifications.md` here)

## Default Research Plan

If the planner agent fails or returns no output, use these defaults:

### Foundational Dimensions (Phase 1 — spawn in parallel, wait for all)
{{FOUNDATIONAL_DIMENSION_INSTRUCTIONS}}

### Exploratory Dimensions (Phase 2 — spawn in parallel, each receives Phase 1 output)
{{EXPLORATORY_DIMENSION_INSTRUCTIONS}}
</context>

---

<instructions>

## Phase 0: Plan

Spawn the research planner agent (`name: "research-planner"`, `model: "opus"`).
Pass it:
- Skill type: {{SKILL_TYPE}}
- Domain name (from coordinator)
- The default research plan listed above
- Available dimension catalog:
{{DIMENSION_CATALOG_SUMMARY}}

If the planner returns a valid research plan, use it for Phases 1 and 2.
If the planner fails or returns invalid output, use the defaults above.

## Phase 1: Foundational Research

Follow the Sub-agent Spawning protocol. Spawn all foundational dimension agents
in parallel. Each agent **returns text** — it does not write files.

For each foundational dimension from the plan:
- Agent name: `"research-<dimension-slug>"`
- Pass: the domain name and the dimension's focus line
- For the entities dimension, also pass: entity examples

Wait for all foundational agents to complete. Collect their returned text.

## Phase 2: Exploratory Research

Spawn all exploratory dimension agents in parallel. Each receives:
- The domain name
- The dimension's focus line from the plan
- The **combined text from all Phase 1 agents** (foundational research context)

Wait for all exploratory agents to complete.

## Phase 3: Consolidate

After all dimension agents return, spawn a fresh **consolidate-research**
sub-agent (`name: "consolidate-research"`, `model: "opus"`). Pass it:
- The returned text from ALL dimension agents (foundational + exploratory)
- The context directory path and target filename `clarifications.md`

## Error Handling

If a dimension agent fails, re-spawn once. If it fails again, proceed with
available output. If the consolidation agent fails, perform consolidation yourself.

</instructions>

## Success Criteria
- Planner runs and produces a valid plan (or graceful fallback to defaults)
- All foundational dimension agents return research text with 5+ questions each
- All exploratory dimension agents return research text with 5+ questions each
- Consolidation agent produces a cohesive `clarifications.md` with logical section flow
```

The `{{FOUNDATIONAL_DIMENSION_INSTRUCTIONS}}`, `{{EXPLORATORY_DIMENSION_INSTRUCTIONS}}`,
`{{DIMENSION_CATALOG_SUMMARY}}`, and `{{SKILL_TYPE}}` placeholders are filled by the
build system from the type's config.conf.

### Templates Unchanged

| File | Reason |
|------|--------|
| `agent-sources/templates/generate-skill.md` | Works from decisions.md — unaffected by research changes |

### New: Shared Dimension Agents

Each dimension agent is a handwritten shared agent in `agents/shared/`. They follow
a common structure:

```markdown
---
name: research-<slug>
description: Researches <dimension name> for the skill domain. Called during
  Step 1 by the research orchestrator.
model: sonnet
tools: Read, Write, Edit, Glob, Grep, Bash
---

# Research Agent: <Dimension Name>

<role>
## Your Role
You are a research agent. <Dimension-specific role description>.
</role>

<context>
## Context
- The orchestrator passes you:
  - **Which domain** to research
  - **Focus areas** for your research
  - [If exploratory] The **foundational research text** directly in the prompt
- This agent writes no files — it returns clarification text to the orchestrator
</context>

<instructions>
## Instructions

**Goal**: Produce clarification questions about <dimension name> where different
answers produce meaningfully different skill content.

[If exploratory] **Input**: Review the foundational research text provided by
the orchestrator. Use it to anchor your questions to confirmed entities and concepts.

**Research approach**: <Dimension-specific research instructions>

**Constraints**:
- Follow the Clarifications file format from your system prompt
- Always include "Other (please specify)" as a choice
- Return the clarification text (do not write files)
- Every question must present choices where different answers change the skill's design
- Target 5-8 questions

## Error Handling
[If exploratory] If foundational research text is not provided or empty, report
to the orchestrator. Do not generate questions without foundational context.
</instructions>

## Success Criteria
- <Dimension-specific success criteria>
- Each question has 2-4 specific, differentiated choices
- Recommendations include clear reasoning
- Output contains 5-8 questions focused on decisions that change skill content
```

The dimension-specific sections are handwritten for each of the 14 dimensions.
They do NOT use the build system — they are committed directly to `agents/shared/`.

### Build System Changes (`scripts/build-agents.sh`)

The build system changes from generating 5 files per type to generating 2 files per type:

1. **Research orchestrator** (`research.md`) — from the new `research.md` template
2. **Generate skill** (`generate-skill.md`) — from the existing `generate-skill.md` template

New config variables the build system parses:
- `DIMENSIONS_FOUNDATIONAL` — comma-separated dimension slugs
- `DIMENSIONS_EXPLORATORY` — comma-separated dimension slugs
- `DIMENSION_FOCUS__*` — per-dimension focus overrides
- `SKILL_TYPE` — new variable (value: the type name, e.g., `data-engineering`)

New placeholders the build system fills:
- `{{SKILL_TYPE}}` — the skill type name
- `{{FOUNDATIONAL_DIMENSION_INSTRUCTIONS}}` — generated from `DIMENSIONS_FOUNDATIONAL` + focus overrides
- `{{EXPLORATORY_DIMENSION_INSTRUCTIONS}}` — generated from `DIMENSIONS_EXPLORATORY` + focus overrides
- `{{DIMENSION_CATALOG_SUMMARY}}` — generated from all dimension agent files (name + description)

The build system reads each dimension's default focus from the dimension agent file
(parsed from the agent's markdown) and uses the type's focus override if present.

Example generated instruction block for data-engineering foundational:
```markdown
1. **research-entities** — Pass this focus: "Focus on dimensional entities
   (dimensions, fact tables, SCD history, surrogate keys)..."
   Entity examples: "e.g., for dimensional pipelines: dimensions, fact tables..."
2. **research-metrics** — Pass this focus: "Focus on pipeline health metrics,
   data quality scores, freshness SLAs..."
```

---

## 6. Impact on Steps 3 and Beyond

### Step 3: Detailed Research — No Changes

The `detailed-research` agent already works dynamically:
1. Reads `clarifications.md` (produced by consolidation in Step 1)
2. Identifies topic sections from the YAML frontmatter `sections` field
3. Spawns one sub-agent per section
4. Consolidates into `clarifications-detailed.md`

With dynamic dimensions, the sections in `clarifications.md` will reflect dimension
names (e.g., "Pipeline Patterns", "Historization") instead of the old generic names
("Domain Concepts & Metrics", "Practices & Edge Cases"). The detailed-research agent
is section-agnostic — it reads whatever sections exist and drills deeper. No changes needed.

### Step 5: Confirm Decisions — No Changes

The `confirm-decisions` agent reads `clarifications.md` and `clarifications-detailed.md`,
analyzing answers holistically. It's content-agnostic — it works with whatever questions
are present. The output (`decisions.md`) format is unchanged. No changes needed.

### Step 6: Generate Skill — No Changes

The `generate-skill` agent reads `decisions.md` and creates SKILL.md + reference files.
It's decision-driven, not research-structure-driven. No changes needed.

### Step 7: Validate Skill — No Changes

The `validate-skill` agent reads SKILL.md, reference files, `decisions.md`, and
`clarifications.md`. It validates content quality and decision coverage. No changes needed.

### Plugin Coordinator (SKILL.md) — No Changes

The coordinator invokes `skill-builder:{type_prefix}-research` for Step 1.
The orchestrator's internal dimension machinery is invisible to the coordinator.
No changes needed.

### App Workflow Store — No Changes

The workflow step definitions in `workflow-store.ts` are unchanged.
Step 0 (Research) still runs a single orchestrator agent.

---

## 7. Migration Path

### Phase 1: Create Dimension Agents (Low Risk)

**Goal:** Add all 14 shared dimension agents without changing any existing code.

1. Create `agents/shared/research-entities.md` — adapted from the entity sub-agent
   currently described inline in `research-concepts.md`
2. Create `agents/shared/research-metrics.md` — adapted from the metrics sub-agent
   currently described inline in `research-concepts.md`
3. Create the remaining 12 dimension agents with appropriate role descriptions,
   research instructions, and success criteria
4. Create `agents/shared/research-planner.md`

**Verification:** `./scripts/validate.sh` still passes. No existing agents are modified.

### Phase 2: Update Config Format (Low Risk)

**Goal:** Extend config.conf files with dimension declarations.

1. Add `DIMENSIONS_FOUNDATIONAL`, `DIMENSIONS_EXPLORATORY`, `DIMENSION_FOCUS__*`,
   and `SKILL_TYPE` to each type's `config.conf`
2. Keep old `FOCUS_LINE__*` keys for backward compatibility during transition

**Verification:** Old `build-agents.sh` still works (ignores new keys).

### Phase 3: Update Build System (Medium Risk)

**Goal:** Modify `build-agents.sh` to generate dimension-aware orchestrators.

1. Update `research.md` template to the new dimension-aware version
2. Remove `research-concepts.md`, `research-practices.md`, `research-implementation.md` templates
3. Update `build-agents.sh` to:
   - Parse new config variables (`DIMENSIONS_FOUNDATIONAL`, etc.)
   - Generate dimension instruction blocks for the orchestrator
   - Generate the dimension catalog summary
   - Only process `research.md` and `generate-skill.md` templates (skip removed ones)
4. Run `./scripts/build-agents.sh` to regenerate
5. Delete old generated files: `agents/{type}/research-concepts.md`,
   `agents/{type}/research-practices.md`, `agents/{type}/research-implementation.md`

**Verification:**
- `./scripts/build-agents.sh --check` passes
- Generated orchestrators contain correct dimension instructions
- `./scripts/validate.sh` passes

### Phase 4: Update Tests (Medium Risk)

**Goal:** Update test expectations for new agent count and structure.

1. Update T1 structural validation: agent count changes from 24 to 22
2. Update agent name expectations (new dimension agent names, removed old names)
3. Add dimension agent validation (verify all declared dimensions have corresponding files)
4. Run `./scripts/test-plugin.sh t1`

**Verification:** T1 passes with new expectations.

### Phase 5: Integration Test (High Value)

**Goal:** Verify the new research step produces quality output.

1. Run a full research step for each skill type in mock or dev mode
2. Compare `clarifications.md` output quality against the old fixed approach
3. Verify the planner produces sensible plans for various domains
4. Verify fallback to defaults when planner is disabled/fails
5. Run `./scripts/test-plugin.sh t2 t3` for plugin integration

**Verification:**
- Each type produces a well-structured `clarifications.md`
- Planner adjustments are sensible (not hallucinated dimensions)
- Fallback path works

### Phase 6: Cleanup (Low Risk)

1. Remove old `FOCUS_LINE__*` keys from config.conf files
2. Remove any transitional compatibility code
3. Update CLAUDE.md documentation for new architecture
4. Update test manifest

### Rollback Plan

At any phase, if issues are found:
- **Phase 1-2:** Simply delete new files. No existing code was modified.
- **Phase 3:** Restore old templates from git. Run `build-agents.sh` to regenerate old agents.
- **Phase 4-6:** Revert test changes. The architecture changes are in Phase 3.

---

## 8. Data Engineering Deep Dive

### Why Data Engineering Benefits Most

Data engineering skills for lakehouse silver/gold table modeling need research depth in
areas that the generic concepts/practices/implementation split doesn't cover well:

| Current Agent | What it covers | What it misses |
|---------------|---------------|----------------|
| research-concepts (entity + metrics) | Entities and KPIs | Pipeline load patterns, layer design |
| research-practices | Generic patterns and edge cases | SCD-specific trade-offs, quality gates |
| research-implementation | Technical decisions broadly | Historization depth, silver/gold boundaries |

The new 6-dimension structure for data-engineering covers each area with focused depth:

### Data Engineering Dimension Breakdown

#### Foundational: `entities`
**Focus:** Dimensional entities (dimensions, fact tables, SCD history, surrogate keys),
incremental load entities (watermarks, merge targets, change logs), streaming entities
(sources, sinks, windows, state stores).

**Key questions this dimension surfaces:**
- Which entities are dimensions vs. facts? (affects historization strategy downstream)
- What's the grain of each fact table? (affects aggregation in gold layer)
- Which entities need surrogate keys vs. natural keys? (affects merge strategies)
- What are the cardinality relationships? (affects join performance)

#### Foundational: `metrics`
**Focus:** Pipeline health metrics, data quality scores, freshness SLAs, reconciliation
patterns, and business metrics that drive aggregation design.

**Key questions:**
- What freshness SLAs exist per table? (affects materialization strategy)
- Which reconciliation patterns are needed? (affects quality gate design)
- What business metrics drive gold table design? (affects aggregation granularity)

#### Exploratory: `pipeline-patterns`
**Focus:** Load patterns (SCD types, incremental, CDC, streaming), merge strategies
(MERGE INTO, upsert, append-only), and transformation approaches.

**Key questions this surfaces (building on entity context):**
- For each dimension entity from Phase 1: which SCD type? (Type 1 for reference,
  Type 2 for tracking, Type 3 for both old/new)
- For each fact entity: full refresh or incremental? What's the high-water mark column?
- Merge strategy for upserts: MERGE INTO vs delete+insert vs append-only with dedup?
- How to handle late-arriving facts? (affects merge window sizing)

**Example clarification question:**
```markdown
### Q: What load pattern should the skill recommend for fact tables?
The entities research identified [N] fact tables with [grain description].
The load pattern affects pipeline cost, complexity, and data freshness.

**Choices:**
a) **Full refresh** — Simplest; replaces target entirely. Best for small tables
   or where the source doesn't provide reliable change timestamps.
b) **Timestamp-based incremental** — Loads records modified since last run.
   Handles 80% of cases but misses hard deletes.
c) **CDC (change data capture)** — Captures all operations from source logs.
   Most complete but requires source system support.
d) **Other (please specify)**

**Recommendation:** Option (b) — timestamp-based incremental is the best
default for most fact tables. The skill should recommend CDC as an upgrade
path for tables where delete detection matters (e.g., [entity from Phase 1]).

**Answer:**
```

#### Exploratory: `data-quality`
**Focus:** Cross-layer validation rules, reconciliation patterns, quality gates
between silver and gold, and pipeline testing strategies.

**Key questions (building on entity + metrics context):**
- What validation rules at silver layer ingestion? (schema, null checks, range checks)
- What reconciliation between source counts and silver counts?
- What quality gates before silver→gold promotion? (completeness thresholds, anomaly checks)
- What testing approach? (dbt tests, Great Expectations, custom assertions)

#### Exploratory: `historization`
**Focus:** SCD type selection per entity, snapshot strategies, event sourcing patterns,
bitemporal modeling for audit-critical data.

**Key questions (building on entity context):**
- For each dimension entity: which SCD type and why?
- Snapshot strategy: daily full snapshot vs. change-only rows?
- Bitemporal modeling: needed for any entities? (regulatory/audit requirements)
- History retention: how long? Archival strategy?

#### Exploratory: `silver-gold-design`
**Focus:** Layer separation, conformed dimensions, fact table granularity,
materialization, and aggregate patterns.

**Key questions (building on entity + metrics context):**
- Silver layer: cleansed source-conformed or business-conformed?
- Gold layer: star schema, one big table, or wide denormalized?
- Conformed dimensions: which entities span multiple fact tables?
- Materialization: physical tables vs. views vs. materialized views?
- Aggregate tables: pre-computed aggregates for [metrics from Phase 1]?

### Expected Output Quality Improvement

With the current 3-agent approach, a data-engineering skill for "sales pipeline lakehouse"
produces ~15-20 questions across concepts, practices, and implementation. Many questions
are generic ("How should you handle incremental loads?") because the agents don't have
enough context about the specific pipeline pattern.

With the 6-dimension approach:
- `entities` and `metrics` establish the domain vocabulary first
- `pipeline-patterns` asks about load strategies *for the specific entities identified*
- `historization` asks about SCD types *per identified dimension entity*
- `silver-gold-design` asks about layer patterns *for the identified metrics*
- `data-quality` asks about validation *across the identified pipeline stages*

This produces ~25-30 questions that are deeply anchored to the specific domain,
with each question's choices reflecting the actual entities and metrics at play.
The consolidation agent (opus) then merges these into ~18-22 high-quality questions
with much better domain specificity than the current approach.

### Example Planner Output for "Sales Pipeline Lakehouse"

```markdown
# Research Plan

## Skill: Sales Pipeline Lakehouse (data-engineering)

## Foundational Dimensions
1. **entities** — Focus: Focus on sales pipeline entities (opportunities, pipeline
   stages, accounts, contacts, products), their grain, and cardinality relationships.
   Emphasize the opportunity-to-account and opportunity-to-stage relationships.
   Entity examples: opportunities, pipeline stages, accounts, contacts, products,
   forecast categories, sales territories

2. **metrics** — Focus: Focus on sales pipeline metrics (conversion rates by stage,
   pipeline velocity, win rates, average deal size, forecast accuracy) and the
   calculation nuances that drive aggregation design in the gold layer.

## Exploratory Dimensions
1. **pipeline-patterns** — Focus: Focus on incremental loading for high-volume
   opportunity updates, CDC for stage transition tracking, and merge strategies
   for slowly-changing account hierarchies.

2. **data-quality** — Focus: Focus on pipeline stage transition validation
   (no backward jumps without reason), amount consistency checks, and
   duplicate opportunity detection.

3. **historization** — Focus: Focus on SCD Type 2 for accounts (territory
   changes, ownership changes) and pipeline stage snapshots for funnel analysis
   over time.

4. **silver-gold-design** — Focus: Focus on star schema with opportunity fact
   table at stage-transition grain, conformed account/contact/product dimensions,
   and pre-computed pipeline progression aggregates for sales dashboards.

## Adjustments Made
- Adjusted entity focus to emphasize sales-specific entities and their CRM relationships
- Adjusted metrics focus to include forecast accuracy (critical for sales pipelines)
- Adjusted historization focus to emphasize stage snapshots for funnel analysis
- No dimensions added or removed — defaults are appropriate for this domain
```

---

## Appendix: Open Questions

1. **Output examples per dimension?** Currently, output examples live in
   `agent-sources/types/{type}/output-examples/research-concepts.md`. With shared
   dimension agents, should output examples be:
   - (a) Per-dimension in `agent-sources/dimensions/{slug}/output-example.md`
   - (b) Per-type-per-dimension in `agent-sources/types/{type}/output-examples/research-{slug}.md`
   - (c) Removed — the dimension agent's instructions are sufficient

   **Recommendation:** Option (a). Each dimension has one output example showing
   the question format. Type-specific entity names are injected via the prompt, not the example.

2. **Extended thinking for planner?** The planner is an opus agent making a relatively
   simple decision. Should it use extended thinking (`effort: medium`)?

   **Recommendation:** Yes, `effort: medium`. The planner benefits from reasoning about
   domain-dimension fit, but it's not a deep analysis task.

3. **Planner for the plugin?** The plugin coordinator currently doesn't have a separate
   planner step. Should the plugin's research orchestrator also include the planner?

   **Recommendation:** Yes. The orchestrator template is shared between app and plugin.
   The planner runs as Phase 0 of the orchestrator in both contexts.
