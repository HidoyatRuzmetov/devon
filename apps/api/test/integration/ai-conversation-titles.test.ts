import { MockProvider } from '@devon/ai'
import type { AiChatMessage } from '@devon/contracts'
import { applyMigrations, readMigrationFiles, withContext, type RequestContext } from '@devon/db'
import { sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { processConversationTitle } from '../../src/modules/ai/conversation-title-worker.js'
import * as chat from '../../src/modules/ai/conversations.js'
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

type TitleTurns = readonly Pick<AiChatMessage, 'role' | 'content'>[]

let db: Db, server: Server
let member: RequestContext, coworker: RequestContext, foreignHead: RequestContext
const sessions = new Map<string, Session>()
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  async function department() {
    return (await seedDepartment(db, { name: 'Title fixtures', slug: randomUUID() })).id
  }
  const [home, foreign] = await Promise.all([department(), department()])
  async function actor(departmentId: string, role: 'head' | 'member'): Promise<RequestContext> {
    const user = await seedMember(db, departmentId, { role })
    sessions.set(user.id, await loginAs(server.baseUrl, user.login))
    return {
      requestId: randomUUID(),
      userId: user.id,
      actorRole: 'member',
      departmentRole: role,
      departmentId,
      actingForUserId: null,
      viewAs: false,
      ip: '127.0.0.1',
      userAgent: 'title-integration-test',
    }
  }
  ;[member, coworker, foreignHead] = await Promise.all([
    actor(home, 'member'),
    actor(home, 'head'),
    actor(foreign, 'head'),
  ])
  await superuserQuery(
    db,
    `insert into app.ai_department_settings(department_id,budget_uzs_per_month,flags)
     values($1,1000000,'{"semantic_ask":true}'),($2,1000000,'{"semantic_ask":true}')`,
    [home, foreign],
  )
})
afterEach(async () => {
  __setProviderForTests(null)
  // This file owns an isolated database. Each claim test should see only its own fixtures.
  await superuserQuery(db, 'delete from app.ai_conversations')
})
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})

function message(role: 'user' | 'assistant', content: string): AiChatMessage {
  return {
    id: randomUUID(),
    role,
    content,
    status: 'complete',
    sources: [],
    context: null,
    error: null,
    createdAt: new Date().toISOString(),
  }
}

function create(actor = member) {
  return chat.createConversation(actor, { id: randomUUID(), locale: 'en', seedBriefing: false })
}

function jobs(id: string) {
  return superuserQuery(
    db,
    'select * from app.ai_conversation_title_jobs where conversation_id=$1',
    [id],
  )
}

async function stored(id: string) {
  const [row] = await superuserQuery(
    db,
    'select title,title_status,messages,updated_at from app.ai_conversations where id=$1',
    [id],
  )
  return row!
}

async function firstTurn(
  actor = member,
  content = 'What caused the November invoice discrepancy?',
) {
  const conversation = await create(actor)
  const request = { id: randomUUID(), content }
  const submitted = await chat.submitConversationMessage(actor, conversation.id, request)
  return { conversation: submitted.conversation, request }
}

