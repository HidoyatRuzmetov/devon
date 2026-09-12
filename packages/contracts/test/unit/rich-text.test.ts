// H1.5 (Tiptap schema allow-list, no javascript:/data: URLs in stored documents) and the URL half of
// H1.6. Every assertion here is a document the server used to accept and store.
import { describe, it, expect } from 'vitest'
import {
  isSafeUrl,
  richTextDocSchema,
  RICH_TEXT_MARK_TYPES,
  RICH_TEXT_NODE_TYPES,
} from '../../src/rich-text.js'

function doc(...content: unknown[]) {
  return { type: 'doc', content }
}

function linked(href: string) {
  return doc({
    type: 'paragraph',
    content: [
      {
        type: 'text',
        text: 'click me',
        marks: [{ type: 'link', attrs: { href } }],
      },
    ],
  })
}

describe('isSafeUrl (H1.6)', () => {
  it('allows the four schemes a document may point at, and same-origin relatives', () => {
    for (const url of [
      'https://example.uz/a',
      'http://example.uz/a',
      'mailto:someone@example.uz',
      'tel:+998901234567',
      '/work/board',
      '//example.uz/a',
      '#section',
    ]) {
      expect(isSafeUrl(url), url).toBe(true)
    }
  })

  it('refuses every scheme that can execute or inline content', () => {
    for (const url of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox(1)',
      'blob:https://example.uz/abc',
      'file:///etc/passwd',
      '',
      '   ',
    ]) {
      expect(isSafeUrl(url), url).toBe(false)
    }
  })

  it('refuses a scheme hidden behind stripped control characters', () => {
    // Browsers strip these before parsing the URL, so a naive `startsWith('javascript:')` misses it.
    const tabbed = `java${String.fromCharCode(9)}script:alert(1)`
    const newlined = `java${String.fromCharCode(10)}script:alert(1)`
    const nulled = `${String.fromCharCode(0)}javascript:alert(1)`
    expect(isSafeUrl(tabbed)).toBe(false)
    expect(isSafeUrl(newlined)).toBe(false)
    expect(isSafeUrl(nulled)).toBe(false)
  })

  it('refuses a non-string', () => {
    expect(isSafeUrl(undefined)).toBe(false)
    expect(isSafeUrl(42)).toBe(false)
    expect(isSafeUrl({ href: 'https://example.uz' })).toBe(false)
  })
})

describe('richTextDocSchema (H1.5)', () => {
  it('accepts a document made of allow-listed nodes and marks', () => {
    const value = doc(
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Reja' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] }],
      },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'do it' }] }],
          },
        ],
      },
      {
        type: 'callout',
        attrs: { tone: 'info' },
        content: [{ type: 'paragraph' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'mention', attrs: { id: 'u1', label: 'Aziz' } }],
      },
    )
    expect(richTextDocSchema.safeParse(value).success).toBe(true)
  })

  it('accepts a link to an http(s) URL', () => {
    expect(richTextDocSchema.safeParse(linked('https://example.uz/plan')).success).toBe(true)
  })

  it('refuses a link mark carrying a javascript: URL (stored XSS)', () => {
    expect(richTextDocSchema.safeParse(linked('javascript:alert(document.cookie)')).success).toBe(
      false,
    )
  })

  it('refuses a link mark carrying a data: URL', () => {
    expect(
      richTextDocSchema.safeParse(linked('data:text/html,<script>alert(1)</script>')).success,
    ).toBe(false)
  })

  it('refuses a node type the editor does not register (stored denial of service)', () => {
    expect(richTextDocSchema.safeParse(doc({ type: 'iframe', attrs: {} })).success).toBe(false)
    expect(richTextDocSchema.safeParse(doc({ type: 'image', attrs: {} })).success).toBe(false)
    expect(richTextDocSchema.safeParse(doc({ type: '__proto__' })).success).toBe(false)
  })

  it('refuses a mark type the editor does not register', () => {
    const value = doc({
      type: 'paragraph',
      content: [{ type: 'text', text: 'x', marks: [{ type: 'evil' }] }],
    })
    expect(richTextDocSchema.safeParse(value).success).toBe(false)
  })

  it('refuses an event-handler attribute smuggled into attrs', () => {
    const value = doc({ type: 'paragraph', attrs: { onclick: 'alert(1)' } })
    expect(richTextDocSchema.safeParse(value).success).toBe(false)
  })

  it('refuses an oversized attribute value', () => {
    const value = doc({
      type: 'paragraph',
      attrs: { title: 'x'.repeat(4096) },
    })
    expect(richTextDocSchema.safeParse(value).success).toBe(false)
  })

  it('refuses a document over the serialized ceiling', () => {
    const value = doc({
      type: 'paragraph',
      content: [{ type: 'text', text: 'a'.repeat(19_000) }],
    })
    const many = doc(...Array.from({ length: 200 }, () => value.content[0]))
    expect(richTextDocSchema.safeParse(many).success).toBe(false)
  })
})

describe('allow-lists mirror the registered editor extensions', () => {
  it('names exactly the StarterKit 3.31 + task-list + task-item + mention + callout node set', () => {
    expect([...RICH_TEXT_NODE_TYPES].sort()).toEqual(
      [
        'blockquote',
        'bulletList',
        'callout',
        'codeBlock',
        'doc',
        'hardBreak',
        'heading',
        'horizontalRule',
        'listItem',
        'mention',
        'orderedList',
        'paragraph',
        'taskItem',
        'taskList',
        'text',
      ].sort(),
    )
  })

  it('names no mark that can carry executable content beyond the one URL-bearing mark', () => {
    expect([...RICH_TEXT_MARK_TYPES].sort()).toEqual(
      ['bold', 'code', 'italic', 'link', 'strike', 'underline'].sort(),
    )
  })
})
