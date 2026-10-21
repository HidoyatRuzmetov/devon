import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { withContext, dispatch, type RequestContext } from '@devon/db'
import { MockProvider, type ChatCompletionResult, type ChatCompletionRequest } from '@devon/ai'
import type { AiConversation } from '@devon/contracts'
import { __setProviderForTests } from '../../src/modules/ai/service.js'
import { __setConversationEnqueueForTests } from '../../src/modules/ai/conversation-jobs.js'
import * as chat from '../../src/modules/ai/conversations.js'
import { conversationContext } from '../../src/modules/ai/conversation-context.js'
import {
  startHarness,
  stopHarness,
  seedDepartment,
  seedMember,
  superuserQuery,
  loginAs,
  type Db,
  type Server,
  type Session,
} from './harness.js'

let db: Db, server: Server, ctx: RequestContext, headSession: Session, memberSession: Session
let departmentId: string,
  owner: string,
  other: string,
  foreignDepartment: string,
  foreignHead: string
const cardId = randomUUID(),
  projectId = randomUUID(),
  unitId = randomUUID(),
  eventId = randomUUID(),
  pageId = randomUUID()
const jobs: chat.ConversationJob[] = []
function response(
  content = 'The audit has a deadline.',
  citations = [`card:${cardId}`],
): ChatCompletionResult {
  return {
    content: null,
    reasoningContent: null,
    toolCalls: [
      {
        id: randomUUID(),
        name: 'department_chat_answer',
        argumentsJson: JSON.stringify({ content, citations }),
      },
    ],
    finishReason: 'tool_calls',
    usage: { promptTokens: 150, completionTokens: 30, totalTokens: 180 },
  }
}
function provider() {
  const instance = new MockProvider({ respond: () => response() })
  __setProviderForTests(instance)
  return instance
}
async function create() {
  return chat.createConversation(ctx, { id: randomUUID(), locale: 'en', seedBriefing: false })
}
async function submit(
  id: string,
  content = 'What is the audit deadline?',
  messageId: string = randomUUID(),
) {
  return chat.submitConversationMessage(ctx, id, { id: messageId, content })
}
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  departmentId = (
    await seedDepartment(db, { name: 'Conversation department', slug: `chat-${randomUUID()}` })
  ).id
  const head = await seedMember(db, departmentId, { role: 'head' })
  owner = head.id
  const member = await seedMember(db, departmentId, { role: 'member' })
  other = member.id
  foreignDepartment = (
    await seedDepartment(db, { name: 'Foreign department', slug: `foreign-${randomUUID()}` })
  ).id
  foreignHead = (await seedMember(db, foreignDepartment, { role: 'head' })).id
  ctx = {
    requestId: randomUUID(),
    userId: owner,
    actorRole: 'member',
    departmentRole: 'head',
    departmentId,
    actingForUserId: null,
    viewAs: false,
    ip: '127.0.0.1',
    userAgent: 'conversation-test',
  }
  headSession = await loginAs(server.baseUrl, head.login)
  memberSession = await loginAs(server.baseUrl, member.login)
  await superuserQuery(
    db,
    `insert into app.ai_department_settings(department_id,budget_uzs_per_month,flags) values($1,1000000,'{"semantic_ask":true}')`,
    [departmentId],
  )
  await superuserQuery(
    db,
    `insert into app.projects(id,department_id,title,owner_user_id,status,milestones) values($1,$2,'Audit project',$3,'active',$4::jsonb)`,
    [
      projectId,
      departmentId,
      owner,
      JSON.stringify([
        { id: randomUUID(), title: 'Evidence checked', done: false, dueOn: '2026-11-01' },
      ]),
    ],
  )
  await superuserQuery(
    db,
    `insert into app.cards(id,department_id,title,giver_user_id,assignee_user_id,project_id,created_by_user_id,due_at)
    values($1,$2,'Audit evidence',$3,$3,$4,$3,'2026-11-02T00:00:00+05:00')`,
    [cardId, departmentId, owner, projectId],
  )
  await superuserQuery(
    db,
    `insert into app.units(id,department_id,name,expected_people) values($1,$2,'Research',6)`,
    [unitId, departmentId],
  )
  await superuserQuery(
    db,
    `insert into app.unit_roles(id,department_id,unit_id,user_id,role,assigned_by) values($1,$2,$3,$4,'member',$4)`,
    [randomUUID(), departmentId, unitId, owner],
  )
  await superuserQuery(
    db,
    `insert into app.events(id,department_id,title,starts_at,ends_at,organizer_user_id)
    values($1,$2,'Audit meeting',now()+interval '1 day',now()+interval '2 days',$3)`,
    [eventId, departmentId, owner],
  )
  await superuserQuery(
    db,
    `insert into app.pages(id,department_id,title,blocks,created_by_user_id,updated_by_user_id)
    values($1,$2,'Audit guidance','{"text":"Evidence must be checked"}',$3,$3)`,
    [pageId, departmentId, owner],
  )
  await superuserQuery(
    db,
    `insert into app.personal_tasks(id,user_id,title) values($1,$2,'SECRET PRIVATE TASK')`,
    [randomUUID(), other],
  )
  await superuserQuery(
    db,
    `insert into app.personal_notes(id,user_id,title) values($1,$2,'SECRET PRIVATE NOTE')`,
    [randomUUID(), other],
  )
  await superuserQuery(
    db,
    `insert into app.cards(id,department_id,title,giver_user_id,created_by_user_id) values($1,$2,'SECRET FOREIGN TASK',$3,$3)`,
    [randomUUID(), foreignDepartment, foreignHead],
  )
  __setConversationEnqueueForTests(async (job) => {
    jobs.push(job)
  })
}, 180000)
afterAll(async () => {
  __setProviderForTests(null)
  __setConversationEnqueueForTests(null)
  if (db && server) await stopHarness({ db, server })
})

