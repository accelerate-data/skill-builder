/**
 * Module-scoped eval running state.
 * Used by app-layout to guard skill switches and block the skill panel.
 * Local React state in workspace-evals is not accessible from layout components.
 */
let _isRunning = false;
let _isStopping = false;
let _cancelCurrentRun: (() => Promise<void>) | null = null;
const _listeners = new Set<(v: boolean) => void>();
const _stoppingListeners = new Set<(v: boolean) => void>();

export function setEvalsRunning(v: boolean): void {
  _isRunning = v;
  if (v) _isStopping = false;
  for (const fn of _listeners) fn(v);
}

export function getEvalsRunning(): boolean {
  return _isRunning;
}

export function setEvalsStopping(v: boolean): void {
  _isStopping = v;
  for (const fn of _stoppingListeners) fn(v);
}

export function getEvalsStopping(): boolean {
  return _isStopping;
}

export function setEvalsCancelHandler(
  handler: (() => Promise<void>) | null,
): void {
  _cancelCurrentRun = handler;
}

export async function requestEvalsCancel(): Promise<void> {
  await _cancelCurrentRun?.();
}

/** Subscribe to running state changes. Returns unsubscribe function. */
export function subscribeEvalsRunning(fn: (v: boolean) => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/** Subscribe to stopping state changes. Returns unsubscribe function. */
export function subscribeEvalsStopping(fn: (v: boolean) => void): () => void {
  _stoppingListeners.add(fn);
  return () => _stoppingListeners.delete(fn);
}
