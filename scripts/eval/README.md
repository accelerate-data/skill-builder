# Skill Evaluation Harness

LLM-as-judge evaluation framework for measuring skill quality, cost, and performance.

## Overview

The evaluation harness compares Claude's responses with and without skills (baseline mode) or between two skill versions (compare mode). It uses two LLM judges: a quality judge scoring responses across four dimensions aligned with the Skill Builder's validation criteria, and a Claude best practices judge evaluating three additional dimensions for compliance with Anthropic's official skill design guidelines (7 dimensions total, max 35 points).

## Quick Start

```bash
# Baseline: Does the skill improve output quality?
./scripts/eval/eval-skill-quality.sh \
  --baseline path/to/SKILL.md \
  --prompts scripts/eval/prompts/data-engineering.txt

# Compare: Which skill version is better?
./scripts/eval/eval-skill-quality.sh \
  --compare skills/v1/SKILL.md skills/v2/SKILL.md \
  --prompts scripts/eval/prompts/domain.txt

# JSON output for programmatic analysis
./scripts/eval/eval-skill-quality.sh \
  --baseline path/to/SKILL.md \
  --prompts scripts/eval/prompts/platform.txt \
  --format json \
  --output results/platform-eval-$(date +%Y%m%d).json

# Dry run to validate inputs
./scripts/eval/eval-skill-quality.sh \
  --baseline skill.md \
  --prompts prompts.txt \
  --dry-run
```

## Directory Structure

```text
scripts/eval/
├── README.md                      # This file
├── eval-skill-quality.sh          # Main evaluation script
├── prompts/                       # Test prompts by skill type
│   ├── data-engineering.txt       # 5 prompts for data engineering skills
│   ├── domain.txt                 # Prompts for domain-specific skills
│   ├── platform.txt               # Prompts for platform skills
│   └── source.txt                 # Prompts for source extraction skills
└── results/                       # Evaluation outputs (gitignored)
```

## Evaluation Modes

### Baseline Mode

Compares skill-loaded responses vs no-skill responses to answer: **Does the skill improve output quality?**

```bash
./scripts/eval/eval-skill-quality.sh \
  --baseline path/to/SKILL.md \
  --prompts scripts/eval/prompts/data-engineering.txt
```

**Use when:**

- Validating a new skill before deployment
- Measuring skill effectiveness
- Deciding whether to keep or revise a skill

### Compare Mode

Compares two skill versions head-to-head to answer: **Which skill version is better?**

```bash
./scripts/eval/eval-skill-quality.sh \
  --compare skills/v1/SKILL.md skills/v2/SKILL.md \
  --prompts scripts/eval/prompts/domain.txt
```

**Use when:**

- A/B testing skill improvements
- Evaluating skill refactoring
- Choosing between alternative skill designs

## Evaluation Rubric

Responses are scored across two judge passes totaling 7 dimensions (max 35 points).

### Quality Dimensions (both variants, max 20)

These align with the Skill Builder's validate agent criteria. Both variant A and variant B are scored.

#### 1. Actionability (1-5)

Could an engineer follow this response to implement the pattern in a real system?

- **1** = Too abstract to act on
- **5** = Ready to implement with clear steps and decisions

#### 2. Specificity (1-5)

Are the instructions concrete with specific implementation details (SQL/code examples, exact patterns, named strategies)?

- **1** = Vague/generic boilerplate
- **5** = Highly specific with concrete examples

#### 3. Domain Depth (1-5)

Does the response demonstrate deep domain knowledge — hard-to-find rules, edge cases, non-obvious entity relationships, industry-specific pitfalls?

- **1** = Surface-level/common knowledge
- **5** = Expert-level domain insight

#### 4. Self-Containment (1-5)

Does the response provide enough context to be useful standalone — WHAT and WHY (entities, metrics, business rules, trade-offs)?

- **1** = Requires significant external context
- **5** = Fully self-contained guidance

