# Skills Marketplace — Design Note

The marketplace is a **one-way import layer**: skills flow in from GitHub repositories, never out. It feeds two destinations:

| | **Settings → Skills** | **Skill Library** |
|---|---|---|
| **Purpose** | Skills used by Skill Builder agents to build, refine, and test skills | Domain knowledge — skills users create, import, and refine |
| **Examples** | `research`, `validate-skill`, `skill-builder-practices` | Sales Pipeline Analytics, dbt Incremental Silver |
| **After import** | Wired into the agent workspace — active on every agent run | Appears in the dashboard as a completed skill, ready to refine. Download skill file to use with Vibedata.|

---

## Repo Structure

A marketplace repo has three levels: **registry → plugins → skills**. The catalog at `.claude-plugin/marketplace.json` lists each plugin directory; each plugin directory contains `.claude-plugin/plugin.json` (its name) and a `skills/` subdirectory of skill folders. No catalog = error, never a silent empty result.

The default registry (`https://github.com/hbanerjee74/skills`) shows both common layout patterns — plugins in a subdirectory and a plugin rooted at `./`:

```
hbanerjee74/skills/
  .claude-plugin/
    marketplace.json          ← catalog
    plugin.json               ← { "name": "vibedata" }  (root plugin name)
  plugins/
    skill-builder/
      .claude-plugin/
        plugin.json           ← { "name": "skill-builder" }
      skills/
        building-skills/
          SKILL.md
    skill-builder-practices/
      .claude-plugin/
        plugin.json
      skills/ ...
    skill-builder-research/
      .claude-plugin/
        plugin.json
      skills/ ...
    skill-builder-validate/
      .claude-plugin/
        plugin.json
      skills/ ...
  skills/                     ← root plugin (vibedata) skills
    dbt-fabric-patterns/SKILL.md
    dbt-semantic-layer/SKILL.md
    dbt-snapshot-scd2/SKILL.md
    dlt-rest-api-connector/SKILL.md
    elementary-data-quality/SKILL.md
    revenue-domain/SKILL.md
    salesforce-extraction/SKILL.md
```

