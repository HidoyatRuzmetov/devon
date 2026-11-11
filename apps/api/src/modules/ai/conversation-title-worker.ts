import type { AiChatMessage, AiConversation } from '@devon/contracts'
import { withContext, type RequestContext } from '@devon/db'
import { sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { AiBudgetExceededError, AiFeatureDisabledError } from './errors.js'
import { generateConversationTitle } from './generate-conversation-title.js'

const scheduler: RequestContext = {
  requestId: 'ai-conversation-titles',
  departmentId: null,
  userId: null,
  actorRole: 'super_admin',
  departmentRole: null,
  actingForUserId: null,
  viewAs: false,
  ip: '127.0.0.1',
  userAgent: 'devon-ai/conversation-titles',
}
type Job = {
  conversation_id: string
  department_id: string
  owner_user_id: string
  attempts: number
}
type Source = {
  role: 'head' | 'member'
  title: string
  title_status: AiConversation['titleStatus']
  locale: AiConversation['locale']
  messages: AiChatMessage[]
}

function claim(token: string, freshOnly: boolean) {
  return withContext(scheduler, async (tx) => {
    const [job] = await tx.raw<Job>(sql`with candidate as (
      select conversation_id from app.ai_conversation_title_jobs
      where available_at<=now() and (lease_until is null or lease_until<=now())
      ${freshOnly ? sql`and not backfill` : sql``}
      order by backfill,available_at,conversation_id limit 1 for update skip locked
    ) update app.ai_conversation_title_jobs j set lease_token=${token},
      lease_until=now()+interval '2 minutes',attempts=attempts+1
      from candidate c where j.conversation_id=c.conversation_id returning j.*`)
    return job
  })
}

// This predicate is evaluated under the owner's RLS context before reading content and again
// before saving the title, so lockouts, transfers and departed members take effect mid-flight.
function activeConversation(job: Job) {
  return sql`from app.ai_conversations c
    join app.memberships m on m.department_id=c.department_id and m.user_id=c.owner_user_id
      and m.role in ('head','member') and m.status='active' and m.deleted_at is null
    join app.users u on u.id=c.owner_user_id and u.status='active' and u.deleted_at is null
    join app.departments d on d.id=c.department_id and d.status='active' and d.deleted_at is null
    where c.id=${job.conversation_id} and c.department_id=${job.department_id}
      and c.owner_user_id=${job.owner_user_id}`
}

function defer(job: Job, token: string, seconds: number) {
  return withContext(scheduler, (tx) =>
    tx.raw(sql`update app.ai_conversation_title_jobs set lease_token=null,lease_until=null,
      available_at=now()+make_interval(secs=>${seconds}) where conversation_id=${job.conversation_id}
      and lease_token=${token}`),
  )
}

/** One claimed job, no provider work inside a database transaction. A crashed worker leaves
 * a reclaimable lease. Its delayed result cannot replace a newer claim or a custom title. */
export async function processConversationTitle(
  generate = generateConversationTitle,
  freshOnly = false,
): Promise<boolean> {
  const token = randomUUID()
  const job = await claim(token, freshOnly)
  if (!job) return false
  const ctx: RequestContext = {
    ...scheduler,
    requestId: token,
    userId: job.owner_user_id,
    departmentId: job.department_id,
    actorRole: 'member',
    departmentRole: 'member',
  }
  const [source] = await withContext(ctx, (tx) =>
    tx.raw<Source>(
      sql`select m.role,c.title,c.title_status,c.locale,c.messages ${activeConversation(job)}`,
    ),
  )
  if (!source) {
    await defer(job, token, 3600)
    return true
  }
  ctx.departmentRole = source.role
  let title: string | undefined
  if (source.title_status === 'pending') {
    try {
      title = await generate(ctx, source.locale, source.messages)
    } catch (error) {
      const delay =
        error instanceof AiBudgetExceededError || error instanceof AiFeatureDisabledError
          ? 3600
          : Math.min(3600, 30 * 2 ** Math.min(job.attempts - 1, 7))
      await defer(job, token, delay)
      return true
    }
  }
  const stillEligible = await withContext(ctx, async (tx) => {
    const [current] = await tx.raw<Pick<Source, 'title_status' | 'title'>>(
      sql`select c.title,c.title_status ${activeConversation(job)} for update of c for share of m,u`,
    )
    if (!current) return false
    const [ownership] = await tx.raw(sql`select conversation_id from app.ai_conversation_title_jobs
      where conversation_id=${job.conversation_id} and lease_token=${token}
      and lease_until>now() for update`)
    if (!ownership) return true
    if (title && current.title_status === 'pending' && current.title === source.title) {
      // Title updates deliberately leave updated_at and the owner's history cursor untouched.
      await tx.raw(sql`update app.ai_conversations set title=${title},title_status='ready'
        where id=${job.conversation_id}`)
    }
    await tx.raw(
      sql`delete from app.ai_conversation_title_jobs where conversation_id=${job.conversation_id}`,
    )
    return true
  })
  if (!stillEligible) await defer(job, token, 3600)
  return true
}

export function startConversationTitleWorker(onError: (error: unknown) => void) {
  let stopped = false
  // Reserve one lane for new chats so migrating a history of slow calls cannot stall a live title.
  const lanes = [true, false].map((freshOnly) => {
    let timer: NodeJS.Timeout
    const schedule = (delay: number) => {
      if (stopped) return
      timer = setTimeout(() => {
        void processConversationTitle(generateConversationTitle, freshOnly)
          .then((worked) => schedule(worked ? 250 : 3000))
          .catch((error: unknown) => {
            onError(error)
            schedule(5000)
          })
      }, delay)
      timer.unref()
    }
    schedule(0)
    return () => clearTimeout(timer)
  })
  return {
    stop() {
      stopped = true
      lanes.forEach((stop) => stop())
    },
  }
}
