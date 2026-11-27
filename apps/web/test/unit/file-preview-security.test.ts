import { describe, expect, it } from 'vitest'
import {
  archiveChildren,
  fileKind,
  previewLimits,
  safeArchivePath,
  validateArchive,
} from '../../src/features/files/file-types.js'
import {
  decodeText,
  parseDelimited,
  safeDocument,
} from '../../src/features/files/document-formats.js'
import { previewEndpoint } from '../../src/features/files/interactive-html.js'

describe('read-only file previews', () => {
  it('restricts renderer URLs to same-origin page attachments', () => {
    expect(() =>
      previewEndpoint('https://example.com/api/v1/pages/123/attachments/456/download', 'html'),
    ).toThrow()
    expect(() => previewEndpoint('/api/v1/accounts/export', 'office')).toThrow()
    expect(
      previewEndpoint(
        '/api/v1/pages/00000000-0000-4000-8000-000000000001/attachments/00000000-0000-4000-8000-000000000002/download',
        'html',
      ),
    ).toMatch(/\/preview\/html$/)
  })
  it('refuses executables and macro formats, including a renamed executable', () => {
    for (const name of [
      'run.EXE',
      'script.bat',
      'login.ps1',
      'report.xlsm',
      'letter.docm',
      'shortcut.lnk',
      'run.js',
    ])
      expect(fileKind(name)).toBe('risky')
    expect(fileKind('photo.png', new Uint8Array([0x4d, 0x5a, 0, 0]))).toBe('risky')
    expect(fileKind('report.pdf', new Uint8Array([0x7f, 0x45, 0x4c, 0x46]))).toBe('risky')
    expect(fileKind('design.proprietary')).toBe('unknown')
    expect(fileKind('project.rar')).toBe('archive')
  })
  it('rejects archive traversal, absolute paths and deceptive filenames', () => {
    for (const path of [
      '../secret',
      '/etc/passwd',
      'C:\\Windows\\file',
      '\\\\server\\share',
      'docs/../../file',
      'docs/./file',
      'docs//file',
      'photo\u202egnp.exe',
      'file:stream',
      'file\0.txt',
    ])
      expect(() => safeArchivePath(path)).toThrow()
    expect(safeArchivePath('folder\\subfolder\\file.txt')).toBe('folder/subfolder/file.txt')
    expect(safeArchivePath('.notes.txt')).toBe('.notes.txt')
  })
  it('caps archive expansion and prevents duplicate/file-directory collisions', () => {
    const item = {
      path: 'document.txt',
      directory: false,
      encrypted: false,
      size: 20,
    }
    expect(() => validateArchive([item, item], 100)).toThrow()
    expect(() =>
      validateArchive([item, { ...item, path: 'document.txt/inside.txt' }], 100),
    ).toThrow()
    expect(() => validateArchive([{ ...item, size: previewLimits.file + 1 }], 1_000_000)).toThrow()
    expect(() => validateArchive([{ ...item, size: 2_000_000 }], 100)).toThrow()
    expect(() => validateArchive([{ ...item, size: NaN }], 100)).toThrow()
  })
  it('builds deterministic directory levels, including implicit folders', () => {
    const entries = ['team/notes.txt', 'team/reports/quarter.pdf', 'readme.txt'].map((path) => ({
      path,
      directory: false,
      encrypted: false,
      size: 123,
    }))
    expect(archiveChildren(entries, '').map((entry) => [entry.path, entry.directory])).toEqual([
      ['team', true],
      ['readme.txt', false],
    ])
    expect(archiveChildren(entries, 'team').map((entry) => entry.path)).toEqual([
      'team/reports',
      'team/notes.txt',
    ])
  })
  it('removes active HTML and navigation while preserving document content', () => {
    const result = safeDocument(
      '<html><head><meta http-equiv="refresh" content="0;url=https://example.com"></head><body onload="alert(1)"><script>alert(1)</script><iframe src="/settings"></iframe><form action="/api/change"><input autofocus></form><a href="https://example.com">Link</a><h1>Welcome</h1><img src="https://example.com/tracker.png" onerror="alert(1)"><p>Body</p></body></html>',
      'Example',
    )
    const doc = new DOMParser().parseFromString(result, 'text/html')
    expect(
      doc.querySelector('script, iframe, form, input, [onload], [onerror], [href], [src]'),
    ).toBeNull()
    expect(doc.querySelector('meta[http-equiv="refresh"]')).toBeNull()
    expect(doc.querySelector('h1')?.textContent).toBe('Welcome')
    expect(
      doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'),
    ).toContain("default-src 'none'")
  })
  it('handles quoted CSV, newlines and formulas strictly as text', () => {
    const result = parseDelimited(
      'Name,Notes\r\n"Lola, A.","First\nSecond"\r\n=1+1,"A ""quote"""',
      ',',
    )
    expect(result[0]?.rows).toEqual([
      ['Name', 'Notes'],
      ['Lola, A.', 'First\nSecond'],
      ['=1+1', 'A "quote"'],
    ])
    expect(() => parseDelimited('"unfinished', ',')).toThrow()
    expect(() => decodeText(new Uint8Array([0, 1, 2]))).toThrow()
    expect(decodeText(new Uint8Array([0xff, 0xfe, 65, 0]))).toBe('A')
  })
})
