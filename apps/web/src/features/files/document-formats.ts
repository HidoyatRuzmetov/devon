import DOMPurify from 'dompurify'
import type { CSSProperties } from 'react'
import { PreviewError, previewLimits, extension } from './file-types.js'
import { ArchiveClient, type DocumentPart } from './archive-client.js'

export function decodeText(data: Uint8Array) {
  if (data.length > previewLimits.text) throw new PreviewError('size')
  const encoding =
    data[0] === 0xff && data[1] === 0xfe
      ? 'utf-16le'
      : data[0] === 0xfe && data[1] === 0xff
        ? 'utf-16be'
        : 'utf-8'
  const text = new TextDecoder(encoding, { fatal: true }).decode(data)
  if (text.includes('\0')) throw new PreviewError('format')
  return text
}
function xml(text: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new PreviewError('format')
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new PreviewError('format')
  if (doc.getElementsByTagName('*').length > 50_000) throw new PreviewError('size')
  return doc
}
const elements = (parent: Document | Element, name: string) => [
  ...parent.getElementsByTagNameNS('*', name),
]
const escape = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

/** No scripts, forms, embedded browsing contexts or remote resource requests in a document. */
export function safeDocument(html: string, title: string) {
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: [
      'script',
      'iframe',
      'object',
      'embed',
      'form',
      'input',
      'button',
      'textarea',
      'select',
      'base',
      'meta',
      'link',
    ],
    FORBID_ATTR: ['srcset', 'ping', 'download', 'autofocus'],
  })
  const doc = new DOMParser().parseFromString(clean, 'text/html')
  for (const anchor of doc.querySelectorAll('a')) {
    // Links are inert in read-only files; onboarding documents have a separate, explicit policy.
    anchor.removeAttribute('href')
    anchor.removeAttribute('target')
  }
  for (const node of doc.querySelectorAll('[src]')) {
    if (
      !/^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,/i.test(node.getAttribute('src') ?? '')
    )
      node.removeAttribute('src')
  }
  const policy =
    "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>${escape(title)}</title><style>html{color-scheme:light}body{margin:0;padding:24px;background:#fff;color:#182b3d;font:16px/1.65 system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}th,td{padding:8px;border:1px solid #ddd}pre{white-space:pre-wrap}section.docx{max-width:100%;box-sizing:border-box}.docx-wrapper{padding:0!important;background:transparent!important}.docx-wrapper>section.docx{box-shadow:none!important;margin:0 auto 24px!important}@media(max-width:640px){body{padding:12px}.docx-wrapper>section.docx{padding:24px!important;width:100%!important;min-height:0!important}}</style>${doc.head.innerHTML}</head><body>${doc.body.innerHTML}</body></html>`
}
export async function documentParts(
  name: string,
  data: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
) {
  const client = new ArchiveClient()
  const abort = () => client.close()
  signal.addEventListener('abort', abort, { once: true })
  try {
    signal.throwIfAborted()
    await client.open(name, data.buffer)
    return await client.parts()
  } finally {
    signal.removeEventListener('abort', abort)
    client.close()
  }
}
async function officePackage(parts: DocumentPart[]) {
  const { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } = await import('@zip.js/zip.js')
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
    level: 0,
  })
  try {
    // Each addition advances the same ZIP writer; keep its output ordered and bounded.
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]!
      let data = part.data
      if (/\.(?:xml|rels)$/i.test(part.path)) {
        const doc = xml(decodeText(data))
        if (part.path.endsWith('.rels')) {
          for (const rel of elements(doc, 'Relationship'))
            if (rel.getAttribute('TargetMode') === 'External') rel.remove()
        }
        data = new TextEncoder().encode(new XMLSerializer().serializeToString(doc))
      }
      // nosemgrep: query-in-loop -- Each part advances the same ZIP output stream; sequential writes bound the compression buffers.
      await writer.add(part.path, new Uint8ArrayReader(data))
    }
    return await writer.close()
  } catch (error) {
    await writer.close().catch(() => undefined)
    throw error
  }
}
export async function wordDocument(
  name: string,
  data: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
) {
  const parts = await documentParts(name, data, signal)
  if (!parts.some((part) => part.path === 'word/document.xml')) throw new PreviewError('format')
  const bytes = await officePackage(parts)
  signal.throwIfAborted()
  const { renderAsync } = await import('docx-preview')
  const container = document.createElement('div')
  await renderAsync(bytes, container, undefined, {
    useBase64URL: true,
    renderAltChunks: false,
    ignoreFonts: true,
    experimental: false,
    renderComments: false,
    ignoreLastRenderedPageBreak: true,
  })
  signal.throwIfAborted()
  return safeDocument(container.innerHTML, name)
}
export type SheetCell = {
  style?: CSSProperties
  rowSpan?: number
  colSpan?: number
  covered?: boolean
}
export type Sheet = {
  name: string
  rows: string[][]
  truncated: boolean
  cells?: Record<string, SheetCell>
  widths?: number[]
  heights?: number[]
}
export function parseDelimited(text: string, separator: string): Sheet[] {
  const rows: string[][] = []
  let row: string[] = [],
    value = '',
    quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"'
        i++
      } else if (quoted || !value) quoted = !quoted
      else value += char
    } else if (!quoted && (char === separator || char === '\n' || char === '\r')) {
      row.push(value)
      value = ''
      if (row.length > 100) throw new PreviewError('size')
      if (char !== separator) {
        rows.push(row)
        row = []
        if (char === '\r' && text[i + 1] === '\n') i++
        if (rows.length === 1000) return [{ name: 'Data', rows, truncated: i < text.length - 1 }]
      }
    } else value += char
  }
  if (quoted) throw new PreviewError('format')
  if (value || row.length) {
    row.push(value)
    rows.push(row)
  }
  return [{ name: 'Data', rows, truncated: false }]
}
export async function workbook(
  name: string,
  data: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
): Promise<Sheet[]> {
  const ext = extension(name)
  if (ext === 'csv' || ext === 'tsv')
    return parseDelimited(decodeText(data), ext === 'tsv' ? '\t' : ',')
  const parts = await documentParts(name, data, signal)
  if (!parts.some((part) => part.path === 'xl/workbook.xml')) throw new PreviewError('format')
  const clean = await officePackage(parts)
  signal.throwIfAborted()
  return new Promise<Sheet[]>((resolve, reject) => {
    const worker = new Worker(new URL('./spreadsheet.worker.ts', import.meta.url), {
      type: 'module',
    })
    const stop = () => {
      clearTimeout(timer)
      worker.terminate()
      signal.removeEventListener('abort', abort)
    }
    const abort = () => {
      stop()
      reject(new DOMException('Cancelled', 'AbortError'))
    }
    const timer = setTimeout(() => {
      stop()
      reject(new PreviewError('timeout'))
    }, 20_000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<{ sheets?: Sheet[]; error?: boolean }>) => {
      stop()
      if (event.data.sheets) resolve(event.data.sheets)
      else reject(new PreviewError('format'))
    }
    worker.onerror = () => {
      stop()
      reject(new PreviewError('format'))
    }
    worker.postMessage(clean.buffer, [clean.buffer])
  })
}