Its `marketplace.json` (conforms to the [official Claude Code plugin marketplace schema](https://code.claude.com/docs/en/plugin-marketplaces#marketplace-schema)):

```json
{
  "name": "vibedata-skills",
  "owner": { "name": "hbanerjee74" },
  "metadata": {
    "description": "Vibedata Skills Marketplace — practitioner-level data and analytics engineering skills for Claude",
    "version": "1.0.0"
  },
  "plugins": [
    { "name": "skill-builder",           "source": "./plugins/skill-builder",           "description": "Multi-agent workflow for creating domain-specific Claude skills" },
    { "name": "skill-builder-practices", "source": "./plugins/skill-builder-practices", "description": "Content guidelines and patterns for skill structure" },
    { "name": "skill-builder-research",  "source": "./plugins/skill-builder-research",  "description": "Research skill for dimension scoring and parallel research" },
    { "name": "skill-builder-validate",  "source": "./plugins/skill-builder-validate",  "description": "Validate skill for quality checking and companion recommendations" },
    { "name": "vibedata",                "source": "./",                                "description": "Practitioner-level data and analytics engineering skills for Claude" }
  ]
}
```

`name` becomes the registry's tab label in the browse dialog. Only `metadata.pluginRoot` is recognized by the app — all other `metadata` fields (like `description` and `version` above) are ignored.

---

## Skill Discovery

For each plugin entry in the catalog the app:

1. **Resolves `plugin_path`** from `source`:
   - `"./plugins/skill-builder"` → strip `./` → `plugins/skill-builder`
   - `"./"` → `""` (repo root)
   - Bare name (no `./`) → prepend `metadata.pluginRoot` if set: `"skill-builder"` + `pluginRoot="plugins"` → `plugins/skill-builder`

2. **Enumerates skills** — finds all `{plugin_path}/skills/{skill_name}/SKILL.md` paths in the git tree (one level deep only).

3. **Validates each `SKILL.md`** — skills with no `name:` frontmatter field are excluded. No directory-name fallback.

4. **Reads the plugin name** from `{plugin_path}/.claude-plugin/plugin.json`. For the root case (`plugin_path = ""`), this is `.claude-plugin/plugin.json`. If absent or missing `name`, plugin name is `null`.

For the default registry:

| `source` | `plugin_path` | Skills at |
|---|---|---|
| `"./plugins/skill-builder"` | `plugins/skill-builder` | `plugins/skill-builder/skills/*/SKILL.md` |
| `"./plugins/skill-builder-practices"` | `plugins/skill-builder-practices` | `plugins/skill-builder-practices/skills/*/SKILL.md` |
| `"./plugins/skill-builder-research"` | `plugins/skill-builder-research` | `plugins/skill-builder-research/skills/*/SKILL.md` |
| `"./plugins/skill-builder-validate"` | `plugins/skill-builder-validate` | `plugins/skill-builder-validate/skills/*/SKILL.md` |
| `"./"` | `""` (root) | `skills/*/SKILL.md` |

Plugin entries with no valid skills are silently skipped. External source types (`github`, `npm`, `pip`, `url`) are skipped with a warning.

---

## Skill Naming

**Display** (browse dialog): `{plugin_name}:{skill_name}` — e.g. `vibedata:dbt-fabric-patterns`, `skill-builder:building-skills`. When plugin name is `null`, just `{skill_name}`. Mirrors the Claude Code runtime namespace.

**Storage** (disk and database): plain `skill_name` from frontmatter only — no plugin prefix. Two skills from different plugins with the same `name:` will collide; importing the second overwrites the first.

---

## Registry Configuration

Configured in Settings → Marketplace. Each registry has a name, GitHub URL, and enabled/disabled toggle.

- **Default** — `https://github.com/hbanerjee74/skills` (`vibedata-skills`), seeded on first launch, cannot be removed.
- **Adding** — paste a GitHub URL; the app fetches `marketplace.json` and uses its `name` field as the display name (falls back to `"{owner}/{repo}"`).
- **Enabled only** — disabled registries are hidden from the browse dialog but not deleted.
- **No nesting** — registry → plugins → skills is fixed at three levels. Sub-collections must each be added as a separate registry URL.

---

## Version Tracking and Updates

At import time the app stores the installed `version` (semver) and a SHA-256 hash of `SKILL.md` as a baseline. On startup it compares each installed skill against the current catalog. The Skill Library and Settings → Skills are checked independently.

**Customization detection** — if the current hash differs from the baseline, the skill is considered customized and excluded from auto-update.

**Auto-update mode** — non-customized skills update silently on startup; a summary toast lists what changed.

**Manual update mode** — a startup notification links to the import dialog for each available update.

**As built:** The startup check failure path logs silently — a persistent error notification is not yet shown. The customization warning dialog before overwriting a modified Settings → Skills skill has its state wired up but the AlertDialog is not rendered.

---

## Browse Dialog

One tab per enabled registry. Each skill shows its qualified display name and install state:

- No badge — not installed
- **Up to date** — same version installed
- **Update available** — newer version in catalog
- **Already installed** — installed, no version to compare

Before importing, the user can edit the skill's metadata. The form pre-populates from the remote `SKILL.md` frontmatter, falling back to the locally-installed fields when upgrading.

---

## SKILL.md Frontmatter Reference

```yaml
---
name: dbt-fabric-patterns
description: >
  Teaches Claude how to write dbt models for Microsoft Fabric.
  Use when building incremental or snapshot models on Fabric.
version: 1.2.0
model: sonnet
argument-hint: "dbt model name or pattern"
user-invocable: true
disable-model-invocation: false
---
```

| Field | Required | Notes |
|---|---|---|
| `name` | Yes | Kebab-case. Authoritative skill name — directory name never used as fallback. Missing = skill excluded. |
| `description` | Yes | Shown in browse dialog; wired into `CLAUDE.md` so agents know when to invoke it. |
| `version` | Yes | Semver. Defaults to `"1.0.0"` if absent at import time. |
| `model` | No | Preferred Claude model. Overrides app default on invocation. |
| `argument-hint` | No | Hint shown when invoking as a slash command. |
| `user-invocable` | No | Whether the skill can be invoked as a slash command. |
| `disable-model-invocation` | No | Suppresses model selection UI. |

All other keys are silently ignored. `purpose` is set by import destination, never read from the file.
