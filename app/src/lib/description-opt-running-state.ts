/**
 * Module-scoped description optimization running state.
 * Used by app-layout to guard skill switches while optimization is in progress.
 * Local React state in workspace-description is not accessible from layout components.
 */
let _isRunning = false;
const _listeners = new Set<(v: boolean) => void>();

export function setDescriptionOptRunning(v: boolean): void {
  _isRunning = v;
  for (const fn of _listeners) fn(v);
}

export function getDescriptionOptRunning(): boolean {
  return _isRunning;
}

/** Subscribe to changes. Returns unsubscribe function. */
export function subscribeDescriptionOptRunning(fn: (v: boolean) => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
