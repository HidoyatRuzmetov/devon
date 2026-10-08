import { describe, expect, it } from 'vitest'
import { personalDigestText } from '../../src/modules/notifications/registry.js'

describe('scheduled summary copy', () => {
  it('names the actual daily or weekly frequency in all four locales', () => {
    const daily = personalDigestText({ assigned: 2 }, 'daily')
    const weekly = personalDigestText({ assigned: 2 }, 'weekly')
    expect(daily.title.en).toBe('Daily summary — 2')
    expect(weekly.title.en).toBe('Weekly summary — 2')
    expect(weekly.title['uz-Latn']).toContain('Haftalik')
    expect(weekly.title['uz-Cyrl']).toContain('Ҳафталик')
    expect(weekly.title.ru).toContain('неделю')
  })
})
