import { PgBoss } from 'pg-boss'
import type { FastifyBaseLogger } from 'fastify'
import { queueDatabaseOptions } from '../../lib/queue-database.js'
import { processConversation, stopConversationRuns, type ConversationJob } from './conversations.js'

const QUEUE = 'ai.conversation'
let boss: PgBoss | null = null
let testEnqueue: ((job: ConversationJob) => Promise<void>) | null = null
export function __setConversationEnqueueForTests(enqueue: typeof testEnqueue) {
  testEnqueue = enqueue
}
export async function enqueueConversation(job: ConversationJob): Promise<void> {
  if (testEnqueue) return testEnqueue(job)
  if (!boss) throw new Error('conversation_worker_unavailable')
  const id = await boss.send(QUEUE, job, {
    retryLimit: 2,
    retryBackoff: true,
    retryDelay: 10,
    expireInSeconds: 360,
  })
  if (!id) throw new Error('conversation_enqueue_failed')
}
export async function startConversationJobs(databaseUrl: string, log: FastifyBaseLogger) {
  const instance = new PgBoss(queueDatabaseOptions(databaseUrl))
  instance.on('error', () => log.error('ai: conversation queue unavailable'))
  try {
    await instance.start()
    await instance.createQueue(QUEUE)
    await instance.work<ConversationJob>(QUEUE, async (jobs) => {
      for (let index = 0; index < jobs.length; index++) {
        // nosemgrep: query-in-loop -- Serialized bounded AI jobs avoid exhausting one provider.
        await processConversation(jobs[index]!.data)
      }
    })
    boss = instance
    return {
      stop: async () => {
        boss = null
        stopConversationRuns()
        await instance.stop({ graceful: true })
      },
    }
  } catch {
    await instance.stop().catch(() => {})
    log.error('ai: conversation queue failed to start; saved chats remain readable')
    return null
  }
}
