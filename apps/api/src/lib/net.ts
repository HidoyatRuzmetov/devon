// Shared loopback check. Mirrors `modules/setup/index.ts`'s own `isLoopbackPeer` byte-for-byte (that
// file predates this one and is left untouched rather than refactored to import this -- MODULE-GUIDE.md
// "a module never edits a file another module also touches" -- but `/metrics` (`modules/metrics.ts`)
// needs the identical check and this is a new file, not an existing one, so it gets its own copy here
// instead of a third inline duplicate).
import type { FastifyRequest } from 'fastify'

/** Checks the real TCP peer, never `X-Forwarded-For` -- `app.ts` sets `trustProxy: true` for
 * client-ip logging elsewhere, but a security gate must not trust a header an attacker controls when
 * there is no real reverse proxy stripping it (design.md §4(m) makes the identical point about the
 * sentinel and the setup token route). */
export function isLoopbackPeer(req: FastifyRequest): boolean {
  const addr = req.socket.remoteAddress ?? ''
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}
