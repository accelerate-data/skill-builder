import fs from "fs";
import path from "path";

const SESSION_JSON = (
  skillName: string,
  phase: string
) => `{
  "skill_name": "${skillName}",
  "skill_type": "domain",
  "domain": "Pet Store Analytics",
  "skill_dir": "./${skillName}/",
  "created_at": "2026-01-01T00:00:00Z",
  "last_activity": "2026-01-01T01:00:00Z",
  "current_phase": "${phase}",
  "phases_completed": [],
  "mode": "guided",
  "research_dimensions_used": ["entities", "metrics"],
  "clarification_status": { "total_questions": 6, "answered": 0 },
  "auto_filled": false,
  "iterative_history": []
}`;

function writeSessionJson(dir: string, skillName: string, phase: string) {
  const vibeDir = path.join(dir, ".vibedata/skill-builder", skillName);
  fs.mkdirSync(vibeDir, { recursive: true });
  fs.writeFileSync(path.join(vibeDir, "session.json"), SESSION_JSON(skillName, phase));
}

function makeSkillDirs(dir: string, skillName: string) {
  fs.mkdirSync(path.join(dir, skillName, "context"), { recursive: true });
  fs.mkdirSync(path.join(dir, skillName, "references"), { recursive: true });
}

function writeUserContextMd(dir: string, skillName: string) {
  const vibeDir = path.join(dir, ".vibedata/skill-builder", skillName);
  fs.mkdirSync(vibeDir, { recursive: true });
  fs.writeFileSync(
    path.join(vibeDir, "user-context.md"),
    `# User Context

- **Industry**: Retail / E-commerce
- **Function**: Analytics Engineering
- **Target Audience**: Intermediate data engineers building dbt models
- **Key Challenges**: Handling seasonal spikes, multi-location inventory reconciliation
- **Scope**: Silver and gold layer dbt modeling for pet store operations
- **What Makes This Setup Unique**: Multi-location with centralized e-commerce fulfillment
- **What Claude Gets Wrong**: Assumes single-store context; misses cross-location stock logic
`
  );
}

// fresh: empty workspace — no session.json, no artifacts
export function createFixtureFresh(_dir: string) {
  // nothing to create
}

// scoping: session.json only
export function createFixtureScoping(dir: string, skillName: string) {
  writeSessionJson(dir, skillName, "scoping");
  writeUserContextMd(dir, skillName);
  makeSkillDirs(dir, skillName);
}

// research: session.json + user-context.md + clarifications.md with all answers empty
export function createFixtureResearch(dir: string, skillName: string) {
  writeSessionJson(dir, skillName, "research");
  writeUserContextMd(dir, skillName);
  makeSkillDirs(dir, skillName);
  fs.writeFileSync(
    path.join(dir, skillName, "context", "clarifications.md"),
    `## Core Entities

### Q1: Primary entities
What are the primary business entities in pet store analytics?
A. Products, Customers, Transactions
B. Products, Customers, Transactions, Inventory
C. Other (please specify)
**Recommendation:** B
**Answer:**

### Q2: Customer segmentation
How do you segment customers?
A. By purchase frequency (one-time, repeat, loyal)
B. By pet type (dog, cat, exotic, multi-pet)
C. Both dimensions
**Recommendation:** C
**Answer:**

## Business Patterns

### Q3: Seasonal patterns
Does the business have strong seasonal patterns?
A. Yes, holiday-driven (Christmas, adoption events)
B. Yes, weather-driven (flea/tick season)
C. Both
**Recommendation:** C
**Answer:**

### Q4: Return policy
What is the return model for different product types?
A. Full refund within 30 days for all products
B. Exchange-only for live animals, refund for products
C. Custom policy by category
**Recommendation:** B
**Answer:**

## Data Modeling

### Q5: Source systems
What are the primary source systems?
A. Single POS system
B. POS + inventory management
C. POS + inventory + e-commerce
**Recommendation:** B
**Answer:**

### Q6: Multi-location
Is this single store or multi-location?
A. Single location
B. 2-5 locations
C. 5+ locations
**Recommendation:** B
**Answer:**
`
  );
}

