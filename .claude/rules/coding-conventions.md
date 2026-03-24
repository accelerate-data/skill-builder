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

## Business Logic Architecture (Data / Calculation / Action)

Applies to: frontend TypeScript, Rust backend, Node.js sidecar.

Organize logic into three explicit layers:

- **Data** — types, interfaces, and raw values. No logic.
- **Calculations** — pure functions that take data and return data.
  No side effects, no I/O, no state mutations. Unit-test these in isolation.
- **Actions** — the only layer allowed to mutate state, call APIs,
  write to the DB, invoke Tauri commands, or trigger side effects.
  Actions call calculations; calculations never call actions.

### Rules

- A calculation must never read from a store or call an action.
  Pass all required state in as arguments.
- An action may call calculations to derive the next state before writing it.
- New business logic goes into a calculation first; wrap in an action only when
  a side effect is needed.

### Examples

**Wrong** — derivation mixed into action:

```ts
addMessage: (msg) => set((s) => ({
  messages: [...s.messages, msg],
  hasUnread: s.messages.filter(m => !m.read).length + 1 > 0,
}))
```

**Right** — calculation extracted and independently testable:

```ts
// lib/message-utils.ts
export function countUnread(messages: Message[]): number {
  return messages.filter(m => !m.read).length;
}

// store action
addMessage: (msg) => set((s) => {
  const messages = [...s.messages, msg];
  return { messages, hasUnread: countUnread(messages) > 0 };
})
```
