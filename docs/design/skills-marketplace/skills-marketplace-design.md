# Skills Marketplace — Feature Design

> Documents the skills marketplace as built in VD-696 (browse, install, manage) and the remaining roadmap (publish, companion matching, community signals).

---

## 1. Core Concepts

### What IS the Skills Marketplace?

The skills marketplace is a **discovery and distribution layer** for domain-specific Claude skills built with skill-builder. It connects skill authors (who build skills using the multi-agent workflow) with skill consumers (who want pre-built domain knowledge for their Claude Code projects).

A skill is a structured knowledge package (SKILL.md + references/) that teaches Claude domain-specific patterns, rules, and conventions. The marketplace catalogs and distributes these packages via a configured GitHub repository.

### Two Populations of Skills

The app manages two types of skills that differ in lifecycle and storage:

| | **Built skills** | **Marketplace skills** |
|---|---|---|
| **Origin** | Created locally using the workflow | Imported from a marketplace GitHub repo |
| **DB table** | `workflow_runs` (source='created') | `workflow_runs` (source='marketplace') **and** `imported_skills` |
| **Status** | pending → in_progress → completed | Always 'completed', current_step=5 |
| **Location** | `skills_path/{name}/` | `skills_path/{name}/` (same path) |
| **Refinable?** | Yes, after workflow completes | Yes, immediately after import |
| **CLAUDE.md wired** | Yes, by workflow | Yes, by import pipeline |

Both types live at `skills_path/{skill_name}/` and are fully interchangeable for refinement and use. Marketplace skills are "already completed" — they skip the generation workflow entirely.

---

## 2. Architecture: GitHub-Repo-as-Registry (Built)

### The Registry Model

The marketplace is a **GitHub repository** — any repo with skill directories (each containing SKILL.md) and a configured URL. No separate catalog file, no dedicated backend, no central index.

**Configuration**: A single `marketplace_url` setting in Settings → GitHub stores the repo URL (supports GitHub shorthand `owner/repo`, full GitHub URL, and subpath `owner/repo/tree/branch/path`).

**Discovery**: `list_github_skills()` fetches the repo's recursive git tree from the GitHub API, finds all `SKILL.md` files, parses frontmatter, and returns an `AvailableSkill[]` list. This is the "browse" operation — no pre-downloaded catalog needed.

**Authentication**: Uses the configured GitHub OAuth token (or none for public repos). The default branch is auto-detected via the GitHub repos API before fetching the tree, avoiding 404s on repos where the default branch isn't `main`.

### Why This Works

The existing `list_github_skills` / `import_github_skills` infrastructure already did exactly this — it's marketplace discovery without the "marketplace" label. Adding `marketplace_url` as a dedicated setting and routing imports through `import_marketplace_to_library` (which creates `workflow_runs` rows) is the only new infrastructure needed.

### What a Marketplace Repo Looks Like

Any GitHub repo where each subdirectory (or subdirectory within a subpath) contains a `SKILL.md`:

```
skill-builder-marketplace/
├── dbt-incremental-silver/
│   ├── SKILL.md               ← required; frontmatter drives discovery
│   └── references/
│       └── ...
├── management-accounting/
│   ├── SKILL.md
│   └── references/
└── salesforce-extraction/
    ├── SKILL.md
    └── references/
```

No `marketplace.json` catalog is needed for Phase 1. Skills are discovered by scanning the tree. A future `marketplace.json` catalog (for richer metadata: descriptions, featured status, install counts) is a Phase 3 consideration.

### Filtering by Type

The `GitHubImportDialog` accepts a `typeFilter?: string[]` prop that filters the skill list to only skills whose `skill_type` frontmatter field is in the list. Dashboard uses this to show only domain-type skills (`['platform', 'domain', 'source', 'data-engineering']`) in the marketplace dialog, keeping convention skills separate.

---

## 3. Data Model (Built)

### DB Migrations

Three migrations were added (14–16):

**Migration 14**: Adds `source TEXT DEFAULT 'created'` to `workflow_runs`.
- Existing rows get `source='created'` (user-built skills)
- Marketplace imports use `source='marketplace'`

