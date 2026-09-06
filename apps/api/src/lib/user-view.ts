// Shared "public tier" projection of a `UserRecord` (design.md §3.2: `public`+`internal` fields only --
// no `email` (restricted), never `passwordHash` (secret)). Used by `POST /setup/{token}`'s 201 body and
// by `/me`'s `user` field, which are the two response shapes that need it in this item.
import { asLocale } from '../schemas.js'
import type { UserRecord } from '../types.js'

export function toPublicUser(user: UserRecord) {
  return {
    id: user.id,
    login: user.login,
    givenName: user.givenName,
    familyName: user.familyName,
    patronymic: user.patronymic,
    title: user.title,
    avatarKey: user.avatarKey,
    locale: asLocale(user.locale),
    timezone: user.timezone,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  }
}
