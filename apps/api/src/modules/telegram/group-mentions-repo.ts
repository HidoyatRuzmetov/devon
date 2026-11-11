import { withContext, type RequestContext } from '@devon/db'
import { sql } from 'drizzle-orm'
import type { User } from 'grammy/types'
import { departmentTelegramRoster } from './repo.js'

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
export async function groupMentionAudience(groupId: string, departmentId: string) {
  return withContext({ ...system, departmentId }, async (tx) => {
    const [group] = await tx.raw<{ locale: string; observed: string[] }>(sql`
      select d.locale_default as locale,
        array(select telegram_user_id::text from app.telegram_group_members where group_id=g.id) as observed
      from app.telegram_groups g join app.departments d on d.id=g.department_id
      where g.id=${groupId} and g.department_id=${departmentId} and g.disconnected_at is null`)
    if (!group) throw new Error('telegram_group_disconnected')
    const roster = await departmentTelegramRoster(tx, departmentId)
    return {
      locale: group.locale,
      candidates: [...new Set([...group.observed.map(Number), ...roster.linkedChatIds])].filter(
        Number.isSafeInteger,
      ),
      total: roster.memberCount,
      connected: roster.linkedChatIds.length,
      missing: roster.unlinkedMembers.map((member) => member.name),
    }
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