it('queues a first send once and titles it without changing the turn, recency or ownership', async () => {
  const { conversation, request } = await firstTurn()
  expect(conversation).toMatchObject({ title: '', titleStatus: 'pending', status: 'running' })
  await chat.submitConversationMessage(member, conversation.id, request)
  expect(await jobs(conversation.id)).toHaveLength(1)
  const before = await stored(conversation.id)
  const generate = vi.fn(async (actor: RequestContext, locale: string, turns: TitleTurns) => {
    expect(actor).toMatchObject({
      userId: member.userId,
      departmentId: member.departmentId,
      departmentRole: 'member',
      viewAs: false,
    })
    expect(locale).toBe('en')
    expect(turns.map((turn) => turn.content)).toEqual([request.content])
    return 'November invoice discrepancy'
  })
  expect(await processConversationTitle(generate)).toBe(true)
  expect(await processConversationTitle(generate)).toBe(false)
  expect(generate).toHaveBeenCalledTimes(1)
  expect(await stored(conversation.id)).toMatchObject({
    title: 'November invoice discrepancy',
    title_status: 'ready',
    messages: before['messages'],
    updated_at: before['updated_at'],
  })
  expect(await jobs(conversation.id)).toHaveLength(0)
  const ownerList = await chat.listConversations(
    member,
    undefined,
    10,
    'November invoice discrepancy',
  )
  expect(ownerList.conversations.map((row) => row.id)).toContain(conversation.id)
  for (const actor of [coworker, foreignHead]) {
    expect((await chat.listConversations(actor)).conversations).toHaveLength(0)
    const denied = await fetch(`${server.baseUrl}/api/v1/ai/conversations/${conversation.id}`, {
      headers: sessions.get(actor.userId!)!.headers,
    })
    expect(denied.status).toBe(404)
  }
  const audit = await superuserQuery(
    db,
    'select before,after from audit.events where subject_id=$1',
    [conversation.id],
  )
  const outbox = await superuserQuery(
    db,
    "select payload from app.outbox_events where payload->>'conversationId'=$1",
    [conversation.id],
  )
  const metadata = JSON.stringify({ audit, outbox })
  expect(metadata).not.toContain(request.content)
  expect(metadata).not.toContain('November invoice discrepancy')
  expect(
    await withContext(coworker, (tx) =>
      tx.raw(sql`select title from app.ai_conversations where id=${conversation.id}`),
    ),
  ).toEqual([])
})

it('fences concurrent workers and a late model completion after a title has changed', async () => {
  const { conversation } = await firstTurn()
  let resolve!: (title: string) => void
  const waiting = new Promise<string>((done) => {
    resolve = done
  })
  const generate = vi.fn(() => waiting)
  const running = processConversationTitle(generate)
  try {
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce(), { timeout: 5000 })
    expect(await processConversationTitle(generate)).toBe(false)
    await superuserQuery(
      db,
      "update app.ai_conversations set title='My chosen title' where id=$1",
      [conversation.id],
    )
  } finally {
    resolve('Late model response')
    await running
  }
  expect(await stored(conversation.id)).toMatchObject({
    title: 'My chosen title',
    title_status: 'ready',
  })
  expect(await jobs(conversation.id)).toHaveLength(0)
})

it('backs off after a provider error, leaves the conversation usable and retries without storing the error text', async () => {
  const { conversation } = await firstTurn()
  const before = await stored(conversation.id)
  const fail = vi.fn(async () => {
    throw new Error('SENSITIVE provider error details')
  })
  await processConversationTitle(fail)
  expect(fail).toHaveBeenCalledOnce()
  const retry = await jobs(conversation.id)
  expect(retry).toHaveLength(1)
  expect(retry[0]!['available_at']).toBeInstanceOf(Date)
  expect(Number(retry[0]!['available_at'])).toBeGreaterThan(Date.now())
  expect(JSON.stringify(retry)).not.toContain('SENSITIVE')
  expect(await processConversationTitle(fail)).toBe(false)
  expect(await stored(conversation.id)).toEqual(before)
  await superuserQuery(
    db,
    "update app.ai_conversation_title_jobs set available_at=now()-interval '1 second' where conversation_id=$1",
    [conversation.id],
  )
  await processConversationTitle(async () => 'Reconciled invoice')
  expect(await jobs(conversation.id)).toEqual([])
  expect((await chat.getConversation(member, conversation.id)).title).toBe('Reconciled invoice')
})

