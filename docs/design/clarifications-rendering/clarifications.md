---
status: pending
question_count: 26
sections: 6
duplicates_removed: 17
refinement_count: 16
priority_questions: [Q1, Q2, Q3, Q4, Q5]
---

# Clarifications: Sales Pipeline for Just Analytics

> Questions marked **[MUST ANSWER]** block skill generation. All others refine quality but have reasonable defaults.

---

## Core Concepts and Definitions

These questions resolve foundational terms used throughout all pipeline metrics and reporting.

### Q1: MRR Definition by Service Type [MUST ANSWER]

How is MRR calculated across your three service categories (Managed Services, PS <12mo, PS >12mo)?

A. Managed Services MRR = recurring monthly fee. PS <12mo = TCV spread over engagement months. PS >12mo = TCV / actual term months. All three contribute to MRR but use different denominators.
B. Managed Services MRR = recurring monthly fee. PS <12mo treated as one-time revenue (excluded from MRR). PS >12mo = annualized TCV / 12. MRR aggregates only Managed Services + PS >12mo.
C. MRR applies only to Managed Services (true recurring contracts). All PS deals are tracked as TCV or ACV and excluded from MRR entirely.
D. Other (please specify)

_Consolidated from: Metrics Q1, Segmentation Q2, Business Rules Q5, Modeling Q7_

**Answer**: Managed services is already MRR, PS projects less than 12 months are total value / 10. PS projects more than 12 months are year 1 value / 12.

#### Refinements

##### R1.1: Why TCV/10 for PS Projects Under 12 Months

The divisor of 10 (not actual contract months) will be baked into the MRR formula throughout the skill. If it reflects a fixed business assumption, that assumption needs to be documented explicitly so analysts do not substitute actual duration.

A. 10 is a fixed company-wide assumption for average PS engagement length (always use 10 regardless of actual contract months)
B. 10 approximates billable months after excluding ramp/close time (a policy simplification)
C. It varies -- the divisor is negotiated or set at deal level, and 10 is just the default
D. Other (please specify)

**Answer**: A

##### R1.2: Definition of "Year 1 Value" for PS Projects Over 12 Months

For PS >12mo deals, the MRR calculation depends on what "year 1 value" means -- different interpretations produce materially different MRR figures and must be stated precisely in the skill.

A. First 12 months of invoiced/billed revenue as scheduled in the contract
B. ACV (Annual Contract Value) as entered on the Odoo Opportunity record
C. Total contract value divided by contract duration in years (i.e., a straight-line ACV)
D. Other (please specify)

**Answer**: B

### Q2: Committed Pipeline Signal -- Stage vs. Forecast Flag [MUST ANSWER]

Your key challenge is that "committed pipeline" is sometimes defined by pipeline stage and sometimes by forecast flag. Which rule governs?

A. Forecast flag is the single source of truth for committed pipeline across all metrics and service types. Stage is used only for funnel/progression reporting.
B. Stage governs pipeline metrics (coverage, weighted pipeline). Forecast flag governs revenue forecasting and commit calls. Both are tracked separately and can diverge.
C. Dual signal required -- a deal is committed only when it reaches a specific stage threshold AND the forecast flag is set to "Committed."
D. The rule differs by service type: Managed Services uses forecast flag, PS uses stage, because PS deals have longer and less predictable cycles.
E. Other (please specify)

_Consolidated from: Metrics Q3, Business Rules Q1, Entities Q4, Segmentation Q3, Modeling Q2_

**Answer**: Stage governs pipeline metrics (coverage, weighted pipeline). Forecast flag governs revenue forecasting and commit calls. Both are tracked separately and can diverge.

#### Refinements

##### R2.1: Pipeline Entry Point -- Which Stage Marks a Deal as "In Pipeline"

The skill must specify the exact stage where a deal transitions from lead/prospecting into counted pipeline, because coverage ratios and weighted pipeline calculations start from that boundary.

