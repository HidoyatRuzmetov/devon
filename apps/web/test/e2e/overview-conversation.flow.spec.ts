import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { AiConversation } from '@devon/contracts'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'

test('@flow real conversation queue saves a failed turn and restores it after reload', async ({
  browser,
}) => {
  test.setTimeout(60_000)
  const admin = await newFlowContext(browser)
  const context = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    await createApprovedDepartment(context, admin, {
      headLogin: uniqueLogin('savedchat.head'),
      headPassword: examplePassword(),
      departmentName: 'Synthetic Saved Chat QA',
    })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const id = randomUUID()
    expect(
      (
        await authedPost(context, '/api/v1/ai/conversations', {
          id,
          locale: 'en',
          seedBriefing: false,
        })
      ).status(),
    ).toBe(200)
    const content = 'Which work needs attention before the next review?'
    expect(
      (
        await authedPost(context, `/api/v1/ai/conversations/${id}/messages`, {
          id: randomUUID(),
          content,
        })
      ).status(),
    ).toBe(202)
    // The isolated flow stack strips provider credentials. Its real queue must save a truthful
    // failure rather than invent an answer; ordinary provider success is covered by API tests.
    const read = async () =>
      (await (await context.request.get(`/api/v1/ai/conversations/${id}`)).json()) as AiConversation
    await expect.poll(async () => (await read()).status, { timeout: 25_000 }).toBe('ready')
    const saved = await read()
    expect(saved.messages).toHaveLength(1)
    expect(saved.messages[0]).toMatchObject({ role: 'user', content, status: 'failed' })
    expect(['provider_unavailable', 'feature_disabled', 'budget_exceeded']).toContain(
      saved.messages[0]!.error,
    )
    const page = await context.newPage()
    await page.goto(`/?conversation=${id}`)
    await expect(page.getByTestId('head-overview')).toHaveAttribute('data-mode', 'conversation')
    await expect(page.getByTestId('ai-messages')).toContainText(content)
    await page.reload()
    await expect(page.getByTestId('ai-messages')).toContainText(content)
    const listed = (await (await context.request.get('/api/v1/ai/conversations')).json()) as {
      conversations: { id: string }[]
    }
    expect(listed.conversations.some((item) => item.id === id)).toBe(true)
  } finally {
    await context.close()
    await admin.close()
  }
})

