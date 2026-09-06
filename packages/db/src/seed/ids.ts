// Deterministic ids for the demo dataset (item handoff, ADR-013). `on conflict do nothing` only gives
// exact idempotence if the *same* logical row always maps to the *same* primary key across runs --
// that is the one job of this file.
import { createHash } from 'node:crypto'

/**
 * Fixed namespace for every id this seed ever writes. A one-time constant, not a knob: changing it
 * would silently orphan every previously-seeded demo row (`seed:reset --demo` matches ids inside this
 * namespace, so a new namespace makes old demo rows unreachable and unreset-able).
 */
export const DEMO_NAMESPACE = '9b1f7f9e-2c8a-4b7e-9f9a-2b6a7e0c9f3a'

function namespaceBytes(namespace: string): Buffer {
  const hex = namespace.replace(/-/g, '')
  if (!/^[0-9a-f]{32}$/i.test(hex)) {
    throw new Error(`ids: "${namespace}" is not a UUID`)
  }
  return Buffer.from(hex, 'hex')
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}

/**
 * RFC 4122 §4.3 UUIDv5 (namespace + name, SHA-1). Pure and deterministic: the same `name` under the
 * same `namespace` always yields the same id, on any machine, forever -- that is what lets a second
 * `seed:demo` run recognise its own rows via `on conflict do nothing` instead of duplicating them.
 */
export function uuidv5(name: string, namespace: string = DEMO_NAMESPACE): string {
  const digest = createHash('sha1')
    .update(namespaceBytes(namespace))
    .update(Buffer.from(name, 'utf8'))
    .digest()
  const bytes = digest.subarray(0, 16)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50 // version 5
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80 // RFC 4122 variant
  return bytesToUuid(bytes)
}

/** Every deterministic id the demo seed writes is named through this helper, so a reviewer can grep
 * `demoId('user.head')` in `fixtures.ts` and know exactly which row it is without a lookup table. */
export function demoId(name: string): string {
  return uuidv5(`devon.demo.${name}`)
}
