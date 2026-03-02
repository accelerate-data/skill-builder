---
inclusion: always
---

# Testing Strategy

All authoritative details are in `CLAUDE.md` (when to write tests, test discipline, choosing which tests to run, agent test tiers). This file provides a Kiro-friendly summary.

## Quick Commands

```bash
# App tests (all from app/)
./tests/run.sh                    # All levels (unit + integration + e2e + agents)
./tests/run.sh unit               # Stores, utils, hooks, rust, sidecar
./tests/run.sh integration        # Component + page tests
./tests/run.sh e2e                # Playwright
./tests/run.sh e2e --tag @workflow
cd src-tauri && cargo test        # Rust tests

# Agent tests
cd app && npm run test:agents:structural  # Structural checks (free)
cd app && npm run test:agents:smoke       # Smoke tests (requires API key)
```

## When to Write Tests

1. **New state logic** (Zustand store) → store unit tests
2. **New Rust command** with testable logic → `#[cfg(test)]` tests
3. **New UI interaction** (button states, forms) → component test
4. **New page or major flow** → E2E test (happy path)
5. **Bug fix** → regression test

Purely cosmetic or wiring-only changes don't require tests. If unclear, ask.

## Test Selection

**Frontend:** Use `npm run test:changed` to auto-detect affected tests via `vitest --changed`.

**Rust:** Run `cargo test <module>`. For UI-facing commands, consult `app/tests/TEST_MANIFEST.md` for the cross-layer E2E tag to also run.

## Mocking Tauri APIs

**Unit tests:** `@tauri-apps/api/core` globally mocked in `src/test/setup.ts`. Use `mockInvoke` from `src/test/mocks/tauri.ts`.

**E2E tests:** Vite aliases replace Tauri APIs with mocks when `TAURI_E2E=true`. Override via `window.__TAURI_MOCK_OVERRIDES__`.
