// Dedicated browser-fixture entry point. The API, queue, validation, permissions, scanner, object
// store, confirmations and audit remain real. Only model output is deterministic. Never imported by
// production; the ordinary server entry point has no fixture branch or mock-provider environment flag.
import { randomUUID } from 'node:crypto'
import { MockProvider, type ChatCompletionResult } from '@devon/ai'
import { __setProviderForTests } from '../../src/modules/ai/service.js'

const database = new URL(process.env['DATABASE_URL'] ?? '')
if (
  process.env['FLOW_AI_ACTION_FIXTURE'] !== '1' ||
  process.env['NODE_ENV'] === 'production' ||
  process.env['API_HOST'] !== '127.0.0.1' ||
  !['127.0.0.1', 'localhost'].includes(database.hostname) ||
  !/^\/devon_flow_e2e(?:_[a-z0-9]+)*$/.test(database.pathname) ||
  process.env['AI_API_KEY']
)
  throw new Error('The AI browser fixture requires an owned, credential-free local flow database')

function answer(content: string, actions: unknown[] = []): ChatCompletionResult {
  return {
    content: null,
    reasoningContent: null,
    finishReason: 'tool_calls',
    usage: { promptTokens: 100, completionTokens: 100, totalTokens: 200 },
    toolCalls: [
      {
        id: randomUUID(),
        name: 'department_chat_answer',
        argumentsJson: JSON.stringify({ content, citations: [], actions }),
      },
    ],
  }
}

__setProviderForTests(
  new MockProvider({
    respond(request) {
      if (!request.tools?.some((tool) => tool.name === 'department_chat_answer'))
        throw new Error('The action browser fixture only supports department_chat_answer')
      const latest =
        request.messages.filter((message) => message.role === 'user').at(-1)?.content ?? ''
      // Naming receives JSON conversation excerpts. Only the action turn receives the scanned file.
      if (latest.startsWith('{')) {
        const excerpts = JSON.parse(latest) as { requests: string[] }
        if (excerpts.requests.some((text) => text.startsWith('Create a page named')))
          return answer('Directory publication')
        if (excerpts.requests.some((text) => text.startsWith('Create a task to review')))
          return answer('Directory review assignment')
        throw new Error('Browser fixture received an unexpected conversation to name')
      }
      const attachmentLine = latest.split('\n').find((line) => line.startsWith('Attached files: '))
      const files = attachmentLine
        ? (JSON.parse(attachmentLine.slice('Attached files: '.length)) as { id: string }[])
        : []
      const card = latest.includes('Create a task')
      const title = card ? 'Review the published directory' : 'AI publication browser test'
      const actions = [
        {
          kind: card ? 'card.create' : 'page.create',
          title: card ? 'Create the review task' : 'Publish the directory page',
          summary: 'Create the requested content and attach the uploaded file after confirmation.',
          arguments: {
            body: card
              ? {
                  title,
                  description: 'Review the attached directory and confirm the contact details.',
                  priority: 'medium',
                }
              : {
                  title,
                  blocks: {
                    type: 'doc',
                    content: [
                      {
                        type: 'paragraph',
                        content: [
                          {
                            type: 'text',
                            text: 'Download the directory below to find colleague contact details.',
                            marks: [{ type: 'bold' }],
                          },
                        ],
                      },
                    ],
                  },
                },
            attachmentIds: files.map((file) => file.id),
          },
        },
      ]
      if (!files.length)
        throw new Error('Browser fixture expected a real persisted upload in chat context')
      return answer(
        '**Ready for your review.** The proposed change will only run after you confirm it.',
        actions,
      )
    },
  }),
)
await import('../../src/server.js')
