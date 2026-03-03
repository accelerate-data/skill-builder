# Coding Conventions

This is the canonical source for naming, markdown, and error-handling conventions.

## TypeScript (Frontend)

- Files: `kebab-case` (`skill-card.tsx`, `settings-store.ts`)
- Components: `PascalCase` (`SkillCard`, `SettingsPanel`)
- Functions/variables: `camelCase` (`getSkillList`, `workspacePath`)
- Constants: `UPPER_SNAKE_CASE` (`MAX_TURNS`, `DEFAULT_WORKSPACE`)

## Rust (Tauri Backend)

- Follow standard Rust conventions (enforced by `clippy`)
- Every `#[tauri::command]` logs `info!` on entry (with key params) and `error!` on failure
- Use `thiserror` for error types; propagate with `?`

## Database Query Conventions

- SQLite mutations must use bound parameters, not string-concatenated SQL.
- Schema/data changes must keep migrations and tests in sync.
- Usage/log snapshot tables should not use foreign keys to mutable entities; keep records as immutable point-in-time data unaffected by parent deletes.

## Logging

Canonical logging policy is in `.claude/rules/logging-policy.md`.

## Markdown

All `.md` files must pass `markdownlint` before committing. Config is at `.markdownlint.json`.

```bash
markdownlint <file-or-dir>
```

## Error Handling

- Validate at system boundaries: user input, Tauri IPC payloads, external API responses
- Trust internal Agent SDK guarantees — don't wrap them
- TypeScript: typed errors from Tauri commands, surface to user via error state
- Agent tool errors: log and surface to user — don't crash the session
