// The Postgres-backed data layer for pages + onboarding templates (TECH-SPEC §3.5). Every function
// opens its own `withContext()` transaction (MODULE-GUIDE.md "API modules": "never a direct
// `@devon/db` import from a route handler" -- `index.ts` never imports `@devon/db` itself, only this
// file), and reaches `app.pages`/`app.page_versions`/`app.onboarding_templates` through `Tx.raw()`
// hand-written SQL (MODULE-GUIDE.md "DB: schema": these tables are not re-exported through
// `schema/index.ts`).
import { sql, type SQL } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'
import type { AuditCtx } from '../../types.js'
import type { TiptapNode } from './schemas.js'

function toRequestContext(ctx: AuditCtx, departmentId: string): RequestContext {
  return {
    requestId: ctx.requestId,
    userId: ctx.userId,
    actorRole: ctx.actorRole,
    departmentId,
    actingForUserId: ctx.actingForUserId,
    viewAs: false,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  }
}

function joinSet(parts: SQL[]): SQL {
  return sql.join(parts, sql.raw(', '))
}

export type MutationOutcome<T> = { ok: 'done'; row: T } | { ok: 'not_found' } | { ok: 'conflict' }

// ---------------------------------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------------------------------

export type PageSummaryRow = {
  id: string
  kind: 'how_we_work' | 'onboarding' | 'brief' | 'note'
  title: string
  created_by_user_id: string
  updated_by_user_id: string
  created_at: Date
  updated_at: Date
  version: number
}
export type PageRow = PageSummaryRow & { blocks: TiptapNode }

const SUMMARY_COLUMNS = sql.raw(
  'id, kind, title, created_by_user_id, updated_by_user_id, created_at, updated_at, version',
)

export async function listPages(
  departmentId: string,
  ctx: AuditCtx,
  kind?: string | undefined,
): Promise<PageSummaryRow[]> {
  return withContext(toRequestContext(ctx, departmentId), (tx) =>
    tx.raw<PageSummaryRow>(sql`
      select ${SUMMARY_COLUMNS} from app.pages
      where department_id = ${departmentId} and deleted_at is null
      ${kind ? sql`and kind = ${kind}` : sql``}
      order by updated_at desc
    `),
  )
}

export async function getPage(
  departmentId: string,
  id: string,
  ctx: AuditCtx,
): Promise<PageRow | null> {
  return withContext(toRequestContext(ctx, departmentId), async (tx) => {
    const rows = await tx.raw<PageRow>(sql`
      select ${SUMMARY_COLUMNS}, blocks from app.pages
      where id = ${id} and department_id = ${departmentId} and deleted_at is null
    `)
    return rows[0] ?? null
  })
}

export async function createPage(
  departmentId: string,
  userId: string,
  input: { kind: string; title: string; blocks?: TiptapNode | undefined },
  ctx: AuditCtx,
): Promise<PageRow> {
  return withContext(toRequestContext(ctx, departmentId), async (tx) => {
    const blocks = input.blocks ?? { type: 'doc', content: [] }
    const rows = await tx.raw<PageRow>(sql`
      insert into app.pages (department_id, kind, title, blocks, created_by_user_id, updated_by_user_id)
      values (${departmentId}, ${input.kind}, ${input.title}, ${JSON.stringify(blocks)}::jsonb, ${userId}, ${userId})
      returning ${SUMMARY_COLUMNS}, blocks
    `)
    const row = rows[0]!
    await tx.raw(sql`
      insert into app.page_versions (department_id, page_id, title, blocks, author_user_id)
      values (${departmentId}, ${row.id}, ${row.title}, ${JSON.stringify(blocks)}::jsonb, ${userId})
    `)
    tx.audit({
      action: 'pages.page.created',
      subjectType: 'page',
      subjectId: row.id,
      departmentId,
      after: { id: row.id, kind: row.kind, title: row.title },
    })
    return row
  })
}

export async function patchPage(
  departmentId: string,
  userId: string,
  id: string,
  input: { title?: string | undefined; blocks?: TiptapNode | undefined; version: number },
  ctx: AuditCtx,
): Promise<MutationOutcome<PageRow>> {
  return withContext(toRequestContext(ctx, departmentId), async (tx) => {
    const setParts: SQL[] = []
    if (input.title !== undefined) setParts.push(sql`title = ${input.title}`)
    if (input.blocks !== undefined)
      setParts.push(sql`blocks = ${JSON.stringify(input.blocks)}::jsonb`)
    setParts.push(
      sql`updated_by_user_id = ${userId}`,
      sql`updated_at = now()`,
      sql`version = version + 1`,
    )

    const rows = await tx.raw<PageRow>(sql`
      update app.pages set ${joinSet(setParts)}
      where id = ${id} and department_id = ${departmentId} and version = ${input.version} and deleted_at is null
      returning ${SUMMARY_COLUMNS}, blocks
    `)
    const row = rows[0]
    if (!row) {
      const exists = await tx.raw<{ id: string }>(sql`
        select id from app.pages where id = ${id} and department_id = ${departmentId} and deleted_at is null
      `)
      return exists[0] ? { ok: 'conflict' } : { ok: 'not_found' }
    }
    // A new version snapshot on every save that actually changed content -- TECH-SPEC §3.5 "versions
    // with diff/restore" needs a row to diff/restore *against* for each edit, not just the latest.
    if (input.title !== undefined || input.blocks !== undefined) {
      await tx.raw(sql`
        insert into app.page_versions (department_id, page_id, title, blocks, author_user_id)
        values (${departmentId}, ${row.id}, ${row.title}, ${JSON.stringify(row.blocks)}::jsonb, ${userId})
      `)
    }
    tx.audit({
      action: 'pages.page.updated',
      subjectType: 'page',
      subjectId: row.id,
      departmentId,
      after: { id: row.id, title: row.title, version: row.version },
    })
    return { ok: 'done', row }
  })
}

