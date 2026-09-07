// The local-disk driver and the key/token rules every driver shares (`src/lib/storage/*`): the key
// grammar (H1.8 "random storage keys, no user filenames"), path-traversal refusal, token binding
// (key + method + user + expiry, tamper-evident), and the byte-level contract (atomic put, head with
// content type, bounded get, idempotent remove).
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createLocalStore } from '../../../src/lib/storage/local-store.js'
import {
  assertObjectKey,
  avatarKeyPrefix,
  avatarOriginalKey,
  avatarVariantKey,
  InvalidObjectKey,
  isValidObjectKey,
  ObjectTooLarge,
} from '../../../src/lib/storage/object-store.js'
import { deriveSigningKey, signToken, verifyToken } from '../../../src/lib/storage/signed-token.js'

const dir = mkdtempSync(join(tmpdir(), 'devon-local-store-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const store = createLocalStore({
  dir,
  signingSecret: 'test-signing-secret-example',
  urlPrefix: '/api/v1/storage',
})

describe('object key grammar', () => {
  it('accepts the keys this codebase generates', () => {
    const prefix = avatarKeyPrefix(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    )
    expect(isValidObjectKey(prefix)).toBe(true)
    expect(isValidObjectKey(avatarVariantKey(prefix, 64))).toBe(true)
    expect(isValidObjectKey(avatarOriginalKey('u', 'x'))).toBe(true)
  })

  it('refuses traversal, absolute paths, empty segments, uppercase and user-filename shapes', () => {
    for (const bad of [
      '',
      '/avatars/x',
      'avatars//x',
      'avatars/../etc/passwd',
      'a..b/c',
      '..',
      'Avatars/x',
      'my photo.png',
      'avatars/x/',
      'a\\b',
      'x'.repeat(513),
    ]) {
      expect(isValidObjectKey(bad), bad).toBe(false)
      expect(() => assertObjectKey(bad)).toThrow(InvalidObjectKey)
    }
  })

  it('pathFor never resolves outside the store directory', () => {
    expect(store.pathFor('avatars/a/b').startsWith(dir)).toBe(true)
    expect(() => store.pathFor('../outside')).toThrow(InvalidObjectKey)
    expect(() => store.pathFor('avatars/../../outside')).toThrow(InvalidObjectKey)
  })
})

describe('signed tokens', () => {
  const key = deriveSigningKey('secret-a')

  it('round-trips a payload and binds it to the signing secret', () => {
    const payload = {
      key: 'avatars/u/x/original',
      userId: 'u',
      method: 'PUT' as const,
      contentType: 'image/png',
      exp: Date.now() + 60_000,
    }
    const token = signToken(payload, key)
    expect(verifyToken(token, key)).toEqual(payload)
    expect(verifyToken(token, deriveSigningKey('secret-b'))).toBeNull()
  })

  it('rejects an expired, tampered or malformed token', () => {
    const expired = signToken(
      { key: 'k', userId: 'u', method: 'GET', contentType: null, exp: Date.now() - 1 },
      key,
    )
    expect(verifyToken(expired, key)).toBeNull()

    const good = signToken(
      { key: 'k', userId: 'u', method: 'GET', contentType: null, exp: Date.now() + 60_000 },
      key,
    )
    const [encoded, sig] = good.split('.') as [string, string]
    // Flip the payload but keep the signature.
    const otherPayload = Buffer.from(
      JSON.stringify({
        key: 'k',
        userId: 'attacker',
        method: 'GET',
        contentType: null,
        exp: Date.now() + 60_000,
      }),
    ).toString('base64url')
    expect(verifyToken(`${otherPayload}.${sig}`, key)).toBeNull()
    // Flip the signature but keep the payload.
    expect(
      verifyToken(`${encoded}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`, key),
    ).toBeNull()
    expect(verifyToken('not-a-token', key)).toBeNull()
    expect(verifyToken('', key)).toBeNull()
  })

  it('the derived signing key never equals the raw secret', () => {
    expect(deriveSigningKey('secret-a').toString('utf8')).not.toBe('secret-a')
    expect(deriveSigningKey('secret-a').equals(deriveSigningKey('secret-a'))).toBe(true)
  })
})

describe('local store objects', () => {
  it('presignPut yields a same-origin PUT whose token the store itself verifies', async () => {
    const presigned = await store.presignPut('avatars/u/x/original', {
      contentType: 'image/png',
      expiresInSeconds: 60,
      userId: 'u',
    })
    expect(presigned.method).toBe('PUT')
    expect(presigned.headers).toEqual({ 'content-type': 'image/png' })
    const token = new URL(presigned.url, 'http://localhost').searchParams.get('token')!
    expect(store.verifyToken(token)).toMatchObject({
      key: 'avatars/u/x/original',
      userId: 'u',
      method: 'PUT',
      contentType: 'image/png',
    })
    expect(presigned.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('presignGet yields a GET token, never usable for a PUT', async () => {
    const url = await store.presignGet('avatars/u/x/64.webp', {
      expiresInSeconds: 300,
      userId: 'u',
    })
    const token = new URL(url, 'http://localhost').searchParams.get('token')!
    expect(store.verifyToken(token)?.method).toBe('GET')
  })

  it('put / head / get / remove, with the content type preserved and remove idempotent', async () => {
    const key = 'avatars/u/y/64.webp'
    expect(await store.head(key)).toBeNull()
    expect(await store.get(key, { maxBytes: 1000 })).toBeNull()

    await store.put(key, Buffer.from('RIFF....WEBP'), 'image/webp')
    expect(await store.head(key)).toEqual({ size: 12, contentType: 'image/webp' })
    expect((await store.get(key, { maxBytes: 1000 }))?.toString('utf8')).toBe('RIFF....WEBP')
    expect(existsSync(store.pathFor(key))).toBe(true)

    await store.remove([key])
    expect(await store.head(key)).toBeNull()
    await expect(store.remove([key, 'avatars/never/existed'])).resolves.toBeUndefined()
  })

  it('get() refuses an object past maxBytes before reading it', async () => {
    const key = 'avatars/u/z/original'
    await store.put(key, Buffer.alloc(2048), 'image/png')
    await expect(store.get(key, { maxBytes: 1024 })).rejects.toBeInstanceOf(ObjectTooLarge)
    await store.remove([key])
  })

  it('ping() creates the directory and reports true', async () => {
    await expect(store.ping()).resolves.toBe(true)
  })
})
