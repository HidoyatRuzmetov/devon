import { withContext, type RequestContext } from '@devon/db'
import { sql } from 'drizzle-orm'
import type { User } from 'grammy/types'

const system: RequestContext = {
  requestId: 'telegram-group-mentions',
  userId: null,
  actorRole: 'super_admin',
  departmentId: null,
  departmentRole: null,
  actingForUserId: null,
  viewAs: false,
  ip: '',
  userAgent: 'devon-telegram/group-mentions',
}
export async function connectedMentionGroup(chatId: number) {
  return withContext(
    system,
    async (tx) =>
      (
        await tx.raw<{ id: string; department_id: string }>(
          sql`select id,department_id from app.telegram_groups where chat_id=${chatId} and disconnected_at is null`,
        )
      )[0] ?? null,
  )
}
export async function rememberGroupMember(groupId: string, user: User, present = true) {
  if (user.is_bot) return
  await withContext(system, async (tx) => {
    if (!present) {
      await tx.raw(
        sql`delete from app.telegram_group_members where group_id=${groupId} and telegram_user_id=${user.id}`,
      )
      return
    }
    await tx.raw(
      sql`insert into app.telegram_group_members(group_id,telegram_user_id,first_name,last_name,username) values(${groupId},${user.id},${user.first_name.slice(0, 128)},${user.last_name?.slice(0, 128) ?? null},${user.username?.slice(0, 64) ?? null}) on conflict(group_id,telegram_user_id) do update set first_name=excluded.first_name,last_name=excluded.last_name,username=excluded.username,seen_at=now()`,
    )
  })
}
export async function mentionCandidateIds(
  groupId: string,
  departmentId: string,
): Promise<number[]> {
  return withContext(system, async (tx) => {
    const rows = await tx.raw<{
      id: string
    }>(sql`select telegram_user_id::text as id from app.telegram_group_members where group_id=${groupId}
      union select l.chat_id::text from app.telegram_links l join app.memberships m on m.user_id=l.user_id
      join app.users u on u.id=m.user_id where m.department_id=${departmentId} and m.status='active' and m.deleted_at is null and u.deleted_at is null and l.unlinked_at is null and l.chat_id>0`)
    return rows.map((row) => Number(row.id)).filter(Number.isSafeInteger)
  })
}
export async function claimGroupMention(groupId: string, messageId: number): Promise<boolean> {
  return withContext(system, async (tx) => {
    const rows = await tx.raw(
      sql`insert into app.telegram_group_mentions(group_id,message_id) values(${groupId},${messageId}) on conflict do nothing returning message_id`,
    )
    return rows.length > 0
  })
}
export async function finishGroupMention(
  groupId: string,
  messageId: number,
  ok: boolean,
  recipients: number,
) {
  await withContext(system, async (tx) => {
    await tx.raw(
      sql`update app.telegram_group_mentions set finished_at=now(),status=${ok ? 'sent' : 'failed'},recipients=${recipients} where group_id=${groupId} and message_id=${messageId}`,
    )
    tx.audit({
      action: 'telegram.group_mentioned',
      subjectType: 'telegram_group',
      subjectId: groupId,
      after: { messageId, recipients, status: ok ? 'sent' : 'failed' },
    })
  })
}
