import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Every locale's strings, registered up front. `@devon/i18n` ships only the default catalogue in a
// browser's shell chunk and fetches the rest on demand (packages/i18n/src/messages.ts); a Node test
// has no such constraint, and a suite that calls `setLocale('ru')` and asserts on the Russian string
// needs the switch to stay synchronous. This import is what keeps it so.
import '@devon/i18n/catalogues'

// Vitest does not inject Jest-style globals by default (this repo does not set `test.globals` in
// vitest config), so @testing-library/react's automatic `afterEach(cleanup)` never registers --
// every test in a file would otherwise render on top of the previous test's leftover DOM. Wiring it
// explicitly here is the fix, not `test.globals: true` (which would change every other package's
// convention too, outside this item's TOUCHES).
afterEach(() => {
  cleanup()
})

// jsdom has no pointer-capture implementation; Radix and Sonner both call it unconditionally on
// pointer-down (drag-to-dismiss handling). A no-op is correct for a jsdom test -- there is no real
// pointer to capture.
if (typeof Element !== 'undefined') {
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.scrollIntoView ??= () => {}
}

// jsdom has no layout engine, so it never implements ResizeObserver; `cmdk` (CommandPalette) uses
// one to keep its list height in sync. A no-op observer is correct here -- there is no real layout
// to observe.
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver
}

// jsdom does not implement `matchMedia`; several hooks (`useReducedMotion`, theme resolution) read
// it. A permissive default (nothing reduced, nothing dark) keeps component smoke tests deterministic;
// individual tests override with their own mock when they need to assert the other branch.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

// jsdom has no font loading pipeline; `document.fonts` is undefined. Components that call
// `useFontsLoaded()` need at least the shape of the `FontFaceSet` API used in this package.
if (typeof document !== 'undefined' && !('fonts' in document)) {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      ready: Promise.resolve(),
      check: () => true,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  })
}
