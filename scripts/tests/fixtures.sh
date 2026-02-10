#!/usr/bin/env bash
# fixtures.sh — Create test fixture directories for mode detection and agent tests

# Mode A: Resume (workflow-state.md exists at Step 3)
create_fixture_mode_a() {
  local dir="$1" skill_name="$2"
  mkdir -p "$dir/context"
  mkdir -p "$dir/$skill_name/references"

  cat > "$dir/workflow-state.md" << 'EOF'
# Workflow State: pet-store-analytics
## Current Step: 3 (Parallel Research)
## Domain: pet store analytics
## Status: In Progress
EOF

  cat > "$dir/context/clarifications-concepts.md" << 'EOF'
## Core Entities

### Q1: Primary entities
**Question**: What are the primary business entities in pet store analytics?
**Choices**:
  a) Products, Customers, Transactions
  b) Products, Customers, Transactions, Inventory
  c) Other (please specify)
**Recommendation**: b
**Answer**: b — We track all four plus suppliers
EOF
}

# Mode B: Modify (skill exists, no workflow-state)
create_fixture_mode_b() {
  local dir="$1" skill_name="$2"
  mkdir -p "$dir/$skill_name/references"

  cat > "$dir/$skill_name/SKILL.md" << 'EOF'
# Pet Store Analytics

This skill helps data engineers build silver and gold layer models for pet store analytics domains.

## Key Entities
- Products (inventory items, categories, brands)
- Customers (profiles, loyalty, segments)
- Transactions (sales, returns, exchanges)
- Inventory (stock levels, reorder points, supplier lead times)

## Reference Files
- `references/entities.md` — Entity definitions and relationships
- `references/metrics.md` — KPI definitions and calculation logic
EOF

  cat > "$dir/$skill_name/references/entities.md" << 'EOF'
# Entities

## Products
Products are inventory items sold in pet stores. Key attributes include SKU, category, brand, species target, and price tier.

## Customers
Customer profiles track purchase history, pet ownership, and loyalty program membership.
EOF

  cat > "$dir/$skill_name/references/metrics.md" << 'EOF'
# Metrics

## Revenue Metrics
- Gross Revenue: Total sales before returns
- Net Revenue: Gross Revenue minus returns and discounts
- Average Transaction Value: Net Revenue / Transaction Count
EOF
}

# T4 fixture: Pre-populated workspace with answered clarifications for agent smoke tests
create_fixture_t4_workspace() {
  local dir="$1" skill_name="$2"

  mkdir -p "$dir/context"
  mkdir -p "$dir/$skill_name/references"

  cat > "$dir/workflow-state.md" << 'EOF'
# Workflow State: pet-store-analytics
## Current Step: 5 (Merged Questions Answered)
## Domain: pet store analytics
## Status: In Progress
EOF

  # Answered concepts (Step 2 complete)
  cat > "$dir/context/clarifications-concepts.md" << 'EOF'
## Core Entities

### Q1: Primary entities
**Question**: What are the primary business entities in pet store analytics?
**Choices**:
  a) Products, Customers, Transactions
  b) Products, Customers, Transactions, Inventory
  c) Other (please specify)
**Recommendation**: b
**Answer**: b — We track all four: Products, Customers, Transactions, and Inventory

### Q2: Customer segmentation
**Question**: How do you segment customers?
**Choices**:
  a) By purchase frequency (one-time, repeat, loyal)
  b) By pet type (dog, cat, exotic, multi-pet)
  c) Both dimensions
**Recommendation**: c
**Answer**: c — Both purchase frequency and pet type are important segmentation dimensions

### Q3: Product hierarchy
**Question**: How deep is the product hierarchy?
**Choices**:
  a) Two levels (category, product)
  b) Three levels (department, category, product)
  c) Four+ levels (department, category, subcategory, product)