// clarification: session.json + user-context.md + clarifications.md with SOME answers filled
export function createFixtureClarification(dir: string, skillName: string) {
  writeSessionJson(dir, skillName, "clarification");
  writeUserContextMd(dir, skillName);
  makeSkillDirs(dir, skillName);
  fs.writeFileSync(
    path.join(dir, skillName, "context", "clarifications.json"),
    JSON.stringify({
      version: "1",
      metadata: {
        title: "Pet Store Analytics Clarifications",
        question_count: 6,
        section_count: 2,
        refinement_count: 0,
        must_answer_count: 2,
        priority_questions: ["Q1", "Q4"],
        scope_recommendation: false,
      },
      sections: [
        {
          id: "S1",
          title: "Core Entities",
          questions: [
            {
              id: "Q1",
              title: "Primary entities",
              must_answer: true,
              text: "What are the primary business entities in pet store analytics?",
              choices: [
                { id: "A", text: "Products, Customers, Transactions", is_other: false },
                { id: "B", text: "Products, Customers, Transactions, Inventory", is_other: false },
                { id: "C", text: "Other (please specify)", is_other: true },
              ],
              recommendation: "B",
              answer_choice: "B",
              answer_text: "We track all four entities in the core model.",
              refinements: [],
            },
            {
              id: "Q2",
              title: "Customer segmentation",
              must_answer: false,
              text: "How do you segment customers?",
              choices: [
                { id: "A", text: "Purchase frequency", is_other: false },
                { id: "B", text: "Pet type", is_other: false },
                { id: "C", text: "Both dimensions", is_other: false },
              ],
              recommendation: "C",
              answer_choice: "C",
              answer_text: "Both frequency and pet type are required.",
              refinements: [],
            },
            {
              id: "Q3",
              title: "Seasonal patterns",
              must_answer: false,
              text: "Does the business have strong seasonal patterns?",
              choices: [
                { id: "A", text: "Holiday-driven", is_other: false },
                { id: "B", text: "Weather-driven", is_other: false },
                { id: "C", text: "Both", is_other: false },
              ],
              recommendation: "C",
              answer_choice: "C",
              answer_text: "Both holiday and weather seasonality matter.",
              refinements: [],
            },
          ],
        },
        {
          id: "S2",
          title: "Data Modeling",
          questions: [
            {
              id: "Q4",
              title: "Return policy",
              must_answer: true,
              text: "What is the return model for different product types?",
              choices: [
                { id: "A", text: "30-day refund for all products", is_other: false },
                { id: "B", text: "Exchange-only for live animals", is_other: false },
                { id: "C", text: "Custom by category", is_other: false },
              ],
              recommendation: "B",
              answer_choice: null,
              answer_text: null,
              refinements: [],
            },
            {
              id: "Q5",
              title: "Source systems",
              must_answer: false,
              text: "What are the primary source systems?",
              choices: [
                { id: "A", text: "Single POS", is_other: false },
                { id: "B", text: "POS + inventory", is_other: false },
                { id: "C", text: "POS + inventory + e-commerce", is_other: false },
              ],
              recommendation: "C",
              answer_choice: null,
              answer_text: null,
              refinements: [],
            },
            {
              id: "Q6",
              title: "Multi-location",
              must_answer: false,
              text: "Is this single store or multi-location?",
              choices: [
                { id: "A", text: "Single location", is_other: false },
                { id: "B", text: "2-5 locations", is_other: false },
                { id: "C", text: "5+ locations", is_other: false },
              ],
              recommendation: "B",
              answer_choice: null,
              answer_text: null,
              refinements: [],
            },
          ],
        },
      ],
      notes: [],
    }, null, 2)
  );
}

// refinement_pending: clarifications.md with unanswered #### Refinements section
export function createFixtureRefinementPending(dir: string, skillName: string) {
  writeSessionJson(dir, skillName, "refinement_pending");
  writeUserContextMd(dir, skillName);
  makeSkillDirs(dir, skillName);
  fs.writeFileSync(
    path.join(dir, skillName, "context", "clarifications.md"),
    `## Core Entities

### Q1: Primary entities
**Recommendation:** B
**Answer:** B — We track all four

### Q2: Customer segmentation
**Recommendation:** C
**Answer:** C — Both dimensions

#### Refinements

### R1: Inventory tracking granularity
How granular is inventory tracking?
A. SKU level only
B. SKU + location level
C. SKU + location + batch level
**Recommendation:** B
**Answer:**

### R2: Customer merge strategy
How are duplicate customer records handled across locations?
A. Each location maintains separate customer records
B. Customers are merged by email
C. Customers are merged by loyalty card number
**Recommendation:** B
**Answer:**
`
  );
}