A. A specific named stage (e.g., "Qualified" or "Discovery") -- deal must reach this stage to appear in pipeline metrics
B. Any stage beyond the initial "New" or "Prospecting" stage
C. Pipeline entry is governed by the forecast flag, not stage (a deal is in pipeline when any forecast flag is set)
D. Other (please specify)

**Answer**: B

##### R2.2: Tie-Breaking Rule When Stage and Forecast Flag Diverge

Because the two signals are independent and can contradict each other, the skill needs a documented rule for which signal governs commit calls -- otherwise reps and managers will resolve disagreements inconsistently.

A. Forecast flag always wins for commit calls; stage is informational only for commit purposes
B. Manager judgment call -- no hard rule, but divergence must be flagged in the weekly pipeline review
C. The more conservative signal wins (e.g., a late-stage deal without the forecast flag set is not counted as committed)
D. Other (please specify)

**Answer**: B

### Q3: Stage-to-Forecast-Flag Relationship in Odoo [MUST ANSWER]

How are pipeline stage and forecast flag related in your Odoo configuration?

A. Independent fields -- reps set both manually with no system coupling.
B. Stage-driven -- advancing to certain stages automatically sets the forecast flag, but reps can override.
C. Partially coupled -- some stages auto-set the flag, but reps can manually override in either direction.
D. Fully independent, and usage patterns vary by region or service type.
E. Other (please specify)

_Consolidated from: Business Rules Q2, Business Rules Q7_

**Answer**: Independent fields -- reps set both manually with no system coupling.

#### Refinements

##### R3.1: Process-Level Governance Rules for Stage and Forecast Flag Combinations

Since the system enforces no coupling, the skill must document any human-enforced hygiene rules so analysts know when a combination is a data quality issue versus an intentional business state.

A. Specific combinations are prohibited by process (e.g., a deal at stage "Closed Won" must have the forecast flag set -- violations are flagged in pipeline reviews)
B. No required combinations -- reps set both fields independently with no process constraint
C. Required combinations exist for late stages only (e.g., "Proposal Sent" and beyond must have a forecast flag)
D. Other (please specify)

**Answer**: B

### Q4: Service Type Representation in Odoo [MUST ANSWER]

Where does the distinction between Managed Services and Professional Services (and the PS <12mo vs. >12mo split) live in Odoo?

A. A custom field on the Opportunity record (e.g., service_type or business_line), with the <12mo vs. >12mo split derived from a contract duration field.
B. Product category on the quotation / sale order lines -- the service type is inferred from what is being sold.
C. Separate CRM pipelines or sales teams configured in Odoo for each service type.
D. Other (e.g., a tag, inferred from product name, or set in a separate system)

_Consolidated from: Entities Q2, Segmentation Q1_

**Answer**: A custom field on the Opportunity record (e.g., service_type or business_line), with the <12mo vs. >12mo split derived from a contract duration field.

#### Refinements

##### R4.1: Actual Field Names for Service Type and Contract Duration in Odoo

The skill will reference these fields by name for analysts writing reports or building dashboards -- generic descriptions cause lookup errors in practice.

A. Provide the exact technical field names as they appear in Odoo (e.g., `x_service_type`, `x_contract_duration_months`)
B. Only the display labels are known; technical names must be looked up in Odoo settings
C. Other (please specify)

**Answer**: this is not me, source system expert will tell.

##### R4.2: How Contract Duration Is Stored

The MRR branching logic (< 12mo vs. > 12mo) is applied at calculation time -- the skill must specify the data type so analysts know how to write the conditional correctly.

A. A number field storing total months (e.g., `12`, `18`, `24`)
B. Start and end date fields -- duration is derived by calculating the difference
C. A categorical/select field with values like "< 12 months" and "> 12 months" (no raw number stored in Odoo)
D. Other (please specify)

**Answer**: start and end date

### Q5: MRR Attachment Point in the Data Model [MUST ANSWER]

