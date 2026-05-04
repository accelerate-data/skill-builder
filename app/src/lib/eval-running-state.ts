/**
 * Module-scoped eval running state.
 * Used by app-layout to guard skill switches and block the skill panel.
 * Local React state in workspace-evals is not accessible from layout components.
 */
let _isRunning = false;
let _cancelCurrentRun: (() => Promise<void>) | null = null;
const _listeners = new Set<(v: boolean) => void>();

export function setEvalsRunning(v: boolean): void {
  _isRunning = v;
  for (const fn of _listeners) fn(v);
}

export function getEvalsRunning(): boolean {
  return _isRunning;
}

export function setEvalsCancelHandler(
  handler: (() => Promise<void>) | null,
): void {
  _cancelCurrentRun = handler;
}

export async function requestEvalsCancel(): Promise<void> {
  await _cancelCurrentRun?.();
}

/** Subscribe to changes. Returns unsubscribe function. */
export function subscribeEvalsRunning(fn: (v: boolean) => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
