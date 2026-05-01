# State Management Rules

Applies to `app/src/**`.

## Local UI State

Use component-local `useState` or `useReducer` for state that is only needed by
one component subtree, should reset on unmount, or represents ephemeral UI such
as open/closed, hover, active tab, or form draft state.

Use Zustand only for shared state, navigation-persistent selections, workflow or
refine runtime state, and live agent event streams.

## Server State

Request/response backend data belongs in TanStack Query hooks under
`app/src/lib/queries/`, not in Zustand stores.

Use query hooks for Tauri command results, lists, records, loading/error state,
refresh, invalidation, stale-response handling, and mutations that affect
backend data.

When backend data changes:

- mutations invalidate the smallest stable query family in
  `app/src/lib/queries/query-keys.ts`
- agent event streams update or invalidate through
  `app/src/lib/queries/agent-stream-cache.ts`
