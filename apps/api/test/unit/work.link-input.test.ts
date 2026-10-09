import { describe, expect, it } from 'vitest'
import {
  createCardBodySchema,
  linkSchema,
  patchCardBodySchema,
} from '../../src/modules/work/schemas.js'

describe('card link writes and legacy reads', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,test',
    'ftp://example.org/x',
    'https://viewer:ExamplePass@example.org/x',
  ])('refuses new unsafe URLs while retaining legacy read compatibility: %s', (url) => {
    const link = { url, title: 'Legacy title', favicon: null }
    expect(linkSchema.safeParse(link).success).toBe(true)
    expect(createCardBodySchema.safeParse({ title: 'New card', links: [link] }).success).toBe(false)
    expect(patchCardBodySchema.safeParse({ links: [link] }).success).toBe(false)
  })
  it('accepts plain http/https links and refuses unsafe favicon values too', () => {
    const link = {
      url: 'https://example.org/x',
      title: 'Public link',
      favicon: 'https://example.org/favicon.ico',
    }
    expect(createCardBodySchema.safeParse({ title: 'New card', links: [link] }).success).toBe(true)
    expect(
      patchCardBodySchema.safeParse({ links: [{ ...link, url: 'http://example.org/x' }] }).success,
    ).toBe(true)
    expect(
      patchCardBodySchema.safeParse({ links: [{ ...link, favicon: 'javascript:alert(1)' }] })
        .success,
    ).toBe(false)
  })
})
