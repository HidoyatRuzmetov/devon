// `users.avatar_key` -> the URL of a served variant (EPIC-001 photo upload). The key is an opaque
// prefix the server chose (`avatars/<userId>/<uploadId>`); the API serves its WebP variants at
// `GET /api/v1/accounts/avatar/:userId/:uploadId/:size` to any signed-in user, immutable-cacheable
// (a new photo is always a new upload id, so a new URL). Every feature that renders a person's
// `<Avatar>` passes `src={avatarUrl(user.avatarKey, size)}` and keeps its initials fallback -- a
// `null` key, an unparseable key, or a 404 all fall back to initials exactly as before.
export type AvatarSize = 64 | 128 | 512

const AVATAR_KEY_RE = /^avatars\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/i

export function avatarUrl(
  avatarKey: string | null | undefined,
  size: AvatarSize = 128,
): string | null {
  if (!avatarKey) return null
  const match = AVATAR_KEY_RE.exec(avatarKey)
  if (!match) return null
  return `/api/v1/accounts/avatar/${match[1]}/${match[2]}/${size}`
}
