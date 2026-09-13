// The bot's side of the Mini App (v1.1 SPEC §9: "Bot commands open the Mini App via a web_app
// button"), plus the orthography of the strings those buttons carry.
//
// Two failures this file exists to prevent:
//
//  1. A `web_app` button whose URL is not HTTPS. Telegram rejects the *whole* message, so a
//     developer instance on `http://localhost` would not just lose the button -- every notification
//     the bot tried to send with one would fail to deliver. Every builder is conditional; these tests
//     hold that conditional in place.
//  2. A button that opens a screen the Mini App no longer has. The route list is shared through
//     `@devon/contracts`, and `miniappHref` is checked against it here rather than against a string.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { InlineKeyboard } from 'grammy'
import { MINIAPP_ROUTES, MINIAPP_ROUTE_KEYS } from '@devon/contracts'
import {
  addMiniappButton,
  miniappHref,
  miniappMenuKeyboard,
  routeForReason,
} from '../../src/modules/telegram/miniapp-buttons.js'
import { tb, type BotLocale } from '../../src/modules/telegram/templates.js'
import { configureTelegram } from '../../src/modules/telegram/transport.js'
import type { Config } from '../../src/config.js'

const BOT_LOCALES = ['uz-Latn', 'uz-Cyrl', 'ru', 'en'] as const satisfies readonly BotLocale[]

/** `miniappUrl()` reads `DEVON_PUBLIC_URL` through the config the app hands the transport at boot,
 * not `process.env` -- so the test sets it the same way the server does. */
function setPublicUrl(value: string): void {
  configureTelegram({
    TELEGRAM_BOT_TOKEN: null,
    TELEGRAM_BOT_USERNAME: null,
    DEVON_PUBLIC_URL: value,
  } as unknown as Config)
}

afterEach(() => {
  setPublicUrl('http://localhost:5173')
  vi.restoreAllMocks()
})

type WebAppButton = { text: string; web_app?: { url: string } }

function buttons(keyboard: InlineKeyboard): WebAppButton[] {
  return keyboard.inline_keyboard.flat() as unknown as WebAppButton[]
}

describe('miniappHref', () => {
  it('points every route at the shared hash the app itself parses', () => {
    setPublicUrl('https://devon.example.uz')
    for (const key of MINIAPP_ROUTE_KEYS) {
      expect(miniappHref(key)).toBe(`https://devon.example.uz/miniapp/${MINIAPP_ROUTES[key]}`)
    }
  })

  it('does not double the slash when the public URL has a trailing one', () => {
    setPublicUrl('https://devon.example.uz/')
    expect(miniappHref('inbox')).toBe('https://devon.example.uz/miniapp/#/inbox')
  })
})

describe('miniappMenuKeyboard', () => {
  it('offers one web_app button per screen on an HTTPS instance', () => {
    setPublicUrl('https://devon.example.uz')
    const keyboard = miniappMenuKeyboard('uz-Latn')
    expect(keyboard).not.toBeNull()
    const rows = buttons(keyboard!)
    expect(rows).toHaveLength(6)
    for (const button of rows) {
      expect(button.web_app?.url.startsWith('https://devon.example.uz/miniapp/#')).toBe(true)
      expect(button.text.trim()).not.toBe('')
    }
    // Every URL is a distinct screen -- a keyboard of six buttons that all open "Bugun" is the
    // failure mode a length assertion alone would miss.
    expect(new Set(rows.map((b) => b.web_app?.url)).size).toBe(6)
  })

  it('answers null on a non-HTTPS instance instead of building a message Telegram would reject', () => {
    for (const url of ['http://localhost:5173', 'http://127.0.0.1:3000', 'ftp://x/']) {
      setPublicUrl(url)
      expect(miniappMenuKeyboard('uz-Latn')).toBeNull()
    }
  })

  it('labels the keyboard in every bot locale', () => {
    setPublicUrl('https://devon.example.uz')
    for (const locale of BOT_LOCALES) {
      const rows = buttons(miniappMenuKeyboard(locale)!)
      expect(rows.map((b) => b.text)).toEqual([
        tb(locale, 'miniapp.open_today'),
        tb(locale, 'miniapp.open_inbox'),
        tb(locale, 'miniapp.open_board'),
        tb(locale, 'miniapp.open_events'),
        tb(locale, 'miniapp.open_focus'),
        tb(locale, 'miniapp.open_fields'),
      ])
    }
  })
})

describe('addMiniappButton', () => {
  it('adds the button and says it did, on HTTPS', () => {
    setPublicUrl('https://devon.example.uz')
    const keyboard = new InlineKeyboard()
    expect(addMiniappButton(keyboard, 'ru', 'inbox')).toBe(true)
    const [button] = buttons(keyboard)
    expect(button?.text).toBe(tb('ru', 'miniapp.open'))
    expect(button?.web_app?.url).toBe('https://devon.example.uz/miniapp/#/inbox')
  })

  it('leaves the caller’s keyboard untouched on a non-HTTPS instance', () => {
    setPublicUrl('http://localhost:5173')
    const keyboard = new InlineKeyboard().text('Ochish', 'noop')
    expect(addMiniappButton(keyboard, 'uz-Latn', 'inbox')).toBe(false)
    expect(buttons(keyboard)).toHaveLength(1)
  })
})

describe('routeForReason', () => {
  it('lands an event or poll notification on Tadbirlar and work on the inbox', () => {
    expect(routeForReason('rsvp')).toBe('events')
    expect(routeForReason('poll')).toBe('events')
    for (const reason of ['due', 'assigned', 'mentioned', 'updated']) {
      expect(routeForReason(reason)).toBe('inbox')
    }
  })

  it('falls back to the home tab for anything it does not know', () => {
    for (const reason of ['digest', 'system', 'decision', 'something-new']) {
      expect(routeForReason(reason)).toBe('today')
    }
  })

  it('only ever names a route the Mini App actually has', () => {
    const known = new Set<string>(MINIAPP_ROUTE_KEYS)
    for (const reason of ['rsvp', 'poll', 'due', 'assigned', 'mentioned', 'updated', 'system']) {
      expect(known.has(routeForReason(reason))).toBe(true)
    }
  })
})

describe('the bot’s own copy', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../../src/modules/telegram/templates.ts', import.meta.url)),
    'utf8',
  )

  it('writes Uzbek with the modifier letters, never a typewriter or curly apostrophe', () => {
    // DESIGN.md §2.3 / WALKTHROUGH-FINDINGS §5.3: `oʻ`/`gʻ` are U+02BB and `aʼzo` is U+02BC. An
    // ASCII `'` inside a single-quoted TS string could not compile, so the realistic offenders are
    // the curly right single quote and a backtick-quoted string.
    const offenders = source
      .split('\n')
      .filter((line) => /[’ʹ´]/.test(line))
      .map((line) => line.trim())
    expect(offenders).toEqual([])
  })

  it('uses an em dash, not two hyphens, in anything a person reads', () => {
    // WALKTHROUGH-FINDINGS §5.4. Comments are the author's, not the reader's, so they are exempt.
    const offenders = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//') && line.includes(' -- '))
      .map((line) => line.trim())
    expect(offenders).toEqual([])
  })
})