Where is contract duration or term length stored, which drives MRR calculation?

A. On the sale order or quotation header as a custom term_months field.
B. On individual sale order lines -- each line can have its own duration.
C. In a separate subscription or contract module (e.g., Odoo Subscriptions).
D. Not stored in Odoo -- duration is tracked in a separate system or spreadsheet.
E. Other (please specify)

_Consolidated from: Entities Q6_

**Answer**: Not stored in Odoo -- duration is tracked in a separate system or spreadsheet.

#### Refinements

##### R5.1: Join Key Between Odoo Opportunities and the External Duration Data

Without a reliable join key documented in the skill, analysts building pipeline reports that require MRR for PS deals will hit ambiguity or produce mismatches.

A. Odoo Opportunity ID is the primary join key in the external system/spreadsheet
B. A quote or SOW number is the join key (Odoo Opportunity ID is not used externally)
C. No formal join key -- the external data is manually matched by deal name or rep
D. Other (please specify)

**Answer**: Odoo Opportunity ID

##### R5.2: When in the Sales Cycle the External Duration Data Is Expected to Be Populated

The skill must state the expected population point so analysts know when MRR calculations for PS deals can be trusted -- and when they should be treated as incomplete.

A. At stage "Proposal Sent" or equivalent -- duration is known once a SOW is drafted
B. At deal close -- external data is only reliable post-signature
C. At pipeline entry -- reps are expected to estimate duration early and update it
D. Other (please specify)

**Answer**: At stage "Proposal Sent"

---

## Pipeline Entities and Data Model

These questions establish what records drive pipeline reporting and how they relate.

### Q6: Primary Pipeline Entity (Analytical Grain)

Which Odoo record type is the authoritative grain of your pipeline report?

A. The Opportunity record (crm.lead where type = opportunity) -- one row per deal.
B. The Quotation / Sale Order line -- one row per product or service line item.
C. The Opportunity, but with separate rows per service-type bucket when a deal spans multiple types (e.g., a deal with both Managed Services and PS components).
D. Other (please specify)

_Consolidated from: Entities Q1, Modeling Q1_

**Answer**: The Quotation / Sale Order line -- one row per product or service line item.

#### Refinements

##### R6.1: Multi-Line Deal Aggregation for Opportunity-Level Metrics

Since the analytical grain is the sale.order.line, win rate, deal count, and pipeline coverage metrics require an explicit aggregation rule -- without one, a three-line deal could inflate deal count or distort win rate calculations.

A. One deal = one crm.lead record. Opportunity-level metrics (win/loss, deal count) count the crm.lead once, regardless of how many order lines it has. Line-level grain is used only for revenue metrics.
B. Win/loss is tracked at the quotation level (sale.order). A deal with one quotation counts once even with multiple lines. Multiple superseded quotations on one opportunity still count as one deal outcome.
C. Each order line is an independent unit for all metrics, including win/loss. A three-line deal that closes counts as three wins.
D. Other (please specify)

**Answer**: A

##### R6.2: Mixed-Service-Type Deals on a Single Quotation

Because MRR is calculated differently for Managed Services vs. PS (<12mo) vs. PS (>12mo), a single sale.order containing lines of more than one service type requires an explicit rule -- otherwise MRR for that deal is ambiguous.

A. Each line inherits its MRR formula from its own service type field independently. The deal's total MRR is the sum of per-line MRR values, each calculated by its own rule.
B. The deal is classified by its dominant service type (highest TCV line). All lines use that type's MRR formula.
C. Mixed-type deals are not permitted by business process; a separate quotation is always created per service type on the same opportunity.
D. Other (please specify)

**Answer**: A

### Q7: Cardinality Between Opportunities and Quotations

Can a single opportunity have more than one quotation?

A. Yes, regularly -- revisions, re-quotes, and alternates all live as separate quotations under one opportunity.
B. Yes, but only one is ever "active" at a time; others are superseded.
C. No -- one opportunity maps to exactly one quotation by business convention.
D. Other (please specify)

