import type { PoolClient, QueryResult } from 'pg'
import type { AuditEventInput } from './audit.js'

// Operational bookkeeping is not a user action. Domain writes are included by default,
// so a newly added feature does not silently fall outside the verification chain.
const bookkeeping = new Set([
  'sessions',
  'setup_tokens',
  'seed_runs',
  'join_attempts',
  'outbox_events',
  'card_activity',
  'work_action_receipts',
  'portal_onboarding',
  'ai_context_revisions',
  'ai_file_text',
  'ai_search_documents',
  'ai_traces',
  'ai_briefings',
  'event_reminder_jobs',
  'event_telegram_deliveries',
  'notification_deliveries',
  'checkin_reminders',
  'personal_calendar_reminders',
  'telegram_link_codes',
  'telegram_group_connect_codes',
])

export function describeWrite(
  text: string,
  result: Pick<QueryResult, 'command' | 'rowCount' | 'rows'>,
): AuditEventInput | null {
  if (!result.rowCount || !['INSERT', 'UPDATE', 'DELETE'].includes(result.command)) return null
  const statement = text.replaceAll('"', '')
  const pattern =
    result.command === 'INSERT'
      ? /\binsert\s+into\s+app\.(\w+)/i
      : result.command === 'UPDATE'
        ? /\bupdate\s+app\.(\w+)/i
        : /\bdelete\s+from\s+app\.(\w+)/i
  const table = pattern.exec(statement)?.[1]
  if (!table || bookkeeping.has(table)) return null
  const operation =
    result.command === 'INSERT' ? 'created' : result.command === 'DELETE' ? 'deleted' : 'updated'
  const id =
    result.rows.length === 1
      ? (result.rows[0] as Record<string, unknown> | undefined)?.['id']
      : null
  const fields =
    result.command === 'UPDATE'
      ? [
          ...(statement.split(/\bset\b/i)[1]?.split(/\bwhere\b|\breturning\b/i)[0] ?? '').matchAll(
            /(?:^|,)\s*(\w+)\s*=/g,
          ),
        ].map((m) => m[1]!)
      : result.command === 'INSERT'
        ? (statement.match(/\bapp\.\w+\s*\(([^)]+)\)/i)?.[1] ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : []
  return {
    action: `data.record.${operation}`,
    subjectType: table,
    subjectId:
      typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
        ? id
        : null,
    // Values, SQL, prompts, attachments and credentials never enter the fallback record.
    after: { table, operation, rowsAffected: result.rowCount, fields },
  }
}

/** Observe Drizzle and raw writes on this transaction's connection without altering the pool client. */
export function trackWrites(client: PoolClient, writes: AuditEventInput[]): PoolClient {
  const execute = client.query.bind(client) as (
    config: unknown,
    values?: unknown,
  ) => Promise<QueryResult>
  return new Proxy(client, {
    get(target, key, receiver) {
      if (key !== 'query') return Reflect.get(target, key, receiver)
      return async (config: string | { text: string }, values?: unknown) => {
        const result = await execute(config, values)
        const event = describeWrite(typeof config === 'string' ? config : config.text, result)
        if (event) writes.push(event)
        return result
      }
    },
  })
}