export type Slide = { title: string; html: string }
const toDataUrl = (part: DocumentPart) => {
  const mime: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  }
  const type = mime[extension(part.path)]
  if (!type || part.data.length > 4 * 1024 * 1024) return ''
  let raw = ''
  for (let start = 0; start < part.data.length; start += 8192)
    raw += String.fromCharCode(...part.data.subarray(start, start + 8192))
  return `data:${type};base64,${btoa(raw)}`
}
export async function slideDeck(
  name: string,
  data: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
): Promise<Slide[]> {
  const parts = await documentParts(name, data, signal)
  const slides = parts
    .filter((part) => /^ppt\/slides\/slide\d+\.xml$/.test(part.path))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
  if (!slides.length) throw new PreviewError('format')
  return slides.slice(0, 100).map((part, index) => {
    const doc = xml(decodeText(part.data))
    const paragraphs = elements(doc, 'p')
      .map((p) =>
        elements(p, 't')
          .map((t) => t.textContent ?? '')
          .join(''),
      )
      .filter(Boolean)
    const relPath = part.path.replace('slides/', 'slides/_rels/') + '.rels'
    const relPart = parts.find((item) => item.path === relPath)
    const rels = relPart ? elements(xml(decodeText(relPart.data)), 'Relationship') : []
    const pictures = elements(doc, 'blip')
      .map((node) => {
        const id = node.getAttribute('r:embed')
        const rel = rels.find(
          (item) =>
            item.getAttribute('Id') === id && item.getAttribute('TargetMode') !== 'External',
        )
        const target = rel?.getAttribute('Target')?.replace('../media/', 'ppt/media/')
        const image = parts.find((item) => item.path === target)
        return image ? toDataUrl(image) : ''
      })
      .filter(Boolean)
    const title = paragraphs[0] ?? `Slide ${index + 1}`
    return {
      title,
      html: safeDocument(
        `<main style="max-width:960px;margin:auto;padding:32px"><h1 style="font:36px/1.2 Georgia,serif;color:#15334a">${escape(title)}</h1>${paragraphs
          .slice(1)
          .map((p) => `<p>${escape(p)}</p>`)
          .join(
            '',
          )}${pictures.map((src) => `<img src="${src}" style="max-height:380px;object-fit:contain;margin:16px">`).join('')}</main>`,
        title,
      ),
    }
  })
}
export async function openDocument(
  name: string,
  data: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
): Promise<{ html?: string; sheets?: Sheet[]; slides?: Slide[] }> {
  const parts = await documentParts(name, data, signal)
  if (extension(name) === 'epub') {
    const container = parts.find((part) => part.path === 'META-INF/container.xml')
    const packagePath =
      container &&
      elements(xml(decodeText(container.data)), 'rootfile')[0]?.getAttribute('full-path')
    const packagePart = parts.find((part) => part.path === packagePath)
    if (!packagePart) throw new PreviewError('format')
    const doc = xml(decodeText(packagePart.data))
    const base = packagePart.path.slice(0, packagePart.path.lastIndexOf('/') + 1)
    const manifest = elements(doc, 'item')
    const chapters = elements(doc, 'itemref')
      .map((ref) => manifest.find((item) => item.getAttribute('id') === ref.getAttribute('idref')))
      .map((item) => parts.find((part) => part.path === base + item?.getAttribute('href')))
      .filter((part): part is DocumentPart => !!part)
    return {
      slides: chapters.slice(0, 100).map((part, index) => ({
        title: `Chapter ${index + 1}`,
        html: safeDocument(decodeText(part.data), name),
      })),
    }
  }
  const content = parts.find((part) => part.path === 'content.xml')
  if (!content) throw new PreviewError('format')
  const doc = xml(decodeText(content.data))
  if (extension(name) === 'ods') {
    return {
      sheets: elements(doc, 'table')
        .slice(0, 30)
        .map((table, index) => {
          const rows: string[][] = []
          const sourceRows = elements(table, 'table-row')
          for (const row of sourceRows) {
            if (rows.length >= 1000) break
            const cells: string[] = []
            for (const cell of [...row.children].filter((child) =>
              ['table-cell', 'covered-table-cell'].includes(child.localName),
            )) {
              const repeat = Math.min(
                100 - cells.length,
                Math.max(1, Number(cell.getAttribute('table:number-columns-repeated')) || 1),
              )
              for (let i = 0; i < repeat; i++)
                cells.push(
                  elements(cell, 'p')
                    .map((p) => p.textContent)
                    .join('\n'),
                )
            }
            const repeat = Math.min(
              1000 - rows.length,
              Math.max(1, Number(row.getAttribute('table:number-rows-repeated')) || 1),
            )
            for (let i = 0; i < repeat; i++) rows.push(cells)
          }
          return {
            name: table.getAttribute('table:name') ?? `Sheet ${index + 1}`,
            rows,
            truncated: rows.length === 1000,
          }
        }),
    }
  }
  const paragraphs = (root: Document | Element) =>
    elements(root, 'p')
      .map((p) => `<p>${escape(p.textContent ?? '')}</p>`)
      .join('')
  if (extension(name) === 'odp')
    return {
      slides: elements(doc, 'page')
        .slice(0, 100)
        .map((page, index) => ({
          title: page.getAttribute('draw:name') ?? `Slide ${index + 1}`,
          html: safeDocument(paragraphs(page), name),
        })),
    }
  const headings = elements(doc, 'h')
    .map((h) => `<h2>${escape(h.textContent ?? '')}</h2>`)
    .join('')
  return { html: safeDocument(headings + paragraphs(doc), name) }
}