### Claude Best Practices Dimensions (skill A only, max 15)

These evaluate how well the skill follows Anthropic's official best practices for Claude Agent Skills. Only the skill-loaded variant (A) is scored.

#### 5. Progressive Disclosure (1-5)

Is content organized for efficient loading with clear layering?

- **1** = Monolithic blob with everything in one file
- **5** = Perfectly layered: clear name/description for discovery, core content in SKILL.md, details in references

#### 6. Structure & Organization (1-5)

Is the skill organized like an onboarding guide with clear flow?

- **1** = Chaotic, no clear structure or separation of concerns
- **5** = Exemplary structure: clear flow from overview to specifics, appropriate separation

#### 7. Claude-Centric Design (1-5)

Is the skill written from Claude's perspective with clear instructions?

- **1** = Confusing: unclear when to trigger, ambiguous instructions
- **5** = Perfectly clear: obvious triggers, unambiguous instructions, handles common failure modes

### Scoring Summary

| Category | Dimensions | Max Score | Applies To |
|---|---|---|---|
| Quality | 4 (actionability, specificity, domain depth, self-containment) | 20 | Both variants |
| Claude Best Practices | 3 (progressive disclosure, structure, claude-centric design) | 15 | Skill A only |
| **Combined** | **7** | **35** | **Skill A** |

## Test Prompts

Test prompts are organized by skill type in `scripts/eval/prompts/`. Each file contains prompts separated by `---` delimiters.

### Available Prompt Sets

- **data-engineering.txt** — 5 prompts for data engineering skills (DQ, testing, engineering standards)
- **domain.txt** — Prompts for domain-specific skills (business process logic, allocation rules, filters)
- **platform.txt** — Prompts for platform skills (dbt, Fabric, tool-specific standards)
- **source.txt** — Prompts for source extraction skills (join conditions, API quirks, source-specific gotchas)

### Prompt Format

```text
First prompt text here.
Can span multiple lines.
---
Second prompt text here.
Also can span multiple lines.
---
Third prompt text here.
```

### Creating New Prompts

When creating test prompts, focus on scenarios where skills should provide value:

1. **Analytics engineer perspective** — Building silver/gold models, not raw extraction
2. **Real-world complexity** — Edge cases, business rules, domain-specific patterns
3. **Actionable guidance needed** — Situations where generic LLM knowledge isn't enough
4. **Self-contained** — Prompts should be clear without external context

**Example (data-engineering.txt):**

```text
I'm building a silver layer customer table in dbt. What data quality checks should I implement, and how should I structure them?
---
I need to test my dbt models. What testing strategy should I use for dimension tables vs fact tables?
```

## Output Formats

### Markdown (default)

Human-readable report with:

- Configuration summary
- Per-prompt results table
- Dimension averages
- Verdict with winner

```bash
./scripts/eval/eval-skill-quality.sh \
  --baseline skill.md \
  --prompts prompts.txt \
  --output report.md
```

### JSON

Machine-readable format for programmatic analysis, CI/CD integration, or time-series tracking.

```bash
./scripts/eval/eval-skill-quality.sh \
  --baseline skill.md \
  --prompts prompts.txt \
  --format json \
  --output results.json
```

**JSON Schema:**