**Recommendation**: b
**Answer**: b — Department > Category > Product (e.g., Dog Food > Dry Food > Brand X Adult)
EOF

  # Merged clarifications (Steps 3-4 complete, answered in Step 5)
  cat > "$dir/context/clarifications.md" << 'EOF'
## Business Patterns

### Q1: Seasonal patterns
**Question**: Does the business have strong seasonal patterns?
**Choices**:
  a) Yes, holiday-driven (Christmas, adoption events)
  b) Yes, weather-driven (flea/tick season, winter supplies)
  c) Both holiday and weather seasonality
  d) Minimal seasonality
**Recommendation**: c
**Answer**: c — Both holiday gifting peaks and seasonal health/weather product cycles

### Q2: Return and exchange policy
**Question**: What is the return model for different product types?
**Choices**:
  a) Full refund within 30 days for all products
  b) Exchange-only for live animals, refund for products
  c) Custom policy by category
**Recommendation**: b
**Answer**: b — Live animals are exchange-only with health guarantee; products have 30-day returns

### Q3: Loyalty program structure
**Question**: What does the loyalty program look like?
**Choices**:
  a) Points-based (earn per dollar, redeem for discounts)
  b) Tier-based (bronze, silver, gold with escalating benefits)
  c) Subscription model (monthly delivery with discounts)
  d) No formal loyalty program
**Recommendation**: a
**Answer**: a — Points-based: 1 point per dollar, 100 points = $5 discount

## Data Modeling

### Q4: Source systems
**Question**: What are the primary source systems?
**Choices**:
  a) Single POS system
  b) POS + separate inventory management system
  c) POS + inventory + e-commerce platform
**Recommendation**: c
**Answer**: b — POS system (Lightspeed) plus inventory management (proprietary), no e-commerce yet

### Q5: Historical data depth
**Question**: How far back does historical transaction data go?
**Choices**:
  a) Less than 1 year
  b) 1-3 years
  c) 3+ years
**Recommendation**: c
**Answer**: c — 5 years of transaction history available

### Q6: Multi-location
**Question**: Is this a single store or multi-location?
**Choices**:
  a) Single location
  b) 2-5 locations (small chain)
  c) 5+ locations (regional chain)
**Recommendation**: b
**Answer**: b — 3 locations in the metro area, each with slightly different product mix
EOF
}

# T4 fixture: Separate pattern and data files for merge agent testing
create_fixture_t4_merge() {
  local dir="$1"
  mkdir -p "$dir/context"

  cat > "$dir/context/clarifications-patterns.md" << 'EOF'
## Business Patterns

### Q1: Seasonal patterns
**Question**: Does the business have strong seasonal patterns?
**Choices**:
  a) Yes, holiday-driven (Christmas, adoption events)
  b) Yes, weather-driven (flea/tick season, winter supplies)
  c) Both
**Recommendation**: c
**Answer**:

### Q2: Return policy
**Question**: What is the return model?
**Choices**:
  a) Full refund within 30 days
  b) Exchange-only for live animals, refund for products
  c) Custom policy
**Recommendation**: b
**Answer**:

### Q3: Loyalty program
**Question**: What does the loyalty program look like?
**Choices**:
  a) Points-based
  b) Tier-based
  c) Subscription model
  d) No formal program
**Recommendation**: a
**Answer**:
EOF

  cat > "$dir/context/clarifications-data.md" << 'EOF'
## Data Modeling

### Q1: Source systems
**Question**: What are the primary source systems?
**Choices**:
  a) Single POS
  b) POS + inventory management
  c) POS + inventory + e-commerce
**Recommendation**: c
**Answer**:

### Q2: Seasonal patterns
**Question**: Are there seasonal trends in the data?
**Choices**:
  a) Yes, holiday-driven
  b) Yes, weather-driven
  c) Both
**Recommendation**: c
**Answer**:

### Q3: Historical data
**Question**: How far back does data go?
**Choices**:
  a) Less than 1 year
  b) 1-3 years
  c) 3+ years
**Recommendation**: c
**Answer**:
EOF
}
