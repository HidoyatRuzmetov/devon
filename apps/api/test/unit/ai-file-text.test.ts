import { describe, expect, it } from 'vitest'
import { extractFileText } from '../../src/modules/ai/file-text.js'

describe('isolated assistant attachment extraction', () => {
  it('reads a phonebook HTML document as text without executing scripts or loading remote assets', async () => {
    const result = await extractFileText(
      Buffer.from(
        '<html><body><h1>Center phonebook</h1><table><tr><td>Research</td><td>1234</td></tr></table><script>throw new Error("EXECUTED")</script><img src="https://invalid.example.test/tracker"></body></html>',
      ),
      'phonebook.html',
    )
    expect(result.status).toBe('read')
    expect(result.text).toContain('Research')
    expect(result.text).toContain('1234')
    expect(result.text).not.toContain('EXECUTED')
  })
  it('preserves plain text and explicitly reports truncation', async () => {
    const result = await extractFileText(Buffer.from('a'.repeat(170_000)), 'notes.txt')
    expect(result.status).toBe('truncated')
    expect(result.text).toHaveLength(160_000)
  })
  it('does not pretend to understand unsupported binary files', async () => {
    expect(await extractFileText(Buffer.from('video'), 'recording.mp4')).toEqual({
      status: 'unsupported',
      text: '',
    })
    expect(await extractFileText(Buffer.from('bad ZIP'), 'document.docx')).toEqual({
      status: 'unavailable',
      text: '',
    })
  })
  it('terminates a parser exceeding its deadline', async () => {
    expect(
      await extractFileText(Buffer.from('<html><body>test</body></html>'), 'file.html', 1),
    ).toEqual({ status: 'unavailable', text: '' })
  })
})
