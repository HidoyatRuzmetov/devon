import { ZipReader, Uint8ArrayReader, configure, type Entry } from '@zip.js/zip.js'
import {
  PreviewError,
  previewLimits,
  safeArchivePath,
  validateArchive,
  extension,
  type ArchiveEntry,
} from './file-types.js'

configure({ useWebWorkers: false, useCompressionStream: true })
let source: Uint8Array<ArrayBuffer>
let filename = ''
let password = ''
let zip: ZipReader<Uint8Array<ArrayBuffer>> | undefined
let zipEntries: Entry[] = []
let entries: ArchiveEntry[] = []
let tarFiles = new Map<string, Uint8Array<ArrayBuffer>>()

async function bounded(stream: ReadableStream<Uint8Array>, limit: number) {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.length
      if (length > limit) throw new PreviewError('size')
      chunks.push(next.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  const data = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.length
  }
  return data
}
async function unrar() {
  const [{ createExtractorFromData }, { default: wasmUrl }] = await Promise.all([
    import('node-unrar-js/esm/index.esm.js'),
    import('node-unrar-js/esm/js/unrar.wasm?url'),
  ])
  const wasm = await fetch(wasmUrl).then((response) => {
    if (!response.ok) throw new PreviewError('load')
    return response.arrayBuffer()
  })
  const extractor = await createExtractorFromData({
    wasmBinary: wasm,
    data: source.buffer.slice(0),
    password,
  })
  // UnRAR's in-memory writer must obey the actual output limit, not just archive headers.
  const writer = extractor as unknown as {
    write(fd: number, pointer: number, size: number): boolean
  }
  const original = writer.write.bind(extractor)
  let written = 0
  writer.write = (fd, pointer, size) => {
    written += size
    if (written > previewLimits.expanded) throw new PreviewError('size')
    return original(fd, pointer, size)
  }
  return extractor
}
function readTar(data: Uint8Array<ArrayBuffer>) {
  const decoder = new TextDecoder()
  const string = (start: number, length: number) =>
    decoder.decode(data.subarray(start, start + length)).replace(/\0.*$/s, '')
  tarFiles = new Map()
  const result: ArchiveEntry[] = []
  for (let offset = 0; offset + 512 <= data.length; ) {
    if (data.subarray(offset, offset + 512).every((value) => value === 0)) break
    let sum = 0
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : (data[offset + i] ?? 0)
    if (sum !== parseInt(string(offset + 148, 8).trim(), 8)) throw new PreviewError('archive')
    const prefix = string(offset + 345, 155)
    const name = string(offset, 100)
    const path = safeArchivePath(prefix ? `${prefix}/${name}` : name)
    const type = string(offset + 156, 1)
    const size = parseInt(string(offset + 124, 12).trim(), 8) || 0
    // Links, devices and extended headers are not extracted as ordinary files.
    if (!['', '0', '5'].includes(type)) throw new PreviewError('archive')
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > previewLimits.file ||
      offset + 512 + size > data.length
    )
      throw new PreviewError('size')
    result.push({ path, size, directory: type === '5', encrypted: false })
    if (result.length > previewLimits.entries) throw new PreviewError('size')
    tarFiles.set(path, data.slice(offset + 512, offset + 512 + size))
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return result
}
async function open() {
  const ext = extension(filename)
  if (ext === 'rar') {
    if (String.fromCharCode(...source.subarray(0, 4)) !== 'Rar!') throw new PreviewError('format')
    const extractor = await unrar()
    const list = extractor.getFileList()
    if (list.arcHeader.flags.volume) throw new PreviewError('archive')
    entries = []
    for (const header of list.fileHeaders) {
      entries.push({
        path: safeArchivePath(header.name),
        size: header.unpSize,
        directory: header.flags.directory,
        encrypted: header.flags.encrypted,
      })
      if (entries.length > previewLimits.entries || header.unpSize > previewLimits.file)
        throw new PreviewError('size')
    }
  } else if (['tar', 'gz', 'tgz'].includes(ext)) {
    let data = source
    if (ext !== 'tar')
      data = await bounded(
        new Blob([source]).stream().pipeThrough(new DecompressionStream('gzip')),
        previewLimits.expanded,
      )
    if (ext === 'tar' || ext === 'tgz' || filename.toLowerCase().endsWith('.tar.gz'))
      entries = readTar(data)
    else {
      const path = safeArchivePath(filename.replace(/\.gz$/i, '') || 'file')
      entries = [{ path, directory: false, size: data.length, encrypted: false }]
      tarFiles = new Map([[path, data]])
    }
  } else {
    if (source[0] !== 0x50 || source[1] !== 0x4b) throw new PreviewError('format')
    zip = new ZipReader(new Uint8ArrayReader(source), {
      strictness: 'strict',
      checkOverlappingEntry: true,
    })
    zipEntries = []
    entries = []
    for await (const item of zip.getEntriesGenerator()) {
      if (item.unixMode && (item.unixMode & 0xf000) === 0xa000) throw new PreviewError('archive')
      zipEntries.push(item)
      entries.push({
        path: safeArchivePath(item.filename),
        size: item.uncompressedSize,
        directory: item.directory,
        encrypted: item.encrypted,
      })
      if (entries.length > previewLimits.entries || item.uncompressedSize > previewLimits.file)
        throw new PreviewError('size')
    }
  }
  validateArchive(entries, source.length)
  return entries
}
async function extract(path: string) {
  const entry = entries.find((item) => item.path === path && !item.directory)
  if (!entry) throw new PreviewError('archive')
  if (extension(filename) === 'rar') {
    const extractor = await unrar()
    let data: Uint8Array<ArrayBuffer> | undefined
    for (const item of extractor.extract({
      files: (header) => safeArchivePath(header.name) === path,
      password,
    }).files) {
      if (item.extraction) data = new Uint8Array(item.extraction)
    }
    if (!data || data.length !== entry.size || data.length > previewLimits.file)
      throw new PreviewError('archive')
    return data
  }
  if (zip) {
    const item = zipEntries.find((candidate) => safeArchivePath(candidate.filename) === path)
    if (!item || item.directory) throw new PreviewError('archive')
    const chunks: Uint8Array[] = []
    let length = 0
    await item.getData(
      new WritableStream<Uint8Array>({
        write(chunk) {
          length += chunk.length
          if (length > Math.min(entry.size, previewLimits.file)) throw new PreviewError('size')
          chunks.push(chunk)
        },
      }),
      { password, checkSignature: true },
    )
    if (length !== entry.size) throw new PreviewError('archive')
    const data = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      data.set(chunk, offset)
      offset += chunk.length
    }
    return data
  }
  const data = tarFiles.get(path)
  if (!data) throw new PreviewError('archive')
  return data.slice()
}
type Request = {
  id: number
  action: 'open' | 'extract' | 'parts'
  name?: string
  data?: ArrayBuffer
  password?: string
  path?: string
}
self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data
  try {
    if (request.password !== undefined) password = request.password
    let result: unknown
    if (request.action === 'open') {
      await zip?.close()
      zip = undefined
      source = new Uint8Array(request.data!)
      filename = request.name ?? ''
      if (source.length > previewLimits.file) throw new PreviewError('size')
      result = await open()
    } else if (request.action === 'extract') result = await extract(request.path ?? '')
    else {
      const parts: { path: string; data: Uint8Array<ArrayBuffer> }[] = []
      for (const entry of entries) {
        if (entry.directory) continue
        if (/vbaProject|ActiveX|embeddings\//i.test(entry.path)) throw new PreviewError('archive')
        if (/\.(?:xml|rels)$/i.test(entry.path) && entry.size > previewLimits.text)
          throw new PreviewError('size')
        parts.push({ path: entry.path, data: await extract(entry.path) })
      }
      result = parts
    }
    self.postMessage({ id: request.id, result })
  } catch (error) {
    const passwordError = error instanceof Error && /password|encrypted/i.test(error.message)
    self.postMessage({
      id: request.id,
      error: error instanceof PreviewError ? error.code : passwordError ? 'password' : 'format',
    })
  }
}
