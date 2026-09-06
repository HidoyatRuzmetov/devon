import { randomUUID } from 'node:crypto'
import { hashPassword } from '../../src/lib/password.js'
import type { FakeState } from './fake-deps.js'
import type { UserRecord } from '../../src/types.js'

export async function seedUser(
  state: FakeState,
  overrides: Partial<UserRecord> & { password: string },
): Promise<UserRecord> {
  const { password, ...rest } = overrides
  const user: UserRecord = {
    id: randomUUID(),
    login: `user-${randomUUID().slice(0, 8)}`,
    email: null,
    passwordHash: await hashPassword(password),
    givenName: 'Aziz',
    familyName: 'Yusupov',
    patronymic: null,
    title: null,
    avatarKey: null,
    locale: 'uz-Latn',
    timezone: 'Asia/Tashkent',
    role: 'member',
    status: 'active',
    mustChangePassword: false,
    lastLoginAt: null,
    ...rest,
  }
  state.users.push(user)
  return user
}
