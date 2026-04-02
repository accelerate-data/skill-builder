/**
 * Module-scoped eval running state.
 * Used by app-layout to guard skill switches and block the skill panel.
 * Local React state in workspace-evals is not accessible from layout components.
 */
let _isRunning = false;
const _listeners = new Set<(v: boolean) => void>();

export function setEvalsRunning(v: boolean): void {
  _isRunning = v;
  for (const fn of _listeners) fn(v);
}

export function getEvalsRunning(): boolean {
  return _isRunning;
}

/** Subscribe to changes. Returns unsubscribe function. */
export function subscribeEvalsRunning(fn: (v: boolean) => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
