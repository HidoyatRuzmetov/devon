import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertLocalTestDatabase } from './flow-safety.js'
import { assertLocalDockerEndpoint } from './flow-services.js'
import {
  FLOW_APP_ROLE,
  FLOW_DB_CONTAINER,
  FLOW_DB_HOST,
  FLOW_DB_NAME,
  FLOW_DB_PORT,
} from './flow-env.js'

export const WORKER_NAMESPACE = 'devon_flow_e2e_worker'
export type WorkQueue = 'work.recurrence' | 'work.reminders'

function assertOwnedDatabase(): void {
  if (FLOW_DB_NAME !== WORKER_NAMESPACE)
    throw new Error('Work queue proof requires its exact exclusive worker namespace')
  assertLocalTestDatabase({
    host: FLOW_DB_HOST,
    database: FLOW_DB_NAME,
    container: FLOW_DB_CONTAINER,
    port: FLOW_DB_PORT,
  })
  const context = spawnSync(
    'docker',
    ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
    {
      encoding: 'utf8',
      timeout: 10_000,
    },
  )
  if (context.status !== 0) throw new Error('Work queue proof cannot verify local Docker ownership')
  assertLocalDockerEndpoint(context.stdout.trim())
  if (process.env['DOCKER_HOST']) assertLocalDockerEndpoint(process.env['DOCKER_HOST'])
}

function sql(text: string): string {
  assertOwnedDatabase()
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      FLOW_DB_CONTAINER,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      FLOW_DB_NAME,
      '-At',
    ],
    { input: text, encoding: 'utf8', timeout: 15_000 },
  )
  // SQL may include the generated producer password: never print input or driver stderr.
  if (result.status !== 0) throw new Error('Owned worker proof SQL operation failed')
  return result.stdout.trim()
}

function uuid(value: string): string {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value))
    throw new Error('Worker proof only accepts exact fixture UUIDs')
  return value
}

function rows<T>(query: string): T[] {
  return JSON.parse(sql(`select coalesce(json_agg(x), '[]'::json) from (${query}) x;`)) as T[]
}

export type SeriesRow = {
  id: string
  title: string
  status: string
  due_at: string | null
  recurrence_series_id: string
  recurrence_index: number
}
export function readSeries(id: string): SeriesRow[] {
  return rows<SeriesRow>(`select id,title,status,due_at,recurrence_series_id,recurrence_index
    from app.cards where recurrence_series_id='${uuid(id)}' and deleted_at is null order by recurrence_index`)
}

export type ReminderRow = {
  id: string
  remind_at: string
  sent_at: string | null
  note: string | null
}
export function readReminders(cardId: string, userId: string): ReminderRow[] {
  return rows<ReminderRow>(`select id,remind_at,sent_at,note from app.card_reminders
    where card_id='${uuid(cardId)}' and user_id='${uuid(userId)}' and deleted_at is null order by remind_at`)
}

export type NotificationRow = { id: string; deep_link: string; body: { en: string } }
export function readReminderNotifications(cardId: string, userId: string): NotificationRow[] {
  return rows<NotificationRow>(`select id,deep_link,body from app.notifications
    where subject_id='${uuid(cardId)}' and user_id='${uuid(userId)}' and type='work.card.reminder' order by created_at`)
}

export function readQueueJob(
  id: string,
): { id: string; name: string; state: string; output: unknown }[] {
  return rows(`select id,name,state,output from pgboss.job where id='${uuid(id)}'`)
}

interface Producer {
  start(): Promise<unknown>
  send(name: WorkQueue): Promise<string | null>
  stop(options: { graceful: boolean }): Promise<unknown>
  on(name: 'error', handler: (error: unknown) => void): void
}
type ProducerConstructor = new (options: Record<string, unknown>) => Producer

/** Real PgBoss producer with one connection, no workers, cron or schema changes. Its only login is
 * generated in memory, belongs to this disposable namespace, and is removed after disconnect. */
export async function createWorkQueueProducer(): Promise<{
  enqueue(queue: WorkQueue): Promise<string>
  close(): Promise<void>
}> {
  assertOwnedDatabase()
  const producerRole = `qa_worker_${randomBytes(8).toString('hex')}`
  const producerPassword = randomBytes(24).toString('base64url')
  sql(`begin; create role ${producerRole} login password '${producerPassword}' nosuperuser nobypassrls;
    grant ${FLOW_APP_ROLE} to ${producerRole}; commit;`)
  let producer: Producer | undefined
  const errors: unknown[] = []
  const close = async () => {
    try {
      await producer?.stop({ graceful: true })
    } finally {
      sql(`drop role ${producerRole};`)
    }
  }
  try {
    const apiRequire = createRequire(resolve(import.meta.dirname, '../../../api/package.json'))
    const loaded = (await import(pathToFileURL(apiRequire.resolve('pg-boss')).href)) as {
      PgBoss: ProducerConstructor
    }
    producer = new loaded.PgBoss({
      host: FLOW_DB_HOST,
      port: FLOW_DB_PORT,
      database: FLOW_DB_NAME,
      user: producerRole,
      password: producerPassword,
      max: 1,
      application_name: 'qa-work-queue-producer',
      connectionTimeoutMillis: 3000,
      migrate: false,
      supervise: false,
      schedule: false,
      useListenNotify: false,
    })
    producer.on('error', (error) => errors.push(error))
    await producer.start()
    return {
      async enqueue(queue) {
        if (!['work.recurrence', 'work.reminders'].includes(queue))
          throw new Error('Worker proof refuses unrelated queues')
        if (errors.length > 0) throw new Error('Owned worker producer reported a transport failure')
        const id = await producer!.send(queue)
        if (!id) throw new Error('Owned worker enqueue produced no receipt')
        return uuid(id)
      },
      close,
    }
  } catch {
    await close()
    throw new Error('Owned work queue producer failed to start')
  }
}
