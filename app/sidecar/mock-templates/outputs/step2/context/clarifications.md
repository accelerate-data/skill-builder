---
question_count: 9
sections: 3
duplicates_removed: 2
refinement_count: 3
priority_questions: [Q1, Q4, Q7]
---

# Research Clarifications

## Section 1: Core Concepts

### Required

### Q1: Primary Use Case
What is the primary use case for this skill?

A. Focus on the most common workflow patterns that engineers encounter daily
B. Focus on advanced/niche patterns for experienced engineers
C. Cover both common and advanced patterns with equal depth
D. Other (please specify)

**Recommendation:** Focus on the most common workflow patterns that engineers encounter daily.

**Answer:** B — Focus on common workflow patterns

#### Refinements

##### R1.1: Priority Workflow Patterns
Since you chose to focus on common workflow patterns, which should be primary: CRUD operations, batch processing, event-driven workflows, or scheduled tasks?

A. CRUD and event-driven as primary; batch and scheduled as secondary
B. Equal coverage for all four patterns
C. CRUD as primary; all others as secondary
D. Other (please specify)

**Recommendation:** A — CRUD and event-driven are the most common patterns engineers encounter; batch and scheduled are important but less frequent.

**Answer:**

### Optional

### Q2: Target Expertise Level
What level of expertise should this skill assume?

A. Beginner — needs step-by-step guidance on fundamentals
B. Intermediate — familiar with basic concepts but needs guidance on best practices and edge cases
C. Advanced — already knows best practices, needs deep domain-specific insight
D. Other (please specify)

**Recommendation:** Intermediate — familiar with basic concepts but needs guidance on best practices and edge cases.

**Answer:** B — Intermediate level

#### Refinements

##### R2.1: Prerequisite Checks for Intermediate Readers
For intermediate-level guidance, should the skill include a self-assessment checklist or assume readers can gauge their own readiness?

A. Include a brief prerequisites section with self-assessment checklist
B. Assume readers can self-assess; no prerequisites section
C. Include prerequisites as a collapsible/optional section
D. Other (please specify)

**Recommendation:** A — A brief prerequisites section helps readers confirm they have the right background and sets expectations for what the skill covers.

**Answer:**

### Q3: Greenfield vs Brownfield Coverage
Should this skill cover both greenfield and brownfield scenarios?

A. Greenfield only — new projects from scratch
B. Both, with emphasis on greenfield but include migration guidance for existing systems
C. Both with equal depth
D. Other (please specify)

**Recommendation:** Both, with emphasis on greenfield but include migration guidance for existing systems.

**Answer:** Both, with emphasis on greenfield but include migration guidance for existing systems.

## Section 2: Architecture & Design

### Required

### Q4: Architectural Pattern Priority
What architectural patterns should be prioritized?

A. Start with the most widely adopted patterns, then layer in alternatives for specific constraints
B. Cover all patterns equally and let the reader choose
C. Focus on opinionated best-practice patterns only
D. Other (please specify)

**Recommendation:** Start with the most widely adopted patterns, then layer in alternatives for specific constraints.

**Answer:** Start with the most widely adopted patterns, then layer in alternatives for specific constraints.

### Optional

### Q5: Technology-Specific vs Agnostic Guidance
How should the skill handle technology-specific vs technology-agnostic guidance?

A. Lead with technology-agnostic principles, then provide concrete examples for the most common tools
B. Organize entirely by technology/tool
C. Technology-agnostic only — no tool-specific examples
D. Other (please specify)

**Recommendation:** Lead with technology-agnostic principles, then provide concrete examples for the most common tools.

**Answer:** A — Technology-agnostic first

#### Refinements

##### R5.1: Tool Selection Decision Matrix
When presenting technology-agnostic patterns, should the skill provide a decision matrix for choosing specific tools, or keep tool recommendations out of the main guidance entirely?

A. Include a decision matrix in references, with brief tool mentions in the main skill
B. Keep all tool recommendations in references only
C. Include tool recommendations inline with each pattern
D. Other (please specify)

**Recommendation:** A — A decision matrix in references gives readers actionable tool selection guidance without cluttering the main skill with tool-specific details.

**Answer:**

### Q6: Performance Optimization Placement
Should performance optimization be covered in the main skill or references?

A. Cover key performance principles in SKILL.md, detailed optimization in references
B. All performance content in references only
C. Inline performance guidance alongside each pattern
D. Other (please specify)

**Recommendation:** Cover key performance principles in SKILL.md, detailed optimization in references.

**Answer:** Cover key performance principles in SKILL.md, detailed optimization in references.

## Section 3: Implementation Details

### Required

### Q7: Code Example Depth
What level of code examples should be included?

A. Copy-paste-ready templates for the most common patterns
B. Pseudocode/conceptual examples only
C. Full working examples with test harnesses
D. Other (please specify)

**Recommendation:** Include copy-paste-ready templates for the most common patterns.

**Answer:** Copy-paste-ready templates for the most common patterns.

### Optional

### Q8: Testing Guidance Scope
Should testing guidance be included?

A. Yes, include a testing strategy section with concrete patterns
B. Brief mention only — testing is out of scope
C. Comprehensive testing guide as a separate reference file
D. Other (please specify)

**Recommendation:** Yes, include a testing strategy section with concrete patterns.

**Answer:** Yes, include a testing strategy section with concrete patterns.

### Q9: Error Handling Approach
How should error handling be addressed?

A. Cover common failure modes with specific recovery patterns
B. General error handling principles only
C. Detailed error taxonomy with per-pattern recovery strategies
D. Other (please specify)

**Recommendation:** Cover common failure modes with specific recovery patterns.

**Answer:** Cover common failure modes with specific recovery patterns.
