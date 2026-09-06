// The clamd INSTREAM client (`src/lib/storage/clamav.ts`) against a fake clamd on a loopback port:
// proves the wire framing (z-command, 4-byte big-endian length-prefixed chunks, zero-length
// terminator) by reassembling what the fake received and comparing it byte-for-byte with what was
// scanned, and pins every reply shape (OK / FOUND / ERROR) plus the two outage modes (silent daemon,
// nothing listening) to `ScannerUnavailable`.
import { randomBytes } from 'node:crypto'
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createClamdScanner,
  createDisabledScanner,
  parseScanReply,
  ScannerUnavailable,
} from '../../../src/lib/storage/clamav.js'

type FakeClamd = {
  port: number
  received: Buffer[]
  close(): Promise<void>
}

/** `reply` decides what INSTREAM answers; `null` means "hang forever" (a wedged daemon). */
function startFakeClamd(reply: string | null): Promise<FakeClamd> {
  const received: Buffer[] = []
  const server: Server = createServer((socket: Socket) => {
    let buf = Buffer.alloc(0)
    let command: string | null = null
    let body = Buffer.alloc(0)
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      if (command === null) {
        const end = buf.indexOf(0)
        if (end === -1) return
        command = buf.subarray(0, end).toString('utf8')
        buf = buf.subarray(end + 1)
        if (command === 'zPING') {
          socket.end('PONG\0')
          return
        }
      }
      // INSTREAM: <u32be length><bytes>... until a zero-length frame.
      for (;;) {
        if (buf.length < 4) return
        const len = buf.readUInt32BE(0)
        if (len === 0) {
          received.push(body)
          if (reply !== null) socket.end(reply)
          return
        }
        if (buf.length < 4 + len) return
        body = Buffer.concat([body, buf.subarray(4, 4 + len)])
        buf = buf.subarray(4 + len)
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        port,
        received,
        close: () =>
          new Promise((done) => {
            server.close(() => done())
          }),
      })
    })
  })
}

describe('parseScanReply', () => {
  it('maps clamd reply shapes to verdicts', () => {
    expect(parseScanReply('stream: OK')).toEqual({ verdict: 'clean' })
    expect(parseScanReply('stream: Win.Test.EICAR_HDB-1 FOUND')).toEqual({
      verdict: 'infected',
      signature: 'Win.Test.EICAR_HDB-1',
    })
    expect(() => parseScanReply('INSTREAM size limit exceeded. ERROR')).toThrow(ScannerUnavailable)
    expect(() => parseScanReply('')).toThrow(ScannerUnavailable)
  })
})

describe('createClamdScanner', () => {
  let fake: FakeClamd | null = null
  afterEach(async () => {
    await fake?.close()
    fake = null
  })

  it('streams the exact bytes in length-prefixed frames and reads a clean verdict', async () => {
    fake = await startFakeClamd('stream: OK\0')
    const scanner = createClamdScanner({ host: '127.0.0.1', port: fake.port, timeoutMs: 5000 })
    // Larger than one 64 KiB frame, so chunking is exercised, not just the single-frame case.
    const bytes = randomBytes(200 * 1024 + 17)
    await expect(scanner.scan(bytes)).resolves.toEqual({ verdict: 'clean' })
    expect(fake.received).toHaveLength(1)
    expect(fake.received[0]!.equals(bytes)).toBe(true)
  })

  it('reports a FOUND signature as infected', async () => {
    fake = await startFakeClamd('stream: Eicar-Test-Signature FOUND\0')
    const scanner = createClamdScanner({ host: '127.0.0.1', port: fake.port, timeoutMs: 5000 })
    await expect(scanner.scan(Buffer.from('x'))).resolves.toEqual({
      verdict: 'infected',
      signature: 'Eicar-Test-Signature',
    })
  })

  it('turns a clamd ERROR reply into ScannerUnavailable (never a clean verdict)', async () => {
    fake = await startFakeClamd('INSTREAM size limit exceeded. ERROR\0')
    const scanner = createClamdScanner({ host: '127.0.0.1', port: fake.port, timeoutMs: 5000 })
    await expect(scanner.scan(Buffer.from('x'))).rejects.toBeInstanceOf(ScannerUnavailable)
  })

  it('times out a daemon that never answers (H8.1)', async () => {
    fake = await startFakeClamd(null)
    const scanner = createClamdScanner({ host: '127.0.0.1', port: fake.port, timeoutMs: 200 })
    await expect(scanner.scan(Buffer.from('x'))).rejects.toThrow(/did not answer within 200ms/)
  })

  it('reports nothing-listening as ScannerUnavailable and ping() as false', async () => {
    const probe = await startFakeClamd('stream: OK\0')
    const freePort = probe.port
    await probe.close()
    const scanner = createClamdScanner({ host: '127.0.0.1', port: freePort, timeoutMs: 2000 })
    await expect(scanner.scan(Buffer.from('x'))).rejects.toBeInstanceOf(ScannerUnavailable)
    await expect(scanner.ping()).resolves.toBe(false)
  })

  it('ping() is true for a daemon that answers PONG', async () => {
    fake = await startFakeClamd('stream: OK\0')
    const scanner = createClamdScanner({ host: '127.0.0.1', port: fake.port, timeoutMs: 2000 })
    await expect(scanner.ping()).resolves.toBe(true)
  })
})

describe('createDisabledScanner', () => {
  it('never claims a file is clean -- it says the scan was skipped', async () => {
    const scanner = createDisabledScanner()
    expect(scanner.mode).toBe('off')
    await expect(scanner.scan(Buffer.from('x'))).resolves.toEqual({
      verdict: 'skipped',
      reason: 'disabled',
    })
  })
})
