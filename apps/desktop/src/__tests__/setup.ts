import "@testing-library/jest-dom/vitest";

// jsdom has no matchMedia / ResizeObserver, which ThemeProvider and the Radix primitives read.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }),
});
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
