import { describe, it, expect, beforeEach, vi } from 'vitest';

// Re-import the module fresh before each test to reset module-level state.
// Vitest module isolation: use vi.resetModules() + dynamic import.
describe('description-opt-running-state', () => {
  let setDescriptionOptRunning: (v: boolean) => void;
  let getDescriptionOptRunning: () => boolean;
  let subscribeDescriptionOptRunning: (fn: (v: boolean) => void) => () => void;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/lib/description-opt-running-state');
    setDescriptionOptRunning = mod.setDescriptionOptRunning;
    getDescriptionOptRunning = mod.getDescriptionOptRunning;
    subscribeDescriptionOptRunning = mod.subscribeDescriptionOptRunning;
  });

  it('starts as false', () => {
    expect(getDescriptionOptRunning()).toBe(false);
  });

  it('set to true is reflected by get', () => {
    setDescriptionOptRunning(true);
    expect(getDescriptionOptRunning()).toBe(true);
  });

  it('set to false after true resets state', () => {
    setDescriptionOptRunning(true);
    setDescriptionOptRunning(false);
    expect(getDescriptionOptRunning()).toBe(false);
  });

  it('subscriber is called with new value on change', () => {
    const listener = vi.fn();
    subscribeDescriptionOptRunning(listener);
    setDescriptionOptRunning(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(true);
  });

  it('subscriber is called on every change', () => {
    const listener = vi.fn();
    subscribeDescriptionOptRunning(listener);
    setDescriptionOptRunning(true);
    setDescriptionOptRunning(false);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, true);
    expect(listener).toHaveBeenNthCalledWith(2, false);
  });

  it('unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const unsub = subscribeDescriptionOptRunning(listener);
    setDescriptionOptRunning(true);
    unsub();
    setDescriptionOptRunning(false);
    expect(listener).toHaveBeenCalledOnce(); // only the first change
  });

  it('multiple subscribers all receive notifications', () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeDescriptionOptRunning(a);
    subscribeDescriptionOptRunning(b);
    setDescriptionOptRunning(true);
    expect(a).toHaveBeenCalledWith(true);
    expect(b).toHaveBeenCalledWith(true);
  });
});
