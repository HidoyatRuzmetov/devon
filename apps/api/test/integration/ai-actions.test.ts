import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'
import { MockProvider, type ChatCompletionResult } from '@devon/ai'
import type { AiConversation, AiChatProposal } from '@devon/contracts'
import { __setProviderForTests } from '../../src/modules/ai/service.js'
import * as chat from '../../src/modules/ai/conversations.js'
import {
  configureConversationFiles,
  conversationFiles,
} from '../../src/modules/ai/conversation-files.js'
import type { ObjectStore } from '../../src/lib/storage/object-store.js'
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

let db: Db,
  server: Server,
  headCtx: RequestContext,
  memberCtx: RequestContext,
  foreignCtx: RequestContext
let headSession: Session, memberSession: Session, foreignSession: Session
let departmentId: string,
  foreignDepartmentId: string,
  headId: string,
  memberId: string,
  foreignId: string

type Action = Pick<AiChatProposal, 'kind' | 'arguments'>
function mock(actions: Action[]) {
  const provider = new MockProvider({
    respond: (): ChatCompletionResult => ({
      content: null,
      reasoningContent: null,
      finishReason: 'tool_calls',
      usage: { promptTokens: 80, completionTokens: 40, totalTokens: 120 },
      toolCalls: [
        {
          id: randomUUID(),
          name: 'department_chat_answer',
          argumentsJson: JSON.stringify({
            content: 'Review this change before confirming.',
            citations: [],
            actions: actions.map((action) => ({
              ...action,
              title: 'Requested work change',
              summary: 'Apply only the requested change after confirmation.',
            })),
          }),
        },
      ],
    }),
  })
  __setProviderForTests(provider)
  return provider
}
async function newChat(ctx = headCtx) {
  return chat.createConversation(ctx, { id: randomUUID(), locale: 'en', seedBriefing: false })
}
async function propose(
  actions: Action[],
  ctx = headCtx,
  conversation?: AiConversation,
  attachmentIds: string[] = [],
) {
  const model = mock(actions)
  const current = conversation ?? (await newChat(ctx))
  const pending = await chat.submitConversationMessage(ctx, current.id, {
    id: randomUUID(),
    content: 'Please make this requested change.',
    attachmentIds,
  })
  expect(pending.job).not.toBeNull()
  await chat.processConversation(pending.job!)
  const saved = await chat.getConversation(ctx, current.id)
  expect(saved.messages.at(-1)).toMatchObject({ role: 'assistant', status: 'complete' })
  expect(saved.messages.at(-1)?.proposals).toHaveLength(actions.length)
  return { conversation: saved, proposals: saved.messages.at(-1)!.proposals!, model }
}
async function resolve(
  conversationId: string,
  proposalId: string,
  session = headSession,
  decision: 'execute' | 'discard' = 'execute',
) {
  return fetch(
    `${server.baseUrl}/api/v1/ai/conversations/${conversationId}/proposals/${proposalId}/${decision}`,
    {
      method: 'POST',
      headers: session.headers,
      body: '{}',
    },
  )
}
async function resolved(
  conversationId: string,
  proposalId: string,
  session = headSession,
  decision: 'execute' | 'discard' = 'execute',
) {
  const response = await resolve(conversationId, proposalId, session, decision)
  expect(response.status, await response.clone().text()).toBe(200)
  const conversation = (await response.json()) as AiConversation
  return conversation.messages
    .flatMap((message) => message.proposals ?? [])
    .find((proposal) => proposal.id === proposalId)!
}
async function seedCard(ctx: RequestContext, title: string) {
  const id = randomUUID()
  await superuserQuery(
    db,
    `insert into app.cards(id,department_id,title,giver_user_id,assignee_user_id,created_by_user_id)
    values($1,$2,$3,$4,$4,$4)`,
    [id, ctx.departmentId, title, ctx.userId],
  )
  return id
}
async function seedFile(
  ctx: RequestContext,
  conversationId: string,
  name = 'report.html',
  scan = 'clean',
) {
  const id = randomUUID()
  await superuserQuery(
    db,
    `insert into app.attachments(id,department_id,subject_type,subject_id,key,name,mime,size,scan_status,uploaded_by_user_id)
    values($1,$2,'ai_conversation',$3,$4,$5,'application/octet-stream',64,$6,$7)`,
    [id, ctx.departmentId, conversationId, `synthetic-action-tests/${id}`, name, scan, ctx.userId],
  )
  return id
}
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  departmentId = (
    await seedDepartment(db, { name: 'Action integration', slug: `actions-${randomUUID()}` })
  ).id
  foreignDepartmentId = (
    await seedDepartment(db, { name: 'Foreign actions', slug: `actions-foreign-${randomUUID()}` })
  ).id
  const head = await seedMember(db, departmentId, { role: 'head' })
  const member = await seedMember(db, departmentId, { role: 'member' })
  const foreign = await seedMember(db, foreignDepartmentId, { role: 'head' })
  headId = head.id
  memberId = member.id
  foreignId = foreign.id
  headCtx = {
    requestId: randomUUID(),
    userId: headId,
    actorRole: 'member',
    departmentRole: 'head',
    departmentId,
    actingForUserId: null,
    viewAs: false,
    ip: '127.0.0.1',
    userAgent: 'ai-action-integration',
  }
  memberCtx = { ...headCtx, userId: memberId, departmentRole: 'member' }
  foreignCtx = { ...headCtx, userId: foreignId, departmentId: foreignDepartmentId }
  ;[headSession, memberSession, foreignSession] = await Promise.all([
    loginAs(server.baseUrl, head.login),
    loginAs(server.baseUrl, member.login),
    loginAs(server.baseUrl, foreign.login),
  ])
  await superuserQuery(
    db,
    `insert into app.ai_department_settings(department_id,budget_uzs_per_month,flags)
    values($1,1000000,'{"semantic_ask":true}'),($2,1000000,'{"semantic_ask":true}')`,
    [departmentId, foreignDepartmentId],
  )
}, 180000)
afterAll(async () => {
  __setProviderForTests(null)
  if (db && server) await stopHarness({ db, server })
})

