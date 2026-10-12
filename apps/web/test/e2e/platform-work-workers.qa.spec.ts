import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test'
import { authedPatch, authedPost, login, newFlowContext } from './flow-api.js'
import { FLOW_API_LOG_FILE, FLOW_WEB_BASE_URL } from './flow-env.js'
import { waitForLoadedRoute } from './platform-capture.js'
import {
  createWorkQueueProducer,
  readQueueJob,
  readReminderNotifications,
  readReminders,
  readSeries,
} from './flow-work-queue.js'

const examplePassword = 'Ishonchli#2026'
function label(key: string): string {
  let value: unknown = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../../../../packages/i18n/messages/en.generated.json'),
      'utf8',
    ),
  )
  for (const part of key.split('.')) value = (value as Record<string, unknown>)[part]
  if (typeof value !== 'string') throw new Error(`Missing en:${key}`)
  return value
}

async function fixture(browser: Browser) {
  const editor = await newFlowContext(browser)
  const observer = await newFlowContext(browser)
  const foreignRequests: string[] = []
  await Promise.all(
    [editor, observer].map(async (context) => {
      await context.route('**/*', async (route) => {
        if (new URL(route.request().url()).origin !== FLOW_WEB_BASE_URL) {
          foreignRequests.push(new URL(route.request().url()).hostname)
          await route.abort('blockedbyclient')
        } else await route.continue()
      })
      await login(context, { login: 'demo.boshliq', password: examplePassword })
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    }),
  )
  const me = (await (await editor.request.get('/api/v1/me')).json()) as { user: { id: string } }
  const producer = await createWorkQueueProducer()
  const page = await editor.newPage()
  const watching = await observer.newPage()
  const pageErrors: string[] = []
  const publications: string[] = []
  for (const active of [page, watching])
    active.on('pageerror', (error) => pageErrors.push(error.message))
  watching.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      for (const line of payload.toString().split('\n')) {
        let reply: { push?: { pub?: { data?: { type?: string } } } }
        try {
          reply = JSON.parse(line) as typeof reply
        } catch {
          continue
        }
        if (reply.push?.pub?.data?.type) publications.push(reply.push.pub.data.type)
      }
    })
  })
  return {
    editor,
    observer,
    page,
    watching,
    producer,
    userId: me.user.id,
    publications,
    async close() {
      try {
        expect(foreignRequests).toEqual([])
        expect(pageErrors).toEqual([])
      } finally {
        await Promise.all([editor.close(), observer.close()])
        await producer.close()
      }
    },
  }
}

async function card(
  context: BrowserContext,
  title: string,
  dueAt: string,
  userId: string,
): Promise<string> {
  const response = await authedPost(context, '/api/v1/cards', {
    title,
    kind: 'task',
    dueAt,
    assigneeUserId: userId,
  })
  expect(response.status()).toBe(201)
  return ((await response.json()) as { id: string }).id
}

async function section(page: Page, id: string): Promise<Locator> {
  const toggle = page.locator(`button[aria-controls="${id}"]`)
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const panel = page.locator(`[id="${id}"]`)
  await expect(panel).toBeVisible()
  return panel
}

async function openCard(page: Page, id: string, title: string): Promise<void> {
  await page.goto(`/work?card=${id}`)
  await waitForLoadedRoute(page, '/work')
  await expect(
    page.getByRole('dialog').getByRole('textbox', { name: 'Title', exact: true }),
  ).toHaveValue(title)
}

