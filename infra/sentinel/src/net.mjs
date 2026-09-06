// Peer-address check, independent of the bind itself (design.md §1.9, ADR-011, risk (m)). Node's
// http server bound to the IPv4 loopback address will report a plain '127.0.0.1' remoteAddress, but
// this also accepts the IPv6 forms so the same check is correct if the bind strategy ever changes.
const V4_LOOPBACK = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

export function isLoopbackAddress(address) {
  if (typeof address !== 'string' || address.length === 0) return false
  const a = address.trim()
  if (a === '::1') return true
  const v4 = a.startsWith('::ffff:') ? a.slice(7) : a
  const m = v4.match(V4_LOOPBACK)
  if (!m) return false
  const octets = m.slice(1, 5).map(Number)
  if (octets.some((n) => n < 0 || n > 255)) return false
  // The whole 127.0.0.0/8 range is loopback, not just 127.0.0.1 (RFC 1122 §3.2.1.3).
  return octets[0] === 127
}
