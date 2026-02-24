# Data Engineering Patterns

Stack conventions and anti-patterns for dbt/dlt/elementary/Fabric.

## Contents
- [dbt (silver + gold)](#dbt-silver--gold)
- [dlt (bronze / ingestion)](#dlt-bronze--ingestion)
- [elementary (observability)](#elementary-observability)
- [Microsoft Fabric / Azure](#microsoft-fabric--azure)
- [GitHub CI/CD](#github-cicd)
- [Common Anti-patterns](#common-anti-patterns)

## dbt (silver + gold)

- **Naming**: `stg_<source>__<entity>`, `int_<entity>_<verb>`, `fct_`/`dim_`. Double underscore `__` separates source from entity.
- **Materialization**: staging=view, intermediate=ephemeral/view, marts=table/incremental. Fabric: NO ephemeral.
- **1:1 staging rule**: one model per source table, NO joins, `source()` ONLY in staging.
- **Incremental**: lookback windows for late-arriving data. `is_incremental()` false on first run. Default `merge`. Schedule periodic `--full-refresh`.
- **Surrogate keys**: `generate_surrogate_key()` (not deprecated `surrogate_key()`).
- **Fabric-specific**: `tsql-utils` not `dbt-utils`. ServicePrincipal auth only. Delta mandatory.
- **Packages**: tsql-utils, dbt-expectations, dbt-project-evaluator, elementary dbt package.

## dlt (bronze / ingestion)

- **EL only** — all transformations in dbt.
- **Hierarchy**: Source > Resource > Transformer decorators.
- **Schema contracts**: `evolve` (dev), `freeze` (prod).
- **Raw bronze**: `max_table_nesting=0` preserves JSON. `_dlt_load_id` bridges to dbt incremental.
- **Azure**: filesystem destination to ADLS Gen2, Delta format. OneLake URLs need workspace/lakehouse GUIDs.
- **Config**: `secrets.toml` (gitignored) + `config.toml` (committable). Env vars override both.

## elementary (observability)

- **Two components**: dbt package (warehouse) + `edr` CLI (reports/alerts).
- **Tests by layer**: bronze=`schema_changes_from_baseline`, `volume_anomalies`. Silver=`column_anomalies`, `all_columns_anomalies`. Gold=`exposure_schema_validity`, `dimension_anomalies`.
- Always set `timestamp_column`. Start `severity: warn`, promote to `error` after stabilization.
- `fail_on_zero: true` for tables that should never be empty.
- No official Fabric adapter — relies on dbt test + tsql-utils compatibility.

## Microsoft Fabric / Azure

- **Lakehouse**: `/Tables` (Delta, auto-discovered) vs `/Files` (raw, not auto-discovered). Target `/Tables`.
- **SQL analytics endpoint is READ-ONLY**.
- **Medallion**: separate lakehouses per layer, Shortcuts for cross-layer references.
- **Liquid Clustering** instead of Hive-style partitioning.
- **Cost**: Python notebooks = 1 CU/second. Prefer over Spark unless volume requires it.

## GitHub CI/CD

- **Slim CI**: `dbt build --select state:modified+ --defer --state ./prod-manifest/`. Use `dbt build` not separate run + test.
- `--empty` flag (dbt 1.8+): schema-only dry runs.
- **Azure auth**: OIDC federation, separate credentials for `refs/heads/main` vs `pull_request`.
- **CI schemas**: `ci_pr_<number>` — clean up on PR close.
- **Linting**: SQLFluff with `--format github-annotation-native`.
- **Manifest lifecycle**: upload after deploy, download for slim CI.

## Common Anti-patterns

- `source()` in marts — only staging uses `source()`, everything else uses `ref()`.
- Joins in staging — staging is 1:1 with source tables.
- Confusing dlt (dlthub) with Databricks DLT.
- Assuming dlt does transformations — EL only.
- Missing `__` in staging names — `stg_stripe__payments` not `stg_stripe_payments`.
- `dbt-utils` on Fabric — use `tsql-utils`.
- SQL auth on Fabric — ServicePrincipal only.
- Ephemeral on Fabric — unsupported.
- Writing via SQL analytics endpoint — read-only.
- `dbt run` + `dbt test` in CI — use `dbt build`.
- Missing `timestamp_column` in elementary — anomaly detection fails silently.
- Hallucinating dlt connectors — verify against dlt verified sources.
