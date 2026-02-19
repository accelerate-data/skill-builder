# Marketplace Research: Existing Codebase Infrastructure Inventory

Research conducted 2026-02-19 by codebase-explorer agent.

---

## 1. Companion Skills System

### What Exists

**Agent: `agents/companion-recommender.md`** (sonnet model)
- Analyzes skipped research dimensions (scored 2-3 by the research planner) to recommend companion skills
- Produces structured YAML frontmatter with machine-parseable metadata
- Called as a sub-agent during validation (Step 7) by `validate-skill.md`

**Output artifact: `<skill-dir>/context/companion-skills.md`**
- YAML frontmatter schema per companion:
  - `slug` (kebab-case identifier)
  - `name` (display name)
  - `type` (skill type: domain/source/platform/data-engineering)
  - `dimension` (which research dimension this fills)
  - `dimension_score` (the planner's score, 2-3)
  - `priority` (High/Medium/Low)
  - `reason` (composability rationale)
  - `trigger_description` (draft SKILL.md description for the companion)
  - `template_match` (reserved for VD-696, currently always `null`)

**Example output** (from `app/sidecar/mock-templates/outputs/step6/context/companion-skills.md`):
- 3 companion recommendations with full YAML + markdown body
- Each has slug, priority, dimension, score, reason, trigger_description, template_match fields

### What's Partial

- `template_match` field exists in schema but is always `null` — reserved for future template matching (VD-696)
- No UI yet for surfacing companion recommendations (VD-697 app component pending)

### What's Missing for Marketplace

- **No link to marketplace catalog**: companions reference slugs but don't resolve to actual skills in any registry
- **No install action**: "Build this skill" and "Import template" UI actions are planned (app.md Section 3) but not built
- **No version or author info** in companion frontmatter
- **No community rating/popularity data** — recommendations are purely algorithmic (dimension scoring)

### Marketplace Relevance

The companion system is a **discovery engine** that could drive marketplace recommendations. Each companion recommendation is essentially a "you need this skill" signal with: a slug (potential marketplace ID), a description (searchable), a priority (ranking), and a composability rationale (why it pairs well). The `template_match` field was explicitly designed to connect to a template repository.

---

## 2. Template Matching Design

### What Exists (Design Only — VD-696, Status: Pending)

**Planned template repository structure** (from `shared.md` Section 6):
```
skill-builder-templates/              # Public GitHub repo
├── dbt-incremental-silver/
│   ├── SKILL.md
│   └── references/
├── dbt-snapshot-scd2/
├── dbt-semantic-layer/
├── dlt-rest-api-connector/
├── elementary-data-quality/
├── salesforce-extraction/
└── revenue-domain/
```

**Matching flow** (same for app and plugin):
1. User completes scoping (name, type, domain, intake answers)
2. System fetches template repo index
3. Haiku call matches user context against templates (~$0.01)
4. 0-3 matches presented: "Import as starting point, or build from scratch?"
5. Import populates skill folder → skip to clarification step

**App-side flow** (from `app.md` Section 5):
- After create wizard completes, before research
- Uses existing `github_import.rs` infrastructure for actual download
- Dialog shows matches with reasoning

### What's Missing

- **No template repo exists yet** — the structure is designed but no public repo has been created
- **No template index/manifest** — how templates are cataloged for haiku matching is not specified
- **No template versioning** — templates have no version metadata
- **No community contribution flow** — how users would submit templates to the repo

### Marketplace Relevance

The template matching design is essentially a **marketplace search engine** spec. The haiku-based matching against user context (name, type, domain, intake) is a semantic search system. The planned public GitHub repo is a skill registry. This entire design can be repurposed as the marketplace browse/search/import flow with minimal changes — just add metadata, ratings, and multi-repo support.

---

## 3. GitHub Import Infrastructure

### What Exists (Fully Built)

**Three import pathways:**

#### 3a. Generic GitHub Import (`github_import.rs`)
- `parse_github_url()` — parses URLs, shorthand (`owner/repo`), branch + subpath
- `list_github_skills()` — fetches repo tree recursively, finds all `SKILL.md` files, parses frontmatter
- `import_github_skills()` — downloads all files under each skill directory, writes to local `.claude/skills/`, inserts into `imported_skills` DB table
- Supports OAuth token for private repos
- Validates SKILL.md existence, skill name, path traversal protection
- Parses frontmatter: `name`, `description`, `domain`, `type`

#### 3b. Team Repo Import (`team_import.rs`)
- `list_team_repo_skills()` — lists skills from configured team repo with `.skill-builder` manifest
- `import_team_repo_skill()` — imports to `skills_path/{name}/` (not `.claude/skills/`), creates workspace marker, saves to `workflow_runs` DB, detects step progress
- Reads manifest for creator info
- Force-import option (overwrites existing)
- Auto-commits to git after import

#### 3c. Zip Upload Import (`imported_skills.rs`)
- `upload_skill()` — extracts zip, finds SKILL.md (root or one-level deep), parses frontmatter, extracts to `.claude/skills/`
- `toggle_skill_active()` — moves between active/`.inactive/` directories
- `delete_imported_skill()` — removes disk + DB records
- `generate_trigger_text()` — calls haiku to generate trigger descriptions
- `update_trigger_text()` — manually set trigger text
- `regenerate_claude_md()` — rebuilds CLAUDE.md with imported skills section

**Shared utilities:**
- `build_github_client()` — creates reqwest client with GitHub API headers + optional OAuth
- `parse_frontmatter()` — extracts name, description, domain, type from YAML frontmatter
- `validate_skill_name()` — rejects path traversal characters
- `generate_skill_id()` — `imp-{name}-{timestamp}`

**Frontend bindings** (`tauri.ts`):
```typescript
parseGitHubUrl(url) → GitHubRepoInfo
listGitHubSkills(owner, repo, branch, subpath?) → AvailableSkill[]
importGitHubSkills(owner, repo, branch, skillPaths) → ImportedSkill[]
listTeamRepoSkills() → TeamRepoSkill[]
importTeamRepoSkill(skillPath, skillName, force?) → string
```

### What's Partial

- No search/filter when listing GitHub skills — returns all SKILL.md files in repo
- No preview of skill content before import (must import first, then view)
- No update/sync mechanism — importing is one-way, no pull for updates

### What's Missing for Marketplace

- **No multi-repo browsing** — each import is to one specific repo
- **No central registry/index** — skills are discovered by scanning repo trees
- **No ratings, downloads, popularity metrics**
- **No semantic search** across multiple repos (haiku matching is designed but not built)
- **No dependency resolution** — companion skills are recommendations, not enforced

### Marketplace Relevance

The GitHub import infrastructure is the **entire download/install pipeline** for a marketplace. `list_github_skills()` is skill discovery, `import_github_skills()` is installation. The `.skill-builder` manifest provides creator attribution. The frontmatter parser extracts marketplace-relevant metadata. The team repo flow adds creator tracking and step detection. All three pathways can be unified behind a marketplace API.

---

## 4. GitHub Push Infrastructure

### What Exists (Fully Built)

**Push to remote repo** (`github_push.rs`):
- `validate_remote_repo()` — checks GitHub auth + push permissions
- `push_skill_to_remote()` — full push pipeline:
  1. Reads settings (token, owner, repo, login)
  2. Resolves skill directory from `skills_path`
  3. Computes push version via local git tags (`pushed/{skill_name}/v{N}`)
  4. Generates diff (first push: all files; subsequent: diff from last tag)
  5. Generates changelog via haiku API call
  6. Writes `.skill-builder` manifest (version, creator, created_at, app_version)
  7. Commits and pushes to `skill/{login}/{skill_name}` branch
  8. Creates or updates PR with changelog
  9. Creates local version tag
- `reconcile_manifests()` — startup reconciliation of all `.skill-builder` manifests
- `list_user_repos()` — lists GitHub repos with push access (paginated)

**`.skill-builder` manifest format:**
```json
{
  "version": "1.0",
  "creator": "github-login",
  "created_at": "2026-02-19T...",
  "app_version": "0.1.0"
}
```

**Frontend bindings:**
```typescript
validateRemoteRepo(owner, repo) → void
pushSkillToRemote(skillName) → PushResult
reconcileManifests() → number
listUserRepos() → GitHubRepo[]
```

### What's Missing for Marketplace

- **Single remote repo only** — settings store one `remote_repo_owner` + `remote_repo_name`
- **No public listing/indexing** — push creates a PR, but there's no registry API
- **No metadata in push** (tags, description, skill type beyond what's in SKILL.md frontmatter)
- **No license field** in manifest
- **No update detection** — no way to know if your imported skill has a newer version upstream

### Marketplace Relevance

The push infrastructure is the **publish pipeline** for a marketplace. It handles: authentication, versioning (via git tags), changelog generation (via haiku), PR-based review (team approval), and manifest creation. The branch naming convention (`skill/{login}/{skill_name}`) provides namespacing. The version tagging (`pushed/{name}/v{N}`) provides version history.

---

## 5. Frontmatter/Metadata Conventions

### Agent Frontmatter (`agents/*.md`)

Every agent file has YAML frontmatter:
```yaml
---
name: agent-name
description: What this agent does
model: opus | sonnet | haiku
tools: Read, Write, Edit, Glob, Grep, Bash, Task
---
```

### SKILL.md Frontmatter

Generated skills (from mock template `step5/SKILL.md`):
```yaml
---
name: mock-skill
description: A mock skill generated for...
tools: Read, Write, Edit, Glob, Grep, Bash
---
```

From `best-practices.md` — required SKILL.md structure:
- **Gerund names**, lowercase+hyphens, max 64 chars (e.g., `processing-pdfs`)
- **Description trigger pattern**: `[What it does]. Use when [triggers]. [How it works]. Also use when [more triggers].` Max 1024 chars.
- **Under 500 lines**
- **Required sections**: Metadata | Overview | When to use | Quick reference | Pointers to references

### Companion Skills Frontmatter

```yaml
---
skill_name: parent-skill-name
skill_type: domain
companions:
  - slug: kebab-case-id
    name: Display Name
    type: source
    dimension: field-semantics
    dimension_score: 3
    priority: high
    reason: "..."
    trigger_description: "..."
    template_match: null
---
```

### Convention Skills Frontmatter (Designed, Not Built — VD-694)

```yaml
---
description: Sales pipeline silver/gold layer design
conventions:
  - dbt-conventions
  - fabric-conventions
  - elementary-conventions
---
```

### What's Missing for Marketplace Discovery

| Field | Status | Marketplace Need |
|-------|--------|-----------------|
| `name` | Exists | Marketplace display name |
| `description` | Exists | Search/browse text |
| `tools` | Exists | Capability indicator |
| `domain` | Exists in imported_skills DB | Category filter |
| `type` (skill_type) | Exists | Category filter |
| `tags` | Exists in DB (`skill_tags` table) | Search/browse tags |
| `author` | Exists in `.skill-builder` manifest + DB | Author attribution |
| `version` | `.skill-builder` has `"1.0"` only | Semantic versioning needed |
| `license` | Missing | Required for sharing |
| `category` | Missing (type is closest) | Browse hierarchy |
| `downloads` / `installs` | Missing | Popularity ranking |
| `rating` | Missing | Quality signal |
| `compatibility` | Missing | SDK/tool version requirements |
| `conventions` | Designed (VD-694) | Dependency declaration |
| `preview_image` | Missing | Visual browse experience |
| `changelog` | Generated in push flow | Version history |

---

## 6. Skill CRUD Commands

### What Exists (Fully Built)

**Rust commands** (`skill.rs`):

| Command | Purpose | DB Tables Affected |
|---------|---------|-------------------|
| `list_skills` | List all skills from DB | `workflow_runs`, `skill_tags` |
| `list_refinable_skills` | Completed skills with SKILL.md on disk | `workflow_runs` |
| `create_skill` | Create new skill (workspace dir + skills_path + DB) | `workflow_runs`, `skill_tags` |
| `delete_skill` | Delete skill (workspace dir + skills_path + DB + git commit) | All tables |
| `update_skill_tags` | Update tags | `skill_tags` |
| `update_skill_metadata` | Update domain, type, tags, intake_json | `workflow_runs`, `skill_tags` |
| `rename_skill` | Rename with DB transaction + disk moves | All tables |
| `generate_suggestions` | Haiku-powered field suggestions | None (read-only) |
| `acquire_lock` / `release_lock` / `check_lock` / `get_locked_skills` | Multi-instance locking | `skill_locks` |

**DB Schema** (from `db.rs` and `test_utils.rs`):
- `workflow_runs` — skill_name (PK), domain, current_step, status, skill_type, created_at, updated_at, author_login, author_avatar, display_name, intake_json
- `workflow_steps` — skill_name + step_id (PK), status, started_at, completed_at
- `agent_runs` — agent_id, skill_name, step_id, model, status, tokens, cost, duration
- `workflow_artifacts` — skill_name, step_id, relative_path, content, size_bytes
- `skill_tags` — skill_name + tag (PK), created_at
- `imported_skills` — skill_id (PK), skill_name (UNIQUE), domain, description, is_active, disk_path, trigger_text, imported_at
- `skill_locks` — skill_name (PK), instance_id, pid, acquired_at
- `workflow_sessions` — session_id (PK), skill_name, pid, started_at, ended_at
- `settings` — key/value store

**Frontend types** (`types.ts`):
- `SkillSummary` — name, domain, current_step, status, last_modified, tags, skill_type, author_login, author_avatar, intake_json
- `ImportedSkill` — skill_id, skill_name, domain, description, is_active, disk_path, trigger_text, imported_at
- `AvailableSkill` — path, name, domain, description
- `TeamRepoSkill` — path, name, domain, description, creator, created_at
- `SkillBuilderManifest` — version, creator, created_at, app_version

### What's Missing for Marketplace

- **No publish state** — skills are local (pending/in_progress/completed) or imported, no "published" status
- **No version history** — DB tracks current state only, no versioned snapshots
- **No download/install tracking** — imported_skills tracks what's imported but not from where or when updated
- **No source URL tracking** — once imported, no link back to the original repo/source

---

## 7. Convention Skills Design

### What Exists (Design Only — VD-694, Status: Pending)

From `shared.md` Section 8:

**Planned convention skills catalog:**

| Skill | Content |
|-------|---------|
| `dbt-conventions` | Project structure, naming, materialization, SQL style |
| `dbt-semantic-layer` | Semantic model YAML, MetricFlow |
| `dlt-conventions` | RESTAPIConfig, write dispositions, schema contracts |
| `fabric-conventions` | OneLake, ABFSS, auth, delta format |
| `elementary-conventions` | Anomaly tests, config, alerts |
| `pipeline-integration` | dlt → dbt → Elementary cross-tool flow |

**Key design**: Generated skills declare dependencies via `conventions` frontmatter. The deployer installs convention skills alongside the generated skill.

### Marketplace Relevance

Convention skills are a **category of publishable, reusable skills** — tool-agnostic best practices that any user of that tool would want. They're standalone (not tied to a specific domain), independently versioned, and composable. This is the most natural "marketplace-ready" content category since convention skills are universally useful and don't require domain-specific customization.

---

## 8. Plugin Manifest & Structure

### What Exists

**`.claude-plugin/plugin.json`**:
```json
{
  "name": "skill-builder",
  "version": "0.1.0",
  "description": "Multi-agent workflow for creating domain-specific Claude skills...",
  "skills": "./skills/"
}
```

**Plugin skill directory**: `skills/generate-skill/` with:
- `SKILL.md` (coordinator prompt)
- `references/protocols.md`, `content-guidelines.md`, `best-practices.md`

### Marketplace Relevance

The plugin manifest format is how Claude Code plugins are distributed. If the marketplace distributes skills as plugins (or individual skills within plugins), this manifest structure is the packaging format. The `version` field provides a versioning hook. The `skills` pointer provides skill discovery within a plugin package.

---

## 9. Settings & Authentication Infrastructure

### What Exists

**Settings** (from `AppSettings` type):
- `anthropic_api_key` — for haiku calls (suggestions, trigger generation, changelog)
- `github_oauth_token` — for repo access (import, push, team repo)
- `github_user_login` / `github_user_avatar` / `github_user_email` — identity
- `remote_repo_owner` / `remote_repo_name` — configured team repo
- `workspace_path` / `skills_path` — local storage
- `industry` / `function_role` — user context for personalization

**GitHub OAuth** (device flow):
- `github_start_device_flow()` / `github_poll_for_token()` / `github_get_user()` / `github_logout()`
- Full device flow implementation for GitHub authentication

### Marketplace Relevance

GitHub OAuth is already the identity system. The `github_user_login` is the author identity. The `remote_repo_*` settings pattern can be extended for marketplace repo configuration. The `industry` + `function_role` fields enable personalized marketplace recommendations (just like ghost suggestions).

---

## 10. Summary: Infrastructure Readiness for Marketplace

### Ready to Use (Built & Working)

| Component | What It Provides |
|-----------|-----------------|
| GitHub Import pipeline | Download + install skills from any GitHub repo |
| GitHub Push pipeline | Publish skills to a shared repo with PR + changelog |
| Team Repo flow | List + import from a configured team repo |
| `.skill-builder` manifest | Creator attribution, versioning, app version |
| SKILL.md frontmatter parsing | Extract name, description, domain, type |
| `imported_skills` DB table | Track installed skills with activation toggle |
| Trigger text generation | Haiku-powered description generation |
| CLAUDE.md integration | Auto-wire imported skills into workspace config |
| GitHub OAuth | Authentication for push/pull operations |
| Zip upload | Offline skill package installation |
| Skill CRUD + rename + lock | Full lifecycle management |
| Ghost suggestions (haiku) | AI-powered field completion at skill creation |

### Designed but Not Built

| Component | Design Location | Key Decision |
|-----------|----------------|-------------|
| Template matching | `shared.md` Section 6, `app.md` Section 5 | Haiku-based semantic search against template repo |
| Companion UI | `app.md` Section 3 | "Build this" / "Import template" actions |
| Convention skills | `shared.md` Section 8 | Standalone publishable tool-best-practices skills |
| Template repo structure | `shared.md` Section 6 | Public GitHub repo with SKILL.md per template |

### Missing for Full Marketplace

| Gap | Impact | Suggested Approach |
|-----|--------|-------------------|
| Central registry/index | Can't browse without knowing repo URL | Template repo with index.json or GitHub API-based discovery |
| Semantic search | Can't find skills by need | Haiku matching (designed in VD-696) against skill descriptions |
| Version management | Can't update imported skills | Add source_url + source_version to imported_skills DB |
| Ratings/downloads | No popularity signals | New DB table or external service |
| Multi-repo browsing | Limited to one team repo | Registry of skill repos, or single curated marketplace repo |
| Preview before install | Must import to see content | Fetch and render SKILL.md in a modal before import |
| Update detection | No "new version available" | Compare local manifest version with remote |
| License field | No sharing rights clarity | Add to `.skill-builder` manifest and SKILL.md frontmatter |
| Category hierarchy | Only flat type (4 types) + tags | Add category taxonomy or leverage tags more |
| Author profiles | Only github login + avatar | Link to GitHub profile, show published skill count |

### Architecture Notes

1. **Two distinct skill populations exist**: "built skills" (workflow_runs table, full lifecycle) and "imported skills" (imported_skills table, lighter metadata). A marketplace would primarily deal with importing from the built/published skills of others.

2. **The push→PR→merge→import cycle is already designed**: User A pushes to team repo, User B imports from team repo. The marketplace just needs to scale this from "one team repo" to "many repos" or "one central registry."

3. **Haiku is already the matching/recommendation engine**: Ghost suggestions, trigger text generation, and changelog generation all use haiku. Template matching (VD-696) would also use haiku. The marketplace search could use the same pattern.

4. **Git is the version control backbone**: Skills are committed, tagged (`pushed/{name}/v{N}`), and diffed. The marketplace versioning could build directly on this.
