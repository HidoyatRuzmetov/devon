// Postgres-backed repo for the Telegram module. Same convention as
// `apps/api/src/modules/notifications/repo.ts`: every query goes through `Tx.raw()`, parameterized,
// never a direct import of `packages/db/src/schema/notifications.ts` (a different package's private
// schema file -- see that file's own header comment for why).
//
// Timestamp columns read through `Tx.raw()` (`expires_at`, `linked_at`, `muted_until`, `connected_at`)
// arrive as real `Date`s: `packages/db/src/context.ts`'s `reviveTimestamps` converts every column whose
// `pg` field metadata says timestamp/timestamptz, so the `Date`-typed raw rows below are honest and
// need no per-call-site coercion (`test/checks/telegram-prove.ts` asserts this against a real Postgres).
import { randomBytes, randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'
import type { AuditCtx } from '../../types.js'
import type { GroupKind } from './schemas.js'

function systemAuditCtx(userId: string | null): AuditCtx {
  return {
    requestId: randomUUID(),
    userId,
    actorRole: null,
    actingForUserId: null,
    ip: '',
    userAgent: 'devon-telegram/system',
  }
}

function toRequestContext(ctx: AuditCtx, extra: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: ctx.requestId,
    userId: ctx.userId,
    actorRole: ctx.actorRole,
    departmentId: null,
    actingForUserId: ctx.actingForUserId,
    viewAs: false,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    ...extra,
  }
}

// No 0/O/1/I -- a code that is read aloud or typed by hand should never be ambiguous.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateCode(length = 8): string {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i += 1) out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
  return out
}

// --- Personal linking (`app.telegram_link_codes` / `app.telegram_links`, both global -- see
// `packages/db/src/tenancy.ts`) ----------------------------------------------------------------------

export type LinkCode = { code: string; expiresAt: Date }

export async function issueLinkCode(userId: string, ttlMinutes = 15): Promise<LinkCode> {
  const code = generateCode(8)
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000)
  return withContext(toRequestContext(systemAuditCtx(userId), { userId }), async (tx) => {
    await tx.raw(sql`
      insert into app.telegram_link_codes (user_id, code, expires_at)
      values (${userId}, ${code}, ${expiresAt})
    `)
    tx.audit({
      action: 'telegram.link_code_issued',
      subjectType: 'telegram_link_code',
      subjectId: userId,
    })
    return { code, expiresAt }
  })
}

export type ConsumeLinkCodeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'already_used' }

/** Race-safe consumption, same shape as `apps/api/src/db/repo.ts`'s `consumeSetupToken` (AC-12's
 * pattern reused here): the `update ... where consumed_at is null and expires_at > now() returning`
 * and the link upsert happen in the same transaction, so exactly one concurrent `/start <code>` ever
 * wins for a given code. */
export async function consumeLinkCode(
  code: string,
  chatId: string,
  locale: string,
): Promise<ConsumeLinkCodeResult> {
  return withContext(toRequestContext(systemAuditCtx(null)), async (tx) => {
    const rows = await tx.raw<{ id: string; user_id: string; expires_at: Date }>(sql`
      select id, user_id, expires_at from app.telegram_link_codes where code = ${code}
    `)
    const row = rows[0]
    if (!row) return { ok: false, reason: 'not_found' }
    if (row.expires_at.getTime() < Date.now()) return { ok: false, reason: 'expired' }

    const consumed = await tx.raw<{ id: string }>(sql`
      update app.telegram_link_codes set consumed_at = now()
      where id = ${row.id} and consumed_at is null
      returning id
    `)
    if (consumed.length === 0) return { ok: false, reason: 'already_used' }

    await tx.raw(sql`
      insert into app.telegram_links (user_id, chat_id, link_code_used, locale_at_link)
      values (${row.user_id}, ${chatId}::bigint, ${code}, ${locale})
      on conflict (user_id) do update set
        chat_id = excluded.chat_id, linked_at = now(), link_code_used = excluded.link_code_used,
        locale_at_link = excluded.locale_at_link, unlinked_at = null
    `)
    tx.audit({ action: 'telegram.linked', subjectType: 'telegram_link', subjectId: row.user_id })
    return { ok: true, userId: row.user_id }
  })
}

export type LinkStatus = {
  linked: boolean
  chatId: string | null
  linkedAt: Date | null
  mutedUntil: Date | null
}

export async function getLinkStatus(userId: string): Promise<LinkStatus> {
  return withContext(toRequestContext(systemAuditCtx(userId), { userId }), async (tx) => {
    const rows = await tx.raw<{ chat_id: string; linked_at: Date; muted_until: Date | null }>(sql`
      select chat_id, linked_at, muted_until from app.telegram_links
      where user_id = ${userId} and unlinked_at is null
    `)
    const row = rows[0]
    if (!row) return { linked: false, chatId: null, linkedAt: null, mutedUntil: null }
    return {
      linked: true,
      chatId: row.chat_id,
      linkedAt: row.linked_at,
      mutedUntil: row.muted_until,
    }
  })
}

