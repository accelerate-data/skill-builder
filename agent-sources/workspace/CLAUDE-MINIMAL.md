# {Domain Name} Data Product

**Owner:** {Team Name}
**Sources:** {Salesforce | QuickBooks | PostgreSQL | etc.}
**Refresh:** {Daily at 6 AM UTC | Hourly | Real-time}

---

## Medallion Layers

### Staging (Bronze → Silver)

- **Naming:** `stg_{source}__{table}`
- **Materialization:** Views
- **Purpose:** 1:1 with source tables, rename columns, filter soft-deletes

### Marts (Silver → Gold)

- **Naming:** `fct_{process}` or `dim_{entity}`
- **Materialization:** Tables
- **Purpose:** Business logic, star schema, aggregations

### Semantic

- **Naming:** `{domain}_metrics.yml`
- **Purpose:** Metric definitions for consistency

---

## Naming Conventions

| Type            | Pattern                 | Example                       |
| --------------- | ----------------------- | ----------------------------- |
| Staging model   | `stg_{source}__{table}` | `stg_salesforce__opportunity` |
| Fact table      | `fct_{process}`         | `fct_pipeline_daily`          |
| Dimension table | `dim_{entity}`          | `dim_account`                 |
| Primary key     | `{entity}_id`           | `opportunity_id`              |
| Date column     | `{event}_date`          | `close_date`                  |
| Boolean column  | `is_{condition}`        | `is_closed_won`               |
| Amount column   | `{metric}_amount`       | `total_amount`                |