**Migration 15**: Extends `imported_skills` with: `skill_type`, `version`, `model`, `argument_hint`, `user_invocable`, `disable_model_invocation` — matching the extended frontmatter parsed from SKILL.md.

**Migration 16**: Adds the same 6 columns to `workflow_runs` so built skills can also store these frontmatter fields.

### `workflow_runs` (extended)

```
skill_name       TEXT PRIMARY KEY
domain           TEXT
current_step     INTEGER
status           TEXT              -- 'pending' | 'in_progress' | 'completed'
skill_type       TEXT              -- 'domain' | 'platform' | 'source' | 'data-engineering' | 'skill-builder'
source           TEXT              -- 'created' | 'marketplace'
description      TEXT
version          TEXT
model            TEXT
argument_hint    TEXT
user_invocable   INTEGER           -- 0 or 1
disable_model_invocation INTEGER  -- 0 or 1
author_login     TEXT
author_avatar    TEXT
display_name     TEXT
intake_json      TEXT
created_at       TEXT
updated_at       TEXT
```

**Marketplace rows**: `source='marketplace'`, `status='completed'`, `current_step=5`. Written by `save_marketplace_skill_run()`.

### `imported_skills` (extended)

```
skill_id         TEXT PRIMARY KEY    -- 'imp-{name}-{timestamp}'
skill_name       TEXT UNIQUE
domain           TEXT
is_active        INTEGER             -- 0 or 1
disk_path        TEXT                -- absolute path to skill dir
imported_at      TEXT
is_bundled       INTEGER
skill_type       TEXT
version          TEXT
model            TEXT
argument_hint    TEXT
user_invocable   INTEGER
disable_model_invocation INTEGER
```

**Both tables** are written for every marketplace import. `imported_skills` handles the "skills library" view (toggle active/inactive, delete). `workflow_runs` makes marketplace skills eligible for `list_refinable_skills` and shows them in the main dashboard skill list.

### Key DB Functions

| Function | SQL Pattern | Purpose |
|---|---|---|
| `save_marketplace_skill_run` | `INSERT … ON CONFLICT DO UPDATE` on `skill_name` | Create/update `workflow_runs` row for marketplace skill |
| `upsert_imported_skill` | `INSERT … ON CONFLICT DO UPDATE` on `skill_name` | Idempotent insert into `imported_skills` |
| `get_all_installed_skill_names` | `SELECT skill_name FROM workflow_runs UNION SELECT skill_name FROM imported_skills` | Pre-mark already-installed skills in browse UI |

---

## 4. Skill Metadata (Built)

### What's Parsed from SKILL.md Frontmatter

`import_single_skill` calls `parse_frontmatter_full` which extracts:

```yaml
---
name: building-dbt-incremental-silver    # → skill_name (or dir name if absent)
description: >                            # → imported_skills.description + workflow_runs description
  ...
domain: dbt                              # → stored in both tables
skill_type: data-engineering             # → stored in both tables; drives typeFilter
version: 1.2.0                           # → stored in both tables
model: sonnet                            # → optional; preferred model for this skill
argument_hint: "dbt model name"          # → shown to user when invoking the skill
user_invocable: true                     # → whether skill can be directly invoked
disable_model_invocation: false          # → disables model selection UI for this skill
tools: Read, Write, Edit, Glob, Grep, Bash
---
```

Fields not in frontmatter use defaults (empty string or 0). `author_login` / `author_avatar` / `display_name` are set separately via `set_skill_author` / `set_skill_display_name` (called after import if OAuth profile is available).

### What's NOT Yet Parsed

- `tags` — not in `parse_frontmatter_full`, not stored per-skill (only via `skill_tags` table for built skills)
- `license` — not parsed
- `conventions` — not parsed or acted upon
- `dimensions_covered` — not parsed (future companion matching)

---

## 5. Browse & Discovery (Built)

### UI Entry Points

**Skills Library tab** (`skills-library-tab.tsx`):
- Shows `ImportedSkill[]` from `imported_skills` table (filtered to `skill_type='skill-builder'`)
- "Marketplace" button — disabled when `marketplaceUrl` is not configured (shows tooltip directing to Settings → GitHub)
- Opens `GitHubImportDialog` in `mode='settings-skills'`

