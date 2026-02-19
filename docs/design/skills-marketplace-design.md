# Skills Marketplace — Feature Design

> A skills marketplace for the skill-builder project: discover, install, and publish domain-specific Claude skills.
> Builds on existing GitHub import/push infrastructure, companion recommender, and template matching designs.

---

## 1. Core Concepts

### What IS the Skills Marketplace?

The skills marketplace is a **discovery and distribution layer** for domain-specific Claude skills built with skill-builder. It connects skill authors (who build skills using the multi-agent workflow) with skill consumers (who want pre-built domain knowledge for their Claude Code projects).

A skill in this context is **not** a code extension or plugin — it is a structured knowledge package (SKILL.md + references/) that teaches Claude domain-specific patterns, rules, and conventions. The marketplace catalogs, indexes, and distributes these knowledge packages.

### How It Differs from Claude Code's Plugin Marketplace

| Aspect | Claude Code Plugins | Skills Marketplace |
|---|---|---|
| **Content** | Code extensions (skills, agents, hooks, MCP servers, LSP servers) | Domain knowledge packages (SKILL.md + references) |
| **Granularity** | Plugin = bundle of many components | Skill = single focused knowledge package |
| **Value source** | Developer tooling (formatters, linters, integrations) | Domain expertise (business rules, data patterns, platform conventions) |
| **Author profile** | Software developers | Data/analytics engineers, domain experts |
| **Install result** | New commands, agents, hooks in Claude Code | New domain context loaded into Claude's working memory |
| **Composability** | Independent plugins | Skills compose via companion recommendations and convention dependencies |

### Three Populations of Skills

1. **Built skills** — Skills you created using the skill-builder workflow. Tracked in `workflow_runs` DB table with full lifecycle (scoping → research → generation → validation). These are candidates for publishing.

2. **Marketplace skills** — Skills published by others, discoverable through the marketplace. Tracked in `imported_skills` DB table after installation. Source link maintained for update detection.

3. **Convention skills** — Standalone tool best-practices skills (e.g., `dbt-conventions`, `fabric-conventions`). Independently versioned, universally useful, and auto-suggested based on a skill's `conventions` frontmatter. These are the most "marketplace-ready" category — tool-agnostic, low personalization needed.

---

## 2. Registry Architecture

### Options Considered

| Option | How It Works | Pros | Cons |
|---|---|---|---|
| **A. Single central GitHub repo** | One `skill-builder-marketplace` repo with a `marketplace.json` catalog and skill directories | Simple, familiar, leverages existing `github_import.rs` | Single point of control, PR bottleneck for submissions, repo size grows |
| **B. Multi-repo federation** | Each author publishes to their own repo; a central index repo aggregates `marketplace.json` entries | Distributed authorship, no size limits per repo | Complex discovery, index staleness, harder to curate |
| **C. Centralized API** | Dedicated backend service with REST API, database, search index | Rich features (search, ratings, analytics), real-time | Infrastructure cost, operational burden, over-engineering for current scale |
| **D. Hybrid: Central index + distributed skills** | Central `marketplace.json` in an index repo points to skills hosted in author repos | Best of A and B — curated index, distributed hosting | Two-hop fetch (index then skill), author repo must stay available |

### Recommendation: Option A (Single Central Repo) → graduating to Option D

**Phase 1**: Start with a single `skill-builder-marketplace` GitHub repo. This directly extends the existing `skill-builder-templates` repo design (shared.md Section 6) — same structure, same `github_import.rs` download pipeline, same haiku matching. The repo contains:

```
skill-builder-marketplace/
├── marketplace.json              # Catalog index (inspired by Claude Code's format)
├── skills/
│   ├── dbt-incremental-silver/
│   │   ├── SKILL.md
│   │   ├── references/
│   │   └── .skill-builder        # Manifest with version, author, metadata
│   ├── salesforce-extraction/
│   ├── dbt-conventions/          # Convention skills
│   ├── elementary-conventions/
│   └── revenue-domain/
└── .claude-plugin/
    └── marketplace.json          # Optional: also register as a Claude Code marketplace
```

**Phase 3+**: Graduate to Option D when the number of skills exceeds what a single repo handles well (~100+ skills). The `marketplace.json` index stays in the central repo but `source` fields point to author repos.