```json
{
  "metadata": {
    "mode": "baseline|compare",
    "perspective": "quality|cost|performance|all",
    "timestamp": "ISO-8601 timestamp",
    "judge_model": "model name",
    "response_model": "model name",
    "skill_a": "path to skill A",
    "skill_b": "path to skill B or null",
    "prompts_file": "path to prompts file",
    "total_prompts": int,
    "evaluated": int,
    "failed": int,
    "pricing": {"input_cost_per_mtok": float, "output_cost_per_mtok": float},
    "skill_tokens_a": int,
    "skill_tokens_b": int | null
  },
  "prompts": [
    {
      "index": int,
      "label": "prompt preview text",
      "variant_a": {
        "actionability": int,
        "specificity": int,
        "domain_depth": int,
        "self_containment": int,
        "progressive_disclosure": int,
        "structure_organization": int,
        "claude_centric_design": int,
        "quality_total": int,
        "practices_total": int,
        "total": int,
        "performance": {
          "latency_ms": int, "ttft_ms": int, "success": bool, "retries": int,
          "tokens_per_second": float, "skill_discovery_ms": int,
          "progressive_levels": int
        },
        "cost": {
          "input_tokens": int, "output_tokens": int, "total_tokens": int,
          "skill_tokens": int, "estimated_cost_usd": float,
          "cost_per_quality_point": float | null, "token_source": str
        }
      },
      "variant_b": {
        "actionability": int,
        "specificity": int,
        "domain_depth": int,
        "self_containment": int,
        "total": int,
        "performance": {
          "latency_ms": int, "ttft_ms": int, "success": bool, "retries": int,
          "tokens_per_second": float, "skill_discovery_ms": int,
          "progressive_levels": int
        },
        "cost": {
          "input_tokens": int, "output_tokens": int, "total_tokens": int,
          "skill_tokens": int, "estimated_cost_usd": float,
          "cost_per_quality_point": float | null, "token_source": str
        }
      },
      "explanation": "quality judge explanation text",
      "claude_practices_explanation": "best practices judge explanation text"
    }
  ],
  "averages": {
    "variant_a": {
      "actionability": float, "specificity": float,
      "domain_depth": float, "self_containment": float,
      "progressive_disclosure": float, "structure_organization": float,
      "claude_centric_design": float,
      "quality_total": float, "practices_total": float, "total": float,
      "performance": {
        "latency_ms": float, "ttft_ms": float, "success_rate": float,
        "tokens_per_second": float, "skill_discovery_ms": int,
        "progressive_levels": int
      },
      "cost": {
        "avg_input_tokens": float, "avg_output_tokens": float,
        "avg_total_tokens": float, "avg_cost_usd": float, "total_cost_usd": float
      }
    },
    "variant_b": {
      "actionability": float, "specificity": float,
      "domain_depth": float, "self_containment": float, "total": float,
      "performance": {
        "latency_ms": float, "ttft_ms": float, "success_rate": float,
        "tokens_per_second": float, "skill_discovery_ms": int,
        "progressive_levels": int
      },
      "cost": {
        "avg_input_tokens": float, "avg_output_tokens": float,
        "avg_total_tokens": float, "avg_cost_usd": float, "total_cost_usd": float
      }
    },
    "quality_delta": float,
    "delta": float,
    "cost": {
      "token_delta_pct": float, "cost_delta_pct": float,
      "total_eval_cost_usd": float, "winner": "A|B|TIE"
    }
  },
  "verdict": {
    "winner": "A|B|TIE",
    "message": "verdict message"
  },
  "recommendations": {
    "quality": ["..."],
    "claude_practices": ["..."],
    "cost": ["..."],
    "performance": ["..."]
  },
  "production_readiness": {
    "quality_score": "28.0/35",
    "quality_pass": bool,
    "practices_pass": bool,
    "cost_pass": bool,
    "performance_pass": bool,
    "status": "READY|NOT READY",
    "blockers": ["..."]
  }
}
```

## Environment Variables

### Required

- **ANTHROPIC_API_KEY** — API key for Claude (both response generation and judging)

### Optional

- **CLAUDE_BIN** — Path to claude binary (default: `claude`)
- **JUDGE_MODEL** — Model for the judge LLM (default: `sonnet`)
- **RESPONSE_MODEL** — Model for generating responses (default: `sonnet`)
- **MAX_TOKENS** — Max tokens per response (default: `4096`)
- **VERBOSE** — Set to `1` for verbose output (default: `0`)
- **INPUT_COST_PER_MTOK** — Input cost per million tokens in USD (default: `3.00` for Sonnet)
- **OUTPUT_COST_PER_MTOK** — Output cost per million tokens in USD (default: `15.00` for Sonnet)

