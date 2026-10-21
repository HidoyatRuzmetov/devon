import type { FastifyReply, FastifyRequest } from 'fastify'
import { sendProblem } from '../problem-reply.js'

/** API containers have 4 GiB. Leave half for the application, scanner transport and other work.
 * Charge two copies: raw-body parsing can retain its chunks while concatenating the final Buffer.
 * A single approved 1 GiB file still fits; concurrent routes share this same allowance. */
export const BUFFERED_TRANSFER_CAPACITY = 2 * 1024 * 1024 * 1024

export class BufferedTransferBudget {
  private used = 0
  constructor(readonly capacity = BUFFERED_TRANSFER_CAPACITY) {}
  get usedBytes() {
    return this.used
  }
  acquire(fileBytes: number): (() => void) | null {
    if (!Number.isSafeInteger(fileBytes) || fileBytes < 0) return null
    const weight = 2 * Math.max(fileBytes, 1)
    if (weight > this.capacity - this.used) return null
    this.used += weight
    let released = false
    return () => {
      if (released) return
      released = true
      this.used -= weight
    }
  }
}

type Transfer = { retain: () => (() => void) | null }
const transfers = new WeakMap<FastifyRequest, Transfer>()

/** Hold capacity through response delivery AND any asynchronous storage/scan still using bytes.
 * A disconnected client must not release the reservation while an in-flight scan/read continues. */
export function reserveBufferedTransfer(
  request: FastifyRequest,
  reply: FastifyReply,
  budget: BufferedTransferBudget,
  fileBytes: number,
): Transfer | null {
  if (request.raw.aborted || reply.raw.destroyed) return null
  const release = budget.acquire(fileBytes)
  if (!release) {
    reply.header('retry-after', '5')
    sendProblem(reply, 'maintenance')
    return null
  }
  let responseDone = false
  let retained = 0
  const releaseIfDone = () => {
    if (!responseDone || retained !== 0) return
    transfers.delete(request)
    request.raw.off('aborted', responseEnded)
    reply.raw.off('finish', responseEnded)
    reply.raw.off('close', responseEnded)
    release()
  }
  const responseEnded = () => {
    responseDone = true
    releaseIfDone()
  }
  const transfer: Transfer = {
    retain() {
      if (responseDone) return null
      retained += 1
      let ended = false
      return () => {
        if (ended) return
        ended = true
        retained -= 1
        releaseIfDone()
      }
    },
  }
  transfers.set(request, transfer)
  request.raw.once('aborted', responseEnded)
  reply.raw.once('finish', responseEnded)
  reply.raw.once('close', responseEnded)
  return transfer
}

export function retainBufferedTransfer(request: FastifyRequest) {
  return transfers.get(request)?.retain() ?? null
}
