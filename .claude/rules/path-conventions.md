# Path Conventions

Two distinct path hierarchies exist in this project. Confusing them causes "file not found" bugs at runtime.

## Skill builder path

`{skills_path}/{plugin_slug}/{skill_name}`

Where SKILL.md and all skill files live on disk (the user's skills repository).

| Layer | How to resolve |
|---|---|
| Rust | `resolve_skills_path(&db)` → `skill_paths::resolve_skill_dir()` |
| Frontend | `settingsStore.skillsPath` |

`resolve_skills_path` must never fall back to the workspace path. If `settings.skills_path` is not configured, return an error.

## Workspace skill path

`{workspace}/{plugin_slug}/{skill_name}`

AppData scratch directory for agent artifacts, transcripts, eval state, and other ephemeral data.

| Layer | How to resolve |
|---|---|
| Rust | `skill_paths::workspace_skill_dir()` |
| Frontend | `settingsStore.workspacePath` |

## Rules

- Never construct a skill path as `Path::new(&workspace_path).join(&skill_name)` or `` `${workspacePath}/${skillName}` ``. Always include `plugin_slug` and use the appropriate helper.
- Reference `plugin-paths.json` as the canonical layout for all skill file paths.
- When a command needs to read SKILL.md or skill files, use the skill builder path. When writing ephemeral artifacts (transcripts, eval state), use the workspace skill path.
