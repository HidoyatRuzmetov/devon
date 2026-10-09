import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  examplePassword,
  joinDepartmentAsNewUser,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'
import {
  controlOwnedContainer,
  FLOW_SERVICES_FILE,
  waitForOwnedCentrifugo,
  type FlowServiceState,
} from './flow-services.js'
import type { Card } from '../../src/features/work/api.js'

function observeRealtime(page: Page) {
  const observations = {
    connections: 0,
    closes: 0,
    publications: [] as string[],
    pageErrors: [] as string[],
  }
  page.on('pageerror', (error) => observations.pageErrors.push(error.message))
  page.on('websocket', (socket) => {
    socket.on('close', () => observations.closes++)
    socket.on('framereceived', ({ payload }) => {
      for (const line of payload.toString().split('\n')) {
        let data: unknown
        try {
          data = JSON.parse(line)
        } catch {
          continue
        }
        const replies = Array.isArray(data) ? data : [data]
        for (const value of replies) {
          if (!value || typeof value !== 'object') continue
          const reply = value as {
            connect?: { client?: string }
            push?: { pub?: { data?: { type?: string } } }
          }
          if (reply.connect?.client) observations.connections++
          if (reply.push?.pub?.data?.type) observations.publications.push(reply.push.pub.data.type)
        }
      }
    })
  })
  return observations
}

