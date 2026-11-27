import { createHash } from 'node:crypto'
import { z } from 'zod'
import { ZipReader, Uint8ArrayReader } from '@zip.js/zip.js'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import {
  BufferedTransferBudget,
  reserveBufferedTransfer,
  retainBufferedTransfer,
} from '../../lib/storage/buffer-budget.js'

const LIMIT = 32 * 1024 * 1024
const params = z.object({
  id: z.string().uuid(),
  attachmentId: z.string().uuid(),
})
const body = z
  .object({
    name: z
      .string()
      .min(1)
      .max(180)
      .regex(
        // eslint-disable-next-line no-control-regex -- Reject control characters in uploaded filenames.
        /^[^\\/\u0000-\u001f]+\.(?:docx|dotx|doc|rtf|odt|ott|pptx|ppsx|potx|ppt|odp|xlsx|xltx|xls|ods)$/i,
      ),
    data: z
      .string()
      .min(4)
      .max(Math.ceil(LIMIT / 3) * 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict()
type Authorize = (request: FastifyRequest, reply: FastifyReply) => Promise<boolean>

export async function validateOfficePackage(bytes: Buffer) {
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    useWebWorkers: false,
  })
  const seen = new Set<string>()
  let size = 0
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      const path = entry.filename.replaceAll('\\', '/')
      if (
        seen.size >= 1500 ||
        seen.has(path) ||
        path.startsWith('/') ||
        path.includes(':') ||
        path.split('/').some((part) => part === '..') ||
        entry.encrypted ||
        /vbaProject|vbaData|embeddings\//i.test(path)
      )
        throw new Error('Unsafe Office package')
      seen.add(path)
      size += entry.uncompressedSize
      if (
        !Number.isSafeInteger(size) ||
        size > 80 * 1024 * 1024 ||
        size > Math.max(1024 * 1024, bytes.length * 250)
      )
        throw new Error('Office package too large')
    }
    if (!seen.has('[Content_Types].xml') && !seen.has('mimetype'))
      throw new Error('Invalid Office package')
  } finally {
    await reader.close()
  }
}

// The response header, not uploaded markup, owns this boundary. The frame has an opaque origin.
export const HTML_PREVIEW_CSP =
  "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