_Consolidated from: Entities Q3_

**Answer**: Yes, but only one is ever "active" at a time; others are superseded.

### Q8: Account-to-Opportunity Relationship

How are companies (res.partner) related to opportunities?

A. Opportunity links to a company directly; contacts are optional.
B. Opportunity links to a contact (individual), and the company is inferred via the contact's parent record.
C. Opportunity links to both a company and a contact as separate fields.
D. Other (please specify)

_Consolidated from: Entities Q5_

**Answer**: Opportunity links to both a company and a contact as separate fields.

### Q9: Lead-to-Opportunity Conversion

When a Lead is converted to an Opportunity, how does reporting treat them?

A. Same record -- Odoo updates the type field in place; pipeline reporting sees continuity.
B. Distinct -- pipeline reporting starts only at opportunity stage; lead metrics are separate.
C. Mixed -- some metrics (e.g., cycle time) need the full lead-to-close timeline; pipeline value is opportunity-only.
D. Other (please specify)

_Consolidated from: Entities Q7_

**Answer**: Distinct -- pipeline reporting starts only at opportunity stage; lead metrics are separate.

### Q10: Custom Fields or Modules in Odoo

Which non-standard Odoo configurations are active that affect pipeline data?

A. Custom fields on crm.lead (opportunity) -- e.g., service type, forecast flag, term length.
B. Third-party or custom CRM module adding new objects or workflows.
C. Odoo Subscriptions module integrated into the CRM pipeline.
D. No significant customizations beyond standard Odoo CRM.
E. Other (please specify)

_Consolidated from: Entities Q8_

**Answer**: Custom fields on crm.lead

---

## Business Rules and Exceptions

These questions capture the operational rules that govern deal progression and pipeline hygiene.

### Q11: Stage Progression Rules

Must a deal pass through every stage sequentially, or can it skip stages?

A. Sequential enforcement -- Odoo blocks stage skipping.
B. Skip-forward allowed, skip-back blocked.
C. Both directions fully open -- reps can move deals to any stage at any time.
D. Service-type-specific rules (e.g., PS deals have stricter progression).
E. Other (please specify)

_Consolidated from: Business Rules Q3_

**Answer**: Both directions fully open -- reps can move deals to any stage at any time.

### Q12: Committed Pipeline Variation by Service Type

Does the definition of "committed pipeline" differ between Managed Services, PS <12mo, and PS >12mo?

A. Same definition (same stage threshold or flag logic) for all service types.
B. Different stage thresholds by service type (e.g., Managed Services commits at Proposal, PS commits at Negotiation).
C. PS <12mo and PS >12mo have different committed thresholds from each other and from Managed Services.
D. Other (please specify)

_Consolidated from: Business Rules Q4_

**Answer**: A

#### Refinements

##### R12.1: Stage Threshold for Committed Pipeline

Q2 confirmed that stage governs pipeline metrics, and Q12 confirmed one threshold applies to all service types -- but the specific stage name or position in the Odoo pipeline was never defined. The skill cannot generate correct filters without it.

A. A specific named stage (e.g., "Proposal Sent", "Contract Sent") marks the committed boundary. All opportunities at or beyond that stage are in committed pipeline.
B. A numeric probability threshold on crm.lead.probability (e.g., >= 70%) defines committed, regardless of stage name.
C. A custom Odoo stage sequence number or stage ID is used (not the label, which varies by sales team).
D. Other (please specify)

**Answer**: A

##### R12.2: Forecast Flag Field Name and Committed Value(s)

Q2 confirmed the forecast flag governs commit calls separately from stage, and both can diverge -- but the specific field name and value(s) on crm.lead or sale.order that constitute "committed" for revenue forecasting were not specified.

