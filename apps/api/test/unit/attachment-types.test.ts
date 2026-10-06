import { describe, expect, it } from 'vitest'
import {
  attachmentMime,
  safeAttachmentName,
  validAttachmentBytes,
} from '../../src/lib/storage/attachment-types.js'

describe('task attachment validation', () => {
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
