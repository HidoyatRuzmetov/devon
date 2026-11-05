// A credential-free local birthday capture. Only the model output is deterministic: account
// publication, DOB, configured AI settings, metering, cache, receipts and UI use production code.
// This entry is never imported by src/server.ts and cannot start against a production database.
import { randomUUID } from 'node:crypto'
import { MockProvider } from '@devon/ai'
import { __setProviderForTests } from '../../src/modules/ai/service.js'

const database = new URL(process.env['DATABASE_URL'] ?? '')
if (
  process.env['FLOW_BIRTHDAY_FIXTURE'] !== '1' ||
  process.env['NODE_ENV'] === 'production' ||
  process.env['API_HOST'] !== '127.0.0.1' ||
  !['127.0.0.1', 'localhost'].includes(database.hostname) ||
  !/^\/devon_flow_e2e(?:_[a-z0-9]+)*$/.test(database.pathname) ||
  process.env['AI_API_KEY'] ||
  process.env['TELEGRAM_BOT_TOKEN']
)
  throw new Error('Birthday capture requires an owned, credential-free local flow database')

__setProviderForTests(
  new MockProvider({
    respond(request) {
      if (
        !request.tools?.some((tool) => tool.name === 'department_chat_answer') ||
        !request.messages.some(
          (message) => message.role === 'system' && message.content?.includes('birthday letter'),
        )
      )
        throw new Error('Birthday fixture only supports birthday letter generation')
      const context = JSON.parse(
        request.messages.filter((message) => message.role === 'user').at(-1)?.content ?? '{}',
      ) as { interests?: { hobbies?: string[] } }
      const content = context.interests?.hobbies?.includes('Reading')
        ? 'May the year ahead bring fresh ideas for the systems you build, and unhurried afternoons with a good book. May your curiosity lead you to rewarding discoveries, with space for small adventures and the people you love. We wish you steady health, happy shared moments, and plenty of reasons to smile along the way.'
        : 'May this birthday open a year filled with bright possibilities and little moments worth keeping. We wish you the freedom to follow your curiosity, the courage to try something new, and time to enjoy all that makes you smile. May good health and quiet happiness accompany you through every new chapter.'
      return {
        content: null,
        reasoningContent: null,
        finishReason: 'tool_calls',
        usage: { promptTokens: 100, completionTokens: 100, totalTokens: 200 },
        toolCalls: [
          {
            id: randomUUID(),
            name: 'department_chat_answer',
            argumentsJson: JSON.stringify({ content, citations: [], actions: [] }),
          },
        ],
      }
    },
  }),
)
await import('../../src/server.js')