// refinement: answered #### Refinements section
export function createFixtureRefinement(dir: string, skillName: string) {
  writeSessionJson(dir, skillName, "refinement");
  writeUserContextMd(dir, skillName);
  makeSkillDirs(dir, skillName);
  fs.writeFileSync(
    path.join(dir, skillName, "context", "clarifications.md"),
    `## Core Entities

### Q1: Primary entities
**Recommendation:** B
**Answer:** B — We track all four

#### Refinements

### R1: Inventory tracking granularity
**Recommendation:** B
**Answer:** B — SKU + location level is sufficient

### R2: Customer merge strategy
**Recommendation:** B
**Answer:** B — Merge by email with loyalty card as fallback
`
  );
}

// decisions: session.json + user-context.md + decisions.md
export function createFixtureDecisions(dir: string, skillName: string) {
  writeSessionJson(dir, skillName, "decisions");
  writeUserContextMd(dir, skillName);
  makeSkillDirs(dir, skillName);
  fs.writeFileSync(
    path.join(dir, skillName, "context", "decisions.md"),
    `# Decisions: Pet Store Analytics

### D1: Entity scope
- **Question**: What are the primary business entities?
- **Decision**: Products, Customers, Transactions, Inventory
- **Implication**: Build four core dimension tables plus a fct_sales table

### D2: Customer segmentation
- **Question**: How do you segment customers?
- **Decision**: Both purchase frequency and pet type dimensions
- **Implication**: dim_customers needs frequency_tier and pet_type_primary fields
`
  );
}

// refinable-skill: session.json + user-context.md + completed SKILL.md with full frontmatter — for refine-skill agent tests
export function createFixtureRefinableSkill(dir: string, skillName: string) {
  writeSessionJson(dir, skillName, "refinement");
  writeUserContextMd(dir, skillName);
  makeSkillDirs(dir, skillName);
  fs.writeFileSync(
    path.join(dir, skillName, "SKILL.md"),
    `---
name: ${skillName}
description: Guides data engineers to build silver and gold layer dbt models for pet store analytics. Use when modeling sales transactions, inventory levels, or customer behavior from a pet store POS system.
domain: Pet Store Analytics
type: domain
tools: Read, Edit, Write, Glob, Grep, Task
version: 1.0.0
author: testuser
created: 2026-01-15
modified: 2026-01-15
---

# Pet Store Analytics

This skill guides data engineers in building dbt models for pet store analytics domains.

## Core Entities
- dim_products — product hierarchy (department, category, SKU)
- dim_customers — customer profiles with segmentation
- fct_sales — transaction grain with line items
- fct_inventory — daily inventory snapshots

## Quick Reference

| Entity | Key Metrics | Notes |
|--------|-------------|-------|
| Products | revenue, units_sold | SKU-level |
| Customers | ltv, frequency_tier | Segmented |
| Sales | gmv, aov | Transaction grain |
| Inventory | days_on_hand, fill_rate | Daily snapshot |
`
  );
}

// generation: session.json + user-context.md + SKILL.md (no decisions.md — keeps state signal unambiguous)
export function createFixtureGeneration(dir: string, skillName: string) {
  writeSessionJson(dir, skillName, "generation");
  writeUserContextMd(dir, skillName);
  makeSkillDirs(dir, skillName);
  fs.writeFileSync(
    path.join(dir, skillName, "SKILL.md"),
    `---
name: Pet Store Analytics
description: Guides Claude to build silver and gold layer dbt models for pet store analytics
skill_type: domain
---

# Pet Store Analytics

This skill guides data engineers in building dbt models for pet store analytics domains.

## Core Entities
- dim_products — product hierarchy (department, category, SKU)
- dim_customers — customer profiles with segmentation
`
  );
}

// validation: generation fixture + validation logs
export function createFixtureValidation(dir: string, skillName: string) {
  createFixtureGeneration(dir, skillName);
  writeSessionJson(dir, skillName, "validation");
  const contextDir = path.join(dir, skillName, "context");
  fs.writeFileSync(
    path.join(contextDir, "agent-validation-log.md"),
    `# Validation Log: Pet Store Analytics\n\n**Overall Score**: 82/100\n`
  );
  fs.writeFileSync(
    path.join(contextDir, "test-skill.md"),
    `# Test Skill Results: Pet Store Analytics\n\n**Status**: PARTIAL PASS\n`
  );
  fs.writeFileSync(
    path.join(contextDir, "companion-skills.md"),
    `---\nskill_name: pet-store-analytics\nskill_type: domain\ncompanions:\n  - name: Shopify Extraction\n    slug: shopify-extraction\n    type: source\n    dimension: field-semantics\n    dimension_score: 3\n    priority: high\n    reason: "Field semantics vary across Shopify plan tiers"\n    trigger_description: "Extracting and normalizing Shopify data"\n    template_match: null\n---\n# Companion Skill Recommendations\n`
  );
}