A. Odoo's native `forecast_expected_revenue` toggle or the built-in forecast kanban view flag is the signal. A deal is a commit when this native field is set to its affirmative value.
B. A custom boolean or selection field on crm.lead (e.g., `x_commit_flag`) is the signal. Specify field name and the value that means committed.
C. The forecast flag is a specific selection value on Odoo's `probability` override field (manual probability set by the rep, distinct from the AI-predicted value).
D. Other (please specify)

**Answer**: B

##### R12.1a: Which Named Stage Is the Committed Pipeline Threshold?

The PM confirmed that a specific named stage marks the committed boundary. The exact stage name is required to generate correct Odoo domain filters. Selecting the wrong stage will silently miscalculate committed pipeline coverage and weighted pipeline.

- [ ] "Proposal Sent" (opportunity has a formal proposal delivered to the prospect)
- [ ] "Negotiation" (commercial terms are actively being discussed)
- [ ] "Contract Sent" (proposal has escalated to a contract or SOW stage)
- [ ] "Verbal Commit" / "Commit" (a stage explicitly representing prospect commitment)
- [ ] Other (please specify)

**Answer**: Proposal Sent

##### R12.2a: What Is the Custom Commit Flag Field Name on crm.lead?

The PM confirmed a custom field exists on `crm.lead` to signal forecast commitment. The exact technical field name is required for all Odoo domain filters, report queries, and pipeline review logic.

- [ ] `x_commit_flag`
- [ ] `x_forecast_commit`
- [ ] `x_is_committed`
- [ ] `x_forecast_flag`
- [ ] Other (please specify)

**Answer**: the odoo technical architect can confirm this - i don't know.

##### R12.2b: What Value on the Custom Commit Flag Field Means "Committed"?

The PM confirmed the field is either a boolean or selection type. The committed value determines the exact filter condition. A boolean and a selection field require structurally different Odoo domain expressions, so this choice directly changes generated query patterns.

- [ ] Boolean `True` (field is a checkbox; committed = checked)
- [ ] Selection value `"commit"` (field has multiple options; "commit" is the committed state)
- [ ] Selection value `"yes"` or `"confirmed"` (field uses a different string key)
- [ ] Other (please specify)

**Answer**: Selection value `"in forecast"`

### Q13: Stalled and Reverting Deals

What happens when a deal stalls in a stage or reverts to an earlier stage?

A. No system rule -- handled entirely through manual review and pipeline calls.
B. Stalled deals trigger a flag or alert but remain in committed pipeline until manually removed.
C. Stalled deals are automatically excluded from committed pipeline after a configurable threshold period.
D. Reverting a deal's stage automatically removes it from committed pipeline and resets the forecast flag.
E. Other (please specify)

_Consolidated from: Business Rules Q6_

**Answer**: A

### Q14: Closed-Lost and No-Decision Handling

When a deal is marked Closed-Lost, what are the rules for pipeline removal and recycling?

A. Immediate removal from active pipeline; deals can be reopened and re-enter as recycled pipeline.
B. Immediate removal; Closed-Lost is final and cannot be reopened.
C. Delayed removal -- deals stay in pipeline for a review period before being excluded.
D. Other (please specify)

_Consolidated from: Business Rules Q8_

**Answer**: A

---

## Metrics and Calculations

These questions define how key pipeline metrics are computed.

### Q15: Pipeline Coverage Ratio Denominator

When calculating pipeline coverage ratio, what is the denominator?

A. Remaining quota for the current period (quota minus closed-won to date).
B. Full period quota (not reduced by closed deals), so coverage naturally shrinks as deals close.
C. Forecast target for the period, which may differ from quota and may vary by service type (e.g., 4.5x for Managed Services, 2x for PS).
D. Other (please specify)

_Consolidated from: Metrics Q2_

**Answer**: A

### Q16: Weighted Pipeline Probability Weights

How are probability weights assigned in your weighted pipeline calculation?