export async function unlink(ctx: AuditCtx, userId: string): Promise<void> {
  await withContext(toRequestContext(ctx, { userId }), async (tx) => {
    await tx.raw(
      sql`update app.telegram_links set unlinked_at = now() where user_id = ${userId} and unlinked_at is null`,
    )
    tx.audit({ action: 'telegram.unlinked', subjectType: 'telegram_link', subjectId: userId })
  })
}

export async function setMutedUntil(userId: string, until: Date | null): Promise<void> {
  await withContext(toRequestContext(systemAuditCtx(userId), { userId }), async (tx) => {
    await tx.raw(
      sql`update app.telegram_links set muted_until = ${until} where user_id = ${userId}`,
    )
  })
}

/** Used by `delivery.ts` (a different module, this repo's sibling) and by the bot's own command
 * handlers -- a plain string chat id, `null` when unlinked or never linked. No RLS to work around
 * (`app.telegram_links` is `global`), but still routed through `withContext` for one uniform
 * connection-handling path. */
export async function resolveTelegramChatId(userId: string): Promise<string | null> {
  const status = await getLinkStatus(userId)
  if (!status.linked || !status.chatId) return null
  if (status.mutedUntil && status.mutedUntil.getTime() > Date.now()) return null
  return status.chatId
}

/** The locale recorded at the moment `/start <code>` was completed (`locale_at_link`) -- the closest
 * thing this module has to "what language does this chat read", short of re-reading `app.users.locale`
 * on every send (a cross-module read this module deliberately avoids: `app.users` belongs to the
 * accounts module, and its locale can drift after linking without this module needing to care). */
export async function getTelegramLinkLocale(userId: string): Promise<string | null> {
  return withContext(toRequestContext(systemAuditCtx(userId), { userId }), async (tx) => {
    const rows = await tx.raw<{ locale_at_link: string | null }>(sql`
      select locale_at_link from app.telegram_links where user_id = ${userId} and unlinked_at is null
    `)
    return rows[0]?.locale_at_link ?? null
  })
}

export type ResolvedByChat = { userId: string; locale: string | null }

/** Inbound webhook path: a Telegram update carries only a chat id -- this is the one lookup that must
 * work with no per-request user/department context established yet (`tenancy.ts`'s justification for
 * classifying this table `global`). */
export async function resolveUserByChatId(chatId: string): Promise<ResolvedByChat | null> {
  return withContext(toRequestContext(systemAuditCtx(null)), async (tx) => {
    const rows = await tx.raw<{ user_id: string; locale_at_link: string | null }>(sql`
      select user_id, locale_at_link from app.telegram_links
      where chat_id = ${chatId}::bigint and unlinked_at is null
    `)
    const row = rows[0]
    return row ? { userId: row.user_id, locale: row.locale_at_link } : null
  })
}

// --- Department groups (`app.telegram_group_connect_codes` / `app.telegram_groups`, both global) ----

export async function issueGroupConnectCode(
  departmentId: string,
  createdBy: string,
  ttlMinutes = 30,
): Promise<LinkCode> {
  const code = generateCode(8)
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000)
  await withContext(toRequestContext(systemAuditCtx(createdBy), { departmentId }), async (tx) => {
    await tx.raw(sql`
      insert into app.telegram_group_connect_codes (department_id, code, created_by, expires_at)
      values (${departmentId}, ${code}, ${createdBy}, ${expiresAt})
    `)
    tx.audit({
      action: 'telegram.group_connect_code_issued',
      subjectType: 'telegram_group_connect_code',
      subjectId: departmentId,
    })
  })
  return { code, expiresAt }
}

export type ConsumeGroupCodeResult =
  | { ok: true; departmentId: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'already_used' }

export async function consumeGroupConnectCode(
  code: string,
  chatId: string,
  title: string | null,
  connectedBy: string | null,
): Promise<ConsumeGroupCodeResult> {
  return withContext(toRequestContext(systemAuditCtx(null)), async (tx) => {
    const rows = await tx.raw<{ id: string; department_id: string; expires_at: Date }>(sql`
      select id, department_id, expires_at from app.telegram_group_connect_codes where code = ${code}
    `)
    const row = rows[0]
    if (!row) return { ok: false, reason: 'not_found' }
    if (row.expires_at.getTime() < Date.now()) return { ok: false, reason: 'expired' }

    const consumed = await tx.raw<{ id: string }>(sql`
      update app.telegram_group_connect_codes set consumed_at = now()
      where id = ${row.id} and consumed_at is null
      returning id
    `)
    if (consumed.length === 0) return { ok: false, reason: 'already_used' }

    await tx.raw(sql`
      insert into app.telegram_groups (department_id, chat_id, title, connected_by, kinds, connect_key_used)
      values (${row.department_id}, ${chatId}::bigint, ${title}, ${connectedBy}, '{}'::text[], ${code})
      on conflict (chat_id) where disconnected_at is null do update set
        department_id = excluded.department_id, title = excluded.title, connected_by = excluded.connected_by
    `)
    tx.audit({
      action: 'telegram.group_connected',
      subjectType: 'telegram_group',
      subjectId: row.department_id,
    })
    return { ok: true, departmentId: row.department_id }
  })
}

