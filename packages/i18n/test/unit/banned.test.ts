import { describe, expect, it } from 'vitest'
import { loadBannedWords, scanBannedWords, BANNED_JSON_PATH } from '../../src/terms.js'
import { flatMessages } from '../../src/messages.js'
import { LOCALES } from '../../src/locale.js'

describe('banned.json (design.md §1.4: whole-word scan against the four message files)', () => {
  it('lists exactly the project-management jargon this product refuses (frozen list)', () => {
    expect(loadBannedWords()).toEqual([
      'sprint',
      'ticket',
      'epic',
      'backlog',
      'task',
      'спринт',
      'тикет',
      'эпик',
      'таск',
      'бэклог',
    ])
  })

  it('none of the four shipped message files contain a banned word as a whole word', () => {
    const bannedWords = loadBannedWords()
    for (const locale of LOCALES) {
      const text = JSON.stringify(flatMessages(locale))
      const hits = scanBannedWords(text, bannedWords)
      expect({ locale, hits }).toEqual({ locale, hits: [] })
    }
  })

  it('scanBannedWords matches a whole word, case-insensitively', () => {
    expect(scanBannedWords('This is a Sprint plan', ['sprint'])).toHaveLength(1)
    expect(scanBannedWords('SPRINT', ['sprint'])).toHaveLength(1)
  })

  it('scanBannedWords does not match a banned word as a mid-word substring', () => {
    // "vazifa" is our chosen word for "task"; "task" must not fire on unrelated words that merely
    // contain the letters -- only a real whole-word hit is a defect.
    expect(scanBannedWords('bestasking multitasking', ['task'])).toHaveLength(0)
  })

  it('scanBannedWords finds a Cyrillic banned word as a whole word, not glued to punctuation', () => {
    expect(scanBannedWords('Bu — спринт, deb ataladi.', ['спринт'])).toHaveLength(1)
  })

  it('BANNED_JSON_PATH resolves to the real file', () => {
    expect(() => loadBannedWords()).not.toThrow()
    expect(BANNED_JSON_PATH.endsWith('banned.json')).toBe(true)
  })
})