A. Standard Odoo stage probability percentages, applied uniformly across all service types.
B. Custom probability weights per stage, and those weights differ by service type.
C. Probability is overridden manually by the rep on each opportunity; the weighted pipeline aggregates rep-assigned values.
D. Other (please specify)

_Consolidated from: Metrics Q4_

**Answer**: A

### Q17: Win Rate Definition and Exclusions

What is included in your win rate denominator?

A. Win rate = closed-won / (closed-won + closed-lost). No exclusions or floor rules.
B. Win rate = closed-won / (closed-won + closed-lost), but opportunities below a deal size threshold or minimum active days are excluded.
C. Win rate is calculated separately by service type and never aggregated into a single blended figure.
D. Other (please specify)

_Consolidated from: Metrics Q5_

**Answer**: A

### Q18: Sales Velocity and Deal Value Metric

Sales velocity = (opportunities x win rate x avg deal value) / avg cycle length. Which value metric do you use for "deal value" and "average deal size"?

A. TCV (total contract value) for all service types uniformly.
B. MRR (as defined per service type) as the deal value input.
C. ACV (annualized contract value), normalized to 12 months regardless of actual contract term.
D. Different metrics per service type -- MRR for Managed Services, TCV for PS engagements.
E. Other (please specify)

_Consolidated from: Metrics Q6, Metrics Q8_

**Answer**: B - MRR is the only value we report on

---

## Segmentation and Periods

These questions define how pipeline data is sliced by time, geography, and size.

### Q19: Fiscal Calendar and Quarter Boundaries

What fiscal calendar does the organization use?

A. Standard calendar year (Q1 = Jan-Mar).
B. Non-January fiscal year start (please specify the month).
C. 4-4-5 or 4-5-4 week-based calendar.
D. Other (please specify)

_Consolidated from: Segmentation Q4_

**Answer**: A

### Q20: Region as a Reporting Dimension

Is region a first-class dimension in pipeline reporting?

A. Yes -- formal field on the opportunity with a fixed list; all pipeline metrics reported by region.
B. Region exists but is used inconsistently; some deals have no region set.
C. Region is inferred from account billing country or rep territory, not a direct opportunity field.
D. Region is not used; all pipeline reported at company level only.
E. Other (please specify)

_Consolidated from: Segmentation Q7, Business Rules Q7, Metrics Q7_

**Answer**: C - from rep territory

### Q21: Deal Size Tiers

Does the organization use formal deal size tiers for pipeline segmentation?

A. Yes -- formal tiers with specific ACV or TCV thresholds; pipeline metrics segmented by tier.
B. Informal tiers exist in conversation but are not encoded in Odoo or reporting.
C. Deal size tiers are defined differently per service type.
D. No deal size tiers used.
E. Other (please specify)

_Consolidated from: Segmentation Q8_

**Answer**: E

---

## Analytical Modeling

These questions drive how the pipeline data model is structured for analysis.

### Q22: Pipeline Snapshot Cadence and Retention

How frequently is pipeline data snapshotted, and what fields need to be captured?

A. Weekly snapshots capturing stage, forecast flag, expected revenue, close date, assigned rep, and service type. Live data used between snapshots.
B. Daily snapshots capturing full opportunity state for bitemporal analysis.
C. End-of-period snapshots only (monthly or quarterly) for period-over-period comparison.
D. No formal snapshots -- all analysis runs on live/current data only.
E. Other (please specify)

_Consolidated from: Segmentation Q5, Modeling Q4, Modeling Q5_

**Answer**: B

### Q23: Stage History and Velocity Analysis

How do you need to query historical stage data for pipeline progression and velocity metrics?

A. Current state only -- no need for historical stage tracking.
B. Point-in-time state needed (what stage was a deal in on date X) for pipeline trending.
C. Full stage transition history with timestamps needed to compute stage-to-stage velocity and identify bottlenecks.
D. Both B and C -- point-in-time snapshots AND transition-level detail for velocity.
E. Other (please specify)

_Consolidated from: Modeling Q3, Segmentation Q6_

