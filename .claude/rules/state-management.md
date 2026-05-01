# State Management Conventions

Applies to: frontend (React + Zustand).

## Component-Local State Rule

Use React `useState` / `useReducer` for state that is:

- Only needed within a single component or its direct children
- Ephemeral UI state (open/closed, hover, active tab, form draft before submit)
- Not needed by sibling components or route-level logic

Use Zustand **only** when state must be:

- Shared across unrelated components (not in the same render subtree)
- Persisted across route navigations
- Read or written by sidecar event handlers or Tauri command callbacks outside of React

### Decision heuristics

- "If this component unmounts and remounts, should this state reset?" → yes = local state
- "Does any other component need to read or write this?" → no = local state

### Examples

**Wrong** — ephemeral toggle hoisted into global store:

```ts
// workflow-store.ts
isStepExpanded: false,
setStepExpanded: (v) => set({ isStepExpanded: v }),
```

**Right** — local state in component:

```tsx
const [isExpanded, setIsExpanded] = useState(false);
```

## Server State Rule

Request/response backend data must use TanStack Query hooks under
`app/src/lib/queries/`.

Use query hooks for:

- Tauri command results fetched from SQLite, filesystem, GitHub, or the app
  backend
- Lists and records that need loading, error, refresh, invalidation, or
  stale-response handling
- Mutations that should refresh related backend data

Do not store server data, loading flags, request errors, or fetch methods in
Zustand stores.

Use Zustand for:

- UI state shared across unrelated components
- Navigation-persistent UI selections
- Form drafts and local interaction state that should not be cached as backend
  data
- Live event stream state such as active agent runs, display items, workflow
  runtime status, and refine chat state

When a mutation changes backend data, invalidate the smallest stable query
family in `app/src/lib/queries/query-keys.ts`.

When an event stream changes request/response data, update or invalidate the
query cache through `app/src/lib/queries/agent-stream-cache.ts`.