it('replays the rollout over old empty, seeded, clipped, and custom histories without touching messages or their dates', async () => {
  // Only this suite's disposable PostgreSQL database. Recreate the pre-release schema before
  // seeding so that the new transactional triggers never see the legacy rows before rollout.
  await superuserQuery(
    db,
    `
    drop trigger classify_conversation_title on app.ai_conversations;
    drop trigger queue_conversation_title on app.ai_conversations;
    drop function app.classify_conversation_title();
    drop function app.queue_conversation_title();
    drop table app.ai_conversation_title_jobs;
    alter table app.ai_conversations drop column title_status, drop column title_from_briefing;`,
  )
  async function legacy(title: string, turns: AiChatMessage[]) {
    const id = randomUUID()
    await superuserQuery(
      db,
      `insert into app.ai_conversations(id,department_id,owner_user_id,locale,title,messages,updated_at)
       values ($1,$2,$3,'en',$4,$5::jsonb,'2024-05-06T07:08:09.123456Z')`,
      [id, member.departmentId, member.userId, title, JSON.stringify(turns)],
    )
    return id
  }
  // Old Node titles used slice(0,120), which counts an emoji as two UTF-16 units.
  const long = 'Review 💼 '.repeat(24)
  const user = message('user', long)
  const briefing = message('assistant', 'Department staffing for the coming week')
  const [clipped, custom, seeded, blank] = await Promise.all([
    legacy(long.slice(0, 120), [briefing, user]),
    legacy('An existing custom title', [user]),
    legacy('', [briefing]),
    legacy('', []),
  ])
  const migration = readMigrationFiles().find(
    (file) => file.name === '2035_ai_conversation_titles.sql',
  )!
  expect((await applyMigrations(db.superuserUrl, {}, [migration])).applied).toEqual([
    migration.name,
  ])
  expect((await applyMigrations(db.superuserUrl, {}, [migration])).applied).toEqual([])
  for (const id of [clipped, seeded]) {
    expect(await jobs(id)).toMatchObject([{ backfill: true }])
    expect((await stored(id))['title_status']).toBe('pending')
  }
  expect(await jobs(blank)).toEqual([])
  expect(await jobs(custom)).toEqual([])
  expect(await stored(blank)).toMatchObject({ title: '', title_status: 'empty' })
  expect(await stored(custom)).toMatchObject({
    title: 'An existing custom title',
    title_status: 'ready',
  })
  const generate = vi.fn(async (_actor: RequestContext, _locale: string, turns: TitleTurns) =>
    turns.some((turn) => turn.role === 'user') ? 'Staff expense review' : 'Weekly staffing',
  )
  await processConversationTitle(generate)
  await processConversationTitle(generate)
  expect(await processConversationTitle(generate)).toBe(false)
  expect(generate).toHaveBeenCalledTimes(2)
  expect(await stored(clipped)).toMatchObject({
    title: 'Staff expense review',
    title_status: 'ready',
    messages: [briefing, user],
    updated_at: new Date('2024-05-06T07:08:09.123Z'),
  })
  expect(await stored(seeded)).toMatchObject({ title: 'Weekly staffing', messages: [briefing] })
})

it('does not disclose an ineligible owner transcript or save a title after membership was revoked during generation', async () => {
  const { conversation, request } = await firstTurn()
  async function setMembership(status: 'removed' | 'active') {
    await superuserQuery(
      db,
      'update app.memberships set status=$3 where user_id=$1 and department_id=$2',
      [member.userId, member.departmentId, status],
    )
  }
  async function due() {
    await superuserQuery(
      db,
      "update app.ai_conversation_title_jobs set available_at=now()-interval '1 second' where conversation_id=$1",
      [conversation.id],
    )
  }
  const inactive = vi.fn(async () => 'Must never be called')
  try {
    await setMembership('removed')
    await processConversationTitle(inactive)
    expect(inactive).not.toHaveBeenCalled()
    await setMembership('active')
    await due()
    const revoke = vi.fn(async (_actor: RequestContext, _locale: string, turns: TitleTurns) => {
      expect(turns[0]?.content).toBe(request.content)
      await setMembership('removed')
      return 'No longer authorized'
    })
    await processConversationTitle(revoke)
    expect(revoke).toHaveBeenCalledOnce()
    expect((await stored(conversation.id))['title']).toBe('')
  } finally {
    await setMembership('active')
  }
  await due()
  await processConversationTitle(async () => 'Authorized again')
  expect((await stored(conversation.id))['title']).toBe('Authorized again')
})

