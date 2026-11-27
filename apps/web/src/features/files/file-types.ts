export const previewLimits = {
  file: 32 * 1024 * 1024,
  expanded: 80 * 1024 * 1024,
  entries: 1500,
  ratio: 250,
  depth: 3,
  text: 2 * 1024 * 1024,
} as const

export type FileKind =
  | 'pdf'
  | 'word'
  | 'sheet'
  | 'slides'
  | 'opendocument'
  | 'html'
  | 'image'
  | 'audio'
  | 'video'
  | 'text'
  | 'archive'
  | 'risky'
  | 'unknown'
const executable = new Set(
  'exe com bat cmd msi msp scr dll sys drv ps1 psm1 vbs vbe wsf wsh js jse mjs cjs hta reg lnk url app application gadget jar apk deb rpm dmg pkg sh bash zsh fish command desktop iso img docm dotm xlsm xlam xltm pptm potm ppam ppsm'.split(
    ' ',
  ),
)
const textExtensions = new Set(
  'txt md markdown json jsonl xml yaml yml toml ini conf log css sql py java c cpp h hpp cs go rs rb php swift kt dart graphql csv tsv rtf'.split(
    ' ',
  ),
)
export function extension(name: string) {
  return name.split('.').pop()?.toLowerCase() ?? ''
}
export function fileKind(name: string, bytes?: Uint8Array): FileKind {
  const ext = extension(name)
  // A renamed program must never be handed to a preview renderer.
  if (
    executable.has(ext) ||
    (bytes?.[0] === 0x4d && bytes[1] === 0x5a) ||
    (bytes?.[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46)
  )
    return 'risky'
  if (ext === 'pdf') return 'pdf'
  if (['docx', 'dotx', 'doc', 'rtf'].includes(ext)) return 'word'
  if (['xlsx', 'xltx', 'xls', 'csv', 'tsv'].includes(ext)) return 'sheet'
  if (['pptx', 'ppsx', 'potx', 'ppt'].includes(ext)) return 'slides'
  if (['odt', 'ott', 'ods', 'odp', 'epub'].includes(ext)) return 'opendocument'
  if (['html', 'htm', 'xhtml'].includes(ext)) return 'html'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg'].includes(ext))
    return 'image'
  if (['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) return 'audio'
  if (['mp4', 'webm', 'ogv', 'mov', 'm4v'].includes(ext)) return 'video'
  if (['zip', 'rar', 'tar', 'gz', 'tgz'].includes(ext)) return 'archive'
  if (textExtensions.has(ext)) return 'text'
  return 'unknown'
}
export function fileMime(name: string) {
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    html: 'text/html',
    htm: 'text/html',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    svg: 'image/svg+xml',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    flac: 'audio/flac',
    opus: 'audio/ogg',
    mp4: 'video/mp4',
    webm: 'video/webm',
    ogv: 'video/ogg',
    mov: 'video/quicktime',
    m4v: 'video/mp4',
  }
  return map[extension(name)] ?? 'application/octet-stream'
}
export function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  return size < 1024 * 1024
    ? `${Math.ceil(size / 1024)} KB`
    : `${(size / 1024 / 1024).toFixed(1)} MB`
}
export type PreviewErrorCode = 'load' | 'format' | 'size' | 'archive' | 'password' | 'timeout'
export class PreviewError extends Error {
  constructor(public code: PreviewErrorCode) {
    super(code)
  }
}
export type ArchiveEntry = {
  path: string
  directory: boolean
  size: number
  encrypted: boolean
}
export function safeArchivePath(name: string): string {
  const normalized = name.replaceAll('\\', '/')
  if (
    !normalized ||
    normalized.length > 512 ||
    /^\/|^[a-z]:/i.test(normalized) ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in untrusted archive filenames.
    /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069:]/.test(normalized)
  )
    throw new PreviewError('archive')
  const parts = normalized.replace(/\/$/, '').split('/')
  if (parts.length > 24 || parts.some((part) => !part || part === '..' || part === '.'))
    throw new PreviewError('archive')
  return parts.join('/')
}
export function validateArchive(entries: ArchiveEntry[], compressedSize: number) {
  if (entries.length > previewLimits.entries) throw new PreviewError('size')
  let total = 0
  const paths = new Set<string>()
  for (const entry of entries) {
    const path = safeArchivePath(entry.path)
    if (paths.has(path) || !Number.isSafeInteger(entry.size) || entry.size < 0)
      throw new PreviewError('archive')
    paths.add(path)
    total += entry.size
    if (
      entry.size > previewLimits.file ||
      total > previewLimits.expanded ||
      total > Math.max(1024 * 1024, compressedSize * previewLimits.ratio)
    )
      throw new PreviewError('size')
  }
  for (const entry of entries) {
    if (!entry.directory && entries.some((other) => other.path.startsWith(entry.path + '/')))
      throw new PreviewError('archive')
  }
}
export function archiveChildren(entries: ArchiveEntry[], folder: string): ArchiveEntry[] {
  const result = new Map<string, ArchiveEntry>()
  const prefix = folder ? folder + '/' : ''
  for (const item of entries) {
    if (!item.path.startsWith(prefix)) continue
    const relative = item.path.slice(prefix.length)
    if (!relative) continue
    const slash = relative.indexOf('/')
    const path = slash < 0 ? item.path : prefix + relative.slice(0, slash)
    if (!result.has(path))
      result.set(path, slash < 0 ? item : { path, directory: true, size: 0, encrypted: false })
  }
  return [...result.values()].sort(
    (a, b) =>
      Number(b.directory) - Number(a.directory) ||
      a.path.localeCompare(b.path, undefined, { numeric: true }),
  )
}
