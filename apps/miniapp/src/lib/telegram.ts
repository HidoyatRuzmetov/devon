// The one place this app talks to Telegram's webview SDK (`telegram-web-app.js`, loaded in
// `index.html`), plus the documented stub that stands in for it in a normal browser.
//
// Everything else in the app imports `tg` from here and never touches `window.Telegram`: the SDK is
// an optional global that may be absent (a browser tab, an offline webview, a Telegram client too
// old for a given method), so every call has to be guarded exactly once, in one file, rather than at
// forty call sites.
//
// ## The dev stub
//
// `initData` can only be produced by Telegram signing a payload with the live bot token, and the
// server accepts no substitute (`apps/api/src/modules/telegram/miniapp.ts` explains why there is no
// "skip verification" flag). What the stub replaces is the *environment*, not the identity: theme
// parameters, the viewport sheet, the back button, haptics and `start_param` all behave as they do
// inside Telegram, so every Telegram-specific code path is exercised in a normal browser, while the
// session comes from the `devon_sid` cookie of whoever is signed in at `/login` on the same origin.
// The app shows a visible "namunaviy rejim" strip whenever that is what happened.

export type TelegramThemeParams = {
  bg_color?: string
  text_color?: string
  hint_color?: string
  link_color?: string
  button_color?: string
  button_text_color?: string
  secondary_bg_color?: string
  header_bg_color?: string
}

type TelegramWebApp = {
  initData: string
  initDataUnsafe: { start_param?: string; user?: { id: number; first_name?: string } }
  version: string
  platform: string
  colorScheme: 'light' | 'dark'
  themeParams: TelegramThemeParams
  viewportHeight: number
  viewportStableHeight: number
  isExpanded: boolean
  ready: () => void
  expand: () => void
  close: () => void
  onEvent: (event: string, handler: () => void) => void
  offEvent: (event: string, handler: () => void) => void
  setHeaderColor?: (color: string) => void
  setBackgroundColor?: (color: string) => void
  disableVerticalSwipes?: () => void
  BackButton?: {
    isVisible: boolean
    show: () => void
    hide: () => void
    onClick: (handler: () => void) => void
    offClick: (handler: () => void) => void
  }
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void
    selectionChanged: () => void
  }
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

const noop = (): void => {}

/** The stub. Deliberately not a silent no-op object: it reports the host's own colour scheme, honours
 * `?startapp=` the way Telegram's `start_param` does, and drives the same viewport variable, so the
 * layout you see in a browser is the layout Telegram renders. */
function createStub(): TelegramWebApp {
  const params = new URLSearchParams(window.location.search)
  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  const forced = params.get('theme')
  const scheme: 'light' | 'dark' =
    forced === 'dark' ? 'dark' : forced === 'light' ? 'light' : prefersDark ? 'dark' : 'light'
  const startParam = params.get('startapp') ?? undefined
  const height = typeof window !== 'undefined' ? window.innerHeight : 720
  return {
    initData: '',
    initDataUnsafe: startParam ? { start_param: startParam } : {},
    version: '0.0-stub',
    platform: 'devon-dev-stub',
    colorScheme: scheme,
    themeParams: {},
    viewportHeight: height,
    viewportStableHeight: height,
    isExpanded: true,
    ready: noop,
    expand: noop,
    close: noop,
    onEvent: noop,
    offEvent: noop,
  }
}

let cached: { app: TelegramWebApp; real: boolean } | null = null

function resolve(): { app: TelegramWebApp; real: boolean } {
  if (cached) return cached
  const sdk = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined
  // `initData` is empty when the page is opened outside a Mini App context even though the SDK is
  // present -- `telegram-web-app.js` is loaded by `index.html` and initialises on any page. That is
  // the honest test for "are we really inside Telegram", not the existence of the global.
  //
  // And when it is empty, the stub wins over the SDK object, deliberately. An SDK that Telegram
  // never launched reports *defaults*, not observations: `colorScheme: 'light'` whatever the OS
  // says, no `start_param`, and version 6.0, so every method beyond the oldest few warns and does
  // nothing. The stub reports what can actually be observed in that browser -- the host's colour
  // scheme, `?startapp=`, the window height -- which is the whole point of the documented dev path.
  // Using the SDK here instead is how `?theme=dark` and `?startapp=inbox` silently stop working.
  const launched = sdk !== undefined && sdk.initData !== ''
  cached = launched ? { app: sdk, real: true } : { app: createStub(), real: false }
  return cached
}