export async function deletePage(
  departmentId: string,
  id: string,
  ctx: AuditCtx,
): Promise<boolean> {
  return withContext(toRequestContext(ctx, departmentId), async (tx) => {
    const rows = await tx.raw<{ id: string }>(sql`
      update app.pages set deleted_at = now(), updated_at = now(), version = version + 1
      where id = ${id} and department_id = ${departmentId} and deleted_at is null
      returning id
    `)
    if (rows.length === 0) return false
    tx.audit({ action: 'pages.page.deleted', subjectType: 'page', subjectId: id, departmentId })
    return true
  })
}

/**
 * v1.1 SPEC 12 ("undo on every mutation"): the other half of `deletePage`. Deleting a page is a soft
 * delete -- `deleted_at` is set, nothing is dropped -- so the undo behind the toast is simply
 * clearing it again. Bounded to a recent deletion (10 minutes) rather than being an open-ended
 * "un-delete anything": an undo is for the click you just regretted, not an archive browser, and
 * leaving it unbounded would quietly turn every deleted page into restorable content with no screen
 * that says so.
 */
export async function restorePage(
  departmentId: string,
  id: string,
  ctx: AuditCtx,
): Promise<boolean> {
  return withContext(toRequestContext(ctx, departmentId), async (tx) => {
    const rows = await tx.raw<{ id: string }>(sql`
      update app.pages set deleted_at = null, updated_at = now(), version = version + 1
      where id = ${id} and department_id = ${departmentId}
        and deleted_at is not null and deleted_at > now() - interval '10 minutes'
      returning id
    `)
    if (rows.length === 0) return false
    tx.audit({ action: 'pages.page.restored', subjectType: 'page', subjectId: id, departmentId })
    return true
  })
}

// ---------------------------------------------------------------------------------------------------
// Page versions
// ---------------------------------------------------------------------------------------------------

export type PageVersionSummaryRow = {
  id: string
  title: string
  author_user_id: string
  created_at: Date
}
export type PageVersionRow = PageVersionSummaryRow & { blocks: TiptapNode }

export async function listVersions(
  departmentId: string,
  pageId: string,
  ctx: AuditCtx,
): Promise<PageVersionSummaryRow[]> {
  return withContext(toRequestContext(ctx, departmentId), (tx) =>
    tx.raw<PageVersionSummaryRow>(sql`
      select id, title, author_user_id, created_at from app.page_versions
      where page_id = ${pageId} and department_id = ${departmentId}
      order by created_at desc
      limit 200
    `),
  )
}

export async function getVersion(
  departmentId: string,
  pageId: string,
  versionId: string,
  ctx: AuditCtx,
): Promise<PageVersionRow | null> {
  return withContext(toRequestContext(ctx, departmentId), async (tx) => {
    const rows = await tx.raw<PageVersionRow>(sql`
      select id, title, blocks, author_user_id, created_at from app.page_versions
      where id = ${versionId} and page_id = ${pageId} and department_id = ${departmentId}
    `)
    return rows[0] ?? null
  })
}

export async function restoreVersion(
  departmentId: string,
  userId: string,
  pageId: string,
  versionId: string,
  ctx: AuditCtx,
): Promise<MutationOutcome<PageRow>> {
  return withContext(toRequestContext(ctx, departmentId), async (tx) => {
    const version = await tx.raw<{ title: string; blocks: TiptapNode }>(sql`
      select title, blocks from app.page_versions
      where id = ${versionId} and page_id = ${pageId} and department_id = ${departmentId}
    `)
    const target = version[0]
    if (!target) return { ok: 'not_found' }

    const rows = await tx.raw<PageRow>(sql`
      update app.pages
      set title = ${target.title}, blocks = ${JSON.stringify(target.blocks)}::jsonb,
          updated_by_user_id = ${userId}, updated_at = now(), version = version + 1
      where id = ${pageId} and department_id = ${departmentId} and deleted_at is null
      returning ${SUMMARY_COLUMNS}, blocks
    `)
    const row = rows[0]
    if (!row) return { ok: 'not_found' }

    // The restore itself becomes a new version too -- history only ever grows (I-15's expand-only
    // spirit applied to application data, not just schema), so a restore can itself be undone by
    // restoring the version that preceded it.
    await tx.raw(sql`
      insert into app.page_versions (department_id, page_id, title, blocks, author_user_id)
      values (${departmentId}, ${row.id}, ${row.title}, ${JSON.stringify(row.blocks)}::jsonb, ${userId})
    `)
    tx.audit({
      action: 'pages.page.version_restored',
      subjectType: 'page',
      subjectId: row.id,
      departmentId,
      after: { restoredFromVersionId: versionId },
    })
    return { ok: 'done', row }
  })
}

