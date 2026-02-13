/**
 * E2E mock for @tauri-apps/api/event. This file is loaded via Vite alias
 * when TAURI_E2E=true, replacing the real Tauri event API.
 *
 * Handlers are stored on `window.__TAURI_EVENT_HANDLERS__` so Playwright
 * tests can emit events via `page.evaluate()`.
 */

type UnlistenFn = () => void;

interface TauriEvent<T> {
  payload: T;
}

type EventHandler<T> = (event: TauriEvent<T>) => void;

/** Global handler registry, keyed by event name. */
type HandlerMap = Map<string, Set<EventHandler<unknown>>>;

declare global {
  interface Window {
    __TAURI_EVENT_HANDLERS__: HandlerMap;
  }
}

function getHandlers(): HandlerMap {
  if (!window.__TAURI_EVENT_HANDLERS__) {
    window.__TAURI_EVENT_HANDLERS__ = new Map();
  }
  return window.__TAURI_EVENT_HANDLERS__;
}

/**
 * Register a handler for the given Tauri event name.
 * Returns a function that removes this specific handler.
 */
export async function listen<T>(
  eventName: string,
  handler: EventHandler<T>,
): Promise<UnlistenFn> {
  const handlers = getHandlers();
  if (!handlers.has(eventName)) {
    handlers.set(eventName, new Set());
  }
  const typed = handler as EventHandler<unknown>;
  handlers.get(eventName)!.add(typed);

  return () => {
    const set = handlers.get(eventName);
    if (set) {
      set.delete(typed);
      if (set.size === 0) {
        handlers.delete(eventName);
      }
    }
  };
}

/**
 * Register a handler that fires at most once.
 */
export async function once<T>(
  eventName: string,
  handler: EventHandler<T>,
): Promise<UnlistenFn> {
  let unlisten: UnlistenFn | undefined;

  const wrapper: EventHandler<T> = (event) => {
    handler(event);
    unlisten?.();
  };

  unlisten = await listen(eventName, wrapper);
  return unlisten;
}

/**
 * Emit an event to all registered handlers.
 */
export async function emit(eventName: string, payload?: unknown): Promise<void> {
  const handlers = getHandlers();
  const set = handlers.get(eventName);
  if (set) {
    for (const handler of set) {
      handler({ payload });
    }
  }
}