**Answer**: B

---

## Needs Clarification

### Pipeline Value Metric Inconsistency

Multiple research dimensions surfaced conflicting assumptions about what "pipeline value" means:

- **Metrics research** assumes pipeline value uses MRR or ACV as the deal value.
- **Business Rules research** asks whether pipeline value always uses TCV regardless of service type, with MRR reserved for post-close reporting.
- **Modeling research** asks whether raw contract values or computed MRR should be the silver-layer metric.

This is resolved by **Q1** (MRR definition) and **Q18** (deal value metric). If the answers to those two questions conflict, follow-up will be needed to clarify whether pipeline reporting and velocity calculations use the same value basis.

### Committed Pipeline -- Potential for Contradictory Answers

**Q2** (which signal governs committed pipeline) and **Q3** (how stage and flag are coupled) are tightly linked. If Q2 = "forecast flag only" but Q3 = "stage auto-sets the flag," then the flag is effectively stage-driven despite the stated preference. The skill will need to reconcile these -- no action needed now, but flagging the dependency.

### Unanswered Questions -- Skill Generation Blocked

The following questions have no answers provided. The Metrics and Segmentation sections are entirely unanswered and will significantly limit the skill's accuracy. These should be answered before the skill can be completed.

- **Q15: Pipeline Coverage Ratio Denominator** -- no answer provided. Required for defining the coverage ratio formula, a core pipeline health metric.
- **Q16: Weighted Pipeline Probability Weights** -- no answer provided. Required for computing weighted pipeline, which determines how stage probability translates to expected revenue.
- **Q17: Win Rate Definition and Exclusions** -- no answer provided. Required for specifying the win rate formula and any deal exclusion rules that affect sales velocity and funnel analysis.
- **Q18: Sales Velocity and Deal Value Metric** -- no answer provided. Required for defining which value metric (TCV, MRR, ACV) feeds into velocity calculations and deal size reporting.
- **Q19: Fiscal Calendar and Quarter Boundaries** -- no answer provided. Required for all period-based aggregations, quota tracking, and quarter-over-quarter trend reporting.
- **Q20: Region as a Reporting Dimension** -- no answer provided. Required for determining whether the skill should include regional segmentation in pipeline metrics and dashboards.
- **Q21: Deal Size Tiers** -- no answer provided. Required for pipeline segmentation by deal size, which affects coverage analysis and forecasting stratification.
- **Q22: Pipeline Snapshot Cadence and Retention** -- no answer provided. Required for designing the data model's historical tracking approach and determining storage requirements.
- **Q23: Stage History and Velocity Analysis** -- no answer provided. Required for specifying whether the skill needs stage transition tracking, which drives velocity metrics and bottleneck identification.

### Deferred Questions -- Pending External Input

- **R4.1: Actual Field Names for Service Type and Contract Duration in Odoo** -- PM deferred to source system expert. The skill cannot reference exact Odoo field names for service type and contract duration until this is answered. Generic placeholders will be used in the interim.

### New Refinements -- Committed Pipeline Filter Details

The following sub-refinements were generated because the PM answered the _type_ of threshold/field (R12.1 = named stage, R12.2 = custom field) but not the actual values. These must be completed before the skill can specify exact Odoo domain filters for committed pipeline and forecast commitment logic.

- **R12.1a: Which Named Stage Is the Committed Pipeline Threshold** -- no answer provided. Required to generate the correct stage-based Odoo domain filter for committed pipeline coverage and weighted pipeline calculations.
- **R12.2a: What Is the Custom Commit Flag Field Name on crm.lead** -- no answer provided. Required for all Odoo domain filters, report queries, and pipeline review logic that reference the forecast commitment signal.
- **R12.2b: What Value on the Custom Commit Flag Field Means "Committed"** -- no answer provided. Required to determine whether the filter uses a boolean condition or a selection-value match, which produces structurally different Odoo domain expressions.
