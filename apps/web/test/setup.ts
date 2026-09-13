import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Every locale's strings, registered up front. `@devon/i18n` ships only the default catalogue in a
// browser's shell chunk and fetches the rest on demand (packages/i18n/src/messages.ts); a Node test
// has no such constraint, and a suite that calls `setLocale('ru')` and asserts on the Russian string
// needs the switch to stay synchronous. This import is what keeps it so.
import '@devon/i18n/catalogues'

// Same reasoning as `@devon/ui`'s `src/test-config/setup.ts`: this repo does not set `test.globals`,
// so `@testing-library/react`'s automatic `afterEach(cleanup)` never registers on its own.
afterEach(() => {
  cleanup()
})

// jsdom has no pointer-capture implementation; Radix (used throughout `@devon/ui`) calls it
// unconditionally on pointer-down.
if (typeof Element !== 'undefined') {
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.scrollIntoView ??= () => {}
}

// `cmdk` (CommandPalette) uses a `ResizeObserver`; jsdom has no layout engine and never implements
// one.
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver
}

// jsdom does not implement `matchMedia`; `useReducedMotion`, `useMediaQuery` and the theme store all
// read it. A permissive default (nothing reduced, nothing dark, no breakpoint matched) keeps a plain
// `render()` deterministic; individual tests override with their own mock when they need the other
// branch.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

// jsdom has no font loading pipeline.
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

// jsdom's `HTMLDialogElement`/Radix portals work, but `navigator.clipboard` does not exist by
// default (`setup.tsx`'s copy-to-clipboard button).
if (typeof navigator !== 'undefined' && !navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => {} },
  })
}
