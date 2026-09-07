// Cross-package interop proof: a command this module signs (`sentinel-protocol.ts`) must actually
// verify against `infra/sentinel/src`'s own, independently-implemented verifier -- the two sides are
// deliberately duplicated code (that file's header explains why), so nothing else proves they still
// agree on the wire format except a test that runs both. `infra/sentinel` is not a pnpm workspace
// package (its own package.json says so) but a relative-path import across the repo works exactly
// like any other ESM import; no `@devon/*` package resolution is involved.
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  generateSentinelKeypair,
  buildSignedWipeCommand,
} from '../../src/modules/admin/sentinel-protocol.js'
// infra/sentinel ships plain, dependency-free JS with no .d.ts of its own (ADR-011: "dependency-free
// by design") -- these two imports are real at runtime (Node ESM resolves a relative path across the
// repo with no package-boundary restriction) but untyped by nature, not by omission.
// @ts-expect-error no type declarations for this plain-JS, non-workspace package
import { publicKeyFromRaw, verifySignature } from '../../../../infra/sentinel/src/keys.mjs'
// @ts-expect-error no type declarations for this plain-JS, non-workspace package
import { canonicalJson as sentinelCanonicalJson } from '../../../../infra/sentinel/src/canonical.mjs'

describe('sentinel-protocol.ts <-> infra/sentinel/src interop', () => {
  it('a command signed here verifies against the sentinel’s own verifier', () => {
    const { publicKeyB64, privateKeyB64 } = generateSentinelKeypair()
    const nonce = randomBytes(32).toString('hex')
    const command = buildSignedWipeCommand(publicKeyB64, privateKeyB64, nonce)

    expect(command.v).toBe(1)
    expect(command.command).toBe('wipe')
    expect(command.nonce).toMatch(/^[0-9a-f]{64}$/)

    const sentinelPublicKey = publicKeyFromRaw(publicKeyB64)
    const message = sentinelCanonicalJson({
      v: command.v,
      command: command.command,
      nonce: command.nonce,
      issued_at: command.issued_at,
    })
    expect(verifySignature(sentinelPublicKey, message, command.sig)).toBe(true)
  })

  it('a tampered field after signing fails the sentinel’s verifier (as it must)', () => {
    const { publicKeyB64, privateKeyB64 } = generateSentinelKeypair()
    const nonce = randomBytes(32).toString('hex')
    const command = buildSignedWipeCommand(publicKeyB64, privateKeyB64, nonce)

    const sentinelPublicKey = publicKeyFromRaw(publicKeyB64)
    const tamperedMessage = sentinelCanonicalJson({
      v: command.v,
      command: 'noop', // an attacker downgrading the command after the fact
      nonce: command.nonce,
      issued_at: command.issued_at,
    })
    expect(verifySignature(sentinelPublicKey, tamperedMessage, command.sig)).toBe(false)
  })

  it('a signature from an unrelated keypair does not verify (wrong-key break attempt)', () => {
    const keyA = generateSentinelKeypair()
    const keyB = generateSentinelKeypair()
    const nonce = randomBytes(32).toString('hex')
    const command = buildSignedWipeCommand(keyA.publicKeyB64, keyA.privateKeyB64, nonce)

    const wrongPublicKey = publicKeyFromRaw(keyB.publicKeyB64)
    const message = sentinelCanonicalJson({
      v: command.v,
      command: command.command,
      nonce: command.nonce,
      issued_at: command.issued_at,
    })
    expect(verifySignature(wrongPublicKey, message, command.sig)).toBe(false)
  })
})