### Example

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export JUDGE_MODEL="sonnet"
export RESPONSE_MODEL="sonnet"
export VERBOSE=1

./scripts/eval/eval-skill-quality.sh \
  --baseline skill.md \
  --prompts prompts.txt
```

## Cost Estimation

Based on actual runs with Claude Sonnet:

- **Per prompt:** ~$0.70-1.40 (2 response generations + 2 judge calls)
- **5-prompt evaluation:** ~$4-7
- **Full skill type suite (4 × 5 prompts):** ~$16-28

**Cost breakdown:**

1. Generate response A (with skill) — ~$0.15-0.30
2. Generate response B (without skill or with skill B) — ~$0.15-0.30
3. Quality judge comparison — ~$0.20-0.40
4. Claude best practices judge — ~$0.20-0.40

**Tips to reduce costs:**

- Use smaller prompt sets during development
- Run full evaluations only before deployment
- Use `--dry-run` to validate inputs before running

## Reliability & Retries

The harness includes automatic retry logic with exponential backoff:

- **Max retries:** 3 attempts per response generation
- **Timeout:** 120 seconds per response
- **Backoff:** 2s, 4s, 8s between retries
- **Failure handling:** Skips failed prompts, continues evaluation

**Common failure scenarios:**

- API rate limits (retries with backoff)
- Network timeouts (retries with timeout enforcement)
- Model overload (retries with exponential backoff)

## Skill Loading Mechanism

The harness uses Claude Code's `--plugin-dir` mechanism to load skills, testing the actual skill loading behavior rather than appending to system prompt.

**How it works:**

1. Creates temporary plugin directory for each skill
2. Copies skill to `skills/test-skill/SKILL.md`
3. Generates minimal `plugin.json` manifest
4. Passes `--plugin-dir` to Claude CLI
5. Claude loads skill via standard plugin mechanism

**Why this matters:**

- Tests real skill loading behavior
- Validates skill discovery and activation
- Ensures skills work as they would in production

## Interpreting Results

### Winner Determination

- **Winner A:** Variant A scores > 0.5 points higher on average
- **Winner B:** Variant B scores > 0.5 points higher on average
- **Tie:** Difference < 0.5 points

### Baseline Mode Interpretation

**Skill wins (positive delta):**

- Skill improves output quality
- Deploy with confidence
- Consider expanding to related domains

**No skill wins (negative delta):**

- Skill doesn't add value or makes things worse
- Revise skill content
- Check if prompts match skill's intended use case

**Tie (delta near zero):**

- Skill provides marginal value
- Consider if maintenance cost is worth it
- May need more specific/targeted skill content

### Compare Mode Interpretation

**Clear winner (delta > 2.0):**

- Significant improvement
- Deploy winning version

**Marginal difference (0.5 < delta < 2.0):**

- Modest improvement
- Consider other factors (maintainability, specificity)

**Tie (delta < 0.5):**

- No meaningful difference
- Choose based on other criteria (clarity, length, maintainability)

### Dimension Analysis

Look at per-dimension averages to understand where skills help most:

- **High actionability, low domain depth** — Skill provides clear steps but lacks domain insight
- **High domain depth, low self-containment** — Skill has expertise but assumes too much context
- **High specificity, low actionability** — Skill is detailed but hard to apply

## CI/CD Integration

### Manual Evaluation (Recommended)

Run evaluations manually before deploying skills:

```bash
# Evaluate with each prompt set
for type in data-engineering domain platform source; do
  ./scripts/eval/eval-skill-quality.sh \
    --baseline "path/to/SKILL.md" \
    --prompts "scripts/eval/prompts/${type}.txt" \
    --format json \
    --output "results/${type}-$(date +%Y%m%d).json"