// Agent smoke fixture: fully answered clarifications for confirm-decisions tests
export function createFixtureT4Workspace(dir: string, skillName: string) {
  writeSessionJson(dir, skillName, "clarification");
  writeUserContextMd(dir, skillName);
  makeSkillDirs(dir, skillName);
  fs.writeFileSync(
    path.join(dir, skillName, "context", "clarifications.json"),
    JSON.stringify({
      version: "1",
      metadata: {
        title: "Pet Store Analytics Clarifications",
        question_count: 6,
        section_count: 2,
        refinement_count: 0,
        must_answer_count: 2,
        priority_questions: ["Q1", "Q4"],
        scope_recommendation: false,
      },
      sections: [
        {
          id: "S1",
          title: "Core Entities",
          questions: [
            {
              id: "Q1",
              title: "Primary entities",
              must_answer: true,
              text: "What are the primary business entities?",
              choices: [
                { id: "A", text: "Products, Customers, Transactions", is_other: false },
                { id: "B", text: "Products, Customers, Transactions, Inventory", is_other: false },
                { id: "C", text: "Other (please specify)", is_other: true },
              ],
              recommendation: "B",
              answer_choice: "B",
              answer_text: "Track products, customers, transactions, and inventory.",
              refinements: [],
            },
            {
              id: "Q2",
              title: "Customer segmentation",
              must_answer: false,
              text: "How do you segment customers?",
              choices: [
                { id: "A", text: "Purchase frequency", is_other: false },
                { id: "B", text: "Pet type", is_other: false },
                { id: "C", text: "Both", is_other: false },
              ],
              recommendation: "C",
              answer_choice: "C",
              answer_text: "Use both frequency and pet type segments.",
              refinements: [],
            },
            {
              id: "Q3",
              title: "Product hierarchy",
              must_answer: false,
              text: "How deep is the product hierarchy?",
              choices: [
                { id: "A", text: "2 levels", is_other: false },
                { id: "B", text: "3 levels", is_other: false },
                { id: "C", text: "4+ levels", is_other: false },
              ],
              recommendation: "B",
              answer_choice: "B",
              answer_text: "Department > Category > Product.",
              refinements: [],
            },
          ],
        },
        {
          id: "S2",
          title: "Business Patterns",
          questions: [
            {
              id: "Q4",
              title: "Seasonal patterns",
              must_answer: true,
              text: "Does the business have strong seasonal patterns?",
              choices: [
                { id: "A", text: "Holiday-driven", is_other: false },
                { id: "B", text: "Weather-driven", is_other: false },
                { id: "C", text: "Both", is_other: false },
                { id: "D", text: "Minimal", is_other: false },
              ],
              recommendation: "C",
              answer_choice: "C",
              answer_text: "Both holiday and weather demand patterns exist.",
              refinements: [],
            },
            {
              id: "Q5",
              title: "Return policy",
              must_answer: false,
              text: "What is the return model?",
              choices: [
                { id: "A", text: "30-day refund all", is_other: false },
                { id: "B", text: "Exchange-only for live animals", is_other: false },
                { id: "C", text: "Custom by category", is_other: false },
              ],
              recommendation: "B",
              answer_choice: "B",
              answer_text: "Live animals exchange-only; products 30-day returns.",
              refinements: [],
            },
            {
              id: "Q6",
              title: "Loyalty program",
              must_answer: false,
              text: "What does the loyalty program look like?",
              choices: [
                { id: "A", text: "Points-based", is_other: false },
                { id: "B", text: "Tier-based", is_other: false },
                { id: "C", text: "Subscription", is_other: false },
                { id: "D", text: "No formal loyalty", is_other: false },
              ],
              recommendation: "A",
              answer_choice: "A",
              answer_text: "Points-based loyalty with redemption thresholds.",
              refinements: [],
            },
          ],
        },
      ],
      notes: [],
    }, null, 2)
  );
}