it('can reclaim a dead lease while rejecting the original worker’s late result', async () => {
  const { conversation } = await firstTurn()
  let resolve!: (title: string) => void
  const waiting = new Promise<string>((done) => {
    resolve = done
  })
  const old = vi.fn(() => waiting)
  const first = processConversationTitle(old)
  try {
    await vi.waitFor(() => expect(old).toHaveBeenCalledOnce(), { timeout: 5000 })
    await superuserQuery(
      db,
      `update app.ai_conversation_title_jobs
      set lease_until=now()-interval '1 second',available_at=now()-interval '1 second' where conversation_id=$1`,
      [conversation.id],
    )
    expect(await processConversationTitle(async () => 'Recovered title')).toBe(true)
  } finally {
    resolve('Obsolete response')
    await first
  }
  expect(await stored(conversation.id)).toMatchObject({
    title: 'Recovered title',
    title_status: 'ready',
  })
})

it.each([false, true])(
  'uses the first personal request to replace a seeded briefing title (provider still running: %s)',
  async (inflight) => {
    const id = randomUUID()
    const briefing = message('assistant', 'Department procurement briefing for November')
    await superuserQuery(
      db,
      `insert into app.ai_conversations(id,department_id,owner_user_id,locale,messages)
    values($1,$2,$3,'en',$4::jsonb)`,
      [id, member.departmentId, member.userId, JSON.stringify([briefing])],
    )
    let finish!: (title: string) => void
    const response = new Promise<string>((resolve) => {
      finish = resolve
    })
    const generator = vi.fn(() => response)
    const first = processConversationTitle(generator)
    try {
      await vi.waitFor(() => expect(generator).toHaveBeenCalledOnce(), { timeout: 5000 })
      if (!inflight) {
        finish('Department procurement briefing')
        await first
        expect(await stored(id)).toMatchObject({
          title: 'Department procurement briefing',
          title_status: 'ready',
        })
      }
      const request = { id: randomUUID(), content: 'Which reporting tasks need localization?' }
      const submitted = await chat.submitConversationMessage(member, id, request)
      expect(submitted.conversation.titleStatus).toBe('pending')
      expect(
        await processConversationTitle(async (_ctx, _locale, turns) => {
          expect(turns.at(-1)?.content).toBe(request.content)
          return 'Report localization'
        }, true),
      ).toBe(true)
      await chat.submitConversationMessage(member, id, request)
    } finally {
      finish('Stale briefing label')
      await first
    }
    expect(await stored(id)).toMatchObject({ title: 'Report localization', title_status: 'ready' })
    expect(await jobs(id)).toHaveLength(0)
  },
)

it('meters the configured provider as the owner without exposing private prompts or producing answer turns', async () => {
  const input = 'Review staff allocations for the spring rollout. My email is private@example.test'
  const { conversation } = await firstTurn(member, input)
  const provider = new MockProvider({
    respond: () => ({
      content: null,
      reasoningContent: null,
      finishReason: 'tool_calls',
      toolCalls: [
        {
          id: randomUUID(),
          name: 'department_chat_answer',
          argumentsJson: JSON.stringify({ content: 'Spring staff allocations', citations: [] }),
        },
      ],
      usage: { promptTokens: 20, completionTokens: 4, totalTokens: 24 },
    }),
  })
  __setProviderForTests(provider)
  expect(await processConversationTitle()).toBe(true)
  expect(provider.calls).toHaveLength(1)
  expect(JSON.stringify(provider.calls[0]!.messages)).not.toContain('private@example.test')
  const traces = await superuserQuery(
    db,
    'select * from app.ai_traces where department_id=$1 and user_id=$2',
    [member.departmentId, member.userId],
  )
  expect(traces).toHaveLength(1)
  expect(traces[0]).toMatchObject({ total_tokens: 24, feature: 'semantic_ask' })
  expect(JSON.stringify(traces)).not.toMatch(
    /Spring staff allocations|private@example|staff allocations for the spring/u,
  )
  const result = await chat.getConversation(member, conversation.id)
  expect(result).toMatchObject({
    title: 'Spring staff allocations',
    titleStatus: 'ready',
    status: 'running',
  })
  expect(result.messages).toHaveLength(1)
})
