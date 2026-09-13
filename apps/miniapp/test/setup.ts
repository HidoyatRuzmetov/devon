import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Every locale's strings, registered up front. `@devon/i18n` ships only the default catalogue in a
// browser's shell chunk and fetches the rest on demand (packages/i18n/src/messages.ts); a Node test
// has no such constraint, and a suite that calls `setLocale('ru')` and asserts on the Russian string
// needs the switch to stay synchronous. This import is what keeps it so.
import '@devon/i18n/catalogues'

// This repo does not set `test.globals`, so `@testing-library/react`'s automatic `afterEach(cleanup)`
// never registers on its own (same note as `apps/web/test/setup.ts`).
afterEach(() => {
  cleanup()
})

// jsdom has no layout engine and no media-query implementation; the Telegram stub, `MotionProvider`
// and `useReducedMotion` all read `matchMedia` on first render. A permissive default (light theme,
// nothing reduced) keeps a plain `render()` deterministic; a test that needs the other branch
// overrides it itself.
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

if (typeof window !== 'undefined' && !window.ResizeObserver) {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver
}

// `useTelegramTheme` schedules its chrome repaint on the next frame; jsdom has no rAF loop tied to a
// compositor, so it is stubbed as a macrotask rather than left undefined.
if (typeof window !== 'undefined' && !window.requestAnimationFrame) {
  window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number) as typeof requestAnimationFrame
  window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame
}
