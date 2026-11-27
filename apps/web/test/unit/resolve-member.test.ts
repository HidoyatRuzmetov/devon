import { describe, expect, it } from 'vitest'
import { resolveMentionMember } from '../../src/features/work/lib/resolve-member.js'
import type { MemberSummary } from '../../src/features/work/api.js'

const MEMBERS: MemberSummary[] = [
  {
    userId: 'u1',
    givenName: 'Nodira',
    familyName: 'Karimova',
    title: null,
    avatarKey: null,
    role: 'member',
    unitId: null,
    unitName: null,
  },
  {
    userId: 'u2',
    givenName: 'Botir',
    familyName: 'Aliyev',
    title: null,
    avatarKey: null,
    role: 'head',
    unitId: null,
    unitName: null,
  },
  {
    userId: 'u3',
    givenName: 'Nodirabegim',
    familyName: 'Yusupova',
    title: null,
    avatarKey: null,
    role: 'member',
    unitId: null,
    unitName: null,
  },
]

describe('resolveMentionMember', () => {
  it('resolves an exact given-name match over a longer substring match', () => {
    const resolved = resolveMentionMember('Nodira', MEMBERS)
    expect(resolved?.userId).toBe('u1')
  })

  it('resolves a family-name substring match', () => {
    const resolved = resolveMentionMember('Aliyev', MEMBERS)
    expect(resolved?.userId).toBe('u2')
  })

  it('strips a leading @ (filter-bar-style token)', () => {
    const resolved = resolveMentionMember('@botir', MEMBERS)
    expect(resolved?.userId).toBe('u2')
  })

  it('returns null for no match', () => {
    expect(resolveMentionMember('Zulfiya', MEMBERS)).toBeNull()
  })
})
