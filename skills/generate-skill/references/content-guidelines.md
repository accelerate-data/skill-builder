## Content Principles

1. **Omit what LLMs already know** — standard SQL syntax, basic dbt commands (`dbt run`, `dbt test`), general Python, well-documented REST APIs. Test: "Would Claude produce correct output without the skill?"
2. **Focus on stack-specific gotchas** — Fabric/T-SQL quirks, dlt-to-dbt handoff patterns, elementary test placement by layer, OIDC federation setup. These are where LLMs consistently fail.
3. **Guide WHAT and WHY, not HOW** — "Silver models need lookback windows for late-arriving data because..." not step-by-step dbt tutorials. Exception: be prescriptive when exactness matters (metric formulas, surrogate key macros, CI pipeline YAML).
4. **Calibrate to the medallion architecture** — every data skill has a layer context (bronze/silver/gold). Content should address the right layer's constraints and patterns.

## Stack Conventions

Hard-to-find knowledge that improves every skill for this stack.

### dbt (silver + gold)

- **Naming**: `stg_<source>__<entity>` (staging), `int_<entity>_<verb>` (intermediate), `fct_`/`dim_` (marts). Double underscore `__` separates source from entity.
- **Materialization**: staging → view, intermediate → ephemeral or view, marts → table or incremental. On Fabric: NO ephemeral (unsupported by dbt-fabric).
- **1:1 staging rule**: one staging model per source table, NO joins, `source()` ONLY in staging. Marts never reference `source()` directly.
- **Incremental**: lookback windows for late-arriving data. `is_incremental()` is false on first run. Default to `merge` strategy. Schedule periodic `--full-refresh`.
- **Surrogate keys**: `generate_surrogate_key()` (not deprecated `surrogate_key()`).
- **Fabric-specific**: `tsql-utils` instead of `dbt-utils`. ServicePrincipal auth only. Delta mandatory.
- **Packages**: tsql-utils, dbt-expectations, dbt-project-evaluator, elementary dbt package.

### dlt (bronze / ingestion)

- **EL only** — extract and load. All transformations happen in dbt.
- **Hierarchy**: Source → Resource → Transformer decorators. Resources are the extraction unit.
- **Schema contracts**: `evolve` (dev), `freeze` (prod).
- **Raw bronze**: `max_table_nesting=0` preserves JSON structure. `_dlt_load_id` bridges to dbt incremental models.
- **Azure**: filesystem destination → ADLS Gen2, Delta format. OneLake URLs need workspace/lakehouse GUIDs (not display names).
- **Config**: `secrets.toml` (gitignored) + `config.toml` (safe to commit). Env vars override both.

### elementary (observability)

- **Two components**: dbt package (collects in warehouse) + `edr` CLI (reports/alerts). Don't confuse them.
- **Tests by layer**: bronze → `schema_changes_from_baseline`, `volume_anomalies`. Silver → `column_anomalies`, `all_columns_anomalies`. Gold → `exposure_schema_validity`, `dimension_anomalies`.
- **Critical**: always set `timestamp_column`. Start `severity: warn`, promote to `error` after 1-2 weeks.
- **Volume**: `fail_on_zero: true` for tables that should never be empty.
- **No official Fabric adapter** — relies on dbt test + tsql-utils compatibility.

### Microsoft Fabric / Azure

- **Lakehouse**: `/Tables` (Delta, auto-discovered by SQL analytics) vs `/Files` (raw, not auto-discovered). Target `/Tables` for queryable data.
- **SQL analytics endpoint is READ-ONLY** — no INSERT/UPDATE/DELETE.
- **Medallion**: separate lakehouses per layer, Shortcuts for cross-layer references.
- **Liquid Clustering** instead of Hive-style partitioning on silver/gold.
- **Cost**: Python notebooks = 1 CU/second. Prefer over Spark unless data volume requires it.

### GitHub CI/CD

- **Slim CI**: `dbt build --select state:modified+ --defer --state ./prod-manifest/`. Use `dbt build` (not separate run + test).
- `--empty` flag (dbt 1.8+): schema-only dry runs before full materialization.
- **Azure auth**: OIDC federation, separate credentials for `refs/heads/main` vs `pull_request`.
- **CI schemas**: `ci_pr_<number>` — clean up on PR close.
- **Linting**: SQLFluff with `--format github-annotation-native` for inline PR annotations.
- **Manifest lifecycle**: upload after deploy, download for slim CI.

---

## Common Anti-patterns

What LLMs consistently get wrong about this stack.

- `source()` in marts — only staging models use `source()`. Everything else uses `ref()`.
- **Joins in staging** — staging is 1:1 with source tables.
- **Confusing dlt with Databricks DLT** — completely different tools.
- **Assuming dlt does transformations** — dlt is EL only, T happens in dbt.
- **Missing `__` in staging names** — `stg_stripe__payments` not `stg_stripe_payments`.
- `dbt-utils` on Fabric — must use `tsql-utils`.
- **SQL auth on Fabric** — unsupported. ServicePrincipal only.
- **Ephemeral on Fabric** — unsupported by dbt-fabric.
- **Writing via SQL analytics endpoint** — it's read-only.
- `dbt run` + `dbt test` in CI — use `dbt build` (DAG-ordered).
- **Missing `timestamp_column` in elementary** — anomaly detection fails silently.
- **Hallucinating dlt connectors** — verify against dlt verified sources.

---

## Output Paths

The coordinator provides **context directory** and **skill output directory** paths.
- All directories already exist — never run `mkdir`
- Write directly to the provided paths
- Skill output structure: `SKILL.md` at root + `references/` subfolder
