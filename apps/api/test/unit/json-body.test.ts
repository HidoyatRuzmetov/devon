// H7.4 (limits on request body and JSON depth). Without the depth bound, a body far under the 1 MB
// size limit could nest deeply enough to overflow the stack inside Zod's recursive parse of the
// rich-text document schema -- taking down the single API process this product runs (H8.3).
import { describe, it, expect } from 'vitest'
import { buildTestApp } from './test-app.js'
import { exceedsJsonDepth, MAX_JSON_DEPTH } from '../../src/plugins/json-body.js'

describe('exceedsJsonDepth (H7.4)', () => {
  it('measures nesting and ignores brackets inside strings', () => {
    expect(exceedsJsonDepth('{"a":1}', 1)).toBe(false)
    expect(exceedsJsonDepth('{"a":{"b":1}}', 1)).toBe(true)
    expect(exceedsJsonDepth('{"a":"{{{{{{{{{{"}', 2)).toBe(false)
    expect(exceedsJsonDepth('{"a":"\\"{"}', 2)).toBe(false)
    expect(exceedsJsonDepth('[[[[]]]]', 3)).toBe(true)
    expect(exceedsJsonDepth('[[[]]]', 3)).toBe(false)
  })

  it('accepts a realistic rich-text document', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'hello', marks: [] }] },
              ],
            },
          ],
        },
      ],
    }
    expect(exceedsJsonDepth(JSON.stringify(doc))).toBe(false)
  })
})

describe('the JSON parser refuses an over-nested body (H7.4)', () => {
  it('answers 400 instead of recursing into the validator', async () => {
    const { app } = await buildTestApp()
    const depth = MAX_JSON_DEPTH + 50
    const body = `${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: body,
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('still parses an ordinary body', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: 'nobody', password: 'wrong-password-value' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('still refuses malformed JSON', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"login": ',
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})
