import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(
  new URL('../ops/birthday-announcement.browser.js', import.meta.url),
  'utf8',
)
const departmentId = '6a98d657-83d6-4e58-99a0-489a71069d0d'
const groupId = '57e066ea-428a-4bad-b260-36cac86f7da1'
const headUserId = '7f52fc37-ab25-4998-9b67-011cc71c2dc6'
const operationId = '8d1c2ab0-552d-46f0-9cb4-10761f652031'

function setup({
  origin = 'https://87.192.236.63',
  userId = headUserId,
  connected = true,
  send,
} = {}) {
  const calls = []
  const page = {}
  const sandbox = vm.createContext({
    location: { origin },
    top: page,
    self: page,
    fetch: async (path, options) => {
      calls.push({ path, options })
      if (options.method === 'POST') {
        if (send) return send()
        return { ok: true, status: 200 }
      }
      const body =
        path === '/api/v1/me'
          ? {
              user: { id: userId, role: 'head' },
              actingForUserId: null,
              activeDepartmentId: departmentId,
              memberships: [{ departmentId, role: 'head' }],
              csrfToken: 'synthetic-csrf-only', // Dummy value; this test never opens a real session.
            }
          : { items: connected ? [{ id: groupId, chatId: 'never-return-this' }] : [] }
      return { ok: true, status: 200, json: async () => body }
    },
  })
  vm.runInContext(source, sandbox)
  return { calls, run: sandbox.workPortalBirthdayAnnouncement }
}

test('loading and inspecting the operation never sends, reads cookies, or returns session material', async () => {
  const { calls, run } = setup()
  assert.equal(calls.length, 0)
  const result = await run()
  assert.equal(result.status, 'ready')
  assert.equal(calls.length, 2)
  assert.equal(
    calls.some(({ options }) => options.method === 'POST'),
    false,
  )
  assert.doesNotMatch(JSON.stringify(result), /csrf|chatId|never-return-this|synthetic/)
  assert.doesNotMatch(source, /document\.cookie|localStorage|sessionStorage/)
})

test('refuses a different origin, head, or disconnected group before any send', async () => {
  for (const options of [
    { origin: 'https://elsewhere.example' },
    { userId: 'another-user' },
    { connected: false },
  ]) {
    const { calls, run } = setup(options)
    await assert.rejects(run('send'))
    assert.equal(
      calls.some(({ options }) => options.method === 'POST'),
      false,
    )
  }
})

test('uses the existing canonical route, fixed receipt, and normal in-memory CSRF', async () => {
  const { calls, run } = setup()
  const result = await run('send')
  assert.equal(result.status, 'sent-or-already-sent')
  const post = calls.find(({ options }) => options.method === 'POST')
  assert.equal(post.path, '/api/v1/telegram/group-message')
  assert.equal(post.options.headers['x-operation-id'], operationId)
  assert.equal(post.options.headers['x-csrf-token'], 'synthetic-csrf-only')
  assert.equal(post.options.credentials, 'same-origin')
  assert.equal(post.options.redirect, 'error')
  assert.deepEqual(JSON.parse(post.options.body), {
    groupId,
    message: result.message,
    mentionAll: false,
  })
})

test('ambiguous delivery and receipt conflicts are surfaced without retrying', async () => {
  for (const send of [
    () => {
      throw new Error('connection lost')
    },
    () => ({ ok: false, status: 409 }),
  ]) {
    const { calls, run } = setup({ send })
    await assert.rejects(run('send'), /Check receipt .*do not use a new operation ID/)
    assert.equal(calls.filter(({ options }) => options.method === 'POST').length, 1)
  }
})