// ---------------------------------------------------------------------------------------------------
// Onboarding templates
// ---------------------------------------------------------------------------------------------------

export type OnboardingItem = {
  id: string
  text: string
  ownerRole: 'newcomer' | 'head' | 'buddy'
  sort: number
}
export type OnboardingTemplateRow = {
  id: string
  name: string
  enabled: boolean
  items: OnboardingItem[]
  created_by_user_id: string
  created_at: Date
  updated_at: Date
  version: number
}

export async function listOnboardingTemplates(
  departmentId: string,
  ctx: AuditCtx,
): Promise<OnboardingTemplateRow[]> {
  return withContext(toRequestContext(ctx, departmentId), (tx) =>
    tx.raw<OnboardingTemplateRow>(sql`
      select id, name, enabled, items, created_by_user_id, created_at, updated_at, version
      from app.onboarding_templates
      where department_id = ${departmentId} and deleted_at is null
      order by created_at asc
    `),
  )
}

export async function createOnboardingTemplate(
  departmentId: string,
  userId: string,
  input: {
    name: string
    enabled?: boolean | undefined
    items?: Omit<OnboardingItem, 'sort'>[] | undefined
  },
  ctx: AuditCtx,
): Promise<OnboardingTemplateRow> {
  return withContext(toRequestContext(ctx, departmentId), async (tx) => {
    const items = (input.items ?? []).map((item, i) => ({ ...item, sort: i }))
    const rows = await tx.raw<OnboardingTemplateRow>(sql`
      insert into app.onboarding_templates (department_id, name, enabled, items, created_by_user_id)
      values (${departmentId}, ${input.name}, ${input.enabled ?? false}, ${JSON.stringify(items)}::jsonb, ${userId})
      returning id, name, enabled, items, created_by_user_id, created_at, updated_at, version
    `)
    const row = rows[0]!
    tx.audit({
      action: 'pages.onboarding_template.created',
      subjectType: 'onboarding_template',
      subjectId: row.id,
      departmentId,
      after: { id: row.id, name: row.name, enabled: row.enabled },
    })
    return row
  })
}

export async function patchOnboardingTemplate(
  departmentId: string,
  id: string,
  input: {
    name?: string | undefined
    enabled?: boolean | undefined
    items?: OnboardingItem[] | undefined
    version: number
  },
  ctx: AuditCtx,
): Promise<MutationOutcome<OnboardingTemplateRow>> {
  return withContext(toRequestContext(ctx, departmentId), async (tx) => {
    const setParts: SQL[] = []
    if (input.name !== undefined) setParts.push(sql`name = ${input.name}`)
    if (input.enabled !== undefined) setParts.push(sql`enabled = ${input.enabled}`)
    if (input.items !== undefined) setParts.push(sql`items = ${JSON.stringify(input.items)}::jsonb`)
    setParts.push(sql`updated_at = now()`, sql`version = version + 1`)

    const rows = await tx.raw<OnboardingTemplateRow>(sql`
      update app.onboarding_templates set ${joinSet(setParts)}
      where id = ${id} and department_id = ${departmentId} and version = ${input.version} and deleted_at is null
      returning id, name, enabled, items, created_by_user_id, created_at, updated_at, version
    `)
    const row = rows[0]
    if (!row) {
      const exists = await tx.raw<{ id: string }>(sql`
        select id from app.onboarding_templates
        where id = ${id} and department_id = ${departmentId} and deleted_at is null
      `)
      return exists[0] ? { ok: 'conflict' } : { ok: 'not_found' }
    }
    tx.audit({
      action: 'pages.onboarding_template.updated',
      subjectType: 'onboarding_template',
      subjectId: row.id,
      departmentId,
      after: { id: row.id, enabled: row.enabled },
    })
    return { ok: 'done', row }
  })
}

export async function deleteOnboardingTemplate(
  departmentId: string,
  id: string,
  ctx: AuditCtx,
): Promise<boolean> {
  return withContext(toRequestContext(ctx, departmentId), async (tx) => {
    const rows = await tx.raw<{ id: string }>(sql`
      update app.onboarding_templates set deleted_at = now(), updated_at = now(), version = version + 1
      where id = ${id} and department_id = ${departmentId} and deleted_at is null
      returning id
    `)
    if (rows.length === 0) return false
    tx.audit({
      action: 'pages.onboarding_template.deleted',
      subjectType: 'onboarding_template',
      subjectId: id,
      departmentId,
    })
    return true
  })
}
