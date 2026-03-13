import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Polyfill ResizeObserver for jsdom (used by radix-ui ScrollArea)
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Override requestAnimationFrame to fire synchronously in tests.
let _rafId = 0;
globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
  cb(++_rafId);
  return _rafId;
};
globalThis.cancelAnimationFrame = () => {};

// Suppress known React test noise so warnings don't drown out actionable failures.
const __consoleError = console.error;
console.error = (...args: unknown[]) => {
  const msg = String(args[0] ?? "");
  if (msg.includes("not wrapped in act(")) return;
  __consoleError(...args);
};

// Mock Tauri APIs globally for all tests
import "./mocks/tauri";

// Mock toast wrapper globally so UI tests can assert calls without relying on sonner internals.
vi.mock("@/lib/toast", () => {
  const toast = {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => "toast-id"),
    dismiss: vi.fn(),
  };
  return { toast };
});
