import { PreviewError, type PreviewErrorCode, type ArchiveEntry } from './file-types.js'

export type DocumentPart = { path: string; data: Uint8Array<ArrayBuffer> }
export class ArchiveClient {
  private worker = new Worker(new URL('./archive.worker.ts', import.meta.url), { type: 'module' })
  private id = 0
  private stopped = false
  private pending = new Map<
    number,
    {
      resolve(value: unknown): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  constructor() {
    this.worker.onmessage = (
      event: MessageEvent<{ id: number; result?: unknown; error?: PreviewErrorCode }>,
    ) => {
      const item = this.pending.get(event.data.id)
      if (!item) return
      clearTimeout(item.timer)
      this.pending.delete(event.data.id)
      if (event.data.error) item.reject(new PreviewError(event.data.error))
      else item.resolve(event.data.result)
    }
    this.worker.onerror = () => this.close(new PreviewError('format'))
  }
  private request<T>(request: object): Promise<T> {
    if (this.stopped) return Promise.reject(new PreviewError('load'))
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(new PreviewError('timeout')), 20_000)
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      this.worker.postMessage({ ...request, id })
    })
  }
  open(name: string, data: ArrayBuffer, password = '') {
    return this.request<ArchiveEntry[]>({ action: 'open', name, data, password })
  }
  extract(path: string, password = '') {
    return this.request<Uint8Array<ArrayBuffer>>({ action: 'extract', path, password })
  }
  parts() {
    return this.request<DocumentPart[]>({ action: 'parts' })
  }
  close(error: Error = new DOMException('Cancelled', 'AbortError')) {
    this.stopped = true
    this.worker.terminate()
    for (const item of this.pending.values()) {
      clearTimeout(item.timer)
      item.reject(error)
    }
    this.pending.clear()
  }
}
