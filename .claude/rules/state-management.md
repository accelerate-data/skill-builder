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