### Why This Builds on Existing Infrastructure

- `list_github_skills()` already scans a repo tree for `SKILL.md` files and parses frontmatter → this is marketplace browse
- `import_github_skills()` already downloads skill directories to local `.claude/skills/` → this is marketplace install
- `push_skill_to_remote()` already pushes skills to a GitHub repo with PR + changelog → this is marketplace publish
- The team repo pattern (`list_team_repo_skills()` / `import_team_repo_skill()`) already handles a configured remote repo → extend for marketplace repo
- `.skill-builder` manifest already tracks version, creator, timestamps → extend for marketplace metadata

### `marketplace.json` Schema

```json
{
  "name": "skill-builder-marketplace",
  "version": "1.0.0",
  "description": "Official skill-builder marketplace",
  "owner": {
    "name": "Skill Builder Team",
    "url": "https://github.com/skill-builder"
  },
  "skills": [
    {
      "name": "dbt-incremental-silver",
      "path": "./skills/dbt-incremental-silver",
      "version": "1.2.0",
      "description": "Build incremental silver layer models in dbt...",
      "author": {
        "login": "github-user",
        "name": "Author Name"
      },
      "skill_type": "data-engineering",
      "category": "dbt",
      "tags": ["dbt", "incremental", "silver-layer", "data-modeling"],
      "dimensions_covered": ["load-merge-patterns", "layer-design"],
      "conventions": ["dbt-conventions"],
      "license": "MIT",
      "stats": {
        "installs": 0,
        "featured": false
      },
      "published_at": "2026-02-15T10:00:00Z",
      "updated_at": "2026-02-19T14:00:00Z"
    }
  ]
}
```

Key design choices in this schema:
- **`dimensions_covered`** enables companion-to-marketplace matching (Section 7)
- **`conventions`** declares tool dependencies, enabling auto-suggestion of convention skills
- **`skill_type`** and **`category`** enable browse filtering (type is the top-level taxonomy, category is domain-specific)
- **`stats.installs`** and **`stats.featured`** support popularity signals (Phase 3)
- **`path`** is relative to the repo root, compatible with `list_github_skills()` path resolution

---

## 3. Skill Metadata Schema

### Extended SKILL.md Frontmatter

The existing SKILL.md frontmatter (`name`, `description`, `tools`) is extended for marketplace discovery:

```yaml
---
name: building-dbt-incremental-silver
description: >
  Build incremental silver layer models in dbt with merge strategies and
  late-arriving data handling. Use when designing incremental materializations,
  merge predicates, or unique_key strategies. Also use when the user mentions
  "incremental model", "merge strategy", or "late-arriving facts".
tools: Read, Write, Edit, Glob, Grep, Bash
# Marketplace extensions (optional — only needed for published skills)
version: 1.2.0
author: github-login
skill_type: data-engineering
category: dbt
tags:
  - dbt
  - incremental
  - silver-layer
  - data-modeling
dimensions_covered:
  - load-merge-patterns
  - layer-design
conventions:
  - dbt-conventions
license: MIT
---
```

### Extended `.skill-builder` Manifest

The existing manifest (`version`, `creator`, `created_at`, `app_version`) is extended:

```json
{
  "version": "1.2.0",
  "creator": "github-login",
  "created_at": "2026-02-15T10:00:00Z",
  "app_version": "0.2.0",
  "license": "MIT",
  "source_url": "https://github.com/skill-builder/marketplace/tree/main/skills/dbt-incremental-silver",
  "source_version": "1.2.0",
  "installed_at": "2026-02-19T14:00:00Z"
}
```

New fields:
- **`license`** — required for sharing rights clarity
- **`source_url`** — link back to marketplace source (set on import, enables update detection)
- **`source_version`** — version at time of install (compare with marketplace for updates)
- **`installed_at`** — when this skill was imported from the marketplace

### Companion Skills Slug Mapping

The companion recommender already outputs structured slugs:

```yaml
companions:
  - slug: salesforce-extraction
    type: source
    dimension: field-semantics
    dimension_score: 3
    priority: High
```

The marketplace maps these slugs to catalog entries via a **two-stage match**:

