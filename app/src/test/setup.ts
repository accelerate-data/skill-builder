import "@testing-library/jest-dom/vitest";

// Polyfill ResizeObserver for jsdom (used by radix-ui ScrollArea)
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Mock Tauri APIs globally for all tests
import "./mocks/tauri";