done
```

### Scheduled Evaluation

Run periodic evaluations to track skill quality over time:

```bash
# Weekly evaluation (cron: 0 0 * * 0)
./scripts/eval/eval-skill-quality.sh \
  --baseline path/to/SKILL.md \
  --prompts scripts/eval/prompts/data-engineering.txt \
  --format json \
  --output "results/weekly-$(date +%Y%m%d).json"
```

### PR Validation

Evaluate skill changes in pull requests:

```bash
# Compare main branch skill vs PR branch skill
git show main:path/to/SKILL.md > /tmp/skill-main.md
./scripts/eval/eval-skill-quality.sh \
  --compare /tmp/skill-main.md path/to/SKILL.md \
  --prompts scripts/eval/prompts/data-engineering.txt \
  --format json \
  --output results/pr-comparison.json
```

## Troubleshooting

### "No prompts found in prompts file"

**Cause:** Prompts file is empty or has incorrect format

**Fix:** Ensure prompts are separated by `---` on its own line:

```text
First prompt
---
Second prompt
```

### "Failed to parse judge output"

**Cause:** Judge LLM returned invalid JSON or unexpected format

**Fix:**

- Check `VERBOSE=1` output to see raw judge response
- Verify `JUDGE_MODEL` is set correctly
- Retry (may be transient API issue)

### "Failed after 3 attempts"

**Cause:** API rate limits, network issues, or model overload

**Fix:**

- Wait a few minutes and retry
- Check API key and quota
- Reduce concurrent evaluations

### "Skill file not found"

**Cause:** Incorrect path to skill file

**Fix:**

- Use relative paths from repo root
- Verify file exists: `ls -la path/to/SKILL.md`
- Check for typos in path

## Cost Tracking

The harness tracks token usage and estimated API costs for every response generation.

### How Token Counting Works

1. **Primary method (API):** The harness uses `--output-format json` with the Claude CLI, which returns a JSON response containing both the result text and a `usage` object with `input_tokens` and `output_tokens`. This provides exact counts from the API.

2. **Fallback method (approximation):** If the JSON output does not contain usage data or cannot be parsed, the harness falls back to a word-count approximation: `tokens = words x 1.33`. Input tokens are set to 0 in this case since they cannot be estimated from the output alone.

Token source is tracked per-response (`api` or `approximation`) so you can assess data quality.

### Skill Size Tracking

Skill files are measured in approximate tokens using the same word-count heuristic: `skill_tokens = word_count x 1.33`. This appears in the report configuration and per-prompt cost data.

### Cost Calculation

Per-prompt cost is calculated as:

```text
cost = (input_tokens * INPUT_COST_PER_MTOK / 1,000,000) + (output_tokens * OUTPUT_COST_PER_MTOK / 1,000,000)
```

Default pricing is for Claude Sonnet ($3/MTok input, $15/MTok output). Override with environment variables for other models:

```bash
# Example: Haiku pricing
INPUT_COST_PER_MTOK=0.25 OUTPUT_COST_PER_MTOK=1.25 \
  ./scripts/eval/eval-skill-quality.sh --baseline skill.md --prompts prompts.txt

# Example: Opus pricing
INPUT_COST_PER_MTOK=15.00 OUTPUT_COST_PER_MTOK=75.00 \
  ./scripts/eval/eval-skill-quality.sh --baseline skill.md --prompts prompts.txt
```

### Cost Perspective

Use `--perspective cost` to focus exclusively on cost metrics (skips quality judges):

```bash
# Cost-only evaluation (cheaper, skips judges)
./scripts/eval/eval-skill-quality.sh \
  --baseline skill.md \
  --prompts prompts.txt \
  --perspective cost

# Full evaluation including cost analysis
./scripts/eval/eval-skill-quality.sh \
  --baseline skill.md \
  --prompts prompts.txt \
  --perspective all
