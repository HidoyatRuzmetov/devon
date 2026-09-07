// Package report item 38 (ui-blitz round 2): a bare " -- " (a source-code double-hyphen convention)
// had leaked into user-facing copy across six modules and all four locales -- the designer critique's
// own example, `personal.privacy.note`'s "koʻrasiz -- boʻlim", is one of the strings this test would
// have caught before it ever shipped. `scanBannedWords` in `banned.test.ts` already guards jargon the
// same way; this is the same shape of guard for punctuation instead of vocabulary, so it "cannot come
// back" per that item's own wording, regardless of which module a future string is added to.
import { describe, expect, it } from 'vitest'
import { flatMessages } from '../../src/messages.js'
import { LOCALES } from '../../src/locale.js'

describe('no bare " -- " in shipped copy (an em dash, "—", is the correct punctuation)', () => {
  it('contains no message whose value uses "--" as an em dash, in any locale', () => {
    for (const locale of LOCALES) {
      const messages = flatMessages(locale)
      const hits = Object.entries(messages)
        .filter(([, value]) => value.includes(' -- '))
        .map(([key]) => key)
      expect({ locale, hits }).toEqual({ locale, hits: [] })
    }
  })
})