export const HTML_PREVIEW_SHELL = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HTML preview</title></head><body><script>
(() => {
  const receive = event => {
    if (event.source !== parent || event.data?.type !== 'workportal:file-html' || typeof event.data.html !== 'string' || event.data.html.length > 2097152) return;
    removeEventListener('message', receive);
    // Parse only inside the isolated frame: parser-initiated requests also obey its CSP.
    const doc = new DOMParser().parseFromString(event.data.html, 'text/html');
    doc.querySelectorAll('base,meta[http-equiv="refresh" i],iframe,object,embed').forEach(node => node.remove());
    if (!doc.querySelector('meta[name="viewport"]')) {
      const viewport = doc.createElement('meta'); viewport.name = 'viewport'; viewport.content = 'width=device-width,initial-scale=1'; doc.head.append(viewport);
    }
    for (const link of doc.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href') || '';
      if (href.startsWith('#')) continue;
      if (/^https?:\\/\\//i.test(href)) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      else link.removeAttribute('href');
    }
    document.open(); document.write('<!doctype html>' + doc.documentElement.outerHTML); document.close();
  };
  addEventListener('message', receive);
  parent.postMessage({type:'workportal:file-html-ready'}, '*');
})();
</script></body></html>`

/** Office conversion stays on the private Docker network; no public document-hosting service. */
export async function renderOffice(url: string, name: string, bytes: Buffer, signal: AbortSignal) {
  const form = new FormData()
  form.append('files', new Blob([new Uint8Array(bytes)]), name)
  form.append('nativeBookmarks', 'true')
  form.append('exportFormFields', 'false')
  const response = await fetch(new URL('/forms/libreoffice/convert', url), {
    method: 'POST',
    body: form,
    redirect: 'error',
    signal,
  })
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > LIMIT) {
    await response.body?.cancel()
    throw new Error('preview_conversion_failed')
  }
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  try {
    for (;;) {
      // nosemgrep: query-in-loop -- Bound each conversion response chunk before requesting more data from the stream.
      const item = await reader.read()
      if (item.done) break
      size += item.value.length
      if (size > LIMIT) throw new Error('preview_too_large')
      chunks.push(Buffer.from(item.value))
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  const pdf = Buffer.concat(chunks)
  if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('preview_not_pdf')
  return pdf
}

export function registerFilePreviews(
  app: Parameters<FastifyPluginAsyncZod>[0],
  authorize: Authorize,
) {
  const permission = {
    action: 'read' as const,
    subject: (req: FastifyRequest) => ({
      kind: 'department_child' as const,
      departmentId: req.actor?.departmentId ?? '',
    }),
  }
  const prefix = '/pages/:id/attachments/:attachmentId/preview'
  app.get(`${prefix}/html`, { config: { permission }, schema: { params } }, async (req, reply) => {
    if (!(await authorize(req, reply))) return
    return reply
      .type('text/html; charset=utf-8')
      .header('content-security-policy', HTML_PREVIEW_CSP)
      .header('x-frame-options', 'SAMEORIGIN')
      .header('cache-control', 'private, no-store')
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff')
      .send(HTML_PREVIEW_SHELL)
  })
  const budget = new BufferedTransferBudget(192 * 1024 * 1024)
  const cache = new Map<string, { bytes: Buffer; until: number }>()
  let converting = false
  let cachedBytes = 0
  const prune = () => {
    for (const [key, value] of cache) {
      if (value.until < Date.now() || cachedBytes > 64 * 1024 * 1024 || cache.size > 12) {
        cachedBytes -= value.bytes.length
        cache.delete(key)
      }
    }
  }
  app.post(
    `${prefix}/office`,
    {
      bodyLimit: 45 * 1024 * 1024,
      config: { permission, rateLimit: { max: 12, timeWindow: '1 minute' } },
      schema: { params, body },
      preParsing: async (req, reply, payload) => {
        reserveBufferedTransfer(req, reply, budget, 80 * 1024 * 1024)
        return payload
      },
    },
    async (req, reply) => {
      const release = retainBufferedTransfer(req)
      if (!release) return reply
      let ownsSlot = false
      try {
        if (!checkCsrf(req, reply) || !(await authorize(req, reply))) return
        if (!app.devonConfig.DOCUMENT_PREVIEW_URL) return sendProblem(reply, 'maintenance')
        const bytes = Buffer.from(req.body.data, 'base64')
        if (!bytes.length || bytes.length > LIMIT || bytes.toString('base64') !== req.body.data)
          return sendProblem(reply, 'validation_failed')
        const ext = req.body.name.split('.').at(-1)!.toLowerCase()
        const zip = [
          'docx',
          'dotx',
          'odt',
          'ott',
          'pptx',
          'ppsx',
          'potx',
          'odp',
          'xlsx',
          'xltx',
          'ods',
        ].includes(ext)
        const signature = bytes.subarray(0, 4).toString('hex')
        if (
          (zip && signature !== '504b0304') ||
          (['doc', 'ppt', 'xls'].includes(ext) && signature !== 'd0cf11e0') ||
          (ext === 'rtf' && !bytes.subarray(0, 5).toString().startsWith('{\\rtf'))
        )
          return sendProblem(reply, 'validation_failed')
        const key = createHash('sha256')
          .update(req.actor!.departmentId!)
          .update(req.params.attachmentId)
          .update(req.body.name)
          .update(bytes)
          .digest('hex')
        prune()
        const cached = cache.get(key)
        if (cached)
          return reply
            .type('application/pdf')
            .header('cache-control', 'private, no-store')
            .send(cached.bytes)
        if (converting) {
          reply.header('retry-after', '3')
          return sendProblem(reply, 'maintenance')
        }
        converting = true
        ownsSlot = true
        if (zip) await validateOfficePackage(bytes)
        // Extracted archive members are scanned again; the browser never vouches for their content.
        const verdict = await app.storage.scanner.scan(bytes)
        if (
          verdict.verdict !== 'clean' &&
          !(
            verdict.verdict === 'skipped' &&
            app.devonConfig.NODE_ENV !== 'production' &&
            app.storage.scanner.mode === 'off'
          )
        )
          return sendProblem(reply, 'validation_failed')
        const controller = new AbortController()
        const abort = () => controller.abort()
        const timeout = setTimeout(abort, 50_000)
        reply.raw.once('close', abort)
        try {
          const pdf = await renderOffice(
            app.devonConfig.DOCUMENT_PREVIEW_URL,
            req.body.name,
            bytes,
            controller.signal,
          )
          cache.set(key, { bytes: pdf, until: Date.now() + 5 * 60_000 })
          cachedBytes += pdf.length
          prune()
          return reply
            .type('application/pdf')
            .header('cache-control', 'private, no-store')
            .header('x-content-type-options', 'nosniff')
            .send(pdf)
        } finally {
          clearTimeout(timeout)
          reply.raw.off('close', abort)
        }
      } catch {
        return sendProblem(reply, 'maintenance')
      } finally {
        if (ownsSlot) converting = false
        release()
      }
    },
  )
  app.addHook('onClose', async () => {
    cache.clear()
    cachedBytes = 0
  })
}
