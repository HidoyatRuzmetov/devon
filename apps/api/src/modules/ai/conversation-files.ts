import { sql, type SQL } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'
import type { AiChatSource } from '@devon/contracts'
import type { ObjectStore } from '../../lib/storage/object-store.js'
import { extractFileText, type FileText } from './file-text.js'

let store: ObjectStore | undefined
export function configureConversationFiles(value: ObjectStore) {
  store = value
}
type FileRow = {
  id: string
  name: string
  mime: string
  size: number
  key: string
  subject_type: string
  subject_id: string
  status: FileText['status'] | null
  body: string | null
}
function visibleFile(ctx: RequestContext, conversationId?: string): SQL {
  return sql`a.department_id=${ctx.departmentId} and a.deleted_at is null and a.scan_status='clean' and (
    (a.subject_type='card' and exists(select 1 from app.cards c where c.id=a.subject_id and c.deleted_at is null)) or
    (a.subject_type='page' and exists(select 1 from app.pages p where p.id=a.subject_id and p.deleted_at is null)) or
    (a.subject_type='ai_conversation' and a.subject_id=${conversationId ?? null}::uuid and a.uploaded_by_user_id=${ctx.userId}
      and exists(select 1 from app.ai_conversations c where c.id=a.subject_id and c.owner_user_id=${ctx.userId}))
  )`
}

/** Live authorization surrounds extraction/cache use; removed parents/files never enter new
 * context, and cache writes are a single bounded batch rather than one transaction per file. */
export async function conversationFiles(
  ctx: RequestContext,
  conversationId?: string,
  priorityIds: string[] = [],
) {
  const files = await withContext(ctx, (tx) =>
    tx.raw<FileRow>(sql`
    select a.id,a.name,a.mime,a.size,a.key,a.subject_type,a.subject_id,t.status,t.body
    from app.attachments a left join app.ai_file_text t on t.attachment_id=a.id and t.object_key=a.key and t.parser_version=1
    where ${visibleFile(ctx, conversationId)}
    order by case when a.id=any(${sql.param(priorityIds)}::uuid[]) then 0 else 1 end,a.created_at desc limit 1000`),
  )
  const extracted: { file: FileRow; content: FileText }[] = []
  const toCache: { file: FileRow; content: FileText }[] = []
  const deadline = Date.now() + 35_000
  for (const file of files) {
    let content: FileText = { status: file.status ?? 'unavailable', text: file.body ?? '' }
    if (!file.status && store && Date.now() < deadline && file.size <= 20 * 1024 * 1024) {
      try {
        // Sequential reads/parsing share a wall-time and process-wide two-worker memory budget.
        // nosemgrep: query-in-loop -- next read waits for the previous parse to release its memory.
        const bytes = await store.get(file.key, { maxBytes: 20 * 1024 * 1024 })
        content = bytes
          ? // nosemgrep: query-in-loop -- same shared time/memory budget; DB writes are batched below.
            await extractFileText(bytes, file.name, Math.min(20_000, deadline - Date.now()))
          : content
        if (content.status !== 'unavailable') toCache.push({ file, content })
      } catch {
        content = { status: 'unavailable', text: '' }
      }
    }
    extracted.push({ file, content })
  }
  if (toCache.length) {
    const values = sql.join(
      toCache.map(
        ({ file, content }) =>
          sql`(${file.id}::uuid,${file.key}::text,${content.status}::text,${content.text}::text)`,
      ),
      sql`, `,
    )
    try {
      await withContext(ctx, (tx) =>
        tx.raw(sql`
        insert into app.ai_file_text(attachment_id,department_id,object_key,status,body)
        select a.id,a.department_id,v.object_key,v.status,v.body
        from (values ${values}) v(id,object_key,status,body) join app.attachments a on a.id=v.id and a.key=v.object_key
        where ${visibleFile(ctx, conversationId)}
        on conflict(attachment_id) do update set object_key=excluded.object_key,status=excluded.status,body=excluded.body,parser_version=1`),
      )
    } catch {
      // Cache persistence is optional. A concurrent deletion/permission change must not turn an
      // otherwise answerable question into a failure, nor cause us to recreate a missing file.
    }
  }
  const live = files.length
    ? await withContext(ctx, (tx) =>
        tx.raw<{ id: string; key: string }>(sql`
    select a.id,a.key from app.attachments a where a.id=any(${sql.param(files.map((file) => file.id))}::uuid[]) and ${visibleFile(ctx, conversationId)}`),
      )
    : []
  const liveKeys = new Map(live.map((file) => [file.id, file.key]))
  const evidence: unknown[] = [],
    sources: AiChatSource[] = []
  let chars = 0,
    limited = files.length === 1000
  for (const { file, content } of extracted) {
    if (liveKeys.get(file.id) !== file.key) continue
    const remaining = Math.max(0, 180_000 - chars)
    const text = content.text.slice(0, remaining)
    const status = text.length < content.text.length ? 'truncated' : content.status
    if (status !== 'read') limited = true
    chars += text.length
    const ref = `attachment:${file.id}`
    const href =
      file.subject_type === 'page'
        ? `/pages?page=${file.subject_id}`
        : file.subject_type === 'card'
          ? `/work/card?id=${file.subject_id}`
          : '/'
    sources.push({ ref, title: file.name, href })
    evidence.push({
      ref,
      name: file.name,
      mime: file.mime,
      size: file.size,
      parent: `${file.subject_type}:${file.subject_id}`,
      status,
      text,
    })
  }
  return { evidence, sources, limited }
}