test('real two-browser card updates survive broker outage, offline gap and reconnect', async ({
  browser,
}) => {
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  const services = JSON.parse(readFileSync(FLOW_SERVICES_FILE, 'utf8')) as FlowServiceState
  let brokerStopped = false
  const forbiddenBrowserHosts: string[] = []
  try {
    for (const context of [head, member])
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
          forbiddenBrowserHosts.push(url.hostname)
          await route.abort('blockedbyclient')
        } else await route.continue()
      })
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('live.head'),
      headPassword: examplePassword(),
      departmentName: 'Local realtime QA',
    })
    await joinDepartmentAsNewUser(member, {
      login: uniqueLogin('live.member'),
      password: examplePassword(),
      joinKey: department.joinKey,
      joinPassword: department.joinPassword,
    })
    for (const actor of [head, member])
      expect((await authedPatch(actor, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const config = await (await member.request.get('/api/v1/realtime/config')).json()
    expect(config.enabled).toBe(true)
    expect(config.url).toBe(`ws://127.0.0.1:${services.port}/connection/websocket`)
    const headUser = (await (await head.request.get('/api/v1/me')).json()).user.id as string
    const memberUser = (await (await member.request.get('/api/v1/me')).json()).user.id as string
    expect(
      (
        await authedPost(member, '/api/v1/realtime/subscribe-token', {
          channel: `personal#${headUser}`,
        })
      ).status(),
    ).toBe(403)

    const created = await authedPost(head, '/api/v1/cards', {
      title: 'Realtime version 1',
      assigneeUserId: headUser,
    })
    expect(created.status()).toBe(201)
    const card = (await created.json()) as Card
    const editor = await head.newPage()
    const observer = await member.newPage()
    await Promise.all([
      editor.setViewportSize({ width: 1440, height: 900 }),
      observer.setViewportSize({ width: 1440, height: 900 }),
    ])
    const editorWire = observeRealtime(editor)
    const observerWire = observeRealtime(observer)
    await Promise.all([editor.goto('/work'), observer.goto('/work')])
    if (process.env['FLOW_PRODUCTION_BUILD'] === '1') {
      const scripts = await observer
        .locator('script[src]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('src')))
      expect(scripts.some((source) => source?.startsWith('/assets/'))).toBe(true)
      expect(
        scripts.some(
          (source) => source?.includes('/@vite/client') || source?.includes('/main.tsx'),
        ),
      ).toBe(false)
    }
    const observerCard = observer.locator(`[data-dnd-card="${card.id}"]`)
    await expect(
      observerCard.getByRole('button', { name: 'Realtime version 1', exact: true }),
    ).toBeVisible()
    await expect.poll(() => editorWire.connections).toBe(1)
    await expect.poll(() => observerWire.connections).toBe(1)
    await expect
      .poll(async () => {
        const response = await member.request.get(
          `/api/v1/realtime/presence?channel=${encodeURIComponent(config.channels.board)}`,
        )
        expect(response.status()).toBe(200)
        const presence = (await response.json()) as {
          available: boolean
          people: { userId: string }[]
        }
        expect(presence.available).toBe(true)
        return presence.people.map((person) => person.userId).sort()
      })
      .toEqual([headUser, memberUser].sort())
    await editor
      .locator(`[data-dnd-card="${card.id}"]`)
      .getByRole('button', { name: 'Realtime version 1', exact: true })
      .click()
    const title = editor.getByRole('textbox', { name: 'Title', exact: true })
    await expect(title).toHaveValue('Realtime version 1')
    const edit = async (next: string) => {
      const saved = editor.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          new URL(response.url()).pathname === `/api/v1/cards/${card.id}`,
      )
      await title.fill(next)
      await title.press('Tab')
      expect((await saved).status()).toBe(200)
      const persisted = await head.request.get(`/api/v1/cards/${card.id}`)
      expect((await persisted.json()).title).toBe(next)
    }
    await edit('Realtime version 2')
    await expect
      .poll(() => observerWire.publications.filter((type) => type === 'work.card.updated').length)
      .toBeGreaterThan(0)
    await expect(
      observerCard.getByRole('button', { name: 'Realtime version 2', exact: true }),
    ).toBeVisible()

    controlOwnedContainer(services.centrifugo, 'stop')
    brokerStopped = true
    await expect.poll(() => observerWire.closes).toBe(1)
    const publicationsBeforeOutage = observerWire.publications.length
    await edit('Realtime version 3 during outage')
    // The live transport is actually unavailable. The existing polling fallback must recover this
    // committed write without navigation, reload, synthetic messages or a mocked server response.
    await expect(
      observerCard.getByRole('button', { name: 'Realtime version 3 during outage', exact: true }),
    ).toBeVisible({ timeout: 15_000 })
    expect(observerWire.publications.length).toBe(publicationsBeforeOutage)

    await member.setOffline(true)
    await edit('Realtime version 4 during offline gap')
    await expect(
      observerCard.getByRole('button', { name: 'Realtime version 3 during outage', exact: true }),
    ).toBeVisible()
    controlOwnedContainer(services.centrifugo, 'start')
    brokerStopped = false
    await waitForOwnedCentrifugo(services.port)
    await expect.poll(() => editorWire.connections, { timeout: 25_000 }).toBe(2)
    await member.setOffline(false)
    await expect.poll(() => observerWire.connections, { timeout: 25_000 }).toBe(2)
    await expect(
      observerCard.getByRole('button', {
        name: 'Realtime version 4 during offline gap',
        exact: true,
      }),
    ).toBeVisible({ timeout: 15_000 })
    const beforeFinal = observerWire.publications.filter(
      (type) => type === 'work.card.updated',
    ).length
    await edit('Realtime version 5 after recovery')
    await expect
      .poll(() => observerWire.publications.filter((type) => type === 'work.card.updated').length)
      .toBeGreaterThan(beforeFinal)
    await expect(
      observerCard.getByRole('button', { name: 'Realtime version 5 after recovery', exact: true }),
    ).toBeVisible()
    expect(editorWire.pageErrors).toEqual([])
    expect(observerWire.pageErrors).toEqual([])
    expect(forbiddenBrowserHosts).toEqual([])
    await observer.screenshot({
      path: test.info().outputPath('real-realtime-recovered.png'),
      fullPage: true,
    })
    await test.info().attach('real-realtime-observations', {
      body: JSON.stringify(
        {
          editor: editorWire,
          observer: observerWire,
          persistedTitle: 'Realtime version 5 after recovery',
        },
        null,
        2,
      ),
      contentType: 'application/json',
    })
  } finally {
    if (brokerStopped) {
      controlOwnedContainer(services.centrifugo, 'start')
      await waitForOwnedCentrifugo(services.port)
    }
    await Promise.all([admin.close(), head.close(), member.close()])
  }
})