describe('private persistent head conversations', () => {
  it('gates routes, persists an immediate pending turn and reloads the saved completed answer', async () => {
    provider()
    await conversationContext(ctx, 'audit')
    const id = randomUUID()
    const url = `${server.baseUrl}/api/v1/ai/conversations`
    expect((await fetch(url, { headers: memberSession.headers })).status).toBe(403)
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: { cookie: headSession.cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ id, locale: 'en' }),
        })
      ).status,
    ).toBe(403)
    const made = await fetch(url, {
      method: 'POST',
      headers: headSession.headers,
      body: JSON.stringify({ id, locale: 'en', seedBriefing: false }),
    })
    expect(made.status).toBe(200)
    const messageId = randomUUID()
    const sent = await fetch(`${url}/${id}/messages`, {
      method: 'POST',
      headers: headSession.headers,
      body: JSON.stringify({ id: messageId, content: 'What is the audit deadline?' }),
    })
    expect(sent.status).toBe(202)
    expect(await sent.json()).toMatchObject({
      status: 'running',
      messages: [{ status: 'pending' }],
    })
    expect((await fetch(`${url}/${id}`, { headers: headSession.headers })).status).toBe(200)
    await chat.processConversation(jobs.pop()!)
    const saved = (await (
      await fetch(`${url}/${id}`, { headers: headSession.headers })
    ).json()) as AiConversation
    expect(saved.status).toBe('ready')
    expect(saved.messages.map((m) => m.status)).toEqual(['complete', 'complete'])
    expect(saved.messages[1]?.sources).toEqual([
      { ref: `card:${cardId}`, title: 'Audit evidence', href: `/work/card?id=${cardId}` },
    ])
    expect((await submit(id, 'What is the audit deadline?', messageId)).job).toBeNull()
    await expect(submit(id, 'Changed content', messageId)).rejects.toMatchObject({
      reason: 'message_id_reused',
    })
  })
  it('replays complete successful history, with fresh authorized facts and no private workspace leakage', async () => {
    const model = provider(),
      conversation = await create()
    const first = await submit(conversation.id)
    await chat.processConversation(first.job!)
    await superuserQuery(
      db,
      `update app.cards set title='Audit evidence updated',due_at='2026-12-03T00:00:00+05:00' where id=$1`,
      [cardId],
    )
    const second = await submit(conversation.id, 'What changed about that since my first question?')
    await chat.processConversation(second.job!)
    expect(model.calls).toHaveLength(2)
    expect(model.calls[1]!.messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ])
    const transcript = JSON.stringify(model.calls[1]!.messages)
    for (const term of [
      'Audit evidence updated',
      '2026-12-02',
      'Evidence checked',
      'Research',
      'Audit meeting',
      'Audit guidance',
      'The audit has a deadline.',
      'Asia/Tashkent',
    ])
      expect(transcript).toContain(term)
    expect(transcript).not.toContain('SECRET PRIVATE')
    expect(transcript).not.toContain('SECRET FOREIGN')
    expect((await chat.getConversation(ctx, conversation.id)).messages[3]?.context).toMatchObject({
      historyMessages: 2,
      limited: false,
    })
    const context = await conversationContext(ctx, 'audit')
    expect(new Set(context.sources.map((s) => s.ref)).size).toBe(context.sources.length)
    expect(context.totals).toMatchObject({ people: 2, units: 1, planned_positions: 6 })
  })
  it('enforces owner, department, head and view-as isolation in both service and raw RLS reads', async () => {
    const conversation = await create()
    await Promise.all(
      [
        { ...ctx, userId: other },
        { ...ctx, userId: foreignHead, departmentId: foreignDepartment },
        { ...ctx, viewAs: true },
        { ...ctx, departmentRole: 'member' as const },
      ].map(async (denied) => {
        await expect(chat.getConversation(denied, conversation.id)).rejects.toBeInstanceOf(
          chat.ConversationError,
        )
        expect(
          await withContext(denied, (tx) =>
            tx.raw(sql`select id from app.ai_conversations where id=${conversation.id}`),
          ),
        ).toEqual([])
      }),
    )
    await expect(
      chat.createConversation(
        { ...ctx, userId: foreignHead, departmentId: foreignDepartment },
        { id: conversation.id, locale: 'en', seedBriefing: false },
      ),
    ).rejects.toMatchObject({ code: 'not_found' })
  })
  it('deduplicates racing submits and cancels generation without allowing a late answer to overwrite a retry', async () => {
    const conversation = await create()
    const attempts = await Promise.allSettled([
      submit(conversation.id),
      submit(conversation.id, 'Concurrent question'),
    ])
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const accepted = attempts.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<
      Awaited<ReturnType<typeof submit>>
    >
    let request: ChatCompletionRequest | null = null
    __setProviderForTests({
      simulated: true,
      complete: async (r) => {
        request = r
        return new Promise((_resolve, reject) =>
          r.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
        )
      },
    })
    const running = chat.processConversation(accepted.value.job!)
    await vi.waitFor(() => expect(request).not.toBeNull())
    await chat.processConversation(accepted.value.job!)
    await chat.cancelConversationMessage(ctx, conversation.id, accepted.value.job!.messageId)
    await running
    expect((await chat.getConversation(ctx, conversation.id)).messages).toMatchObject([
      { status: 'cancelled' },
    ])
    provider()
    const pending = accepted.value.conversation.messages[0]!
    const retry = await submit(conversation.id, pending.content, pending.id)
    await chat.processConversation(retry.job!)
    expect(
      (await chat.getConversation(ctx, conversation.id)).messages.map((m) => m.status),
    ).toEqual(['complete', 'complete'])
  })
  it('persists provider failures, rejects fabricated citations and retries the same turn without duplicating history', async () => {
    const conversation = await create()
    __setProviderForTests({
      simulated: true,
      complete: async () => {
        throw new Error('private provider details')
      },
    })
    const first = await submit(conversation.id)
    await chat.processConversation(first.job!)
    expect((await chat.getConversation(ctx, conversation.id)).messages[0]).toMatchObject({
      status: 'failed',
      error: 'provider_failed',
    })
    __setProviderForTests(
      new MockProvider({ respond: () => response('Fabricated answer', [`card:${randomUUID()}`]) }),
    )
    const retry = await submit(
      conversation.id,
      first.conversation.messages[0]!.content,
      first.job!.messageId,
    )
    await chat.processConversation(retry.job!)
    expect((await chat.getConversation(ctx, conversation.id)).messages).toHaveLength(1)
    const good = provider()
    const final = await submit(
      conversation.id,
      first.conversation.messages[0]!.content,
      first.job!.messageId,
    )
    await chat.processConversation(final.job!)
    expect(good.calls[0]!.messages.filter((m) => m.role === 'user')).toHaveLength(1)
    const audit = await superuserQuery(db, `select after from audit.events where subject_id=$1`, [
      conversation.id,
    ])
    expect(JSON.stringify(audit)).not.toContain('What is the audit deadline?')
    expect(JSON.stringify(audit)).not.toContain('private provider details')
  })
  it('recovers interrupted leases and refuses oversized history instead of silently forgetting earlier messages', async () => {
    const conversation = await create(),
      model = provider(),
      first = await submit(conversation.id)
    await superuserQuery(
      db,
      `update app.ai_conversations set lease_until=now()-interval '1 second' where id=$1`,
      [conversation.id],
    )
    expect((await chat.getConversation(ctx, conversation.id)).messages[0]).toMatchObject({
      status: 'failed',
      error: 'interrupted',
    })
    const retry = await submit(
      conversation.id,
      first.conversation.messages[0]!.content,
      first.job!.messageId,
    )
    const oversized = {
      id: randomUUID(),
      role: 'assistant',
      content: 'History '.repeat(20000),
      createdAt: new Date().toISOString(),
      status: 'complete',
      sources: [],
      context: null,
      error: null,
    }
    await superuserQuery(
      db,
      `update app.ai_conversations set messages=$2::jsonb||messages where id=$1`,
      [conversation.id, JSON.stringify([oversized])],
    )
    await chat.processConversation(retry.job!)
    expect(model.calls).toHaveLength(0)
    const saved = await chat.getConversation(ctx, conversation.id)
    expect(saved.messages[0]?.content).toBe(oversized.content)
    expect(saved.messages.at(-1)).toMatchObject({ status: 'failed', error: 'context_limit' })
  })
  it('recovers save-before-enqueue crashes from the transactional outbox', async () => {
    const model = provider(),
      conversation = await create(),
      pending = await submit(conversation.id)
    const rows = await superuserQuery(
      db,
      `select * from app.outbox_events where type='ai.conversation.requested' and payload->>'conversationId'=$1`,
      [conversation.id],
    )
    const row = rows[0]!
    expect(
      await dispatch({
        id: row['id'] as string,
        type: row['type'] as string,
        payload: row['payload'],
        departmentId,
        createdAt: new Date(),
        attempts: 0,
      }),
    ).toEqual({ ok: true })
    await chat.processConversation(jobs.pop()!)
    await chat.processConversation(pending.job!)
    expect(model.calls).toHaveLength(1)
    expect((await chat.getConversation(ctx, conversation.id)).messages).toHaveLength(2)
  })
  it.each(['locked', 'revoked', 'paused'])(
    'does not run a queued question after authority becomes %s',
    async (mode) => {
      const model = provider(),
        conversation = await create(),
        pending = await submit(conversation.id)
      try {
        if (mode === 'locked')
          await superuserQuery(db, `update app.users set status='locked' where id=$1`, [owner])
        else if (mode === 'revoked')
          await superuserQuery(
            db,
            `update app.memberships set role='member' where department_id=$1 and user_id=$2`,
            [departmentId, owner],
          )
        else
          await superuserQuery(
            db,
            `update app.departments set status='paused_by_admin' where id=$1`,
            [departmentId],
          )
        await chat.processConversation(pending.job!)
        expect(model.calls).toHaveLength(0)
      } finally {
        await superuserQuery(db, `update app.users set status='active' where id=$1`, [owner])
        await superuserQuery(
          db,
          `update app.memberships set role='head' where department_id=$1 and user_id=$2`,
          [departmentId, owner],
        )
        await superuserQuery(db, `update app.departments set status='active' where id=$1`, [
          departmentId,
        ])
        await chat.cancelConversationMessage(ctx, conversation.id, pending.job!.messageId)
      }
    },
  )
  it('records timeout as a retryable failure and sends no fabricated answer', async () => {
    const conversation = await create(),
      pending = await submit(conversation.id)
    const initial = Date.now()
    let time = initial
    const now = vi.spyOn(Date, 'now').mockImplementation(() => time)
    __setProviderForTests({
      simulated: true,
      complete: async () => {
        time = initial + 181_000
        throw new Error('timeout')
      },
    })
    try {
      await chat.processConversation(pending.job!)
    } finally {
      now.mockRestore()
    }
    expect((await chat.getConversation(ctx, conversation.id)).messages).toMatchObject([
      { status: 'failed', error: 'timeout' },
    ])
  })
  it('paginates tied sub-millisecond timestamps without omitting or duplicating chats', async () => {
    const created = await Promise.all([create(), create(), create()])
    await superuserQuery(
      db,
      `update app.ai_conversations set updated_at='2099-01-01T00:00:00.123456Z' where id=any($1::uuid[])`,
      [created.map((c) => c.id)],
    )
    const ids: string[] = []
    let cursor: string | undefined
    for (let i = 0; i < 3; i++) {
      const page = await chat.listConversations(ctx, cursor, 1)
      ids.push(page.conversations[0]!.id)
      cursor = page.nextCursor ?? undefined
    }
    expect(ids.sort()).toEqual(created.map((c) => c.id).sort())
    const malformed = Buffer.from(
      JSON.stringify({ at: '2026-99-99T00:00:garbage', id: randomUUID() }),
    ).toString('base64url')
    await expect(chat.listConversations(ctx, malformed)).rejects.toMatchObject({
      reason: 'invalid_cursor',
    })
  })
  it('seeds the cached briefing without a provider call, retaining its date and verified risk references', async () => {
    const model = provider()
    const output = {
      headline: 'Briefing cached once',
      wins: { text: 'Audit work is moving.', citedIds: [] },
      risks: [{ cardId, text: 'The evidence package needs attention.', severity: 'high' }],
      overloaded: [],
      lookingAhead: { text: 'Review the next milestone.', citedIds: [] },
      items: [],
      moreCount: 0,
      needsActionCount: 0,
    }
    await superuserQuery(
      db,
      `insert into app.ai_briefings(department_id,day,locale,status,output,generated_at)
      values($1,'2099-01-01','en','ready',$2::jsonb,'2026-10-20T04:00:00Z')`,
      [departmentId, JSON.stringify(output)],
    )
    const conversation = await chat.createConversation(ctx, {
      id: randomUUID(),
      locale: 'en',
      seedBriefing: true,
    })
    expect(model.calls).toHaveLength(0)
    expect(conversation.messages[0]).toMatchObject({
      role: 'assistant',
      createdAt: '2026-10-20T04:00:00.000Z',
      sources: [{ ref: `card:${cardId}`, href: `/work/card?id=${cardId}` }],
    })
    const next = await submit(conversation.id, 'Who owns the first risk?')
    await chat.processConversation(next.job!)
    expect(model.calls[0]!.messages[1]?.content).toContain(`card:${cardId}`)
    expect(model.calls[0]!.messages[1]?.content).toContain('2026-10-20T04:00:00.000Z')
    expect(
      (await chat.createConversation(ctx, { id: randomUUID(), locale: 'ru', seedBriefing: true }))
        .messages,
    ).toEqual([])
  })
})
