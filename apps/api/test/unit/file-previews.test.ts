import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZipWriter, Uint8ArrayWriter, TextReader } from '@zip.js/zip.js'
import {
  HTML_PREVIEW_CSP,
  renderOffice,
  validateOfficePackage,
} from '../../src/modules/attachments/file-previews.js'

async function officePackage(entries: [string, string][]) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
  })
  for (const [path, value] of entries) await writer.add(path, new TextReader(value))
  return Buffer.from(await writer.close())
}
afterEach(() => vi.unstubAllGlobals())
describe('private document preview boundaries', () => {
  it('accepts a bounded Office package and rejects traversal, embedded programs and expansion bombs', async () => {
    await expect(
      validateOfficePackage(
        await officePackage([
          ['[Content_Types].xml', '<Types/>'],
          ['word/document.xml', '<document/>'],
        ]),
      ),
    ).resolves.toBeUndefined()
    await Promise.all(
      ['../secret', 'word/vbaProject.bin', 'word/embeddings/program.bin'].map(async (path) => {
        await expect(
          validateOfficePackage(
            await officePackage([
              ['[Content_Types].xml', '<Types/>'],
              [path, 'x'],
            ]),
          ),
        ).rejects.toThrow()
      }),
    )
    await expect(
      validateOfficePackage(
        await officePackage([
          ['[Content_Types].xml', '<Types/>'],
          ['word/document.xml', 'x'.repeat(2 * 1024 * 1024)],
        ]),
      ),
    ).rejects.toThrow()
    await expect(
      validateOfficePackage(await officePackage([['random.txt', 'not Office']])),
    ).rejects.toThrow()
  })
  it('keeps active HTML opaque, offline, unable to submit forms or load subframes', () => {
    expect(HTML_PREVIEW_CSP).toContain("script-src 'unsafe-inline'")
    expect(HTML_PREVIEW_CSP).toContain("connect-src 'none'")
    expect(HTML_PREVIEW_CSP).toContain("frame-src 'none'")
    expect(HTML_PREVIEW_CSP).toContain("form-action 'none'")
    expect(HTML_PREVIEW_CSP).not.toMatch(/allow-same-origin|allow-top-navigation|unsafe-eval/)
  })
  it('sends only bytes to the configured renderer, refuses redirects, and verifies the output signature', async () => {
    const request = vi.fn(async () => new Response('%PDF-1.7\nExample'))
    vi.stubGlobal('fetch', request)
    const signal = new AbortController().signal
    const pdf = await renderOffice(
      'http://document-preview:3000',
      'Example.docx',
      Buffer.from('example'),
      signal,
    )
    expect(pdf.toString()).toMatch(/^%PDF-/)
    const [url, options] = request.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.href).toBe('http://document-preview:3000/forms/libreoffice/convert')
    expect(options.redirect).toBe('error')
    expect(options.signal).toBe(signal)
    const form = options.body as FormData
    expect(form.get('downloadFrom')).toBeNull()
    expect(form.get('exportFormFields')).toBe('false')
    request.mockImplementation(async () => new Response('<html>wrong format</html>'))
    await expect(
      renderOffice(url.href, 'Example.docx', Buffer.from('example'), signal),
    ).rejects.toThrow('preview_not_pdf')
  })
  it('rejects oversized and failed conversions before handing any bytes to a viewer', async () => {
    const request = vi.fn(
      async () =>
        new Response('data', {
          headers: { 'content-length': String(33 * 1024 * 1024) },
        }),
    )
    vi.stubGlobal('fetch', request)
    const convert = () =>
      renderOffice(
        'http://document-preview:3000',
        'Example.docx',
        Buffer.from('example'),
        new AbortController().signal,
      )
    await expect(convert()).rejects.toThrow('preview_conversion_failed')
    request.mockImplementation(async () => new Response('failed', { status: 500 }))
    await expect(convert()).rejects.toThrow('preview_conversion_failed')
  })
})