export const tg = {
  /** `true` only inside a real Telegram webview launch with a signed payload. */
  get isTelegram(): boolean {
    return resolve().real
  },
  get initData(): string {
    return resolve().app.initData
  },
  get startParam(): string | null {
    return resolve().app.initDataUnsafe.start_param ?? null
  },
  get colorScheme(): 'light' | 'dark' {
    return resolve().app.colorScheme
  },
  get platform(): string {
    return resolve().app.platform
  },
  get viewportStableHeight(): number {
    return resolve().app.viewportStableHeight || resolve().app.viewportHeight
  },
  ready(): void {
    const { app } = resolve()
    try {
      app.ready()
      app.expand()
      // Telegram's swipe-to-close gesture competes with a vertical scroll inside the sheet; where
      // the client supports turning it off (Bot API 7.7+), a list that scrolls is worth more than a
      // gesture the tab bar's own close button already covers.
      app.disableVerticalSwipes?.()
    } catch {
      // A Telegram client older than a given method throws rather than ignoring it; a missing
      // convenience must never take the whole app down with it.
    }
  },
  close(): void {
    try {
      resolve().app.close()
    } catch {
      /* nothing to close outside Telegram */
    }
  },
  /** Paints Telegram's own chrome (the sheet header and the area behind the page) with **Devon's**
   * resolved token values, so the webview frame and the app are one surface instead of two. Reading
   * the computed token rather than `themeParams` is deliberate: the theme the app renders is the
   * product's, and the chrome follows it -- DESIGN.md §2 ("tokens only"). */
  paintChrome(): void {
    const { app } = resolve()
    if (typeof document === 'undefined') return
    const styles = getComputedStyle(document.documentElement)
    const background = hexFromCss(styles.getPropertyValue('--color-background'))
    const card = hexFromCss(styles.getPropertyValue('--color-card'))
    try {
      if (background) app.setBackgroundColor?.(background)
      if (card) app.setHeaderColor?.(card)
    } catch {
      /* older client: the chrome keeps Telegram's own colours, which is a cosmetic difference only */
    }
  },
  onEvent(event: 'themeChanged' | 'viewportChanged', handler: () => void): () => void {
    const { app } = resolve()
    try {
      app.onEvent(event, handler)
      return () => app.offEvent(event, handler)
    } catch {
      return noop
    }
  },
  backButton: {
    show(handler: () => void): () => void {
      const button = resolve().app.BackButton
      if (!button) return noop
      try {
        button.onClick(handler)
        button.show()
        return () => {
          button.offClick(handler)
          button.hide()
        }
      } catch {
        return noop
      }
    },
  },
  haptic: {
    tap(): void {
      try {
        resolve().app.HapticFeedback?.selectionChanged()
      } catch {
        /* haptics are a nicety; never a failure path */
      }
    },
    success(): void {
      try {
        resolve().app.HapticFeedback?.notificationOccurred('success')
      } catch {
        /* see above */
      }
    },
    warn(): void {
      try {
        resolve().app.HapticFeedback?.notificationOccurred('warning')
      } catch {
        /* see above */
      }
    },
  },
}

/** `oklch(...)`/`rgb(...)` is not something Telegram's `setHeaderColor` accepts -- it wants `#rrggbb`.
 * Resolving a computed colour through a canvas-free path: paint it onto an element and read it back
 * as `rgb()`, then convert. Returns `null` when the value cannot be resolved, and the caller simply
 * leaves Telegram's own chrome colour alone. */
function hexFromCss(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed
  if (typeof document === 'undefined') return null
  const probe = document.createElement('span')
  probe.style.color = trimmed
  probe.style.display = 'none'
  document.body.appendChild(probe)
  const computed = getComputedStyle(probe).color
  probe.remove()
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(computed)
  if (!match) return null
  const hex = [match[1], match[2], match[3]]
    .map((part) => Number(part).toString(16).padStart(2, '0'))
    .join('')
  return `#${hex}`
}
