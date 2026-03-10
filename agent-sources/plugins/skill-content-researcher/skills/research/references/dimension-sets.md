# Dimension Sets by Purpose

---

## Dimension Slug Reference

| Slug | Full Name |
|------|-----------|
| `entities` | Entity & Relationship Research |
| `metrics` | Metrics Research |
| `data-quality` | Data Quality Research |
| `business-rules` | Business Rules Research |
| `segmentation-and-periods` | Segmentation & Periods Research |
| `modeling-patterns` | Modeling Patterns Research |
| `pattern-interactions` | Pattern Interactions Research |
| `load-merge-patterns` | Load & Merge Patterns Research |
| `historization` | Historization Research |
| `layer-design` | Layer Design Research |
| `platform-behavioral-overrides` | Platform Behavioral Overrides Research |
| `config-patterns` | Config Patterns Research |
| `integration-orchestration` | Integration & Orchestration Research |
| `operational-failure-modes` | Operational Failure Modes Research |
| `extraction` | Extraction Research |
| `field-semantics` | Field Semantics Research |
| `lifecycle-and-state` | Lifecycle & State Research |
| `reconciliation` | Reconciliation Research |

---

## Domain Dimensions (Business process knowledge)

| # | Dimension Name | Slug | Dimension Spec |
|---|----------------|------|----------------|
| 1 | Entity & Relationship Research | `entities` | `references/dimensions/entities.md` |
| 2 | Data Quality Research | `data-quality` | `references/dimensions/data-quality.md` |
| 3 | Metrics Research | `metrics` | `references/dimensions/metrics.md` |
| 4 | Business Rules Research | `business-rules` | `references/dimensions/business-rules.md` |
| 5 | Segmentation & Periods Research | `segmentation-and-periods` | `references/dimensions/segmentation-and-periods.md` |
| 6 | Modeling Patterns Research | `modeling-patterns` | `references/dimensions/modeling-patterns.md` |

---

## Data-Engineering Dimensions (Organization specific data engineering standards)

| # | Dimension Name | Slug | Dimension Spec |
|---|----------------|------|----------------|
| 1 | Entity & Relationship Research | `entities` | `references/dimensions/entities.md` |
| 2 | Data Quality Research | `data-quality` | `references/dimensions/data-quality.md` |
| 3 | Pattern Interactions Research | `pattern-interactions` | `references/dimensions/pattern-interactions.md` |
| 4 | Load & Merge Patterns Research | `load-merge-patterns` | `references/dimensions/load-merge-patterns.md` |
| 5 | Historization Research | `historization` | `references/dimensions/historization.md` |
| 6 | Layer Design Research | `layer-design` | `references/dimensions/layer-design.md` |

---

## Platform Dimensions (Organization specific Azure or Fabric standards)

| # | Dimension Name | Slug | Dimension Spec |
|---|----------------|------|----------------|
| 1 | Entity & Relationship Research | `entities` | `references/dimensions/entities.md` |
| 2 | Platform Behavioral Overrides Research | `platform-behavioral-overrides` | `references/dimensions/platform-behavioral-overrides.md` |
| 3 | Config Patterns Research | `config-patterns` | `references/dimensions/config-patterns.md` |
| 4 | Integration & Orchestration Research | `integration-orchestration` | `references/dimensions/integration-orchestration.md` |
| 5 | Operational Failure Modes Research | `operational-failure-modes` | `references/dimensions/operational-failure-modes.md` |

---

## Source Dimensions (Source system customizations)

| # | Dimension Name | Slug | Dimension Spec |
|---|----------------|------|----------------|
| 1 | Entity & Relationship Research | `entities` | `references/dimensions/entities.md` |
| 2 | Data Quality Research | `data-quality` | `references/dimensions/data-quality.md` |
| 3 | Extraction Research | `extraction` | `references/dimensions/extraction.md` |
| 4 | Field Semantics Research | `field-semantics` | `references/dimensions/field-semantics.md` |
| 5 | Lifecycle & State Research | `lifecycle-and-state` | `references/dimensions/lifecycle-and-state.md` |
| 6 | Reconciliation Research | `reconciliation` | `references/dimensions/reconciliation.md` |

---

## Applicability Matrix

| Slug | domain | data-engineering | platform | source |
|------|--------|-----------------|----------|--------|
| `entities` | Y | Y | Y | Y |
| `metrics` | Y | - | - | - |
| `data-quality` | Y | Y | - | Y |
| `business-rules` | Y | - | - | - |
| `segmentation-and-periods` | Y | - | - | - |
| `modeling-patterns` | Y | - | - | - |
| `pattern-interactions` | - | Y | - | - |
| `load-merge-patterns` | - | Y | - | - |
| `historization` | - | Y | - | - |
| `layer-design` | - | Y | - | - |
| `platform-behavioral-overrides` | - | - | Y | - |
| `config-patterns` | - | - | Y | - |
| `integration-orchestration` | - | - | Y | - |
| `operational-failure-modes` | - | - | Y | - |
| `extraction` | - | - | - | Y |
| `field-semantics` | - | - | - | Y |
| `lifecycle-and-state` | - | - | - | Y |
| `reconciliation` | - | - | - | Y |