**Dashboard marketplace dialog** (`dashboard.tsx`):
- "Browse Marketplace" button — same disabled logic
- Opens `GitHubImportDialog` in `mode='skill-library'` with `typeFilter=['platform', 'domain', 'source', 'data-engineering']`
- This is the main path for importing marketplace skills that appear in the skill list and become refinable

**SkillDialog marketplace prompt**:
- When creating a new skill and a marketplace match is found, shows "Import and refine" option
- Opens `GitHubImportDialog` in `mode='skill-library'`

### GitHubImportDialog Behaviour

1. Opens → immediately fetches the marketplace repo (browse mode, not URL entry)
2. Calls `list_github_skills(owner, repo, branch, subpath?)` — scans repo tree, parses frontmatter
3. If `typeFilter` is set, filters results by `skill_type`
4. Calls `get_installed_skill_names()` — marks already-installed skills as "exists" (greyed out, "In library" shown)
5. Shows skill list: name, domain badge, description; each with Install button (or "In library" / "Imported" state)
6. User clicks Install → `handleImport(skill)`

### Import vs. Browse Modes

| `mode` | Install command | Creates `workflow_runs`? | Shows in dashboard? | Refinable? |
|---|---|---|---|---|
| `'skill-library'` | `importMarketplaceToLibrary` | **Yes** (`source='marketplace'`) | Yes | Yes |
| `'settings-skills'` | `importGitHubSkills` | No | No | No (only in skills-library tab) |

Use `'skill-library'` mode when you want the skill to behave like a first-class skill (dashboard + refinement). Use `'settings-skills'` when you just want to add a skill to the workspace `.claude/skills/` directory (old behaviour).

---

## 6. Import/Install Flow (Built)

### Full Flow for `mode='skill-library'`

```
User clicks Install on a skill card
  ↓
setSkillStates: skill.path → "importing"
  ↓
importMarketplaceToLibrary([skill.path])
  ↓
  1. Read settings: marketplace_url, workspace_path, skills_path
  2. Parse marketplace URL → owner/repo/branch
  3. Get default branch via GitHub repos API
  4. Fetch recursive tree: GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1
  5. For each skill_path:
     a. import_single_skill(overwrite=true):
        - Download all files under {skill_path}/ to {skills_path}/{skill_name}/
        - Validate SKILL.md exists; parse full frontmatter
        - 10 MB per-file limit; path traversal protection
        - If dir exists + overwrite=true: remove first, then recreate
     b. upsert_imported_skill() → INSERT/UPDATE imported_skills row
     c. save_marketplace_skill_run() → INSERT/UPDATE workflow_runs row
        (status='completed', source='marketplace', current_step=5)
  6. regenerate_claude_md() → rebuild .claude/CLAUDE.md with all active skills
  ↓
Returns MarketplaceImportResult[] with success/error per skill
  ↓
Frontend: setSkillStates → "imported" (or "exists" / "idle" + toast on error)
Toast: "Imported {skill_name}"
onImported() → reload skills in parent
```

### Idempotency

Re-importing a skill that was previously installed always succeeds:
- `import_single_skill(overwrite=true)` removes the existing directory before downloading
- `upsert_imported_skill` / `save_marketplace_skill_run` use `ON CONFLICT DO UPDATE` — updating metadata if changed
- Frontend distinguishes "already exists" errors (from the old non-idempotent path) from real errors and shows "In library" state

### Conflict with Built Skills

If a built skill (`source='created'`) and a marketplace import have the same `skill_name`, `save_marketplace_skill_run` will overwrite the `workflow_runs` row (source → 'marketplace', current_step → 5). This is intentional: import wins. **No automatic conflict detection is currently implemented** — this is a gap to address in a future ticket.

---

## 7. Refinement Integration (Built)

Marketplace skills are fully integrated into the refine workflow:

