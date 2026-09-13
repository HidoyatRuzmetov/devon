// The Telegram SDK wrapper, and the documented stub that stands in for it in a normal browser.
//
// Two properties are worth a test each. First: the stub is not a silent no-op -- it reports the
// host's own colour scheme and honours `?startapp=`, which is what makes "it looks right in Chrome"
// evidence about how it looks in Telegram. Second: every call degrades instead of throwing, because
// a Telegram client one version too old throws from a method it does not implement, and a missing
// haptic buzz must never take the sheet down with it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { tg as Tg } from '../../src/lib/telegram.js'

async function loadTg(): Promise<typeof Tg> {
  // The module caches its resolution on first use (one `window.Telegram` lookup per page load), so
  // each scenario needs a fresh module registry.
  vi.resetModules()
  return (await import('../../src/lib/telegram.js')).tg
}

function setSearch(search: string): void {
  window.history.replaceState(null, '', `/${search}`)
}

afterEach(() => {
  delete window.Telegram
  setSearch('')
})

describe('the dev stub (no Telegram present)', () => {
  it('reports that it is not Telegram, and carries no initData', async () => {
    const tg = await loadTg()
    expect(tg.isTelegram).toBe(false)
    expect(tg.initData).toBe('')
  })

  it('reads ?startapp= the way Telegram reads start_param', async () => {
    setSearch('?startapp=card_9f2a')
    const tg = await loadTg()
    expect(tg.startParam).toBe('card_9f2a')
  })

  it('has no start parameter when the query string has none', async () => {
    const tg = await loadTg()
    expect(tg.startParam).toBeNull()
  })

  it('follows the host colour scheme, and lets ?theme= force one for a screenshot', async () => {
    const dark = vi.fn().mockReturnValue({ matches: true } as MediaQueryList)
    vi.stubGlobal('matchMedia', dark)
    expect((await loadTg()).colorScheme).toBe('dark')
    vi.unstubAllGlobals()

    setSearch('?theme=light')
    const forcedLight = vi.fn().mockReturnValue({ matches: true } as MediaQueryList)
    vi.stubGlobal('matchMedia', forcedLight)
    expect((await loadTg()).colorScheme).toBe('light')
    vi.unstubAllGlobals()

    setSearch('?theme=dark')
    expect((await loadTg()).colorScheme).toBe('dark')
  })

  it('never throws from a call Telegram would have handled', async () => {
    const tg = await loadTg()
    expect(() => {
      tg.ready()
      tg.close()
      tg.paintChrome()
      tg.haptic.tap()
      tg.haptic.success()
      tg.haptic.warn()
    }).not.toThrow()
    expect(tg.onEvent('themeChanged', () => {})).toBeTypeOf('function')
    expect(tg.backButton.show(() => {})).toBeTypeOf('function')
  })
})