describe('confirmed AI actions through real domain routes', () => {
  it('creates only after confirmation, deduplicates simultaneous confirmations, and records actor plus AI provenance', async () => {
    const title = `AI task ${randomUUID()}`
    const { conversation, proposals } = await propose([
      {
        kind: 'card.create',
        arguments: { body: { title, assigneeUserId: headId, priority: 'high' } },
      },
    ])
    expect(
      await superuserQuery(db, 'select id from app.cards where title=$1', [title]),
    ).toHaveLength(0)
    const attempts = await Promise.all([
      resolve(conversation.id, proposals[0]!.id),
      resolve(conversation.id, proposals[0]!.id),
    ])
    for (const response of attempts) expect(response.status, await response.text()).toBe(200)
    const cards = await superuserQuery(
      db,
      'select id,title,assignee_user_id,priority from app.cards where title=$1',
      [title],
    )
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ title, assignee_user_id: headId, priority: 'high' })
    const complete = await resolved(conversation.id, proposals[0]!.id)
    expect(complete).toMatchObject({
      status: 'executed',
      result: { href: `/work/card?id=${cards[0]!['id']}` },
    })
    expect(
      await superuserQuery(db, 'select id from app.cards where title=$1', [title]),
    ).toHaveLength(1)
    const audit = await superuserQuery(
      db,
      `select actor_user_id,"after" from audit.events where subject_id=$1 and action='ai.action.executed'`,
      [conversation.id],
    )
    expect(audit).toContainEqual(
      expect.objectContaining({
        actor_user_id: headId,
        after: expect.objectContaining({
          via: 'ai',
          kind: 'card.create',
          proposalId: proposals[0]!.id,
        }),
      }),
    )
  })

  it('discards a proposal without a domain write and never executes it on a later click', async () => {
    const title = `Discarded ${randomUUID()}`
    const { conversation, proposals } = await propose([
      { kind: 'card.create', arguments: { body: { title } } },
    ])
    expect(await resolved(conversation.id, proposals[0]!.id, headSession, 'discard')).toMatchObject(
      { status: 'discarded' },
    )
    expect(await resolved(conversation.id, proposals[0]!.id)).toMatchObject({ status: 'discarded' })
    expect(
      await superuserQuery(db, 'select id from app.cards where title=$1', [title]),
    ).toHaveLength(0)
  })

  it('updates with the current version but preserves an intervening human edit when the proposal is stale', async () => {
    const cardId = await seedCard(headCtx, 'Versioned task')
    const first = await propose([
      {
        kind: 'card.update',
        arguments: { id: cardId, body: { title: 'Updated by confirmed AI', version: 1 } },
      },
    ])
    expect(await resolved(first.conversation.id, first.proposals[0]!.id)).toMatchObject({
      status: 'executed',
    })
    const stale = await propose([
      {
        kind: 'card.update',
        arguments: { id: cardId, body: { title: 'Stale AI overwrite', version: 2 } },
      },
    ])
    const human = await fetch(`${server.baseUrl}/api/v1/cards/${cardId}`, {
      method: 'PATCH',
      headers: headSession.headers,
      body: JSON.stringify({ title: 'Latest human edit', version: 2 }),
    })
    expect(human.status).toBe(200)
    expect(await resolved(stale.conversation.id, stale.proposals[0]!.id)).toMatchObject({
      status: 'failed',
      error: 'conflict',
    })
    expect(
      (await superuserQuery(db, 'select title,version from app.cards where id=$1', [cardId]))[0],
    ).toEqual({ title: 'Latest human edit', version: 3 })
  })

  it('creates a shared page, attaches only the conversation owner’s clean file, and preserves the chat file link', async () => {
    const conversation = await newChat(memberCtx)
    const fileId = await seedFile(memberCtx, conversation.id, 'centre-phonebook.html')
    const title = `Shared phonebook ${randomUUID()}`
    const blocks = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Download the centre-wide phonebook below.' }],
        },
      ],
    }
    const proposed = await propose(
      [
        {
          kind: 'page.create',
          arguments: { body: { title, kind: 'note', blocks }, attachmentIds: [fileId] },
        },
      ],
      memberCtx,
      conversation,
      [fileId],
    )
    const result = await resolved(conversation.id, proposed.proposals[0]!.id, memberSession)
    expect(result.status).toBe('executed')
    const pageId = new URL(result.result!.href, 'http://local.test').searchParams.get('page')!
    expect(
      (
        await superuserQuery(
          db,
          'select title,blocks,created_by_user_id from app.pages where id=$1',
          [pageId],
        )
      )[0],
    ).toEqual({ title, blocks, created_by_user_id: memberId })
    expect(
      (
        await superuserQuery(
          db,
          'select subject_type,subject_id from app.attachments where id=$1',
          [fileId],
        )
      )[0],
    ).toEqual({ subject_type: 'page', subject_id: pageId })
    const saved = await chat.getConversation(memberCtx, conversation.id)
    expect(saved.messages[0]!.attachments).toContainEqual(
      expect.objectContaining({
        id: fileId,
        downloadPath: `/pages/${pageId}/attachments/${fileId}/download`,
      }),
    )
    const sharedFiles = await fetch(`${server.baseUrl}/api/v1/pages/${pageId}/attachments`, {
      headers: headSession.headers,
    })
    expect(sharedFiles.status).toBe(200)
    expect(await sharedFiles.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: fileId, name: 'centre-phonebook.html' }),
      ]),
    )
  })

  it('supports attaching a staged file to an existing owned card and blocks an unrelated member’s destination', async () => {
    const owned = await seedCard(memberCtx, 'Member final report'),
      other = await seedCard(headCtx, 'Head-only editable report')
    const conversation = await newChat(memberCtx)
    const allowedFile = await seedFile(memberCtx, conversation.id, 'allowed-report.pdf')
    const deniedFile = await seedFile(memberCtx, conversation.id, 'unshared-report.pdf')
    const proposed = await propose(
      [
        {
          kind: 'attachment.attach',
          arguments: { attachmentIds: [allowedFile], targetType: 'card', targetId: owned },
        },
        {
          kind: 'attachment.attach',
          arguments: { attachmentIds: [deniedFile], targetType: 'card', targetId: other },
        },
      ],
      memberCtx,
      conversation,
    )
    expect(await resolved(conversation.id, proposed.proposals[0]!.id, memberSession)).toMatchObject(
      { status: 'executed', result: { href: `/work/card?id=${owned}` } },
    )
    expect(await resolved(conversation.id, proposed.proposals[1]!.id, memberSession)).toMatchObject(
      { status: 'failed', error: 'forbidden' },
    )
    expect(
      (
        await superuserQuery(
          db,
          'select subject_type,subject_id from app.attachments where id=$1',
          [deniedFile],
        )
      )[0],
    ).toEqual({ subject_type: 'ai_conversation', subject_id: conversation.id })
  })

  it('rejects cross-department targets, unauthorized edits and someone else’s confirmation', async () => {
    const foreign = await seedCard(foreignCtx, 'Foreign task unchanged'),
      head = await seedCard(headCtx, 'Head task unchanged')
    const proposed = await propose(
      [
        {
          kind: 'card.update',
          arguments: { id: foreign, body: { title: 'Must not update foreign', version: 1 } },
        },
        {
          kind: 'card.update',
          arguments: { id: head, body: { title: 'Must not update head', version: 1 } },
        },
      ],
      memberCtx,
    )
    expect(
      (await resolve(proposed.conversation.id, proposed.proposals[0]!.id, foreignSession)).status,
    ).toBe(404)
    expect(
      (await resolve(proposed.conversation.id, proposed.proposals[0]!.id, headSession)).status,
    ).toBe(404)
    expect(
      await resolved(proposed.conversation.id, proposed.proposals[0]!.id, memberSession),
    ).toMatchObject({ status: 'failed', error: 'not_found' })
    expect(
      await resolved(proposed.conversation.id, proposed.proposals[1]!.id, memberSession),
    ).toMatchObject({ status: 'failed', error: 'forbidden' })
    expect(
      await superuserQuery(
        db,
        'select title from app.cards where id=any($1::uuid[]) order by title',
        [[foreign, head]],
      ),
    ).toEqual([{ title: 'Foreign task unchanged' }, { title: 'Head task unchanged' }])
  })

  it('keeps member conversations, private notes and staged files isolated even from the department head', async () => {
    const conversation = await newChat(memberCtx),
      otherConversation = await newChat(headCtx)
    const ownFile = await seedFile(memberCtx, conversation.id, 'MEMBER_ONLY_UPLOAD.bin')
    const otherFile = await seedFile(headCtx, otherConversation.id, 'OTHER_PRIVATE_UPLOAD.bin')
    await superuserQuery(
      db,
      'insert into app.personal_notes(id,user_id,title) values($1,$2,$3),($4,$5,$6)',
      [randomUUID(), memberId, 'MEMBER_PRIVATE_NOTE', randomUUID(), headId, 'OTHER_PRIVATE_NOTE'],
    )
    const result = await propose([], memberCtx, conversation, [ownFile])
    const transcript = JSON.stringify(result.model.calls[0]!.messages)
    expect(transcript).toContain('MEMBER_PRIVATE_NOTE')
    expect(transcript).toContain('MEMBER_ONLY_UPLOAD.bin')
    expect(transcript).not.toContain('OTHER_PRIVATE_NOTE')
    expect(transcript).not.toContain('OTHER_PRIVATE_UPLOAD.bin')
    for (const session of [headSession, foreignSession]) {
      expect(
        (
          await fetch(`${server.baseUrl}/api/v1/ai/conversations/${conversation.id}`, {
            headers: session.headers,
          })
        ).status,
      ).toBe(404)
      expect(
        (
          await fetch(`${server.baseUrl}/api/v1/ai/conversations/${conversation.id}/attachments`, {
            headers: session.headers,
          })
        ).status,
      ).toBe(404)
    }
    expect(
      await withContext(headCtx, (tx) =>
        tx.raw(sql`select id from app.attachments where id=${ownFile}`),
      ),
    ).toEqual([])
    expect(
      await withContext(memberCtx, (tx) =>
        tx.raw(sql`select id from app.attachments where id=${otherFile}`),
      ),
    ).toEqual([])
    await expect(
      chat.submitConversationMessage(memberCtx, conversation.id, {
        id: randomUUID(),
        content: 'Use their file',
        attachmentIds: [otherFile],
      }),
    ).rejects.toMatchObject({ reason: 'attachment_unavailable' })
  })

  it('preflights pending, deleted and different-conversation uploads before creating a page', async () => {
    const conversation = await newChat(memberCtx),
      different = await newChat(memberCtx)
    const pending = await seedFile(memberCtx, conversation.id, 'pending.html', 'pending')
    const deleted = await seedFile(memberCtx, conversation.id, 'deleted.html')
    const wrongChat = await seedFile(memberCtx, different.id, 'other-chat.html')
    await superuserQuery(db, 'update app.attachments set deleted_at=now() where id=$1', [deleted])
    const prefix = `Must not create ${randomUUID()}`
    const proposed = await propose(
      [pending, deleted, wrongChat].map((id, index) => ({
        kind: 'page.create',
        arguments: { body: { title: `${prefix} ${index}` }, attachmentIds: [id] },
      })),
      memberCtx,
      conversation,
    )
    for (const proposal of proposed.proposals)
      expect(await resolved(conversation.id, proposal.id, memberSession)).toMatchObject({
        status: 'failed',
        error: 'attachment_unavailable',
      })
    expect(
      await superuserQuery(db, 'select id from app.pages where title like $1', [`${prefix}%`]),
    ).toHaveLength(0)
  })

  it('expires old pending changes and requires CSRF on every confirmation', async () => {
    const title = `Expired ${randomUUID()}`
    const proposed = await propose([{ kind: 'card.create', arguments: { body: { title } } }])
    const noCsrf = await fetch(
      `${server.baseUrl}/api/v1/ai/conversations/${proposed.conversation.id}/proposals/${proposed.proposals[0]!.id}/execute`,
      {
        method: 'POST',
        headers: { cookie: headSession.cookie, 'content-type': 'application/json' },
        body: '{}',
      },
    )
    expect(noCsrf.status).toBe(403)
    await superuserQuery(
      db,
      `update app.ai_conversations set messages=jsonb_set(messages,'{1,createdAt}',to_jsonb((now()-interval '25 hours')::text)) where id=$1`,
      [proposed.conversation.id],
    )
    expect(await resolved(proposed.conversation.id, proposed.proposals[0]!.id)).toMatchObject({
      status: 'expired',
    })
    expect(
      await superuserQuery(db, 'select id from app.cards where title=$1', [title]),
    ).toHaveLength(0)
  })
  it('hides cached text from other owners and immediately after its page is deleted', async () => {
    const conversation = await newChat(memberCtx)
    const id = await seedFile(memberCtx, conversation.id, 'confidential.txt')
    configureConversationFiles({
      get: async () => Buffer.from('Private file evidence'),
    } as unknown as ObjectStore)
    const evidence = await conversationFiles(memberCtx, conversation.id, [id])
    expect(evidence.evidence).toContainEqual(
      expect.objectContaining({ ref: `attachment:${id}`, text: 'Private file evidence' }),
    )
    expect(
      await withContext(headCtx, (tx) =>
        tx.raw(sql`select body from app.ai_file_text where attachment_id=${id}`),
      ),
    ).toEqual([])
    const pageId = randomUUID()
    await superuserQuery(
      db,
      `insert into app.pages(id,department_id,title,created_by_user_id,updated_by_user_id) values($1,$2,'Cache parent',$3,$3)`,
      [pageId, departmentId, memberId],
    )
    await superuserQuery(
      db,
      `update app.attachments set subject_type='page',subject_id=$2 where id=$1`,
      [id, pageId],
    )
    expect(
      await withContext(headCtx, (tx) =>
        tx.raw(sql`select body from app.ai_file_text where attachment_id=${id}`),
      ),
    ).toHaveLength(1)
    await superuserQuery(db, 'update app.pages set deleted_at=now() where id=$1', [pageId])
    expect(
      (await conversationFiles(headCtx)).sources.some(
        (source) => source.ref === `attachment:${id}`,
      ),
    ).toBe(false)
    expect(
      await withContext(memberCtx, (tx) =>
        tx.raw(sql`select body from app.ai_file_text where attachment_id=${id}`),
      ),
    ).toEqual([])
  })

  it('does not resurrect or quote a file deleted while extraction is in progress', async () => {
    const conversation = await newChat(memberCtx)
    const id = await seedFile(memberCtx, conversation.id, 'removed-during-read.txt')
    configureConversationFiles({
      get: async (key: string) => {
        if (key === `synthetic-action-tests/${id}`)
          await superuserQuery(db, 'update app.attachments set deleted_at=now() where id=$1', [id])
        return Buffer.from('This file was just removed')
      },
    } as unknown as ObjectStore)
    const result = await conversationFiles(memberCtx, conversation.id, [id])
    expect(result.sources.some((source) => source.ref === `attachment:${id}`)).toBe(false)
    expect(
      await superuserQuery(
        db,
        'select attachment_id from app.ai_file_text where attachment_id=$1',
        [id],
      ),
    ).toHaveLength(0)
  })
})