1. `list_refinable_skills` queries `workflow_runs` for `status='completed'` — marketplace skills match
2. `filter_by_skill_md_exists` checks `{skills_path}/{skill_name}/SKILL.md` — exists after import
3. Marketplace skills appear in the refine page's skill picker
4. `handleRefine(skill)` in dashboard navigates to `/refine?skill={skill.name}` for marketplace skills (same route as built skills)
5. `start_refine_session` verifies SKILL.md exists and creates a session
6. `send_refine_message` (first message): creates `{workspace_path}/{skill_name}/` directory if missing (marketplace skills don't have a scratch workspace dir), ensuring transcript log files can be written

### Auto-select Fix

The refine page's auto-select tracks which skill was last auto-selected by name (not a boolean), so navigating from the skill library to `/refine?skill=X` correctly auto-selects `X` even if the user was previously refining a different skill.

---

## 8. Skills Intake Wizard (Built)

The skill creation wizard was expanded from 2 steps to 4 steps (VD-845):

1. **Basic info**: name, domain
2. **Skill type**: skill_type field (domain / platform / source / data-engineering / skill-builder)
3. **Behaviour**: argument_hint, user_invocable, disable_model_invocation
4. **Options**: model preference, other settings

This extended frontmatter (`skill_type`, `version`, `model`, `argument_hint`, etc.) unifies the metadata schema between built skills and marketplace skills — both can now carry the same set of fields.

Some fields are **locked** for marketplace-imported skills (cannot be edited in the UI) since they're authored externally.

---

## 9. Publishing Flow (Not Built — Phase 3)

The publish path (Skill Builder app → marketplace GitHub repo via PR) is not yet implemented. Current state:
- Built skills can be pushed to a **team repo** via `push_skill_to_remote()` (existing feature)
- No dedicated "publish to marketplace" action exists
- The existing push pipeline (auth, versioning via git tags, haiku changelog, PR creation) provides the foundation

**Planned work**:
- "Publish to Marketplace" button targeting the `marketplace_url` repo instead of `remote_repo`
- Auto-generate `category`/`tags` metadata via haiku
- PR body includes validation results from `validate-quality` + `test-skill`
- Human review + merge workflow (Phase 3 uses manual review; Phase 4 adds trusted-author fast-path)

---

## 10. Companion-to-Marketplace Bridge (Not Built — Phase 2)

The companion recommender already produces structured YAML with `slug`, `dimension`, `type`, `priority`, and `trigger_description`. A marketplace match would let each companion recommendation resolve to "Install from marketplace" vs "Build this skill."

**Matching algorithm** (planned):
1. **Exact slug match**: `skill_name` in marketplace == companion `slug`
2. **Dimension match**: marketplace `dimensions_covered` contains companion `dimension` AND `skill_type` matches
3. **Semantic fallback** (haiku): match `trigger_description` against marketplace skill descriptions

**Requires**:
- Companion UI component (VD-697, not yet built)
- `dimensions_covered` and `conventions` fields parsed from SKILL.md frontmatter

---

## 11. Roadmap

### Phase 1 (Built — VD-696)
- `marketplace_url` setting (single GitHub repo as registry)
- Browse: `list_github_skills` scans repo for SKILL.md files
- Install: `import_marketplace_to_library` → `imported_skills` + `workflow_runs` rows
- Skills library tab with marketplace browse button
- Pre-marking of installed skills in browse dialog
- typeFilter support in browse dialog
- Refinement for marketplace skills (full integration)
- Extended skill frontmatter + 4-step intake wizard

### Phase 2: Companion Matching & Recommendations
- Companion UI panel (VD-697)
- Companion-to-marketplace slug/dimension/semantic matching
- "Recommended for You" section on marketplace browse page
- Convention skills auto-suggestion based on `conventions` frontmatter

### Phase 3: Publishing, Version Tracking, Community Signals
- "Publish to Marketplace" from skill builder → PR to marketplace repo
- Version comparison: detect when imported skill has a newer upstream version
- `marketplace.json` catalog for richer metadata (featured, install counts)
- Author profiles

### Phase 4: Multi-Registry, Private Marketplaces
- Multiple marketplace repos (public + team + private)
- `extraKnownMarketplaces` pattern (mirroring Claude Code's team marketplace)
- Private repo support via existing GitHub OAuth

---

## 12. Key Design Decisions

### Decision 1: No Catalog File in Phase 1

**Considered**: `marketplace.json` static catalog (as originally designed) vs. live GitHub API scanning.

**Implemented**: Live scanning via `list_github_skills`. The existing infrastructure already fetches the repo tree and parses frontmatter — adding a catalog file would require keeping it in sync with actual skill directories. For Phase 1, scan-on-open is simpler and always current. Performance (API call per dialog open) is acceptable for the current scale.

**Phase 3**: A `marketplace.json` catalog makes sense once we need richer metadata (install counts, featured status, author info) that can't come from SKILL.md alone.

### Decision 2: Dual DB Write

**Implemented**: Every marketplace import creates rows in BOTH `imported_skills` AND `workflow_runs`. This was a deliberate design choice:
- `imported_skills` drives the skills library tab (toggle active/inactive, delete, settings-skills view)
- `workflow_runs` makes marketplace skills first-class citizens: they appear in the dashboard, are refinable, have domain/type, and share the same lifecycle model as built skills

**Trade-off**: Two rows per marketplace skill, with the risk of drift. The `upsert` pattern ensures both stay in sync on re-import.

### Decision 3: `overwrite=true` for Marketplace Import

**Implemented**: Marketplace imports always remove the existing directory before downloading. This ensures re-imports are always idempotent and clean. Old files (removed from the upstream repo) are cleaned up.

**Contrast**: `import_github_skills` (settings-skills mode) uses `overwrite=false` — it fails if the skill already exists on disk, because settings-skills imports are expected to be deliberate one-time operations.

### Decision 4: Single Marketplace URL

**Implemented**: One `marketplace_url` setting. This is the simplest path: the app has one "official" marketplace the user configures.

**Phase 4**: Multiple marketplace URLs (team + private + public) require a registry of marketplaces, a UI for managing them, and disambiguation when the same skill name exists in multiple registries. Not needed for Phase 1-2.

### Decision 5: skill_type as the Taxonomy

**Implemented**: `skill_type` (domain / platform / source / data-engineering / skill-builder) is the primary browse taxonomy. The `typeFilter` prop lets each call site decide which types to show.

**Note**: `category` field (a more granular sub-taxonomy) was designed but not implemented. `skill_type` + free-form tags provide sufficient filtering for Phase 1.

---

## 13. Rust Commands Reference

### New Commands (VD-696)

| Command | Module | Purpose |
|---|---|---|
| `import_marketplace_to_library(skill_paths)` | `github_import.rs` | Download + dual DB write; main marketplace install |
| `get_installed_skill_names()` | `skill.rs` | UNION query; used for pre-marking in browse UI |
| `check_marketplace_url(url)` | `github_import.rs` (or settings) | Validate URL + resolve default branch |

### Extended Commands

| Command | Change | Module |
|---|---|---|
| `list_github_skills` | Frontend adds `typeFilter` filtering | `github_import.rs` |
| `list_refinable_skills` | Now includes `source='marketplace'` skills | `skill.rs` |
| `filter_by_skill_md_exists` | Added debug logging per-skill | `skill.rs` |
| `send_refine_message` | Creates workspace dir for marketplace skills | `refine.rs` |

### DB Functions (not Tauri commands)

| Function | Purpose |
|---|---|
| `save_marketplace_skill_run` | INSERT/UPDATE `workflow_runs` for marketplace skill |
| `upsert_imported_skill` | INSERT/UPDATE `imported_skills` for marketplace skill |
| `get_all_installed_skill_names` | UNION query for pre-marking UI |
| `set_skill_author` | Set author_login/avatar after import |

---

## 14. Open Questions

1. **Conflict with built skills**: If a built skill and a marketplace import share the same `skill_name`, `save_marketplace_skill_run` silently overwrites the `workflow_runs` row. Should we detect this and prompt the user before proceeding?

2. **Version tracking**: Marketplace skills have no update detection. When is the right time to implement "version available" checks, and where should they show in the UI?

3. **Offline mode**: The browse dialog requires a network call. Should we cache the last fetched skill list locally for offline/slow-network resilience?

4. **`skill_type='skill-builder'` filter**: The skills library tab shows only `skill_type='skill-builder'` imported skills. Is this the right filter, or should it show all imported skills regardless of type?

5. **Convention skills**: Skills with `conventions` frontmatter declare tool dependencies. When should we auto-suggest installing them, and how do we link convention installs to the importing skill?

6. **Multi-org marketplaces**: Should `marketplace_url` support a list of URLs (team + official), or should Phase 4 introduce a formal multi-registry model?