describe('a real Telegram launch', () => {
  const handlers: Array<[string, () => void]> = []
  let webApp: NonNullable<NonNullable<Window['Telegram']>['WebApp']>

  beforeEach(() => {
    handlers.length = 0
    webApp = {
      initData: 'auth_date=1&hash=deadbeef',
      initDataUnsafe: { start_param: 'inbox' },
      version: '7.10',
      platform: 'ios',
      colorScheme: 'dark',
      themeParams: {},
      viewportHeight: 640,
      viewportStableHeight: 600,
      isExpanded: false,
      ready: vi.fn(),
      expand: vi.fn(),
      close: vi.fn(),
      onEvent: vi.fn((event: string, handler: () => void) => handlers.push([event, handler])),
      offEvent: vi.fn(),
      disableVerticalSwipes: vi.fn(),
      BackButton: {
        isVisible: false,
        show: vi.fn(),
        hide: vi.fn(),
        onClick: vi.fn(),
        offClick: vi.fn(),
      },
      HapticFeedback: {
        impactOccurred: vi.fn(),
        notificationOccurred: vi.fn(),
        selectionChanged: vi.fn(),
      },
    }
    window.Telegram = { WebApp: webApp }
  })

  it('is recognised only when initData is actually present', async () => {
    expect((await loadTg()).isTelegram).toBe(true)

    webApp.initData = ''
    // The SDK script loads on any page; an empty payload is the honest "not a Mini App launch" test.
    expect((await loadTg()).isTelegram).toBe(false)
  })

  it('expands the sheet and turns the swipe-to-close gesture off on ready()', async () => {
    const tg = await loadTg()
    tg.ready()
    expect(webApp.ready).toHaveBeenCalledOnce()
    expect(webApp.expand).toHaveBeenCalledOnce()
    expect(webApp.disableVerticalSwipes).toHaveBeenCalledOnce()
  })

  it('survives an older client that throws from a method it does not implement', async () => {
    webApp.disableVerticalSwipes = vi.fn(() => {
      throw new TypeError('WebAppMethodUnsupported')
    })
    const tg = await loadTg()
    expect(() => tg.ready()).not.toThrow()
    expect(webApp.ready).toHaveBeenCalledOnce()
  })

  it('prefers the stable viewport height, falling back to the live one', async () => {
    expect((await loadTg()).viewportStableHeight).toBe(600)
    webApp.viewportStableHeight = 0
    expect((await loadTg()).viewportStableHeight).toBe(640)
  })

  it('unsubscribes the handler it registered', async () => {
    const tg = await loadTg()
    const handler = vi.fn()
    const off = tg.onEvent('viewportChanged', handler)
    expect(handlers).toEqual([['viewportChanged', handler]])
    off()
    expect(webApp.offEvent).toHaveBeenCalledWith('viewportChanged', handler)
  })

  it('shows the native back button and cleans it up again', async () => {
    const tg = await loadTg()
    const handler = vi.fn()
    const hide = tg.backButton.show(handler)
    expect(webApp.BackButton!.onClick).toHaveBeenCalledWith(handler)
    expect(webApp.BackButton!.show).toHaveBeenCalledOnce()
    hide()
    expect(webApp.BackButton!.offClick).toHaveBeenCalledWith(handler)
    expect(webApp.BackButton!.hide).toHaveBeenCalledOnce()
  })

  it('fires the haptics the design catalogue asks for', async () => {
    const tg = await loadTg()
    tg.haptic.tap()
    tg.haptic.success()
    tg.haptic.warn()
    expect(webApp.HapticFeedback!.selectionChanged).toHaveBeenCalledOnce()
    expect(webApp.HapticFeedback!.notificationOccurred).toHaveBeenCalledWith('success')
    expect(webApp.HapticFeedback!.notificationOccurred).toHaveBeenCalledWith('warning')
  })

  it('paints the sheet chrome with a hex colour, never a raw token value', async () => {
    const setHeaderColor = vi.fn()
    const setBackgroundColor = vi.fn()
    webApp.setHeaderColor = setHeaderColor
    webApp.setBackgroundColor = setBackgroundColor
    document.documentElement.style.setProperty('--color-background', '#0b0f14')
    document.documentElement.style.setProperty('--color-card', '#141a21')

    const tg = await loadTg()
    tg.paintChrome()
    expect(setBackgroundColor).toHaveBeenCalledWith('#0b0f14')
    expect(setHeaderColor).toHaveBeenCalledWith('#141a21')
  })

  it('leaves Telegram’s own chrome alone when the token cannot be resolved', async () => {
    const setHeaderColor = vi.fn()
    webApp.setHeaderColor = setHeaderColor
    document.documentElement.style.removeProperty('--color-background')
    document.documentElement.style.removeProperty('--color-card')
    const tg = await loadTg()
    expect(() => tg.paintChrome()).not.toThrow()
    expect(setHeaderColor).not.toHaveBeenCalled()
  })
})
