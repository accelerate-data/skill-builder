# Codegen Contract Rule

When modifying any Rust struct in `app/src-tauri/src/contracts/`:

1. Run `cd app && npm run codegen` to regenerate TypeScript types and JSON Schema
2. Commit the regenerated files alongside your contract changes:
   - `app/src/generated/contracts.ts`
   - `app/sidecar/generated/contracts.ts`
   - `app/src-tauri/src/generated/schemas.rs`
3. Do NOT hand-edit generated files -- they will be overwritten on next codegen run

The CI freshness check (`git diff --exit-code` on generated directories) will fail if codegen output doesn't match committed files.
