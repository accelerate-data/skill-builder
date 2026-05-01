# Codegen Contract Rule

When modifying any Rust struct in `app/src-tauri/src/contracts/`:

1. Run `cd app && npm run codegen` to regenerate TypeScript types and JSON Schema
2. Commit the regenerated files alongside your contract changes:
   - `app/src/generated/contracts.ts`
   - `app/sidecar/generated/contracts.ts`
   - `app/src-tauri/src/generated/schemas.rs`
3. Do NOT hand-edit generated files -- they will be overwritten on next codegen run

The CI freshness check (`git diff --exit-code` on generated directories) will fail if codegen output doesn't match committed files.

## Tauri Command Wrapper Contract

When adding or changing frontend calls to Rust Tauri commands:

1. Add or update the command entry in `app/src/lib/tauri-command-types.ts`.
2. Call Rust through `invokeCommand()` in `app/src/lib/tauri.ts`, not raw `invoke(...)`.
3. Keep raw `invokeUnsafe()` only for explicitly justified migration gaps.
4. Add or update `app/src/lib/tauri-command-types.typecheck.ts` when a new command shape needs compile-time negative coverage.
5. Run `cd app && npx tsc --noEmit` and `cd app && npm run test:guard`.
