---
inclusion: always
---

# Testing Strategy

## Three Tiers of Tests

### Commands

```bash
cd app

# Tier 1: Frontend unit tests (Vitest + Testing Library)
npm test              # Single run
npm run test:watch    # Watch mode

# Tier 2: Rust unit + integration tests
cd src-tauri && cargo test

# Tier 3: E2E tests (Playwright)
npm run test:e2e      # Starts Vite in E2E mode, runs Playwright

# All frontend tests
npm run test:all      # Vitest + Playwright
```

## Test Structure

```
app/
├── src/__tests__/           # Frontend unit tests (Vitest)
│   ├── stores/              # Zustand store logic
│   ├── lib/                 # Utility functions
│   └── pages/               # Page component tests
├── e2e/                     # E2E tests (Playwright)
├── src/test/                # Test infrastructure
│   ├── setup.ts             # Vitest setup
│   └── mocks/               # Tauri API mocks
└── src-tauri/src/           # Rust tests (inline #[cfg(test)])
```

## Mocking Tauri APIs

**Unit tests:** `@tauri-apps/api/core` globally mocked in `src/test/setup.ts`. Use `mockInvoke` from `src/test/mocks/tauri.ts`.

**E2E tests:** Vite aliases replace `@tauri-apps/api/core` with `src/test/mocks/tauri-e2e.ts` when `TAURI_E2E=true`. Override via `window.__TAURI_MOCK_OVERRIDES__`.

## Testing Rule

When implementing a feature or fixing a bug, evaluate whether tests should be added:

1. **New state logic** (Zustand store) → write store unit tests
2. **New Rust command** with testable logic → add `#[cfg(test)]` tests
3. **New UI interaction** (button states, forms, validation) → write component test
4. **New page or major flow** → add E2E test for happy path
5. **Bug fix** → write regression test

Purely cosmetic changes (CSS, copy) or wiring-only changes don't require tests.

**If unclear, ask the user.**

Always run existing tests before committing: `npm test && cargo test`
