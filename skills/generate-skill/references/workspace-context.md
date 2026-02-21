# Skill Builder — Agent Instructions

Auto-loaded into every agent's system prompt. Do not read manually.

## Domain Focus

This workspace generates skills for **dbt on Microsoft Fabric**. Every agent operates in this context by default.

| Layer | Tool | Role |
|---|---|---|
| Ingestion (bronze) | **dlt** (dlthub) | EL pipelines → ADLS Gen2 / OneLake |
| Transformation (silver/gold) | **dbt** (dbt-fabric adapter) | SQL models in medallion architecture |
| Observability | **elementary** | Anomaly detection, schema monitoring |
| Platform | **Microsoft Fabric** on Azure | Lakehouse, Delta tables, SQL analytics |
| CI/CD | **GitHub Actions** | Slim CI, OIDC auth, SQLFluff |

**This is not generic dbt.** The dbt-fabric adapter has behaviors that differ from Snowflake, BigQuery, and Redshift — and from official dbt documentation:
- `merge` strategy silently degrades on Lakehouse endpoints; workarounds are required
- `datetime2` precision causes snapshot failures in certain Fabric configurations
- Warehouse vs. Lakehouse endpoints change which SQL features and materializations are available
- Incremental materialization options and their behavior differ from standard dbt docs

**Default lens for all agents**: Orient research, examples, configurations, failure modes, and anti-patterns to dbt on Fabric unless `user-context.md` explicitly states otherwise. Surface Fabric-specific behaviors, dbt-fabric adapter constraints, and Delta table semantics rather than generic dbt guidance.

**Documentation source**: [Context7](https://context7.com) provides up-to-date docs and code examples for all libraries in this stack. Use Context7 (`resolve-library-id` → `query-docs`) to look up current API docs, configuration references, and code patterns. Skills should NOT rehash what Context7 already provides — focus on the delta: what the docs say vs. what Fabric actually does, what breaks in practice, what's missing from official documentation.

## Protocols

### User Context

The user's `user-context.md` file (in the workspace directory) contains their industry, role, audience, challenges, scope, unique setup, and what Claude gets wrong. Every agent must use this context to tailor output.

**Resolution order:**
1. **Inline** — orchestrators embed the full `user-context.md` content in sub-agent prompts under a `## User Context` heading. Use this first.
2. **File fallback** — if inline content is missing, read `user-context.md` from the workspace directory.
3. **Report missing** — if both fail, prefix your response with `[USER_CONTEXT_MISSING]` and continue with best effort. Parent orchestrators detect this marker and warn in their output.

**Orchestrator responsibility:** Read `user-context.md` early (Phase 0) and embed inline in every sub-agent prompt. Pass the workspace directory path as fallback.

**Workspace directory contents:** The workspace directory only contains `user-context.md`. Do not read or list any other files or subdirectories (e.g. `logs/`).

### Scope Recommendation Guard

When `scope_recommendation: true` appears in the YAML frontmatter of `clarifications.md` or `decisions.md`, the scope was too broad and a recommendation was issued instead of normal output. Every agent that runs after research (detailed-research, confirm-decisions, generate-skill, validate-skill) must check this before starting work. If detected: write any required stub output files (see agent-specific instructions), then return immediately. Do NOT spawn sub-agents, analyze content, or generate output.

### Delegation Policy

Use the lightest option that fits:

1. **Inline** — trivial: single-file read, direct answer, one-liner computation
2. **Task sub-agents** — independent workstreams with no mid-task coordination

#### Model Tiers

| Tier | Model | When |
|---|---|---|
| Reasoning | sonnet | Planning, scoring, consolidation |
| Generation | default | Research, writing, analysis |
| Lightweight | haiku | Counting, metadata extraction, simple classification |

#### Sub-agent Rules

- Launch ALL Task calls in the **same turn** so they run in parallel.
- Sub-agents return text, not files — the orchestrator writes all output to disk.
- Include this directive in every sub-agent prompt:
  > Return your complete output as text. Do not write files. List outcomes, not process.
- Scoped prompts with clear deliverables — tell the sub-agent exactly what to produce.
- If a sub-agent fails, note the failure in the output and continue with available results.

---

## Output Paths

The coordinator provides **context directory** and **skill output directory** paths.
- All directories already exist — never run `mkdir`
- Write directly to the provided paths
- Skill output structure: `SKILL.md` at root + `references/` subfolder

## Customization

Add your workspace-specific instructions below. This section is preserved across app updates and skill changes.
