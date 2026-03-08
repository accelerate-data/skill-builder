# RFC: Skill Builder Eval & Tuning — Anthropic Comparison

**Date**: 2026-03-07
**Status**: Draft
**Scope**: What [Anthropic's skill-creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md) does differently in evaluation, tuning, and creation — and what VibeData's Skill Builder should adopt.

---

## 1. Context

### VibeData Skill Builder

A Tauri desktop app (Rust + React + SQLite + Claude SDK sidecars) that guides users through a **research-driven skill creation workflow**:

| Step | Agent | Purpose |
|------|-------|---------|
| 0 | `research-orchestrator` | Dimension analysis, scope recommendations, clarifications.json |
| 1 | `detailed-research` | Deep-dive on selected dimensions |
| 2 | `confirm-decisions` | Resolve contradictions, produce decisions.md |
| 3 | `generate-skill` | Write SKILL.md + references from decisions |
| Post | `validate-skill` | Conformance + completeness + companion recommendations |
| Post | `answer-evaluator` | Evaluates user answer quality (clear/vague/contradictory) |
| Refine | `refine-skill` | Interactive streaming chat for targeted edits |

**Strengths**: Deep research phase, structured knowledge elicitation, scope guardrails, interactive refinement, full GUI, marketplace/distribution, domain-specific context (dbt/Fabric).

### Anthropic's Skill Creator

A meta-skill (SKILL.md + Python scripts + agent definitions) that runs entirely within Claude Code/Claude.ai:

| Phase | Mechanism | Purpose |
|-------|-----------|---------|
| Intent | Conversation | Capture what the skill should do |
| Draft | Write SKILL.md | Based on interview + research |
| Test | Subagent spawning | Run with-skill and without-skill in parallel |
| Grade | `grader.md` agent | Assertion-based evaluation + claim extraction |
| Compare | `comparator.md` agent | Blind A/B quality judging |
| Analyze | `analyzer.md` agent | Post-hoc pattern analysis on benchmark data |
| Review | `generate_review.py` | HTML eval viewer for human-in-loop feedback |
| Improve | SKILL.md rewrite | Based on user feedback + quantitative data |
| Optimize | `run_loop.py` | Automated description tuning with train/test split |

**Strengths**: Quantitative rigor, automated eval loops, statistical analysis (mean/stddev/variance), blind comparison, description optimization with overfitting prevention.

---

## 2. Capability Comparison Matrix

| Capability | VibeData | Anthropic | Gap? |
|-----------|----------|-----------|------|
| **Research phase** | Deep (dimension analysis, scope recs, clarifications) | Shallow (interview, optional MCP research) | Anthropic gap |
| **Knowledge elicitation** | Structured (questions → answer evaluation → decisions) | Conversational | Anthropic gap |
| **Scope guardrails** | Yes (scope_recommendation, contradictory_inputs) | No | Anthropic gap |
| **Skill generation** | Purpose-driven patterns (knowledge-capture vs standards) | Single pattern | Anthropic gap |
| **Validation** | Agent-based (conformance + completeness + companions) | Quick validate (frontmatter schema only) | Anthropic gap |
| **Interactive refinement** | Streaming chat with `/rewrite`, `/validate` | Manual SKILL.md editing | Anthropic gap |
| **A/B test infrastructure** | `prepare_skill_test` (isolated temp workspaces) | Subagent spawning with-skill / without-skill | **Comparable** |
| **Quantitative assertions** | None (rubric is qualitative, dbt-specific) | Yes (`evals.json` expectations, grading.json) | **VibeData gap** |
| **Grading agent** | None | Yes (assertion grading + claim extraction + eval critique) | **VibeData gap** |
| **Benchmark aggregation** | None | Yes (pass_rate, time, tokens with mean ± stddev) | **VibeData gap** |
| **Blind A/B comparison** | None | Yes (comparator.md with generated rubric) | **VibeData gap** |
| **Variance analysis** | None | Yes (multi-run, flaky detection, non-discriminating assertions) | **VibeData gap** |
| **Human-in-loop eval viewer** | None (test results in markdown) | Yes (HTML viewer with output tabs, benchmark tab, feedback) | **VibeData gap** |
| **Description optimization** | None | Yes (automated trigger eval + improvement loop) | **VibeData gap** |
| **Distribution** | Marketplace, GitHub import, registries | `.skill` packaging | VibeData ahead |
| **GUI experience** | Full Tauri app | CLI/browser only | VibeData ahead |
| **State management** | SQLite + session tracking | Filesystem (workspace dirs) | VibeData ahead |

---

## 3. What Anthropic Does Differently — Detailed Analysis

### 3.1 Quantitative Eval Framework

**What**: For each test case, Anthropic defines **assertions** — objectively verifiable statements about the output (e.g., "The output includes X", "The skill used script Y"). These are graded as PASS/FAIL with cited evidence.

**How**: The grader agent (`grader.md`) does more than check assertions:
1. **Assertion grading** — pass/fail with specific evidence quoted from transcript/outputs
2. **Claim extraction** — extracts implicit claims from outputs ("The form has 12 fields") and verifies them independently
3. **Eval critique** — identifies weak assertions ("A hallucinated document would also pass this") and uncovered outcomes
4. **Execution metrics** — tool call counts, error counts, output size

**Why it matters**: The `skill-test` system in VibeData creates isolated workspaces and runs with-skill / without-skill, but the evaluation rubric is qualitative and dbt-specific. There's no structured assertion framework that can objectively measure whether a skill improves outcomes.

```
// Current VibeData rubric (qualitative, domain-locked)
| Dimension | What to score |
| Silver vs gold | Correct lakehouse layer identification? |
| Model transformations | Correct joins, aggregations, business rules? |

// Anthropic assertion style (quantitative, domain-agnostic)
{
  "text": "The output includes the customer name 'Acme Corp'",
  "passed": true,
  "evidence": "Found in output.csv row 3: 'Acme Corp'"
}
```

### 3.2 Multi-Run Variance Analysis

**What**: Each eval is run 3x per configuration. Results are aggregated with mean ± stddev. An analyzer agent then surfaces patterns:
- Assertions that always pass in both configs (non-discriminating — don't prove skill value)
- High-variance evals (possibly flaky)
- Time/token tradeoffs

**Why it matters**: A single run can be misleading. LLM outputs are non-deterministic. Without multiple runs, you can't distinguish genuine skill improvement from lucky rolls.

### 3.3 Description Optimization Loop

**What**: Automated system that tests whether Claude actually triggers a skill for given queries. Runs `claude -p` with the skill installed, checks if the model invokes it. Uses train/test split (60/40) to prevent overfitting.

**How** (`run_loop.py` + `run_eval.py` + `improve_description.py`):
1. Generate 20 eval queries (10 should-trigger, 10 should-not-trigger)
2. User reviews queries in HTML UI
3. Split into train (60%) and test (40%), stratified by should_trigger
4. For each iteration:
   - Run all queries 3x each against `claude -p`
   - Measure trigger rates per query
   - If train set doesn't pass: call Claude to improve description
   - History of previous attempts is passed to improvement prompt with explicit instruction: "do NOT repeat these — try something structurally different"
5. Select best description by **test** score (not train) to avoid overfitting

**Why it matters**: A skill that never triggers is useless regardless of content quality. VibeData's Skill Builder has no mechanism to test or optimize whether Claude will actually invoke the skill. This is arguably the most impactful single feature to adopt.

### 3.4 Blind A/B Comparison

**What**: The `comparator.md` agent receives two outputs labeled "A" and "B" without knowing which skill produced them. It generates a rubric dynamically based on the task, scores both outputs on content (correctness, completeness, accuracy) and structure (organization, formatting, usability), then picks a winner.

**Why it matters**: Eliminates confirmation bias. When the same agent that wrote the skill also evaluates it, there's inherent bias toward the skilled version. A blind comparator provides an independent quality signal.

### 3.5 Human-in-Loop Eval Viewer

**What**: `generate_review.py` creates an HTML page with:
- **Outputs tab**: Navigate test cases, see rendered outputs, leave feedback per case
- **Benchmark tab**: Aggregate stats, per-eval breakdowns, analyst observations
- **Previous iteration comparison**: Collapsed section showing last iteration's output
- **Feedback persistence**: Auto-saves to `feedback.json` for the next iteration

**Why it matters**: VibeData's test results are written to markdown files. There's no structured feedback mechanism that flows back into the improvement loop. The eval viewer closes this gap by making human review efficient and the feedback machine-readable.

---

## 4. Adoption Recommendations

### 4.1 HIGH PRIORITY — Adopt

#### R1: Assertion-Based Eval Framework

**Gap**: VibeData runs A/B tests but has no structured way to measure outcomes.

**Proposal**: Extend `skill-test` infrastructure with an assertions layer:
- During skill creation (Step 3), auto-generate 3-5 assertions per test case based on `decisions.md` content
- Store in `evals.json` alongside test prompts
- After A/B runs, grade assertions against outputs using a grader agent
- Surface pass rates in the test results UI

**Implementation**: New `grader` agent prompt (adapt from Anthropic's `grader.md`), new `evals.json` schema, UI panel showing assertion results alongside qualitative rubric.

**Effort**: Medium (1-2 weeks). The `prepare_skill_test` infrastructure already creates isolated workspaces; this adds structured evaluation on top.

#### R2: Description Optimization

**Gap**: Skills may never trigger if the description doesn't match user intent patterns.

**Proposal**: Add a "Test Triggering" feature in the Refine phase:
- Generate 10-20 eval queries from skill content + decisions
- Run `claude -p` against each with the skill installed
- Show trigger rates in UI
- One-click "Optimize" that runs the improvement loop

**Implementation**: Port `run_eval.py` + `improve_description.py` + `run_loop.py` logic into a new sidecar agent or Rust command. The train/test split and history-aware improvement prompt are the key mechanisms to preserve.

**Effort**: Medium-High (2-3 weeks). Requires subprocess management for `claude -p` invocations, potentially a pool of parallel evaluations.

### 4.2 MEDIUM PRIORITY — Adopt Selectively

#### R3: Multi-Run Variance Analysis

**Gap**: Single test runs can mislead.

**Proposal**: Run each test case 3x in `prepare_skill_test`. Aggregate results with mean ± stddev. Flag high-variance cases.

**Trade-off**: 3x the compute cost per test. Consider making this optional ("Quick Test" = 1 run, "Thorough Test" = 3 runs).

**Effort**: Low-Medium (1 week). Mostly orchestration changes in the test flow.

#### R4: Grader Agent with Claim Extraction

**Gap**: Validation currently checks conformance to best practices, not output quality.

**Proposal**: Add a grader agent that:
1. Grades assertions (R1)
2. Extracts implicit claims from skill output and verifies them
3. Critiques the eval assertions themselves ("this assertion is non-discriminating")

**Effort**: Low (3-5 days). Mostly prompt engineering — adapt `grader.md`.

#### R5: Eval Viewer / Feedback UI

**Gap**: Test results live in markdown; no structured feedback loop.

**Proposal**: Add a test results panel in the Tauri app showing:
- Side-by-side with-skill / without-skill outputs
- Assertion pass/fail badges
- Inline feedback textboxes per test case
- Aggregate benchmark stats

**Trade-off**: VibeData already has a GUI. Building this into the existing React app is natural but requires frontend work.

**Effort**: Medium (1-2 weeks). UI work plus wiring feedback back to the refine agent.

### 4.3 LOW PRIORITY — Nice to Have

#### R6: Blind A/B Comparison

**Why lower**: The human-in-loop viewer (R5) + quantitative assertions (R1) cover most of the value. Blind comparison adds rigor but requires an additional agent invocation per test case.

**When to adopt**: If users report difficulty judging whether the skill actually helped, or for automated CI testing of skill quality.

#### R7: Benchmark Aggregation Script

**Why lower**: Only valuable after R1 + R3. Once you have assertions and multi-run data, aggregation becomes useful.

---

## 5. What VibeData Should NOT Adopt

| Anthropic Pattern | Why Skip |
|---|---|
| **Filesystem-only state** | VibeData's SQLite + DB state management is superior for tracking workflow progress, sessions, and history |
| **CLI-only experience** | VibeData's Tauri GUI is a competitive advantage, especially for the Full-Stack Analyst persona |
| **Generic skill patterns** | VibeData's purpose-driven patterns (knowledge-capture vs standards) and domain-specific research are more valuable than Anthropic's single-pattern approach |
| **Workspace directory conventions** | VibeData already has a workspace management system; don't regress to manual directory creation |
| **"Vibe with me" fallback** | VibeData's structured research phase is the core differentiator — keep the rigor |

---

## 6. Adoption Sequencing

```
Phase 1 (Weeks 1-3):  R1 (Assertions) + R2 (Description Optimization)
Phase 2 (Weeks 4-5):  R4 (Grader Agent) + R5 (Eval Viewer UI)
Phase 3 (Week 6):     R3 (Multi-Run Variance) — behind "Thorough Test" toggle
Phase 4 (Later):      R6 (Blind Comparison) + R7 (Benchmark Aggregation)
```

R1 and R2 together address the two biggest gaps: "does the skill produce measurably better output?" and "does Claude actually invoke it?" These should be co-developed since R1 provides the scoring framework that R2's loop depends on.

---

## 7. Strategic Framing

VibeData's Skill Builder covers a **wider and deeper creation funnel** than Anthropic's. The research phase, structured elicitation, scope guardrails, and interactive refinement are genuine competitive advantages — especially for the Full-Stack Analyst persona who needs guided knowledge capture rather than open-ended iteration.

What VibeData lacks is the **measurement and optimization tail**. Once a skill is created, there's no quantitative signal for:
- Did the skill actually improve outcomes? (assertions + grading)
- Will Claude invoke it when it should? (description optimization)
- Is the improvement real or just noise? (multi-run variance)
- Can we systematically improve it? (structured feedback → iteration loop)

The Anthropic patterns to adopt are all in this tail. The adoption plan preserves VibeData's front-end advantages while grafting on Anthropic's back-end rigor.

### VibeData Product Fit

Skills are one of VibeData's four value pillars — **"Domain intelligence that compounds."** The positioning promise is that "every pipeline makes the next one faster" because the platform learns from accumulated Skills. This promise requires skills to actually work when invoked and to measurably improve outcomes. Without eval/optimization infrastructure, the compounding claim is aspirational. With it, it's demonstrable.

The Skill Builder is also the meta-utility that creates the domain knowledge powering the broader platform. Making it produce higher-quality, better-triggering skills has a multiplicative effect on every other part of VibeData that depends on Skills.
