import type { Bot, Context, NextFunction } from 'grammy'
import type { User } from 'grammy/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  extractAllMessage,
  mentionMessages,
  registerGroupMentions,
} from '../../src/modules/telegram/group-mentions.js'
const mocks = vi.hoisted(() => ({
  group: vi.fn(),
  remember: vi.fn(),
  candidates: vi.fn(),
  claim: vi.fn(),
  finish: vi.fn(),
  send: vi.fn(),
  maintenance: vi.fn(),
}))
vi.mock('../../src/modules/telegram/group-mentions-repo.js', () => ({
  connectedMentionGroup: mocks.group,
  rememberGroupMember: mocks.remember,
  mentionCandidateIds: mocks.candidates,
  claimGroupMention: mocks.claim,
  finishGroupMention: mocks.finish,
}))
vi.mock('../../src/modules/telegram/transport.js', () => ({ sendMentionMessage: mocks.send }))
vi.mock('../../src/modules/notifications/repo.js', () => ({
  isMaintenanceActive: mocks.maintenance,
}))
const user = (id: number): User => ({ id, is_bot: false, first_name: 'Person ' + id })
function fixture() {
  let handler: (ctx: Context, next: NextFunction) => Promise<unknown>
  registerGroupMentions({
    use: (fn: typeof handler) => {
      handler = fn
    },
  } as unknown as Bot)
  const reply = vi.fn(),
    next = vi.fn(),
    api = {
      getChatMember: vi.fn(async (_chat: number, id: number) => ({
        status: id === 999 ? 'administrator' : 'member',
        user: user(id),
      })),
      getChatAdministrators: vi.fn(async () => []),
      getChatMemberCount: vi.fn(async () => 3),
    }
  const ctx = {
    chat: { id: -100, type: 'supergroup' },
    me: { id: 999 },
    from: { ...user(1), language_code: 'en' },
    message: {
      message_id: 10,
      text: 'Review the materials @all',
      from: user(1),
      message_thread_id: 7,
    },
    api,
    reply,
  }
  return { ctx, reply, api, next, run: () => handler!(ctx as unknown as Context, next) }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.group.mockResolvedValue({ id: 'group', department_id: 'dept' })
  mocks.candidates.mockResolvedValue([1, 2])
  mocks.claim.mockResolvedValue(true)
  mocks.send.mockResolvedValue({ ok: true, messageId: 12 })
  mocks.maintenance.mockResolvedValue(false)
})
describe('explicit group mention tokens', () => {
  it.each([
    'Review all materials',
    'email@all.org',
    '@allison',
    'https://example.com/@all',
    'someone_@all',
    'word@all',
    '@all_crew',
  ])('does not notify for %s', (text) => expect(extractAllMessage(text)).toBeNull())
  it('removes intentional tokens only, handles punctuation, and ignores code/links', () => {
    expect(extractAllMessage('Review materials. @all!')).toBe('Review materials. !')
    expect(extractAllMessage('@ALL Review @all')).toBe('Review')
    expect(extractAllMessage('@all', [{ type: 'code', offset: 0, length: 4 }])).toBeNull()
    expect(
      extractAllMessage('@all', [
        { type: 'text_link', offset: 0, length: 4, url: 'https://example.invalid' },
      ]),
    ).toBeNull()
    expect(extractAllMessage('@all')).toBe('')
  })
  it('uses distinct mention entities with correct UTF-16 offsets and bounds long messages', () => {
    const people = Array.from({ length: 110 }, (_, i) => ({
      ...user(i + 1),
      first_name: '🧑‍💻 ' + i + ' <name>',
    }))
    const chunks = mentionMessages('🚀'.repeat(2200), people)
    expect(chunks.flatMap((c) => c.entities)).toHaveLength(110)
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(4096)
      expect(chunk.entities.length).toBeLessThanOrEqual(50)
      for (const entity of chunk.entities) {
        expect(entity.type).toBe('text_mention')
        if (entity.type === 'text_mention')
          expect(chunk.text.slice(entity.offset, entity.offset + entity.length)).toBe(
            entity.user.first_name,
          )
      }
    }
  })
})
describe('group notification boundaries', () => {
  it('replies in the same topic with the message and only verified group members', async () => {
    const f = fixture()
    await f.run()
    expect(mocks.send).toHaveBeenCalledWith(
      '-100',
      expect.stringContaining('Review the materials\n\nEveryone!'),
      expect.arrayContaining([expect.objectContaining({ user: user(2) })]),
      10,
      7,
    )
    expect(mocks.finish).toHaveBeenCalledWith('group', 10, true, 2)
    expect(f.next).not.toHaveBeenCalled()
  })
  it('does nothing for ordinary messages and unconnected groups', async () => {
    const f = fixture()
    f.ctx.message.text = 'Review all materials'
    await f.run()
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(f.next).toHaveBeenCalled()
    mocks.group.mockResolvedValue(null)
    f.ctx.message.text = '@all'
    await f.run()
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('requires admin visibility, and does not replay an already claimed message', async () => {
    const f = fixture()
    f.api.getChatMember.mockResolvedValue({ status: 'member', user: user(999) })
    await f.run()
    expect(f.reply).toHaveBeenCalledWith(
      expect.stringContaining('administrator'),
      expect.anything(),
    )
    expect(mocks.send).not.toHaveBeenCalled()
    const second = fixture()
    mocks.claim.mockResolvedValue(false)
    await second.run()
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('does not notify departed, bot or unverifiable users and explains incomplete coverage', async () => {
    const f = fixture()
    mocks.candidates.mockResolvedValue([1, 2, 3, 4])
    f.api.getChatMember.mockImplementation(async (_chat, id) => {
      if (id === 3) throw new Error('unknown')
      return {
        status: id === 999 ? 'administrator' : id === 2 ? 'left' : 'member',
        user: { ...user(id), is_bot: id === 4 },
      }
    })
    f.api.getChatMemberCount.mockResolvedValue(6)
    await f.run()
    expect(mocks.finish).toHaveBeenCalledWith('group', 10, true, 1)
    expect(f.reply).toHaveBeenCalledWith(
      expect.stringContaining('Mentioned 1 verified members'),
      expect.anything(),
    )
  })
  it('reports a failed delivery without replaying an unknown send outcome', async () => {
    const f = fixture()
    mocks.send.mockResolvedValue({ ok: false, error: 'timeout' })
    await f.run()
    expect(mocks.finish).toHaveBeenCalledWith('group', 10, false, 0)
    expect(f.reply).toHaveBeenCalledWith(
      expect.stringContaining('could not be completed'),
      expect.anything(),
    )
  })
  it('respects maintenance', async () => {
    mocks.maintenance.mockResolvedValue(true)
    await fixture().run()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.claim).not.toHaveBeenCalled()
  })
})