// Controlled provider-facing responses for UI lifecycle verification. API integration tests separately
// exercise real database persistence, RLS, queue delivery and the complete provider request history.
test('@flow overview conversation expands, resumes after reload and reopens saved history', async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000)
  const admin = await newFlowContext(browser)
  const context = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    await createApprovedDepartment(context, admin, {
      headLogin: uniqueLogin('conversation.head'),
      headPassword: examplePassword(),
      departmentName: 'Synthetic Conversation QA',
    })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const cardResponse = await authedPost(context, '/api/v1/cards', {
      title: 'Prepare the evidence package',
    })
    expect(cardResponse.status()).toBe(201)
    const card = (await cardResponse.json()) as { id: string }
    const page = await context.newPage()
    await page.setViewportSize({ width: 1440, height: 900 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const conversations = new Map<string, AiConversation>()
    const now = () => new Date().toISOString()
    let active: AiConversation | undefined
    const answer = (content: string) => {
      if (!active) throw new Error('No pending conversation')
      const message = active.messages.at(-1)!
      expect(message.status).toBe('pending')
      message.status = 'complete'
      active.messages.push({
        id: randomUUID(),
        role: 'assistant',
        content,
        createdAt: now(),
        status: 'complete',
        error: null,
        sources: [
          {
            ref: `card:${card.id}`,
            title: 'Prepare the evidence package',
            href: `/work/card?id=${card.id}`,
          },
        ],
        context: {
          generatedAt: now(),
          recordsIncluded: 1,
          recordsTotal: 1,
          historyMessages: active.messages.length,
          limited: false,
        },
      })
      active.messageCount = active.messages.length
      active.status = 'ready'
      active.updatedAt = now()
    }
    await page.route('**/api/v1/ai/briefing', (route) =>
      route.fulfill({
        json: {
          canRefresh: true,
          briefing: {
            day: '2026-10-21',
            locale: 'en',
            status: 'ready',
            generatedAt: now(),
            error: null,
            latencyMs: 100,
            data: {
              headline: 'The evidence package is the next priority.',
              wins: { text: 'The first research review is complete.', citedIds: [] },
              risks: [
                { cardId: card.id, text: 'Confirm the evidence package owner.', severity: 'high' },
              ],
              overloaded: [],
              lookingAhead: {
                text: 'The next delivery review will confirm readiness.',
                citedIds: [],
              },
              items: [],
              moreCount: 0,
              needsActionCount: 1,
            },
          },
        },
      }),
    )
    await page.route('**/api/v1/ai/conversations**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      const suffix = path.replace('/api/v1/ai/conversations', '')
      if (!suffix && request.method() === 'GET') {
        return route.fulfill({
          json: {
            conversations: [...conversations.values()].map(
              ({ messages: _messages, ...summary }) => summary,
            ),
            nextCursor: null,
          },
        })
      }
      if (!suffix && request.method() === 'POST') {
        const body = request.postDataJSON() as { id: string; locale: 'en'; seedBriefing: boolean }
        const conversation: AiConversation = {
          id: body.id,
          title: 'Department briefing',
          locale: body.locale,
          createdAt: now(),
          updatedAt: now(),
          messageCount: 1,
          status: 'ready',
          messages: [
            {
              id: randomUUID(),
              role: 'assistant',
              content:
                '**The evidence package is the next priority.**\n\n- The first research review is complete.\n- Confirm the evidence package owner.',
              createdAt: now(),
              status: 'complete',
              error: null,
              sources: [],
              context: null,
            },
          ],
        }
        conversations.set(conversation.id, conversation)
        return route.fulfill({ status: 201, json: conversation })
      }
      const id = suffix.split('/')[1]!
      const conversation = conversations.get(id)
      if (!conversation)
        return route.fulfill({
          status: 404,
          json: { status: 404, title: 'Conversation not found' },
        })
      if (request.method() === 'GET') return route.fulfill({ json: conversation })
      if (suffix.endsWith('/messages')) {
        const body = request.postDataJSON() as { id: string; content: string }
        if (!conversation.messages.some((message) => message.id === body.id)) {
          conversation.messages.push({
            id: body.id,
            role: 'user',
            content: body.content,
            createdAt: now(),
            status: 'pending',
            error: null,
            sources: [],
            context: null,
          })
          conversation.title = conversation.messages
            .find((message) => message.role === 'user')!
            .content.slice(0, 120)
          conversation.status = 'running'
          conversation.messageCount = conversation.messages.length
          active = conversation
        }
        return route.fulfill({ status: 202, json: conversation })
      }
      return route.fulfill({
        status: 400,
        json: { status: 400, title: 'Unexpected fixture request' },
      })
    })
    await page.goto('/')
    const overview = page.getByTestId('head-overview')
    const composer = page.getByRole('textbox', { name: 'Ask about your department', exact: true })
    await expect(composer).toBeVisible()
    await expect(overview).toHaveAttribute('data-mode', 'overview')
    await composer.fill('What needs my attention this week?')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(overview).toHaveAttribute('data-mode', 'conversation')
    await expect(page.getByTestId('ai-messages')).toContainText(
      'What needs my attention this week?',
    )
    await expect.poll(() => active?.status).toBe('running')
    await expect(page).toHaveURL(/conversation=/)
    // Reload while the model is answering: the saved pending turn remains visible and resumes polling.
    await page.reload()
    await expect(overview).toHaveAttribute('data-mode', 'conversation')
    await expect(page.getByTestId('ai-messages')).toContainText(
      'What needs my attention this week?',
    )
    answer(
      '**Confirm the evidence package owner.**\n\n- Review the pending evidence.\n- Agree the next delivery date.',
    )
    await expect(
      page
        .getByTestId('ai-messages')
        .locator('strong')
        .filter({ hasText: 'Confirm the evidence package owner.' }),
    ).toBeVisible()
    await expect(
      page
        .getByTestId('ai-messages')
        .getByRole('listitem')
        .filter({ hasText: 'Agree the next delivery date.' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Back to overview', exact: true }).click()
    await expect(overview).toHaveAttribute('data-mode', 'overview')
    await page.getByRole('button', { name: 'Saved conversations', exact: true }).click()
    await page.getByRole('button', { name: /What needs my attention this week/ }).click()
    await expect(overview).toHaveAttribute('data-mode', 'conversation')
    await composer.fill('Which team owns it?')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect.poll(() => active?.status).toBe('running')
    answer(
      '**The Research unit owns the evidence package.**\n\nThe previous answer referred to that same package.\n\n- Confirm the accountable owner.\n- Review the supporting evidence.\n- Agree the delivery date.',
    )
    await expect(page.getByTestId('ai-messages')).toContainText(
      'The previous answer referred to that same package.',
    )
    await page.reload()
    await expect(page.getByTestId('ai-messages')).toContainText('Which team owns it?')
    await expect(page.getByTestId('ai-messages')).toContainText(
      'The Research unit owns the evidence package.',
    )
    const conversationUrl = page.url()
    await page
      .getByTestId('ai-messages')
      .getByRole('link', { name: 'Prepare the evidence package', exact: true })
      .first()
      .click()
    await expect(page).toHaveURL(/\/work\/card\?/)
    await page.getByRole('link', { name: /Back to board/ }).click()
    await page.locator('main').getByRole('link', { name: 'Table', exact: true }).click()
    await expect(page).toHaveURL(/\/work\/table\?.*conversation=/)
    await page.getByRole('link', { name: /Back to overview/ }).click()
    await expect(page).toHaveURL(conversationUrl)
    await expect(overview).toHaveAttribute('data-mode', 'conversation')
    await expect(page.getByTestId('ai-messages')).toContainText('Which team owns it?')
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
      .toBeLessThanOrEqual(901)
    const latestGap = () =>
      page
        .getByTestId('ai-messages')
        .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)
    await expect.poll(latestGap).toBeLessThan(3)
    await page.screenshot({ path: testInfo.outputPath('conversation-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
      .toBeLessThanOrEqual(845)
    await expect(composer).toBeVisible()
    expect((await composer.boundingBox())!.y + (await composer.boundingBox())!.height).toBeLessThan(
      790,
    )
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391)
    await expect.poll(latestGap).toBeLessThan(3)
    await page.screenshot({ path: testInfo.outputPath('conversation-mobile.png') })
    // Simulate the mobile keyboard's visual viewport contract without changing layout width.
    await page.evaluate(() => {
      const visual = window.visualViewport!
      Object.defineProperty(visual, 'height', { configurable: true, value: 520 })
      visual.dispatchEvent(new Event('resize'))
    })
    await expect
      .poll(async () => {
        const bounds = await composer.boundingBox()
        return bounds!.y + bounds!.height
      })
      .toBeLessThan(520)
    await expect.poll(latestGap).toBeLessThan(3)
    await page.evaluate(() => {
      delete (window.visualViewport as unknown as { height?: number }).height
      window.visualViewport!.dispatchEvent(new Event('resize'))
    })
    await expect.poll(latestGap).toBeLessThan(3)
    await page.getByTestId('ai-messages').focus()
    await page.keyboard.press('Control+Home')
    await expect
      .poll(() => page.getByTestId('ai-messages').evaluate((el) => el.scrollTop))
      .toBeLessThan(3)
    await page.setViewportSize({ width: 390, height: 667 })
    await expect
      .poll(() => page.getByTestId('ai-messages').evaluate((el) => el.scrollTop))
      .toBeLessThan(3)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Back to overview', exact: true }).click()
    await expect(overview).toHaveAttribute('data-mode', 'overview')
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
      .toBeLessThanOrEqual(845)
    expect(errors).toEqual([])
  } finally {
    await context.close()
    await admin.close()
  }
})