```

When `--perspective cost` is selected:

- Responses are still generated (needed to measure tokens)
- Both quality judges are skipped (saves ~$0.40-0.80 per prompt)
- The verdict is based on cost comparison instead of quality scores
- The report focuses on token usage and cost breakdown

### Cost Efficiency Metrics

When quality scores are available (perspective is `quality` or `all`), the report includes:

- **Cost per quality point** — `avg_cost / quality_score`, lower is better
- **Token delta %** — percentage difference in total tokens between variants
- **Cost delta %** — percentage difference in estimated cost

### Cost Fields in JSON Output

Each prompt includes per-variant cost data:

```json
"cost": {
  "input_tokens": 1250,
  "output_tokens": 850,
  "total_tokens": 2100,
  "skill_tokens": 450,
  "estimated_cost_usd": 0.016500,
  "cost_per_quality_point": 0.001031,
  "token_source": "api"
}
```

The averages section includes aggregate cost data:

```json
"cost": {
  "token_delta_pct": -15.3,
  "cost_delta_pct": -15.3,
  "total_eval_cost_usd": 0.165000,
  "winner": "A"
}
```

## Performance Tracking

The harness tracks performance metrics for every response generation, enabling comparison of response speed and reliability between variants.

### Metrics Tracked

| Metric | Description | Source |
|---|---|---|
| **Latency (ms)** | Total wall-clock time for response generation | Measured via `date +%s%3N` |
| **TTFT (ms)** | Time to first token (estimated as 25% of total latency) | Estimated |
| **Tokens/s** | Output throughput: `output_tokens / (latency_ms / 1000)` | Calculated from API token count and latency |
| **Success/Failure** | Whether the response generation succeeded | CLI exit code |
| **Retries** | Number of retry attempts before success or failure | Counted per-prompt |
| **Skill discovery time (ms)** | Estimated overhead of loading the skill: `50 + (skill_tokens / 10)` | Estimated from skill file size |
| **Progressive disclosure levels** | How many layers the skill uses (1 = SKILL.md only, 2 = SKILL.md + references) | Counted from skill directory |

### Performance Perspective

Use `--perspective performance` to focus on performance metrics (skips quality judges):

```bash
# Performance-only evaluation (cheaper, skips judges)
./scripts/eval/eval-skill-quality.sh \
  --baseline skill.md \
  --prompts prompts.txt \
  --perspective performance
```

When `--perspective performance` is selected:

- Responses are still generated (needed to measure latency and throughput)
- Both quality judges are skipped (saves ~$0.40-0.80 per prompt)
- The verdict is based on latency comparison
- The report includes per-prompt and summary performance tables

### Performance Fields in JSON Output

Each prompt includes per-variant performance data:

```json
"performance": {
  "latency_ms": 3200,
  "ttft_ms": 800,
  "success": true,
  "retries": 0,
  "tokens_per_second": 24.6,
  "skill_discovery_ms": 120,
  "progressive_levels": 2
}
```

The averages section includes aggregate performance data with the same fields.

## Multi-Perspective Evaluation

Use `--perspective` to control which aspects are evaluated and reported.

### Perspective Guide

| Perspective | Judges Run | Report Sections | Cost | Use When |
|---|---|---|---|---|
| `quality` (default) | Quality + Practices | Quality scores, cost analysis, verdict | ~$0.70-1.40/prompt | Validating skill effectiveness |
| `cost` | None | Cost analysis, verdict | ~$0.30-0.60/prompt | Measuring token overhead |
| `performance` | None | Performance analysis, verdict | ~$0.30-0.60/prompt | Benchmarking response speed |
| `all` | Quality + Practices | All sections + recommendations + readiness | ~$0.70-1.40/prompt | Pre-deployment comprehensive review |

### Using `--perspective all`

The `all` perspective runs every evaluation and generates a comprehensive report:

```bash
./scripts/eval/eval-skill-quality.sh \
  --baseline skill.md \
  --prompts prompts.txt \
  --perspective all