1. **Exact slug match**: `marketplace.json` skill name matches companion slug directly
2. **Semantic fallback**: If no exact match, use haiku to match the companion's `trigger_description` + `dimension` + `type` against marketplace skill descriptions and `dimensions_covered` fields

This mapping is what powers "Recommended for you" (Section 7).

---

## 4. Discovery & Matching

### Browse

Category grid in the app's marketplace page, organized by:

| Filter | Source | Values |
|---|---|---|
| **Skill type** | `skill_type` field | domain, platform, source, data-engineering |
| **Category** | `category` field | dbt, salesforce, fabric, elementary, revenue, pipeline, etc. |
| **Tags** | `tags` array | Free-form, searchable |
| **Convention** | `conventions` field | dbt-conventions, fabric-conventions, etc. |

Sort options: Featured, Most installed, Recently updated, Alphabetical.

### Search

**Haiku-powered semantic search** — the same engine designed for template matching (VD-696):

1. User types a search query (e.g., "incremental loading patterns for dbt")
2. System sends the query + marketplace skill descriptions to haiku
3. Haiku returns ranked matches with relevance scores and reasoning
4. Results displayed with match reasoning visible ("Matches because: covers load-merge-patterns dimension for dbt data-engineering skills")

Cost: ~$0.01 per search (same as template matching). Cached for repeat queries.

For simple text queries, a **client-side filter** on name/description/tags runs first (instant, free). Haiku semantic search is a "deeper search" option for when text filtering returns too many or too few results.

### Recommendations

Three recommendation surfaces:

1. **Companion-driven**: After building a skill, the companion report recommends 2-4 complementary skills. Each recommendation shows "Install from marketplace" if a match exists, or "Build this skill" otherwise (see Section 7).

2. **Convention-driven**: When a skill declares `conventions: [dbt-conventions]` in frontmatter, the marketplace suggests installing `dbt-conventions` if not already installed. Auto-prompted during skill deployment.

3. **Context-driven**: Based on the user's `industry` + `function_role` settings (already stored), the marketplace highlights skills relevant to their domain. E.g., a user with `industry: financial_services` sees revenue and compliance skills featured.

### Preview

Before installing, users see a **read-only preview** of the skill:

- Full SKILL.md rendered as markdown
- List of reference files (names and sizes, not full content)
- Companion graph: what skills this one composes with
- Author info (GitHub login, avatar, published skill count)
- Metadata: version, last updated, install count, license
- Convention dependencies: which convention skills are required

Implementation: Fetch `SKILL.md` content via GitHub API (`GET /repos/:owner/:repo/contents/skills/:name/SKILL.md`) and render in a modal. No local download needed for preview.

---

## 5. Import/Install Flow

### One-Click Install from Browse UI

```
User clicks "Install" on a marketplace skill card
  ↓
Confirm dialog: "Install [skill name] to your workspace?"
  Shows: version, author, license, convention dependencies
  ↓
Backend: import_marketplace_skill(skill_path, marketplace_repo)
  ↓
1. Download skill directory via github_import.rs
   (SKILL.md + references/ + .skill-builder manifest)
  ↓
2. Write to .claude/skills/{skill-name}/
  ↓
3. Insert into imported_skills DB table
   (with source_url, source_version for update tracking)
  ↓
4. Regenerate CLAUDE.md with new skill's trigger text
   (existing regenerate_claude_md() function)
  ↓
5. If skill declares conventions: prompt to install convention skills
  ↓
Skill is immediately available in the workspace
```

### Scope

**Workspace-level only.** Skills are workspace-specific by nature — a Salesforce extraction skill is meaningless outside a project that ingests Salesforce data. This matches the existing `imported_skills` behavior where skills are installed to `.claude/skills/` within the workspace.

