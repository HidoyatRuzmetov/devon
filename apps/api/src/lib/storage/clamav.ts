// ClamAV client (TECH-SPEC §6: "ClamAV before visibility"; H1.8). Speaks clamd's INSTREAM protocol
// over TCP directly with `node:net` -- ~60 lines, no dependency, no shelling out to `clamdscan`, and no
// shared filesystem between the API and the scanner (the `clamav` Compose profile only exposes port
// 3310). Every scan is bounded by `timeoutMs` (H8.1) and every failure mode is `ScannerUnavailable`,
// which the upload pipeline treats as "not clean": the object is deleted and the upload fails closed.
//
// `CLAMAV_MODE=off` (`createDisabledScanner`) exists for developer machines that run no clamd at all.
// It is refused outright in production by `config.ts`, and `plugins/storage.ts` logs a warning at boot
// whenever it is active -- an unscanned upload path is never silent.
import { createConnection, type Socket } from 'node:net'

export type ScanVerdict =
  | { verdict: 'clean' }
  | { verdict: 'infected'; signature: string }
  | { verdict: 'skipped'; reason: 'disabled' }

export interface MalwareScanner {
  readonly mode: 'clamd' | 'off'
  /** Throws `ScannerUnavailable` when no verdict could be obtained (down, timeout, protocol error). */
  scan(bytes: Buffer): Promise<ScanVerdict>
  /** `true` iff clamd answered PING with PONG (always `true` for the disabled scanner). Never throws. */
  ping(): Promise<boolean>
}

export class ScannerUnavailable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ScannerUnavailable'
  }
}

export type ClamdOptions = { host: string; port: number; timeoutMs: number }

/** clamd's INSTREAM chunk size limit is generous (its `StreamMaxLength`, 25 MB by default); 64 KiB
 * frames keep each write small and predictable. */
const CHUNK = 64 * 1024

/** One request/response exchange with clamd using the null-terminated ("z") command framing, so the
 * reply is unambiguously delimited by `\0` rather than by a newline that a signature name could
 * theoretically contain. `body`, when given, is streamed as INSTREAM frames after the command. */
function exchange(options: ClamdOptions, command: string, body?: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const socket: Socket = createConnection({ host: options.host, port: options.port })
    const fail = (err: Error) => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(err)
    }
    const timer = setTimeout(
      () => fail(new ScannerUnavailable(`clamd did not answer within ${options.timeoutMs}ms`)),
      options.timeoutMs,
    )
    const chunks: Buffer[] = []

    socket.on('error', (err) =>
      fail(new ScannerUnavailable('clamd connection failed', { cause: err })),
    )
    socket.on('connect', () => {
      socket.write(`z${command}\0`)
      if (body) {
        for (let offset = 0; offset < body.length; offset += CHUNK) {
          const frame = body.subarray(offset, Math.min(offset + CHUNK, body.length))
          const header = Buffer.alloc(4)
          header.writeUInt32BE(frame.length, 0)
          socket.write(header)
          socket.write(frame)
        }
        socket.write(Buffer.alloc(4)) // zero-length frame terminates INSTREAM
      }
    })
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      const joined = Buffer.concat(chunks)
      const end = joined.indexOf(0)
      if (end !== -1) {
        clearTimeout(timer)
        if (!settled) {
          settled = true
          socket.end()
          resolve(joined.subarray(0, end).toString('utf8'))
        }
      }
    })
    socket.on('close', () => {
      clearTimeout(timer)
      if (!settled) {
        const joined = Buffer.concat(chunks).toString('utf8').replace(/\0+$/, '')
        settled = true
        if (joined.length > 0) resolve(joined)
        else reject(new ScannerUnavailable('clamd closed the connection without a reply'))
      }
    })
  })
}

/** `stream: OK` / `stream: Win.Test.EICAR_HDB-1 FOUND` / `... ERROR` -- clamd's three reply shapes. */
export function parseScanReply(reply: string): ScanVerdict {
  const text = reply.trim()
  if (/\bOK$/.test(text)) return { verdict: 'clean' }
  const found = /^(?:stream|[^:]*):\s*(.+?)\s+FOUND$/.exec(text)
  if (found?.[1]) return { verdict: 'infected', signature: found[1] }
  throw new ScannerUnavailable(`clamd replied with an error: ${text.slice(0, 120)}`)
}

export function createClamdScanner(options: ClamdOptions): MalwareScanner {
  return {
    mode: 'clamd',
    async scan(bytes) {
      const reply = await exchange(options, 'INSTREAM', bytes)
      return parseScanReply(reply)
    },
    async ping() {
      try {
        return (await exchange(options, 'PING')).trim() === 'PONG'
      } catch {
        return false
      }
    },
  }
}

export function createDisabledScanner(): MalwareScanner {
  return {
    mode: 'off',
    async scan() {
      return { verdict: 'skipped', reason: 'disabled' }
    },
    async ping() {
      return true
    },
  }
}
