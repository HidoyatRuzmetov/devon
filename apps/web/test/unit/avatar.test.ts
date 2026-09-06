// `avatarUrl()` (the one place an `avatar_key` becomes a URL) and `avatarErrorKey()` (the one place an
// upload failure becomes a message key) -- both pure, both the seams every screen relies on.
import { describe, expect, it } from 'vitest'
import { ApiError, NetworkError } from '../../src/lib/api-client.js'
import { avatarUrl } from '../../src/lib/avatar.js'
import { avatarErrorKey, AvatarValidationError } from '../../src/features/accounts/api.js'

const USER = '11111111-1111-4111-8111-111111111111'
const UPLOAD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('avatarUrl', () => {
  it('turns a server avatar key into the served variant URL', () => {
    expect(avatarUrl(`avatars/${USER}/${UPLOAD}`, 64)).toBe(
      `/api/v1/accounts/avatar/${USER}/${UPLOAD}/64`,
    )
    expect(avatarUrl(`avatars/${USER}/${UPLOAD}`)).toBe(
      `/api/v1/accounts/avatar/${USER}/${UPLOAD}/128`,
    )
  })

  it('falls back to null (initials) for a missing or malformed key', () => {
    expect(avatarUrl(null)).toBeNull()
    expect(avatarUrl(undefined)).toBeNull()
    expect(avatarUrl('')).toBeNull()
    expect(avatarUrl('avatars/not-a-uuid/x')).toBeNull()
    expect(avatarUrl(`../${USER}/${UPLOAD}`)).toBeNull()
    expect(avatarUrl(`avatars/${USER}/${UPLOAD}/64.webp`)).toBeNull()
  })
})

describe('avatarErrorKey', () => {
  it('maps the client-side pre-checks', () => {
    expect(avatarErrorKey(new AvatarValidationError('type'))).toBe('accounts.photo.error.type')
    expect(avatarErrorKey(new AvatarValidationError('empty'))).toBe('accounts.photo.error.type')
    expect(avatarErrorKey(new AvatarValidationError('tooLarge'))).toBe(
      'accounts.photo.error.tooLarge',
    )
  })

  it('maps the server verdicts by Problem code and status', () => {
    expect(
      avatarErrorKey(
        new ApiError(422, 'validation_failed', null, [{ path: 'file', code: 'infected' }]),
      ),
    ).toBe('accounts.photo.error.infected')
    expect(
      avatarErrorKey(
        new ApiError(422, 'validation_failed', null, [{ path: 'file', code: 'not_an_image' }]),
      ),
    ).toBe('accounts.photo.error.invalidImage')
    expect(
      avatarErrorKey(
        new ApiError(422, 'validation_failed', null, [{ path: 'size', code: 'too_large' }]),
      ),
    ).toBe('accounts.photo.error.tooLarge')
    expect(avatarErrorKey(new ApiError(413, 'validation_failed', null))).toBe(
      'accounts.photo.error.tooLarge',
    )
    expect(avatarErrorKey(new ApiError(503, 'maintenance', null))).toBe(
      'accounts.photo.error.unavailable',
    )
  })

  it('falls back to the generic message for anything else', () => {
    expect(avatarErrorKey(new ApiError(409, 'conflict', null))).toBe('accounts.photo.error.generic')
    expect(avatarErrorKey(new NetworkError(new Error('offline')))).toBe(
      'accounts.photo.error.generic',
    )
    expect(avatarErrorKey(new Error('?'))).toBe('accounts.photo.error.generic')
  })
})
