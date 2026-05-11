# LiteLLM Budget Hierarchy

> **Status:** Draft
> **Parent:** [Model Settings](../README.md)

## LiteLLM Native Behavior

LiteLLM enforces budgets at three levels. The **most restrictive** limit wins at each level:

| Level | Scope | Configuration |
|---|---|---|
| **Global** | All keys, all users | `config.yaml` → `litellm_settings.max_budget` |
| **User** | All keys for that user | `POST /user/new` → `max_budget` |
| **Key** | That specific virtual key | `POST /key/generate` → `max_budget` |

### Per-Model Budgets

Both the global config and individual keys support per-model budget caps:

```yaml
# config.yaml — global per-model ceilings
litellm_settings:
  max_budget: 1000.0
  model_max_budget:
    gpt-4: 500.0
    claude-sonnet-4-5: 300.0
```

```json
// POST /key/generate — per-key per-model caps
{
  "user_id": "user-123",
  "max_budget": 100.0,
  "model_max_budget": {
    "gpt-4": 50.0,
    "claude-sonnet-4-5": 30.0
  }
}
```

Per-model budgets act as sub-caps within the key's total. If a model hits its per-model cap, it's blocked even if the key total has room. If the key total is hit, all models are blocked.

### How Limits Compose

```
Global max_budget: $1000
  Global model_max_budget: {gpt-4: $500, claude: $300}

  └── User A (max_budget: $500)
        └── Key 1 (max_budget: $100, model_max_budget: {gpt-4: $50})
              → gpt-4 capped at $50  (most restrictive: key-level model cap)
              → claude capped at $100 (key total, no per-model cap)

  └── User B (max_budget: $300)
        └── Key 2 (max_budget: $200, model_max_budget: {claude: $20})
              → gpt-4 capped at $200  (key total, no per-model cap)
              → claude capped at $20  (most restrictive: key-level model cap)
```

## How Skill Builder Uses Budgets

Skill Builder is a single-user desktop app. The user layer is eliminated entirely.

### Configuration

| Level | Skill Builder Setting | Value |
|---|---|---|
| Global | `config.yaml` → `max_budget` | `0` (unlimited) |
| User | Single shared user `"skill-builder"` | No budget cap |
| Key | Per-profile virtual key | From profile `budget_total` or `budget_monthly` |
| Per-model key | Per-profile per-model budget | From `llm_profile_models.budget` |

### Budget Resolution for a Profile Key

```
max_budget = budget_total.unwrap_or(budget_monthly)
```

If both are set, `budget_total` takes precedence. If neither is set, the key has no budget cap (relies on global unlimited).

### Per-Model Budgets

Each model in a profile can optionally have its own budget cap. Models without a per-model budget inherit the key's total cap.

```
Profile "Pro" (max_budget: $100)
  ├── gpt-4: budget $50
  └── claude-sonnet-4-5: budget $30
  └── gemini-pro: no per-model cap → inherits $100 key total
```

### Schema

**`llm_profiles`**

| Column | Type | Description |
|---|---|---|
| `budget_total` | REAL | Lifetime budget in USD |
| `budget_monthly` | REAL | Monthly budget in USD (fallback if `budget_total` is null) |

**`llm_profile_models`**

| Column | Type | Description |
|---|---|---|
| `budget` | REAL | Per-model budget cap in USD (optional) |