Global/user-level installation is a future consideration for convention skills only (they're tool-generic, not domain-specific).

### Conflict Resolution

When a skill with the same name already exists locally:

| Scenario | Behavior |
|---|---|
| **Same skill, older version** | Prompt: "Update [name] from v1.0 to v1.2?" — overwrites files, updates DB |
| **Same skill, same version** | Prompt: "Already installed (v1.2). Reinstall?" — force-overwrite option |
| **Same name, different skill** | Prompt: "A skill named [name] already exists. Rename the import?" — append suffix or let user choose name |
| **Built skill with same name** | Block: "You have a skill named [name] in progress. Import would overwrite your work. Rename first." |

### Version Tracking

The `.skill-builder` manifest's new `source_url` and `source_version` fields enable update detection:

1. At app startup (or manual refresh), fetch `marketplace.json` from the marketplace repo
2. For each installed skill with a `source_url`, compare `source_version` with the marketplace catalog version
3. If newer version available, show "Update available" badge on the skill card
4. User clicks "Update" → re-import the skill, preserving any local customizations in a backup

---

## 6. Publishing Flow

### Author Journey

```
Author builds skill using skill-builder workflow
  ↓
Skill passes validation (validate-quality + test-skill + companion-recommender)
  ↓
Author clicks "Publish to Marketplace" in the app
  ↓
1. Pre-flight check:
   - SKILL.md exists and passes validation
   - .skill-builder manifest exists with version
   - All marketplace metadata present (or auto-generate)
  ↓
2. Auto-generate missing metadata via haiku:
   - category (inferred from skill_type + domain + tags)
   - tags (extracted from SKILL.md content + reference filenames)
   - description (already exists from trigger text, but can be enhanced)
  ↓
3. Version bump:
   - If first publish: set to 1.0.0
   - If update: prompt for semver bump (patch/minor/major)
   - Generate changelog via haiku (existing push pipeline does this)
  ↓
4. Submit to marketplace repo:
   - Push skill directory to skill-builder-marketplace repo
   - Create PR with skill files + updated marketplace.json entry
   - PR body includes: skill preview, metadata, changelog, validation results
  ↓
5. Review & merge:
   - Phase 1: Manual review (maintainer merges PR)
   - Phase 3: Automated checks + expedited review for trusted authors
  ↓
Skill appears in marketplace catalog after merge
```

### Extending the Existing Push Pipeline

The current `push_skill_to_remote()` pushes to a configured team repo. For marketplace publishing:

1. **New target**: Add a `marketplace_repo` setting alongside `remote_repo_owner`/`remote_repo_name`
2. **Branch naming**: `skill/{login}/{skill_name}` (existing convention works)
3. **PR content**: Extend to include marketplace metadata and validation results
4. **marketplace.json update**: The PR includes an updated `marketplace.json` entry for the skill (generated by the app, validated in CI)

The push pipeline already handles: authentication (GitHub OAuth), versioning (git tags), changelog generation (haiku), PR creation (`gh pr create`), and manifest writing (`.skill-builder`). Marketplace publish is a **second target** for the same pipeline, not a new pipeline.

---

## 7. Companion-to-Marketplace Bridge

This is the key innovation that differentiates the skills marketplace from a generic catalog.

### The Connection

The companion recommender already produces structured recommendations with:
- **`slug`**: A kebab-case identifier (e.g., `salesforce-extraction`)
- **`dimension`**: Which research dimension this fills (e.g., `field-semantics`)
- **`type`**: The skill type (e.g., `source`)
- **`priority`**: How important this companion is (High/Medium/Low)
- **`trigger_description`**: What the companion skill would do

The marketplace indexes skills by the same taxonomy:
- **`name`**: Maps to companion slug
- **`dimensions_covered`**: Maps to companion dimension
- **`skill_type`**: Maps to companion type
- **`description`**: Maps to companion trigger_description

### Matching Algorithm

When a companion recommendation is generated:

```
For each companion in companion-skills.md:
  1. Exact match: Find marketplace skill where name == companion.slug
     → If found: "Install [name] from marketplace"

  2. Dimension match: Find marketplace skills where
     dimensions_covered CONTAINS companion.dimension
     AND skill_type == companion.type
     → If found: "These marketplace skills cover [dimension]"

  3. Semantic match (haiku): Send companion.trigger_description
     to haiku with all marketplace skill descriptions
     → Returns ranked matches with reasoning
     → "These skills may help: [ranked list]"

  If no matches at any stage:
     → "Build this skill" (pre-fill create wizard with companion metadata)
```

### UI Integration

On the companion skills panel (VD-697 app component):

```
┌─────────────────────────────────────────────────┐
│ Companion Skills for "sales-pipeline"            │
├─────────────────────────────────────────────────┤
│                                                  │
│ ● salesforce-extraction (source) — High priority │
│   Covers: field-semantics (score: 3)            │
│   "Source skill for Salesforce ingestion layer"  │
│   [Install from Marketplace ↓]  [Build Instead]  │
│                                                  │
│ ● dbt-on-fabric (platform) — Medium priority    │
│   Covers: platform-behavioral-overrides          │
│   "Platform conventions for dbt on Fabric"       │
│   [Not in Marketplace]  [Build This Skill →]     │
│                                                  │
│ ● elementary-conventions (convention) — Medium   │
│   "Data quality testing patterns for Elementary" │
│   [Install Convention Skill ↓]                   │
│                                                  │
└─────────────────────────────────────────────────┘
```

### "Recommended for You" Dashboard

Aggregate companion reports across all user-built skills:

1. Collect all companion recommendations from all `companion-skills.md` files
2. Deduplicate by slug, keeping highest priority
3. Match against marketplace catalog
4. Display as "Recommended for You" section on the marketplace page

This creates a personalized marketplace experience driven by the user's actual knowledge gaps, not generic popularity metrics.

---

## 8. App UI Design

### Navigation

Add a **"Marketplace"** entry to the app's sidebar navigation (alongside existing Skills, Refine, Settings). This is a new top-level page, not a subsection of the skills library, because marketplace browsing is a distinct activity from skill management.

### Marketplace Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Marketplace                                    [🔍 Search]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ [All] [Installed] [Updates Available (2)]                   │
│                                                             │
│ ┌─── Recommended for You ──────────────────────────────┐    │
│ │ Based on your companion reports                       │    │
│ │ ┌─────────┐ ┌─────────┐ ┌─────────┐                 │    │
│ │ │salesforce│ │dbt-seman│ │revenue- │                 │    │
│ │ │-extract  │ │tic-layer│ │domain   │                 │    │
│ │ │ SOURCE   │ │ DATA-ENG│ │ DOMAIN  │                 │    │
│ │ │ ★ 45     │ │ ★ 120   │ │ ★ 32    │                 │    │
│ │ │[Install] │ │[Install]│ │[Install]│                 │    │
│ │ └─────────┘ └─────────┘ └─────────┘                 │    │
│ └──────────────────────────────────────────────────────┘    │
│                                                             │
│ ┌─── Browse by Category ───────────────────────────────┐    │
│ │                                                       │    │
│ │ Filter: [Type ▾] [Category ▾] [Tags ▾]  Sort: [▾]   │    │
│ │                                                       │    │
│ │ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │    │
│ │ │ skill   │ │ skill   │ │ skill   │ │ skill   │    │    │
│ │ │ card    │ │ card    │ │ card    │ │ card    │    │    │
│ │ └─────────┘ └─────────┘ └─────────┘ └─────────┘    │    │
│ │ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │    │
│ │ │ skill   │ │ skill   │ │ skill   │ │ skill   │    │    │
│ │ │ card    │ │ card    │ │ card    │ │ card    │    │    │
│ │ └─────────┘ └─────────┘ └─────────┘ └─────────┘    │    │
│ └──────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Skill Card

Each card in the browse grid shows:

```
┌──────────────────────────┐
│ dbt-incremental-silver   │
│ DATA-ENGINEERING         │  ← skill_type badge (colored)
│                          │
│ Build incremental silver │
│ layer models in dbt...   │  ← truncated description
│                          │
│ dbt · incremental · ...  │  ← tags (first 3)
│                          │
│ @author-login  v1.2.0    │  ← author + version
│ ↓ 45 installs            │  ← popularity signal
│                          │
│ [Install]  [Preview]     │
└──────────────────────────┘
```

### Skill Detail View

Clicking "Preview" or the card title opens a detail panel (slide-over or modal):

- **Header**: Name, type badge, author (with avatar), version, install count
- **Description**: Full trigger description from SKILL.md
- **References**: List of reference files with names (not content)
- **Conventions**: Required convention skills (with install links)
- **Companions**: What skills compose well with this one
- **Changelog**: Version history with haiku-generated summaries
- **Actions**: `[Install]` `[View on GitHub]`
- **SKILL.md preview**: Rendered markdown of the full SKILL.md

### "Installed" Tab

Shows all marketplace-installed skills with:
- Current version vs available version
- "Update" button when newer version exists
- "Uninstall" button
- Toggle active/inactive (existing `toggle_skill_active()`)
- Link to source on GitHub

### "Updates Available" Indicator

Badge count on the Marketplace nav item and Installed tab showing how many installed skills have newer versions in the marketplace.

---

## 9. Plugin Integration

### CLI Plugin Marketplace Interaction

The state-aware router (VD-677) can suggest marketplace skills in two scenarios:

1. **During scoping**: When the router detects a domain that has templates/skills in the marketplace:
   ```
   Router: "I found a marketplace skill 'salesforce-extraction' that covers
   Salesforce ingestion patterns. Would you like to:
     a) Install it and build on top of it
     b) Build from scratch (I'll use it as a reference)
     c) Ignore it"
   ```

2. **After validation**: When the companion report recommends skills that exist in the marketplace:
   ```
   Router: "Your skill would pair well with 'dbt-conventions' (available in
   the marketplace). Install it to your workspace?"
   ```

### Template Matching → Marketplace Matching

The template matching flow (VD-696) is essentially marketplace search scoped to the create-time context. When templates evolve into the marketplace:

- Template repo becomes the marketplace repo (or a subset of it)
- Template index becomes `marketplace.json`
- Haiku matching works identically — same inputs (name, type, domain, intake), same ranking output
- "Import as starting point" becomes "Install from marketplace"

The only difference: templates are starter skills (imported before building), while marketplace skills are finished skills (imported for use as-is). Both use the same `github_import.rs` pipeline.

---

## 10. Phased Rollout

### Phase 1: Central GitHub Repo as Registry, Browse in App, One-Click Import

**Goal**: Get skills discoverable and installable with minimal new infrastructure.

**Builds on**:
- `github_import.rs` (download pipeline) — ready
- `.skill-builder` manifest (versioning, author) — ready
- `imported_skills` DB table (tracking) — ready
- `regenerate_claude_md()` (auto-wiring) — ready
- Template repo structure design (shared.md Section 6) — needs creation

**New work**:
- Create `skill-builder-marketplace` GitHub repo with `marketplace.json` + initial skills
- Add `marketplace_repo` setting to app settings
- Add Marketplace page with browse grid and detail view
- Add `import_marketplace_skill()` Rust command (thin wrapper over `import_github_skills()`)
- Extend `.skill-builder` manifest with `source_url` and `source_version`
- Add update detection (compare local vs remote versions at startup)
- Seed with convention skills (`dbt-conventions`, `elementary-conventions`, etc.)

**Not included**: Publishing flow, companion matching, ratings, semantic search.

### Phase 2: Companion-to-Marketplace Matching, "Recommended for You"

**Goal**: Connect the companion recommender to the marketplace for personalized discovery.

**Builds on**:
- Companion recommender agent — ready
- `companion-skills.md` artifact with structured YAML — ready
- Companion UI (VD-697 app component) — needs building

**New work**:
- Add `dimensions_covered` field to `marketplace.json` skill entries
- Implement companion-to-marketplace matching algorithm (exact → dimension → semantic)
- Build "Recommended for You" section on marketplace page
- Build companion skills panel with "Install from Marketplace" / "Build This Skill" actions
- Convention skills auto-suggestion based on `conventions` frontmatter

### Phase 3: Publishing Flow, Community Signals

**Goal**: Let users publish their skills to the marketplace.

**Builds on**:
- `push_skill_to_remote()` pipeline (authentication, versioning, changelog, PR) — ready
- `validate-quality` + `test-skill` validation agents — ready

**New work**:
- "Publish to Marketplace" button in app (targets marketplace repo instead of team repo)
- Auto-generate marketplace metadata via haiku (category, tags)
- Marketplace PR template with validation results
- Install count tracking (GitHub API or marketplace.json stats field)
- "Featured" curation (manual selection by maintainers)
- Author profiles (published skill count, link to GitHub)

### Phase 4: Multi-Registry Support, Team/Private Marketplaces

**Goal**: Support enterprise teams with private skill registries.

**New work**:
- Multiple marketplace repos (public + team + private)
- `extraKnownMarketplaces` setting (like Claude Code's team marketplace feature)
- Private repo support via existing GitHub OAuth
- Team marketplace management (admin controls who can publish)
- Rating/review system (optional, if community signals from Phase 3 prove insufficient)

---

## 11. Key Design Decisions

### Decision 1: Single Central Repo vs Multi-Repo Federation

| Option | Trade-offs |
|---|---|
| **Single central repo** | Simple to implement, easy to curate, single source of truth. Risk: repo size, PR bottleneck |
| **Multi-repo federation** | Distributed authorship, unlimited scale. Risk: index staleness, discovery complexity, quality variance |

**Recommendation: Single central repo** for Phases 1-3, with a migration path to federated (Option D from Section 2) if scale demands it. The existing `github_import.rs` already handles single-repo operations well. Multi-repo adds complexity that isn't justified until we have 100+ skills and multiple publishing teams.

### Decision 2: Catalog Format

| Option | Trade-offs |
|---|---|
| **`marketplace.json` catalog** | Static file, cacheable, works offline, git-versioned. Risk: manual updates, can drift from actual skill files |
| **GitHub API scanning** | Always current, no manual catalog. Risk: rate limits, slow for large repos, no custom metadata beyond what's in files |
| **Dedicated backend** | Rich query capabilities, real-time stats. Risk: infrastructure cost, operational burden, over-engineering |

**Recommendation: `marketplace.json` catalog** — directly inspired by Claude Code's proven format. It's a static file in the repo, updated via PR when skills are added/updated. CI validation ensures it stays in sync with actual skill directories. GitHub API scanning is used as a **fallback** for repos that don't have a `marketplace.json` (backwards compatibility with plain skill repos).

### Decision 3: Skill-Level vs Repo-Level Versioning

| Option | Trade-offs |
|---|---|
| **Skill-level versioning** | Each skill has its own semver in `.skill-builder` manifest. Granular updates, independent release cycles. Risk: version coordination across related skills |
| **Repo-level versioning** | One version for the whole marketplace repo. Simple, atomic. Risk: can't update one skill without bumping everything |

**Recommendation: Skill-level versioning.** Skills are independent knowledge packages with independent lifecycles. A `dbt-conventions` update shouldn't force a version bump on `salesforce-extraction`. The existing push pipeline already does skill-level versioning via git tags (`pushed/{name}/v{N}`). Semver in the `.skill-builder` manifest is the version of record.

### Decision 4: Curation Model

| Option | Trade-offs |
|---|---|
| **Open submission** | Anyone can publish, maximum content. Risk: quality variance, spam, abandoned skills |
| **Curated** | Maintainers review all submissions. High quality. Risk: bottleneck, slow turnaround, discourages contributions |
| **Hybrid** | Open submission with automated quality gates + manual review for "featured" status. Balances quality and openness |

**Recommendation: Hybrid.** The existing validation pipeline (`validate-quality` + `test-skill`) provides automated quality gates. Every submission PR includes validation results. Automated checks (SKILL.md structure, frontmatter completeness, reference file existence) gate merge eligibility. Manual review curates the "Featured" section and resolves edge cases. Trusted authors (3+ published skills with good validation scores) get expedited review.

### Decision 5: Matching Algorithm

| Option | Trade-offs |
|---|---|
| **Exact slug match** | Fast, deterministic, zero cost. Risk: misses near-matches, requires exact naming conventions |
| **Semantic (haiku) match** | Finds conceptual matches regardless of naming. Risk: ~$0.01 per query, latency, occasional false positives |
| **Both (cascading)** | Exact match first (free, fast), semantic fallback (smart, costs per query). Best of both worlds |

**Recommendation: Cascading (exact → semantic).** Exact slug match handles the common case (companion slug matches marketplace skill name) at zero cost. Semantic haiku match handles the long tail (companion describes a need that doesn't map to any specific slug). This is the same pattern designed for template matching (VD-696) — one haiku call with the query + all marketplace descriptions.

---

## 12. DB Schema Extensions

### New: `marketplace_sources` Table

Tracks configured marketplace repositories:

```sql
CREATE TABLE marketplace_sources (
  source_id TEXT PRIMARY KEY,       -- e.g., "official", "team-acme"
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  display_name TEXT,
  last_synced_at TEXT,
  catalog_version TEXT               -- marketplace.json version
);
```

### Extended: `imported_skills` Table

Add columns for marketplace tracking:

```sql
ALTER TABLE imported_skills ADD COLUMN source_url TEXT;       -- marketplace repo URL
ALTER TABLE imported_skills ADD COLUMN source_version TEXT;   -- version at install time
ALTER TABLE imported_skills ADD COLUMN marketplace_id TEXT;   -- FK to marketplace_sources
ALTER TABLE imported_skills ADD COLUMN installed_at TEXT;     -- when imported from marketplace
ALTER TABLE imported_skills ADD COLUMN update_available TEXT; -- newer version if detected
```

### New: `marketplace_cache` Table

Local cache of `marketplace.json` for offline browse and fast rendering:

```sql
CREATE TABLE marketplace_cache (
  source_id TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  metadata_json TEXT NOT NULL,       -- full marketplace.json skill entry
  cached_at TEXT NOT NULL,
  PRIMARY KEY (source_id, skill_name)
);
```

---

## 13. New Rust Commands

| Command | Purpose | Phase |
|---|---|---|
| `add_marketplace_source(owner, repo)` | Register a marketplace repo | 1 |
| `sync_marketplace(source_id?)` | Fetch/update `marketplace.json` from remote | 1 |
| `list_marketplace_skills(source_id?, filters?)` | Browse cached marketplace catalog with filters | 1 |
| `preview_marketplace_skill(source_id, skill_name)` | Fetch SKILL.md content for preview | 1 |
| `install_marketplace_skill(source_id, skill_name)` | Download + install + DB entry + CLAUDE.md | 1 |
| `check_skill_updates()` | Compare installed versions with marketplace | 1 |
| `update_marketplace_skill(skill_id)` | Re-import newer version | 1 |
| `match_companions_to_marketplace(skill_name)` | Run companion-to-marketplace matching | 2 |
| `get_marketplace_recommendations(industry?, role?)` | Context-driven recommendations | 2 |
| `publish_to_marketplace(skill_name)` | Push to marketplace repo with PR | 3 |
| `generate_marketplace_metadata(skill_name)` | Haiku-generate category, tags | 3 |

---

## 14. Relationship to Existing Design Docs

| Design Doc | Relationship to Marketplace |
|---|---|
| `shared.md` Section 6 (Skill Templates) | Template repo becomes the marketplace repo (or its seed content). Template matching becomes marketplace search. Same haiku-based matching engine. |
| `shared.md` Section 7 (Companion Report) | Companion recommendations drive personalized marketplace discovery. The `template_match` field (currently `null`) resolves to marketplace entries. |
| `shared.md` Section 8 (Convention Skills) | Convention skills are the first category of marketplace content. Auto-suggested based on `conventions` frontmatter. |
| `app.md` Section 3 (Companion UI) | Companion panel shows "Install from Marketplace" when a match exists. This is the primary conversion surface for marketplace installs. |
| `app.md` Section 5 (Template Matching) | Template matching UI becomes marketplace search UI. Same flow: haiku match → present options → import. |
| `plugin.md` Section 2 (State-Aware Router) | Router suggests marketplace skills during scoping and after validation. |

---

## 15. Open Questions

1. **Marketplace repo hosting**: Should the marketplace repo live under the skill-builder org, or a dedicated org? (Affects URL branding and governance.)

2. **Offline mode**: Should the app bundle a snapshot of `marketplace.json` for offline browsing? (Increases app size but improves cold-start experience.)

3. **Skill packs**: Should we support curated bundles of related skills (e.g., "dbt Data Platform Pack" = dbt-conventions + dbt-incremental-silver + elementary-conventions)? (Inspired by Continue.dev's assistant bundles.)

4. **Cross-client compatibility**: Should marketplace skills be installable in both the desktop app and the CLI plugin? (The file format is identical, but install paths differ.)

5. **Deprecation policy**: How do we handle marketplace skills that are abandoned or superseded? (Version freeze + "deprecated" badge + redirect to successor?)
