import { describe, expect, it } from 'vitest'
import {
  attachmentDisposition,
  attachmentMime,
  safeAttachmentName,
  validAttachmentBytes,
} from '../../src/lib/storage/attachment-types.js'

describe('task attachment validation', () => {
  it('preserves the download name in both ASCII fallback and UTF-8 forms without header injection', () => {
    expect(attachmentDisposition('monthly-report.txt')).toBe(
      `attachment; filename="monthly-report.txt"; filename*=UTF-8''monthly-report.txt`,
    )
    const unicode = attachmentDisposition('Oʻzbek report.pdf')
    expect(unicode).toContain('filename="O_zbek report.pdf"')
    expect(unicode).toContain("filename*=UTF-8''O%CA%BBzbek%20report.pdf")
    expect(attachmentDisposition('../report\r\n".pdf')).not.toMatch(/[\r\n]/)
  })
  it('sanitizes paths and header-control characters without using filenames as storage keys', () => {
    expect(safeAttachmentName('../report\r\n".PDF')).toBe('_report___.PDF')
    expect(attachmentMime('REPORT.PDF')).toBe('application/pdf')
    expect(attachmentMime('invoice.pdf.exe')).toBeNull()
  })
  it('rejects renamed executables, malformed UTF-8, binary text and arbitrary ZIPs', () => {
    expect(validAttachmentBytes('report.pdf', Buffer.from('<script>bad</script>'))).toBe(false)
    expect(validAttachmentBytes('report.txt', Buffer.from([0xff, 0xfe]))).toBe(false)
    expect(validAttachmentBytes('report.csv', Buffer.from([65, 0, 66]))).toBe(false)
    expect(validAttachmentBytes('report.docx', Buffer.from('PK\x03\x04arbitrary zip'))).toBe(false)
    expect(validAttachmentBytes('report.txt', Buffer.from('Oʻzbek\nРусский\ttext'))).toBe(true)
  })
})
