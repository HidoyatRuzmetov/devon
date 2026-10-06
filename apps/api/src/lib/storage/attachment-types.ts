/** Files are always downloaded, never rendered as active content in the application origin. */
export const ATTACHMENT_TYPES = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
} as const

export function safeAttachmentName(name: string): string {
  return name
    .normalize('NFC')
    .split('')
    .map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? '_' : char))
    .join('')
    .replace(/[\\/<>:"|?*]/g, '_')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 180)
}

export function attachmentMime(name: string): string | null {
  const extension = name.split('.').at(-1)?.toLowerCase() ?? ''
  return ATTACHMENT_TYPES[extension as keyof typeof ATTACHMENT_TYPES] ?? null
}

export function validAttachmentBytes(name: string, bytes: Buffer): boolean {
  const ext = name.split('.').at(-1)?.toLowerCase()
  if (ext === 'pdf') return bytes.subarray(0, 5).toString() === '%PDF-'
  if (ext === 'png')
    return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (ext === 'jpg' || ext === 'jpeg')
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (ext === 'webp')
    return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
  if (ext === 'docx' || ext === 'xlsx' || ext === 'pptx') {
    const folder = ext === 'docx' ? 'word/' : ext === 'xlsx' ? 'xl/' : 'ppt/'
    return (
      bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])) &&
      bytes.includes(Buffer.from('[Content_Types].xml')) &&
      bytes.includes(Buffer.from(folder))
    )
  }
  if (ext === 'txt' || ext === 'csv') {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      return !Array.from(text).some(
        (char) => char.charCodeAt(0) < 32 && !['\t', '\n', '\r'].includes(char),
      )
    } catch {
      return false
    }
  }
  return false
}