/** Read-only, cross-module by necessity (the bot's group-connect confirmation names the department):
 * `app.departments` is a real table this module does not own, queried the same sanctioned way
 * `apps/api/src/modules/notifications/repo.ts`'s `listAllDepartmentIds` already does -- `super_admin`
 * context, which `departments_read`'s own policy explicitly allows for exactly this kind of read. */
export async function getDepartmentName(departmentId: string): Promise<string | null> {
  return withContext(
    toRequestContext(systemAuditCtx(null), { actorRole: 'super_admin' }),
    async (tx) => {
      const rows = await tx.raw<{ name: string }>(
        sql`select name from app.departments where id = ${departmentId}`,
      )
      return rows[0]?.name ?? null
    },
  )
}

export type GroupRow = {
  id: string
  chatId: string
  title: string | null
  kinds: GroupKind[]
  connectedAt: Date
}

export async function listGroupsForDepartment(departmentId: string): Promise<GroupRow[]> {
  return withContext(
    toRequestContext(systemAuditCtx(null), { departmentId, actorRole: 'super_admin' }),
    async (tx) => {
      const rows = await tx.raw<{
        id: string
        chat_id: string
        title: string | null
        kinds: GroupKind[]
        connected_at: Date
      }>(sql`
      select id, chat_id, title, kinds, connected_at from app.telegram_groups
      where department_id = ${departmentId} and disconnected_at is null
      order by connected_at desc
    `)
      return rows.map((r) => ({
        id: r.id,
        chatId: r.chat_id,
        title: r.title,
        kinds: r.kinds,
        connectedAt: r.connected_at,
      }))
    },
  )
}

export type ResolvedGroup = { departmentId: string; kinds: GroupKind[] }

export async function resolveGroupByChatId(chatId: string): Promise<ResolvedGroup | null> {
  return withContext(toRequestContext(systemAuditCtx(null)), async (tx) => {
    const rows = await tx.raw<{ department_id: string; kinds: GroupKind[] }>(sql`
      select department_id, kinds from app.telegram_groups where chat_id = ${chatId}::bigint and disconnected_at is null
    `)
    const row = rows[0]
    return row ? { departmentId: row.department_id, kinds: row.kinds } : null
  })
}

export async function setGroupKinds(
  ctx: AuditCtx,
  groupId: string,
  departmentId: string,
  kinds: GroupKind[],
): Promise<void> {
  await withContext(toRequestContext(ctx, { departmentId, actorRole: 'head' }), async (tx) => {
    // One bound parameter, never a value list: a bare JS array inside the drizzle `sql` template
    // expands to `($1, $2, ...)` -- a record, which Postgres refuses to cast to `text[]` (and a
    // one-element list collapses to a malformed array literal). `sql.param` binds the whole array as
    // a single placeholder, which node-postgres serialises as a real Postgres array literal.
    await tx.raw(
      sql`update app.telegram_groups set kinds = ${sql.param(kinds)}::text[] where id = ${groupId}`,
    )
    tx.audit({
      action: 'telegram.group_kinds_updated',
      subjectType: 'telegram_group',
      subjectId: groupId,
      after: { kinds },
    })
  })
}

export async function disconnectGroup(
  ctx: AuditCtx,
  groupId: string,
  departmentId: string,
): Promise<void> {
  await withContext(toRequestContext(ctx, { departmentId, actorRole: 'head' }), async (tx) => {
    await tx.raw(sql`update app.telegram_groups set disconnected_at = now() where id = ${groupId}`)
    tx.audit({
      action: 'telegram.group_disconnected',
      subjectType: 'telegram_group',
      subjectId: groupId,
    })
  })
}

/** The bot itself was removed from the group (Telegram's `my_chat_member` update) -- no head session
 * is involved, so this goes straight to the row by chat id instead of `disconnectGroup`'s
 * group-id + head-authorized path. */
export async function disconnectGroupByChatId(chatId: string): Promise<void> {
  await withContext(toRequestContext(systemAuditCtx(null)), async (tx) => {
    await tx.raw(
      sql`update app.telegram_groups set disconnected_at = now() where chat_id = ${chatId}::bigint and disconnected_at is null`,
    )
    tx.audit({
      action: 'telegram.group_disconnected',
      subjectType: 'telegram_group',
      subjectId: chatId,
    })
  })
}

/** Every department group subscribed to a given kind (`events`/`polls`/`announcements`/
 * `weekly_summary`/`deadlines`) -- used by the outbound broadcast helpers, never by a per-user path. */
export async function listGroupsForKind(
  kind: GroupKind,
): Promise<{ chatId: string; departmentId: string }[]> {
  return withContext(toRequestContext(systemAuditCtx(null)), async (tx) => {
    const rows = await tx.raw<{ chat_id: string; department_id: string }>(sql`
      select chat_id, department_id from app.telegram_groups
      where disconnected_at is null and ${kind} = any(kinds)
    `)
    return rows.map((r) => ({ chatId: r.chat_id, departmentId: r.department_id }))
  })
}
