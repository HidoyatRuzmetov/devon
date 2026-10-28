import { MockProvider, type ChatCompletionRequest, type ChatCompletionResult } from '@devon/ai'
import type { AiConversation } from '@devon/contracts'
import { dispatch, withContext, type RequestContext } from '@devon/db'
import { sql } from 'drizzle-orm'
import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ObjectStore } from '../../src/lib/storage/object-store.js'
import { conversationContext } from '../../src/modules/ai/conversation-context.js'
import { configureConversationFiles } from '../../src/modules/ai/conversation-files.js'
import { __setConversationEnqueueForTests } from '../../src/modules/ai/conversation-jobs.js'
import * as chat from '../../src/modules/ai/conversations.js'
import { refreshIndex } from '../../src/modules/ai/search-repo.js'
import { __setProviderForTests } from '../../src/modules/ai/service.js'
import {
  loginAs,
  seedDepartment,
  seedMember,
  startHarness,
  stopHarness,
  superuserQuery,
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
  return chat.createConversation(ctx, {
    id: randomUUID(),
    locale: 'en',
    seedBriefing: false,
  })
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
    await seedDepartment(db, {
      name: 'Conversation department',
      slug: `chat-${randomUUID()}`,
    })
  ).id
  const head = await seedMember(db, departmentId, { role: 'head' })
  owner = head.id
  const member = await seedMember(db, departmentId, { role: 'member' })
  other = member.id
  foreignDepartment = (
    await seedDepartment(db, {
      name: 'Foreign department',
      slug: `foreign-${randomUUID()}`,
    })
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
        {
          id: randomUUID(),
          title: 'Evidence checked',
          done: false,
          dueOn: '2026-11-01',
        },
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
    `insert into app.personal_calendar_entries(id,user_id,title,starts_at,ends_at) values($1,$2,'SECRET PRIVATE APPOINTMENT',now(),now()+interval '1 hour')`,
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

describe('private persistent work conversations', () => {
  it('gates routes, persists an immediate pending turn and reloads the saved completed answer', async () => {
    provider()
    await conversationContext(ctx, 'audit')
    const id = randomUUID()
    const url = `${server.baseUrl}/api/v1/ai/conversations`
    expect((await fetch(url, { headers: memberSession.headers })).status).toBe(200)
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: {
            cookie: headSession.cookie,
            'content-type': 'application/json',
          },
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
      body: JSON.stringify({
        id: messageId,
        content: 'What is the audit deadline?',
      }),
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
      {
        ref: `card:${cardId}`,
        title: 'Audit evidence',
        href: `/work/card?id=${cardId}`,
      },
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
    expect(context.totals).toMatchObject({
      people: 2,
      units: 1,
      planned_positions: 6,
    })
  })
  it('enforces owner, department, membership and view-as isolation in both service and raw RLS reads', async () => {
    const conversation = await create()
    await Promise.all(
      [
        { ...ctx, userId: other },
        { ...ctx, userId: foreignHead, departmentId: foreignDepartment },
        { ...ctx, viewAs: true },
        { ...ctx, departmentRole: null },
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
      new MockProvider({
        respond: () => response('Fabricated answer', [`card:${randomUUID()}`]),
      }),
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
      content: 'History '.repeat(100000),
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
    expect(saved.messages.at(-1)).toMatchObject({
      status: 'failed',
      error: 'context_limit',
    })
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
            `update app.memberships set status='removed' where department_id=$1 and user_id=$2`,
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
          `update app.memberships set role='head',status='active' where department_id=$1 and user_id=$2`,
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
  it('searches titles and messages with literal wildcards, scoped ownership and stable pagination', async () => {
    const term = `search-${randomUUID()}`
    const titleMatch = await create()
    const bodyMatch = await create()
    const privateMatch = await chat.createConversation(
      { ...ctx, userId: other, departmentRole: 'member' },
      {
        id: randomUUID(),
        locale: 'en',
        seedBriefing: false,
      },
    )
    await superuserQuery(db, 'update app.ai_conversations set title=$1 where id=any($2::uuid[])', [
      `${term} 100%_literal`,
      [titleMatch.id, privateMatch.id],
    ])
    await superuserQuery(db, 'update app.ai_conversations set messages=$1::jsonb where id=$2', [
      JSON.stringify([
        {
          id: randomUUID(),
          role: 'user',
          content: `${term} body evidence`,
          status: 'complete',
          error: null,
          createdAt: new Date().toISOString(),
          sources: [],
          context: null,
        },
      ]),
      bodyMatch.id,
    ])
    const first = await chat.listConversations(ctx, undefined, 1, term)
    const second = await chat.listConversations(ctx, first.nextCursor!, 1, term)
    expect([...first.conversations, ...second.conversations].map((item) => item.id).sort()).toEqual(
      [titleMatch.id, bodyMatch.id].sort(),
    )
    expect(second.nextCursor).toBeNull()
    expect(
      (await chat.listConversations(ctx, undefined, 30, '100%_literal')).conversations.map(
        (item) => item.id,
      ),
    ).toEqual([titleMatch.id])
    const url = `${server.baseUrl}/api/v1/ai/conversations`
    const own = await fetch(`${url}?q=${encodeURIComponent(term)}`, {
      headers: memberSession.headers,
    })
    expect(own.status).toBe(200)
    const owned = (await own.json()) as { conversations: { id: string }[] }
    expect(owned.conversations.map((item) => item.id)).toEqual([privateMatch.id])
    expect(
      (await fetch(`${url}?q=${'x'.repeat(161)}`, { headers: headSession.headers })).status,
    ).toBe(422)
  })
  it('seeds the cached briefing without a provider call, retaining its date and verified risk references', async () => {
    const model = provider()
    const output = {
      headline: 'Briefing cached once',
      wins: { text: 'Audit work is moving.', citedIds: [] },
      risks: [
        {
          cardId,
          text: 'The evidence package needs attention.',
          severity: 'high',
        },
      ],
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
      (
        await chat.createConversation(ctx, {
          id: randomUUID(),
          locale: 'ru',
          seedBriefing: true,
        })
      ).messages,
    ).toEqual([])
  })
  it('refreshes only changed records and immediately removes edited/deleted content from cached context', async () => {
    const noteId = randomUUID()
    await superuserQuery(
      db,
      `insert into app.pages(id,department_id,title,blocks,created_by_user_id,updated_by_user_id) values($1,$2,'Cache original','{"text":"Old evidence"}',$3,$3)`,
      [noteId, departmentId, owner],
    )
    await withContext(ctx, (tx) => refreshIndex(tx, departmentId))
    expect(await withContext(ctx, (tx) => refreshIndex(tx, departmentId))).toBe(0)
    expect(JSON.stringify(await conversationContext(ctx, 'Cache'))).toContain('Cache original')
    await superuserQuery(
      db,
      `update app.pages set title='Cache revised',blocks='{"text":"Revised evidence"}' where id=$1`,
      [noteId],
    )
    expect(await withContext(ctx, (tx) => refreshIndex(tx, departmentId))).toBe(1)
    const updated = JSON.stringify(await conversationContext(ctx, 'Cache'))
    expect(updated).toContain('Cache revised')
    expect(updated).not.toContain('Cache original')
    await superuserQuery(db, `update app.pages set deleted_at=now() where id=$1`, [noteId])
    expect(JSON.stringify(await conversationContext(ctx, 'Cache'))).not.toContain('Cache revised')
    expect(
      await withContext(ctx, (tx) =>
        tx.raw(sql`select id from app.ai_search_documents where subject_id=${noteId}`),
      ),
    ).toHaveLength(0)
  })
  it('keeps project discussion and file evidence current across edits, deletions and cached reads', async () => {
    const project = randomUUID(),
      comment = randomUUID(),
      file = randomUUID()
    await superuserQuery(
      db,
      `insert into app.projects(id,department_id,title,owner_user_id) values($1,$2,'Evidence project',$3)`,
      [project, departmentId, owner],
    )
    await superuserQuery(
      db,
      `insert into app.project_comments(id,department_id,project_id,author_user_id,body) values($1,$2,$3,$4,'{"text":"Project decision original"}')`,
      [comment, departmentId, project, owner],
    )
    const get = vi.fn(async () => Buffer.from('Project attachment delivery evidence'))
    configureConversationFiles({ get } as unknown as ObjectStore)
    await superuserQuery(
      db,
      `insert into app.attachments(id,department_id,subject_type,subject_id,key,name,mime,size,uploaded_by_user_id,scan_status)
      values($1,$2,'project',$3,'project-evidence','evidence.txt','text/plain',36,$4,'clean')`,
      [file, departmentId, project, owner],
    )
    const first = JSON.stringify(
      await conversationContext(ctx, 'Evidence project', [`project:${project}`]),
    )
    expect(first).toContain('Project decision original')
    expect(first).toContain('Project attachment delivery evidence')
    expect(first).toContain(`/projects/view?id=${project}&tab=files`)
    await conversationContext(ctx, 'Evidence project', [`project:${project}`])
    expect(get).toHaveBeenCalledTimes(1)
    await superuserQuery(
      db,
      `update app.project_comments set body='{"text":"Project decision revised"}' where id=$1`,
      [comment],
    )
    const revised = JSON.stringify(
      await conversationContext(ctx, 'Evidence project', [`project:${project}`]),
    )
    expect(revised).toContain('Project decision revised')
    expect(revised).not.toContain('Project decision original')
    await superuserQuery(db, 'update app.project_comments set deleted_at=now() where id=$1', [
      comment,
    ])
    expect(
      JSON.stringify(await conversationContext(ctx, 'Evidence project', [`project:${project}`])),
    ).not.toContain('Project decision revised')
    await superuserQuery(db, 'update app.projects set deleted_at=now() where id=$1', [project])
    expect(JSON.stringify(await conversationContext(ctx, 'Evidence project'))).not.toContain(
      'Project attachment delivery evidence',
    )
    expect(
      await withContext(ctx, (tx) =>
        tx.raw(sql`select attachment_id from app.ai_file_text where attachment_id=${file}`),
      ),
    ).toHaveLength(0)
    configureConversationFiles({ get: async () => null } as unknown as ObjectStore)
  })
  it('extracts permitted file text once and rechecks file and parent deletion before every cached read', async () => {
    const ownConversation = await create()
    const memberCtx = {
      ...ctx,
      userId: other,
      departmentRole: 'member' as const,
    }
    const privateConversation = await chat.createConversation(memberCtx, {
      id: randomUUID(),
      locale: 'en',
      seedBriefing: false,
    })
    const sharedId = randomUUID(),
      privateId = randomUUID(),
      ownId = randomUUID()
    const get = vi.fn(async (key: string) =>
      Buffer.from(key.includes('private') ? 'PRIVATE FILE SECRET' : 'Phonebook extension 4567'),
    )
    configureConversationFiles({ get } as unknown as ObjectStore)
    await Promise.all(
      (
        [
          [sharedId, 'page', pageId, owner, 'shared'],
          [privateId, 'ai_conversation', privateConversation.id, other, 'private'],
          [ownId, 'ai_conversation', ownConversation.id, owner, 'own'],
        ] as const
      ).map(([id, subject, subjectId, user, key]) =>
        superuserQuery(
          db,
          `insert into app.attachments(id,department_id,subject_type,subject_id,key,name,mime,size,uploaded_by_user_id,scan_status) values($1,$2,$3,$4,$5,'contact.txt','text/plain',23,$6,'clean')`,
          [id, departmentId, subject, subjectId, key, user],
        ),
      ),
    )
    const initial = JSON.stringify(
      await conversationContext(ctx, 'phonebook', [], ownConversation.id, [ownId]),
    )
    expect(initial).toContain('Phonebook extension 4567')
    expect(initial).not.toContain('PRIVATE FILE SECRET')
    expect(initial).not.toContain(privateId)
    expect(get).toHaveBeenCalledTimes(2)
    await conversationContext(ctx, 'phonebook', [], ownConversation.id, [ownId])
    expect(get).toHaveBeenCalledTimes(2)
    const memberText = JSON.stringify(
      await conversationContext(memberCtx, 'phonebook', [], privateConversation.id, [privateId]),
    )
    expect(memberText).toContain('PRIVATE FILE SECRET')
    expect(memberText).not.toContain(ownId)
    expect(
      await withContext(ctx, (tx) =>
        tx.raw(sql`select attachment_id from app.ai_file_text where attachment_id=${privateId}`),
      ),
    ).toHaveLength(0)
    await superuserQuery(db, `update app.attachments set deleted_at=now() where id=$1`, [ownId])
    expect(
      JSON.stringify(await conversationContext(ctx, 'phonebook', [], ownConversation.id)),
    ).not.toContain(ownId)
    await superuserQuery(db, `update app.pages set deleted_at=now() where id=$1`, [pageId])
    expect(
      JSON.stringify(await conversationContext(ctx, 'phonebook', [], ownConversation.id)),
    ).not.toContain(sharedId)
    await superuserQuery(db, `update app.pages set deleted_at=null where id=$1`, [pageId])
    await superuserQuery(
      db,
      `update app.attachments set deleted_at=now() where id=any($1::uuid[])`,
      [[sharedId, privateId]],
    )
  })
  it('distinguishes an empty provider response from unavailability and preserves the saved question', async () => {
    const conversation = await create(),
      pending = await submit(conversation.id)
    __setProviderForTests(
      new MockProvider({
        respond: () => ({
          content: null,
          reasoningContent: null,
          toolCalls: [],
          finishReason: 'length',
          usage: {
            promptTokens: 100,
            completionTokens: 8192,
            totalTokens: 8292,
          },
        }),
      }),
    )
    await chat.processConversation(pending.job!)
    expect((await chat.getConversation(ctx, conversation.id)).messages).toMatchObject([
      {
        status: 'failed',
        error: 'empty_response',
        content: 'What is the audit deadline?',
      },
    ])
  })
  it('refreshes account names without rebuilding unchanged documents', async () => {
    await conversationContext(ctx, 'audit')
    const [before] = await superuserQuery(db, `select given_name from app.users where id=$1`, [
      owner,
    ])
    await superuserQuery(db, `update app.users set given_name='Updated roster name' where id=$1`, [
      owner,
    ])
    expect(JSON.stringify(await conversationContext(ctx, 'audit'))).toContain('Updated roster name')
    await superuserQuery(db, `update app.users set given_name=$2 where id=$1`, [
      owner,
      before!['given_name'],
    ])
  })
  it('reloads a bounded snapshot when a follow-up references an omitted record', async () => {
    const target = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    await superuserQuery(
      db,
      `insert into app.pages(id,department_id,title,created_by_user_id,updated_by_user_id)
      select gen_random_uuid(),$1,'Snapshot capacity fixture '||n,$2,$2 from generate_series(1,2001) n`,
      [departmentId, owner],
    )
    await superuserQuery(
      db,
      `insert into app.pages(id,department_id,title,created_by_user_id,updated_by_user_id) values($1,$2,'Explicit continuation target',$3,$3)`,
      [target, departmentId, owner],
    )
    const first = await conversationContext(ctx, 'zzzxnomatch')
    expect(first.limited).toBe(true)
    expect(first.sources.some((source) => source.ref === `page:${target}`)).toBe(false)
    const followup = await conversationContext(ctx, 'zzzxnomatch', [`page:${target}`])
    expect(followup.sources.some((source) => source.ref === `page:${target}`)).toBe(true)
    await superuserQuery(
      db,
      `delete from app.pages where department_id=$1 and (title like 'Snapshot capacity fixture %' or id=$2)`,
      [departmentId, target],
    )
  })
  it('includes live actionable event logistics without other RSVP notes, reservations or anonymous voter identities', async () => {
    const carpoolId = randomUUID(),
      itemId = randomUUID(),
      pollId = randomUUID(),
      firstOption = randomUUID(),
      secondOption = randomUUID()
    const myRsvpId = randomUUID(),
      otherRsvpId = randomUUID(),
      mySeatId = randomUUID(),
      otherSeatId = randomUUID()
    const ownVoteId = randomUUID(),
      otherVoteId = randomUUID(),
      foreignEventId = randomUUID(),
      foreignItemId = randomUUID()
    const ownHash = createHash('sha256').update(`${pollId}:${owner}`).digest('hex')
    const otherHash = createHash('sha256').update(`${pollId}:${other}`).digest('hex')
    await Promise.all([
      superuserQuery(
        db,
        `insert into app.event_rsvps(id,department_id,event_id,user_id,status,guests,note)
        values($1,$2,$3,$4,'yes',1,'My dietary request'),($5,$2,$3,$6,'maybe',0,'PRIVATE OTHER RSVP NOTE')`,
        [myRsvpId, departmentId, eventId, owner, otherRsvpId, other],
      ),
      superuserQuery(
        db,
        `insert into app.carpools(id,department_id,event_id,driver_user_id,seats,departure_place)
        values($1,$2,$3,$4,5,'North gate')`,
        [carpoolId, departmentId, eventId, owner],
      ),
      superuserQuery(
        db,
        `insert into app.event_items(id,department_id,event_id,label,quantity)
        values($1,$2,$3,'Projector cables',2)`,
        [itemId, departmentId, eventId],
      ),
      superuserQuery(
        db,
        `insert into app.polls(id,department_id,event_id,kind,question,anonymous,created_by_user_id)
        values($1,$2,$3,'single','Choose our meeting room',true,$4)`,
        [pollId, departmentId, eventId, owner],
      ),
      superuserQuery(
        db,
        `insert into app.events(id,department_id,title,starts_at,ends_at,organizer_user_id)
        values($1,$2,'SECRET FOREIGN EVENT',now(),now()+interval '1 day',$3)`,
        [foreignEventId, foreignDepartment, foreignHead],
      ),
    ])
    await Promise.all([
      superuserQuery(
        db,
        `insert into app.carpool_seats(id,department_id,carpool_id,user_id,seats_claimed,status)
        values($1,$2,$3,$4,2,'confirmed'),($5,$2,$3,$6,1,'waitlist')`,
        [mySeatId, departmentId, carpoolId, owner, otherSeatId, other],
      ),
      superuserQuery(
        db,
        `insert into app.poll_options(id,department_id,poll_id,label,sort_order)
        values($1,$2,$3,'Room A',0),($4,$2,$3,'Room B',1)`,
        [firstOption, departmentId, pollId, secondOption],
      ),
      superuserQuery(
        db,
        `insert into app.event_items(id,department_id,event_id,label,quantity)
        values($1,$2,$3,'SECRET FOREIGN ITEM',1)`,
        [foreignItemId, foreignDepartment, foreignEventId],
      ),
    ])
    await superuserQuery(
      db,
      `insert into app.poll_votes(id,department_id,poll_id,option_id,voter_hash)
      values($1,$2,$3,$4,$5),($6,$2,$3,$7,$8)`,
      [ownVoteId, departmentId, pollId, firstOption, ownHash, otherVoteId, secondOption, otherHash],
    )
    const row = (context: Awaited<ReturnType<typeof conversationContext>>, ref: string) =>
      context.snapshot.find((value) => (value as { ref: string }).ref === ref) as
        | { ref: string; facts: Record<string, unknown> }
        | undefined
    const initial = await conversationContext(ctx, 'event logistics', [`event:${eventId}`])
    expect(row(initial, `event_logistics:${eventId}`)?.facts).toMatchObject({
      eventId,
      rsvpTotals: { responses: 2, yesResponses: 1, goingPeople: 2, maybeResponses: 1 },
      myRsvp: { id: myRsvpId, status: 'yes', guests: 1, note: 'My dietary request' },
    })
    expect(row(initial, `carpool:${carpoolId}`)?.facts).toMatchObject({
      eventId,
      seats: 5,
      confirmedSeats: 2,
      waitlistedSeats: 1,
      availableSeats: 3,
      myReservation: { id: mySeatId, seats: 2, status: 'confirmed' },
    })
    expect(row(initial, `event_item:${itemId}`)?.facts).toMatchObject({
      eventId,
      quantity: 2,
      claimedById: null,
      claimedByMe: false,
    })
    const pollFacts = row(initial, `poll:${pollId}`)?.facts
    expect(pollFacts).toMatchObject({
      eventId,
      anonymous: true,
      totalVotes: 2,
      options: [
        { id: firstOption, label: 'Room A', votes: 1, votedByMe: true },
        { id: secondOption, label: 'Room B', votes: 1, votedByMe: false },
      ],
    })
    const encoded = JSON.stringify(initial)
    for (const secret of [
      ownHash,
      otherHash,
      ownVoteId,
      otherVoteId,
      otherRsvpId,
      otherSeatId,
      'PRIVATE OTHER RSVP NOTE',
      foreignItemId,
      'SECRET FOREIGN EVENT',
    ])
      expect(encoded).not.toContain(secret)
    expect(JSON.stringify(pollFacts)).not.toContain(other)
    for (const [ref, title] of [
      [`carpool:${carpoolId}`, 'North gate'],
      [`event_item:${itemId}`, 'Projector cables'],
      [`poll:${pollId}`, 'Choose our meeting room'],
      [`poll_option:${firstOption}`, 'Room A'],
      [`event_rsvp:${myRsvpId}`, 'yes'],
      [`carpool_reservation:${mySeatId}`, 'confirmed'],
    ])
      expect(initial.sources.find((source) => source.ref === ref)).toMatchObject({
        title: expect.stringContaining(title!),
        href: `/events?event=${eventId}`,
      })
    // These child updates deliberately do not bump the department document revision. The next
    // context must still observe current claims/votes instead of its cached event snapshot.
    await Promise.all([
      superuserQuery(
        db,
        `update app.event_items set claimed_by_user_id=$2,claimed_at=now() where id=$1`,
        [itemId, owner],
      ),
      superuserQuery(db, `update app.carpool_seats set seats_claimed=3 where id=$1`, [mySeatId]),
      superuserQuery(db, `update app.poll_votes set option_id=$2 where id=$1`, [
        ownVoteId,
        secondOption,
      ]),
      superuserQuery(db, `update app.event_rsvps set status='no',guests=0 where id=$1`, [myRsvpId]),
    ])
    const fresh = await conversationContext(ctx, 'event logistics', [`event:${eventId}`])
    expect(row(fresh, `event_item:${itemId}`)?.facts).toMatchObject({
      claimedById: owner,
      claimedByMe: true,
    })
    expect(row(fresh, `carpool:${carpoolId}`)?.facts).toMatchObject({
      confirmedSeats: 3,
      availableSeats: 2,
      myReservation: { seats: 3 },
    })
    expect(row(fresh, `event_logistics:${eventId}`)?.facts).toMatchObject({
      myRsvp: { status: 'no' },
      rsvpTotals: { goingPeople: 0, noResponses: 1 },
    })
    expect(row(fresh, `poll:${pollId}`)?.facts).toMatchObject({
      options: [
        { id: firstOption, votes: 0, votedByMe: false },
        { id: secondOption, votes: 2, votedByMe: true },
      ],
    })
    const member = await conversationContext(
      { ...ctx, userId: other, departmentRole: 'member' },
      'event logistics',
    )
    expect(row(member, `event_logistics:${eventId}`)?.facts).toMatchObject({
      myRsvp: { id: otherRsvpId, note: 'PRIVATE OTHER RSVP NOTE' },
    })
    expect(JSON.stringify(member)).not.toContain('My dietary request')
    expect(row(member, `carpool:${carpoolId}`)?.facts).toMatchObject({
      myReservation: { id: otherSeatId, seats: 1, status: 'waitlist' },
    })
    expect(row(member, `poll:${pollId}`)?.facts).toMatchObject({
      options: [
        { id: firstOption, votedByMe: false },
        { id: secondOption, votedByMe: true },
      ],
    })
    await superuserQuery(db, `update app.events set deleted_at=now() where id=$1`, [eventId])
    const deleted = JSON.stringify(await conversationContext(ctx, 'event logistics'))
    for (const id of [carpoolId, itemId, pollId, myRsvpId, mySeatId, firstOption, secondOption])
      expect(deleted).not.toContain(id)
    await superuserQuery(db, `update app.events set deleted_at=null where id=$1`, [eventId])
  })

  it('reads only current-user calendar entries with current versions and exposes readable nested action references', async () => {
    const entryId = randomUUID(),
      otherEntryId = randomUUID(),
      deletedEntryId = randomUUID()
    const checklistId = randomUUID(),
      commentId = randomUUID(),
      eventCommentId = randomUUID()
    await Promise.all([
      superuserQuery(
        db,
        `insert into app.personal_calendar_entries(id,user_id,starts_at,ends_at,title)
        values($1,$2,now(),now()+interval '1 hour','Finish evidence review'),
        ($3,$4,now(),now()+interval '1 hour','SECRET OTHER APPOINTMENT'),
        ($5,$2,now(),now()+interval '1 hour','DELETED OWN APPOINTMENT')`,
        [entryId, owner, otherEntryId, other, deletedEntryId],
      ),
      superuserQuery(
        db,
        `insert into app.card_checklist_items(id,department_id,card_id,text,order_key)
        values($1,$2,$3,'Check source documents','a0')`,
        [checklistId, departmentId, cardId],
      ),
      superuserQuery(
        db,
        `insert into app.card_comments(id,department_id,card_id,author_user_id,body)
        values($1,$2,$3,$4,'{"format":"markdown","text":"Review completed evidence"}')`,
        [commentId, departmentId, cardId, owner],
      ),
      superuserQuery(
        db,
        `insert into app.event_comments(id,department_id,event_id,author_user_id,body)
        values($1,$2,$3,$4,'Please bring the agenda')`,
        [eventCommentId, departmentId, eventId, owner],
      ),
    ])
    await superuserQuery(
      db,
      `update app.personal_calendar_entries set deleted_at=now() where id=$1`,
      [deletedEntryId],
    )
    const initial = await conversationContext(ctx, 'evidence')
    expect(initial.snapshot).toContainEqual(
      expect.objectContaining({
        ref: `personal_calendar:${entryId}`,
        title: 'Finish evidence review',
        facts: expect.objectContaining({
          kind: 'private_calendar',
          version: 1,
          startsAt: expect.any(String),
          endsAt: expect.any(String),
        }),
      }),
    )
    for (const secret of [
      'SECRET OTHER APPOINTMENT',
      'DELETED OWN APPOINTMENT',
      otherEntryId,
      deletedEntryId,
    ])
      expect(JSON.stringify(initial)).not.toContain(secret)
    for (const [ref, text, href] of [
      [`checklist:${checklistId}`, 'Check source documents', `/work/card?id=${cardId}`],
      [`comment:${commentId}`, 'Review completed evidence', `/work/card?id=${cardId}`],
      [`event_comment:${eventCommentId}`, 'Please bring the agenda', `/events?event=${eventId}`],
    ])
      expect(initial.sources.find((source) => source.ref === ref)).toMatchObject({
        title: expect.stringContaining(text!),
        href,
      })
    expect(initial.sources).toContainEqual(
      expect.objectContaining({
        ref: expect.stringMatching(new RegExp(`^milestone:${projectId}:`)),
        title: expect.stringContaining('Evidence checked'),
        href: `/projects/view?id=${projectId}`,
      }),
    )
    await superuserQuery(
      db,
      `update app.personal_calendar_entries set title='Review finished',version=2 where id=$1`,
      [entryId],
    )
    const fresh = await conversationContext(ctx, 'evidence')
    expect(fresh.snapshot).toContainEqual(
      expect.objectContaining({
        ref: `personal_calendar:${entryId}`,
        title: 'Review finished',
        facts: expect.objectContaining({ version: 2 }),
      }),
    )
    const member = JSON.stringify(
      await conversationContext(
        { ...ctx, userId: other, departmentRole: 'member' },
        'calendar entries',
      ),
    )
    expect(member).toContain('SECRET OTHER APPOINTMENT')
    expect(member).not.toContain(entryId)
    await Promise.all([
      superuserQuery(db, `update app.card_checklist_items set deleted_at=now() where id=$1`, [
        checklistId,
      ]),
      superuserQuery(db, `update app.card_comments set deleted_at=now() where id=$1`, [commentId]),
      superuserQuery(db, `update app.event_comments set deleted_at=now() where id=$1`, [
        eventCommentId,
      ]),
    ])
    const removed = JSON.stringify(await conversationContext(ctx, 'evidence'))
    for (const id of [checklistId, commentId, eventCommentId]) expect(removed).not.toContain(id)
  })
  it('bounds logistics and poll options while prioritizing an explicitly selected child', async () => {
    const boundedPollId = randomUUID()
    const preferredItemId = 'ffffffff-ffff-4fff-8fff-fffffffffff1'
    await Promise.all([
      superuserQuery(
        db,
        `insert into app.event_items(id,department_id,event_id,label,quantity)
        select gen_random_uuid(),$1,$2,'Bounded logistics fixture '||n,1 from generate_series(1,1001) n`,
        [departmentId, eventId],
      ),
      superuserQuery(
        db,
        `insert into app.event_items(id,department_id,event_id,label,quantity)
        values($1,$2,$3,'Preferred logistics fixture',1)`,
        [preferredItemId, departmentId, eventId],
      ),
      superuserQuery(
        db,
        `insert into app.polls(id,department_id,event_id,kind,question,created_by_user_id)
        values($1,$2,$3,'single','Bounded legacy options',$4)`,
        [boundedPollId, departmentId, eventId, owner],
      ),
    ])
    await superuserQuery(
      db,
      `insert into app.poll_options(id,department_id,poll_id,label,sort_order)
      select gen_random_uuid(),$1,$2,'Option '||n,n from generate_series(1,21) n`,
      [departmentId, boundedPollId],
    )
    try {
      const context = await conversationContext(ctx, 'zzzxnomatch', [
        `event_item:${preferredItemId}`,
        `poll:${boundedPollId}`,
      ])
      expect(context.limited).toBe(true)
      expect(context.recordsTotal).toBeGreaterThan(1000)
      expect(context.recordsIncluded).toBeLessThan(context.recordsTotal)
      expect(Buffer.byteLength(JSON.stringify(context.snapshot), 'utf8')).toBeLessThan(410000)
      expect(context.sources).toContainEqual({
        ref: `event_item:${preferredItemId}`,
        title: 'Preferred logistics fixture',
        href: `/events?event=${eventId}`,
      })
      const poll = context.snapshot.find(
        (value) => (value as { ref: string }).ref === `poll:${boundedPollId}`,
      ) as { facts: { options: unknown[]; optionsTotal: number; limited: boolean } }
      expect(poll.facts).toMatchObject({ optionsTotal: 21, limited: true })
      expect(poll.facts.options).toHaveLength(20)
      expect(
        context.sources.some((source) =>
          source.title.includes('Bounded legacy options — Option 21'),
        ),
      ).toBe(false)
    } finally {
      await Promise.all([
        superuserQuery(
          db,
          `delete from app.event_items where department_id=$1 and (label like 'Bounded logistics fixture %' or id=$2)`,
          [departmentId, preferredItemId],
        ),
        superuserQuery(db, `delete from app.poll_options where poll_id=$1`, [boundedPollId]),
      ])
      await superuserQuery(db, `delete from app.polls where id=$1`, [boundedPollId])
    }
  })
  it('expands authorized context and action schemas without showing internal read requests', async () => {
    let reads = 0
    const model = new MockProvider({
      respond: () => {
        reads++
        if (reads === 1) {
          const result = response('Reading relevant records', [])
          result.toolCalls[0]!.argumentsJson = JSON.stringify({
            content: 'Reading relevant records',
            citations: [],
            actions: [],
            contextRequest: { refs: [`card:${cardId}`], actionKinds: ['checklist.update'] },
          })
          return result
        }
        return response('Expanded answer', [])
      },
    })
    __setProviderForTests(model)
    const conversation = await create()
    const pending = await submit(conversation.id, 'Help with our work')
    await chat.processConversation(pending.job!)
    const saved = await chat.getConversation(ctx, conversation.id)
    expect(saved.messages).toHaveLength(2)
    expect(saved.messages.at(-1)?.content).toBe('Expanded answer')
    expect(model.calls).toHaveLength(2)
    expect(model.calls[1]!.messages[0]!.content).toContain('itemId')
    const traces = await superuserQuery(
      db,
      `select count(*)::int as count from app.ai_traces where user_id=$1`,
      [owner],
    )
    expect(traces[0]!['count']).toBeGreaterThanOrEqual(2)
  })

  it('repairs a known wrong entity identity before presenting a proposal', async () => {
    let calls = 0
    const model = new MockProvider({
      respond: () => {
        calls++
        const result = response('Review the requested deletion', [])
        result.toolCalls[0]!.argumentsJson = JSON.stringify({
          content: 'Review the requested deletion',
          citations: [],
          actions: [
            {
              kind: 'card.delete',
              title: 'Delete audit card',
              summary: 'Delete the requested card',
              arguments: { id: calls === 1 ? projectId : cardId },
            },
          ],
        })
        return result
      },
    })
    __setProviderForTests(model)
    const conversation = await create()
    const pending = await submit(conversation.id, 'Delete the audit card')
    await chat.processConversation(pending.job!)
    const saved = await chat.getConversation(ctx, conversation.id)
    expect(model.calls).toHaveLength(2)
    expect(model.calls[1]!.messages[0]!.content).toContain('invalid target identities')
    expect(saved.messages.at(-1)?.proposals).toMatchObject([
      { arguments: { id: cardId }, status: 'pending' },
    ])
    expect(
      (await superuserQuery(db, 'select deleted_at from app.cards where id=$1', [cardId]))[0]![
        'deleted_at'
      ],
    ).toBeNull()
  })

  it('falls back to the full schema after invalid compact proposals, without executing any change', async () => {
    let calls = 0
    const model = new MockProvider({
      respond: () => {
        calls++
        if (calls <= 2) {
          const result = response('Invalid proposal', [])
          result.toolCalls[0]!.argumentsJson = JSON.stringify({
            content: 'Invalid proposal',
            citations: [],
            actions: [
              {
                kind: 'card.delete',
                title: 'Invalid',
                summary: 'Invalid',
                arguments: { id: 'not-an-id' },
              },
            ],
          })
          return result
        }
        return response('Please identify the intended card.', [])
      },
    })
    __setProviderForTests(model)
    const conversation = await create()
    const pending = await submit(conversation.id, 'Help with our work')
    await chat.processConversation(pending.job!)
    const saved = await chat.getConversation(ctx, conversation.id)
    expect(model.calls).toHaveLength(3)
    expect(saved.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Please identify the intended card.',
      proposals: [],
    })
    expect(model.calls[2]!.messages[0]!.content).toContain('This is the full available context')
  })
})