async function dailyRule(
  page: Page,
  id: string,
  mode: 'schedule' | 'after_done',
  count: number,
  until?: string,
): Promise<Locator> {
  const panel = await section(page, `card-repeat-${id}`)
  await panel.getByRole('button', { name: label('work.recurrence.enable'), exact: true }).click()
  await panel.getByLabel(label('work.recurrence.freqLabel'), { exact: true }).selectOption('daily')
  await panel
    .getByRole('radio')
    .nth(mode === 'schedule' ? 0 : 1)
    .click()
  await panel.getByLabel(label('work.recurrence.countLabel'), { exact: true }).fill(String(count))
  if (until !== undefined)
    await panel.getByLabel(label('work.recurrence.untilLabel'), { exact: true }).fill(until)
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/cards/${id}`) &&
      response.request().method() === 'PATCH' &&
      response.status() === 200,
  )
  await panel.getByRole('button', { name: label('common.save'), exact: true }).click()
  await saved
  return panel
}

async function completedJob(
  producer: Awaited<ReturnType<typeof createWorkQueueProducer>>,
  queue: 'work.recurrence' | 'work.reminders',
): Promise<string> {
  const id = await producer.enqueue(queue)
  await expect
    .poll(() => readQueueJob(id)[0]?.state, {
      timeout: 30_000,
      message: `Actual ${queue} job completion`,
    })
    .toBe('completed')
  return id
}

test('@qa real scheduled recurrence creates one persisted successor and respects count after queue redelivery', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const title = `QA worker schedule ${randomUUID().slice(0, 8)}`
    const due = new Date(Date.now() - 3 * 86_400_000).toISOString()
    const id = await card(f.editor, title, due, f.userId)
    await openCard(f.page, id, title)
    await dailyRule(f.page, id, 'schedule', 2)
    expect(readSeries(id)).toHaveLength(1)
    await f.watching.goto('/work')
    await waitForLoadedRoute(f.watching, '/work')
    await expect(f.watching.locator(`[data-dnd-card="${id}"]`)).toBeVisible()
    const job = await completedJob(f.producer, 'work.recurrence')
    await expect.poll(() => readSeries(id), { timeout: 10_000 }).toHaveLength(2)
    const series = readSeries(id)
    const successor = series.find((row) => row.id !== id)!
    expect(successor.recurrence_index).toBe(2)
    expect(new Date(successor.due_at!).getTime()).toBe(
      new Date(due).getTime() +
        86_400_000 -
        new Date(due).getUTCSeconds() * 1000 -
        new Date(due).getUTCMilliseconds(),
    )
    await expect(f.watching.locator(`[data-dnd-card="${successor.id}"]`)).toBeVisible({
      timeout: 35_000,
    })
    await completedJob(f.producer, 'work.recurrence')
    expect(readSeries(id)).toHaveLength(2)
    await openCard(f.watching, successor.id, title)
    await f.watching.reload()
    await expect(f.watching.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title)
    await f.watching.screenshot({
      path: test.info().outputPath('scheduled-successor-reloaded.png'),
    })
    writeFileSync(
      test.info().outputPath('worker-evidence.json'),
      JSON.stringify({ job, series, publications: f.publications }, null, 2),
    )
  } finally {
    await f.close()
  }
})

test('@qa actual recurring queue respects the UI stop-date boundary without creating an extra card', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const title = `QA worker stopped series ${randomUUID().slice(0, 8)}`
    const due = new Date(Date.now() - 3 * 86_400_000).toISOString()
    const until = new Date(new Date(due).getTime() + 86_400_000).toISOString().slice(0, 10)
    const id = await card(f.editor, title, due, f.userId)
    await openCard(f.page, id, title)
    const repeat = await dailyRule(f.page, id, 'schedule', 3, until)
    await expect(repeat.getByText(label('work.recurrence.noNext'), { exact: true })).toBeVisible()
    const job = await completedJob(f.producer, 'work.recurrence')
    expect(readSeries(id)).toHaveLength(1)
    await completedJob(f.producer, 'work.recurrence')
    expect(readSeries(id)).toHaveLength(1)
    await f.page.reload()
    const reloaded = await section(f.page, `card-repeat-${id}`)
    await expect(
      reloaded.getByLabel(label('work.recurrence.untilLabel'), { exact: true }),
    ).toHaveValue(until)
    await f.page.screenshot({ path: test.info().outputPath('recurrence-until-reloaded.png') })
    writeFileSync(
      test.info().outputPath('worker-evidence.json'),
      JSON.stringify({ job, due, until, series: readSeries(id) }, null, 2),
    )
  } finally {
    await f.close()
  }
})

test('@qa real after-done recurrence waits for UI completion and preserves its interval', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const title = `QA worker after done ${randomUUID().slice(0, 8)}`
    const originalDue = new Date(Date.now() - 3 * 86_400_000).toISOString()
    const id = await card(f.editor, title, originalDue, f.userId)
    await openCard(f.page, id, title)
    const originalRepeat = await dailyRule(f.page, id, 'after_done', 2)
    await expect(originalRepeat.locator('[aria-live="polite"]')).toHaveText(
      label('work.recurrence.mode.afterDone'),
    )
    await completedJob(f.producer, 'work.recurrence')
    expect(readSeries(id)).toHaveLength(1)
    const saved = f.page.waitForResponse(
      (response) =>
        response.url().endsWith(`/cards/${id}`) &&
        response.request().method() === 'PATCH' &&
        response.status() === 200,
    )
    await f.page
      .getByRole('dialog')
      .getByRole('button', { name: label('work.card.markDone'), exact: true })
      .click()
    await saved
    const done = (await (await f.editor.request.get(`/api/v1/cards/${id}`)).json()) as {
      status: string
      doneAt: string | null
      archivedAt: string | null
    }
    // Standalone completion intentionally moves the card into its owner's archive. The next
    // after-done occurrence must count from that actual completion, rather than an overdue date.
    expect(done.status).toBe('archived')
    expect(done.archivedAt).toBeTruthy()
    const job = await completedJob(f.producer, 'work.recurrence')
    await expect.poll(() => readSeries(id), { timeout: 10_000 }).toHaveLength(2)
    const successor = readSeries(id).find((row) => row.id !== id)!
    expect(successor.status).toBe('active')
    writeFileSync(
      test.info().outputPath('worker-completion-before-interval.json'),
      JSON.stringify({ job, originalDue, done, successor }, null, 2),
    )
    const gap = new Date(successor.due_at!).getTime() - new Date(done.archivedAt!).getTime()
    expect(gap).toBeGreaterThan(86_400_000 - 60_000)
    expect(gap).toBeLessThanOrEqual(86_400_000)
    await openCard(f.watching, successor.id, title)
    const repeat = await section(f.watching, `card-repeat-${successor.id}`)
    await expect(
      repeat.getByLabel(label('work.recurrence.countLabel'), { exact: true }),
    ).toHaveValue('2')
    await completedJob(f.producer, 'work.recurrence')
    expect(readSeries(id)).toHaveLength(2)
    await f.watching.screenshot({ path: test.info().outputPath('after-done-successor.png') })
    writeFileSync(
      test.info().outputPath('worker-evidence.json'),
      JSON.stringify({ job, done, successor }, null, 2),
    )
  } finally {
    await f.close()
  }
})

test('@qa UI reminder reaches the real queue inbox sent receipt and working card deep-link once', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const f = await fixture(browser)
  try {
    const title = `QA worker reminder ${randomUUID().slice(0, 8)}`
    const note = `Specific local follow-up ${randomUUID().slice(0, 8)}`
    const id = await card(f.editor, title, new Date().toISOString(), f.userId)
    await openCard(f.page, id, title)
    const reminders = await section(f.page, `card-reminders-${id}`)
    const at = new Date(Math.ceil((Date.now() + 12_000) / 60_000) * 60_000)
    // The real native control accepts minute granularity. Wait for its real due instant; neither
    // the persisted date nor the server/browser clock is altered to manufacture eligibility.
    const localTime = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}T${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
    await reminders.getByLabel(label('work.reminders.whenLabel'), { exact: true }).fill(localTime)
    await reminders.getByLabel(label('work.reminders.noteLabel'), { exact: true }).fill(note)
    const saved = f.page.waitForResponse(
      (response) =>
        response.url().endsWith(`/cards/${id}/reminders`) &&
        response.request().method() === 'POST' &&
        response.status() === 201,
    )
    await reminders.getByRole('button', { name: label('work.reminders.add'), exact: true }).click()
    await saved
    const initial = readReminders(id, f.userId)
    expect(initial).toHaveLength(1)
    expect(initial[0]!.sent_at).toBeNull()
    await f.watching.goto('/inbox')
    await waitForLoadedRoute(f.watching, '/inbox')
    await expect
      .poll(() => Date.now() >= new Date(initial[0]!.remind_at).getTime(), { timeout: 85_000 })
      .toBe(true)
    const job = await completedJob(f.producer, 'work.reminders')
    await expect
      .poll(() => readReminders(id, f.userId)[0]?.sent_at, { timeout: 10_000 })
      .not.toBeNull()
    await expect
      .poll(() => readReminderNotifications(id, f.userId), { timeout: 10_000 })
      .toHaveLength(1)
    const notification = readReminderNotifications(id, f.userId)[0]!
    expect(notification.body.en).toContain(note)
    await expect(reminders.getByText(label('work.reminders.sent'), { exact: true })).toBeVisible({
      timeout: 35_000,
    })
    const inbox = f.watching.getByRole('tabpanel')
    await expect(inbox.locator(`[data-inbox-row="${notification.id}"]`)).toBeVisible({
      timeout: 35_000,
    })
    await completedJob(f.producer, 'work.reminders')
    expect(readReminderNotifications(id, f.userId)).toHaveLength(1)
    await f.watching.reload()
    const row = inbox.locator(`[data-inbox-row="${notification.id}"]`)
    await expect(row).toBeVisible()
    await f.watching.screenshot({ path: test.info().outputPath('reminder-inbox-reloaded.png') })
    await row.getByRole('button', { name: label('inbox.row.open'), exact: true }).click()
    await expect(f.watching.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title)
    await f.watching.reload()
    const reloaded = await section(f.watching, `card-reminders-${id}`)
    await expect(reloaded.getByText(label('work.reminders.sent'), { exact: true })).toBeVisible()
    await f.watching.screenshot({ path: test.info().outputPath('reminder-sent-card-reloaded.png') })
    writeFileSync(
      test.info().outputPath('worker-evidence.json'),
      JSON.stringify(
        {
          job,
          reminder: readReminders(id, f.userId),
          notification,
          publications: f.publications,
          scheduledAtBoot: readFileSync(FLOW_API_LOG_FILE, 'utf8').includes(
            'work: recurrence (15 min) and reminder (1 min) jobs scheduled',
          ),
        },
        null,
        2,
      ),
    )
  } finally {
    await f.close()
  }
})