```

This includes:

- Quality scores (4 dimensions) for both variants
- Claude best practices scores (3 dimensions) for the skill variant
- Cost analysis with token usage and efficiency metrics
- Performance analysis with latency, throughput, and reliability
- Actionable recommendations based on threshold analysis
- Production readiness assessment with pass/fail criteria

## Recommendations Engine

When the report is generated, the harness analyzes metrics against thresholds and produces categorized recommendations.

### Quality Recommendations

Based on quality dimension averages (skill A):

| Condition | Level | Example |
|---|---|---|
| Any dimension avg < 3 | CRITICAL | "CRITICAL: Domain Depth scores are low (avg 2.4/5). Add hard-to-find rules..." |
| Any dimension avg < 4 | IMPROVE | "IMPROVE: Specificity could be better (avg 3.6/5). Include more concrete details..." |
| All dimensions >= 4 | GOOD | "GOOD: Quality scores are strong across all dimensions." |

### Claude Practices Recommendations

Based on practices dimension averages:

| Condition | Recommendation |
|---|---|
| progressive_disclosure < 4 | Move detailed content to reference files for better progressive disclosure |
| structure_organization < 4 | Reorganize skill like an onboarding guide: overview then specifics |
| claude_centric_design < 4 | Add clearer trigger conditions and failure mode handling |

### Cost Recommendations

| Condition | Recommendation |
|---|---|
| cost_per_quality_point > $0.003 | Cost efficiency is low. Consider trimming skill content. |
| skill_tokens > 600 | Skill is large. Consider splitting or trimming. |
| token_delta > 50% | Skill adds significant token overhead. Ensure quality justifies cost. |

### Performance Recommendations

| Condition | Recommendation |
|---|---|
| avg latency > 5000ms | Response time exceeds 5s target. Optimize skill size. |
| success_rate < 95% | Reliability below 95%. Add error handling. |
| tokens_per_second < 10 | Output speed is slow. Check model selection. |

### Recommendations in JSON Output

```json
"recommendations": {
  "quality": ["GOOD: Quality scores are strong across all dimensions."],
  "claude_practices": ["Move detailed content to reference files..."],
  "cost": ["GOOD: Cost metrics are within acceptable ranges."],
  "performance": ["GOOD: Performance metrics are within acceptable ranges."]
}
```

Only recommendations relevant to the selected perspective are included.

## Production Readiness

The harness includes a production readiness assessment that checks whether a skill meets deployment thresholds.

### Criteria

| Category | Threshold | Description |
|---|---|---|
| Quality | Combined score >= 28/35 (80%) | Overall quality + practices score |
| Claude Practices | All 3 dimensions >= 4/5 | Each practices dimension individually |
| Cost | Cost per quality point <= $0.003 | Efficiency of token spend |
| Performance | Success rate >= 95%, latency <= 5000ms | Reliability and speed |

### Output

The assessment produces a READY or NOT READY verdict with specific blockers listed:

**Markdown report:**

```text
## Production Readiness

| Check | Status |
|---|---|
| Quality score >= 28/35 | **PASS** (29.2/35) |
| Claude practices >= 4/5 each | **PASS** |
| Cost per quality point <= $0.003 | **PASS** |
| Success rate >= 95%, latency <= 5000ms | **PASS** |

**Status: READY** -- All checks passed.
```

**JSON output:**

```json
"production_readiness": {
  "quality_score": "29.2/35",
  "quality_pass": true,
  "practices_pass": true,
  "cost_pass": true,
  "performance_pass": true,
  "status": "READY",
  "blockers": []
}
```

### Perspective-Specific Checks

When using a specific perspective, only relevant criteria are checked:

- `--perspective quality`: Checks quality score and practices compliance
- `--perspective cost`: Checks cost efficiency only
- `--perspective performance`: Checks success rate and latency only
- `--perspective all`: Checks all criteria

## See Also

- `../README.md` — Scripts directory overview
- `../../CLAUDE.md` — Main development guide
