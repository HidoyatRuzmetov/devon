import type { AdminAiUsage, AdminAiUsageHours } from '@devon/contracts'
import { expect, test, type Locator } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loginAsSuperAdmin, newFlowContext } from './flow-api.js'

const digital = { id: 'ec1903ee-1c35-428e-9012-518fe49f00aa', name: 'Digital services' }
const research = { id: 'd155ab52-cb8e-4b7c-942d-70a98dc87828', name: 'Research and planning' }
const archived = { id: '62340ccd-8f1c-4dc7-8629-7b71c9235d8c', name: 'Former strategy office' }
const today = '2026-11-11'
const hourlyRequests: [hour: number, digitalRuns: number, researchRuns: number][] = [
  [8, 3, 0],
  [9, 6, 2],
  [10, 8, 5],
  [11, 5, 6],
  [12, 2, 2],
  [13, 3, 1],
  [14, 7, 3],
  [15, 5, 7],
  [16, 3, 4],
  [17, 1, 2],
]
const hours: AdminAiUsageHours = {
  day: today,
  // Two teams with distinct workdays, including genuinely empty hours before and after work.
  hours: hourlyRequests.flatMap(([hour, digitalRuns, researchRuns]) =>
    [
      {
        hour,
        departmentId: digital.id,
        tokens: digitalRuns * 323,
        costUzs: digitalRuns * 24,
        runs: digitalRuns,
      },
      {
        hour,
        departmentId: research.id,
        tokens: researchRuns * 147,
        costUzs: researchRuns * 13,
        runs: researchRuns,
      },
    ].filter((row) => row.runs > 0),
  ),
}
const novemberCosts = [1410, 830, 1130, 2100, 1670, 440, 310, 2650, 790, 1940]
const dayRows = novemberCosts.flatMap((costUzs, i) => {
  const day = '2026-11-' + String(i + 1).padStart(2, '0')
  return [digital, research].map((dept, index) => ({
    day,
    departmentId: dept.id,
    costUzs: index === 0 ? costUzs : Math.floor((costUzs * ((i % 4) + 1)) / 7),
    tokens: (i + 1) * (index === 0 ? 1210 : 130),
    runs: (i % 3) + 2,
  }))
})
for (const { id } of [digital, research]) {
  const daily = { day: today, departmentId: id, costUzs: 0, tokens: 0, runs: 0 }
  for (const row of hours.hours.filter((row) => row.departmentId === id)) {
    daily.costUzs += row.costUzs
    daily.tokens += row.tokens
    daily.runs += row.runs
  }
  dayRows.push(daily)
}
const historical = {
  day: '2026-10-04',
  departmentId: archived.id,
  tokens: 68020,
  costUzs: 10450,
  runs: 7,
}
const history: AdminAiUsage = {
  today,
  departments: [digital, research, archived],
  days: [historical, ...dayRows],
}
const number = new Intl.NumberFormat('en').format
const sum = (rows: typeof dayRows, column: 'costUzs' | 'tokens') =>
  number(rows.reduce((n, row) => n + row[column], 0))
const captures = resolve(import.meta.dirname, '../../../../artifacts/review/2026-11-11')

async function visibleTicks(chart: Locator) {
  const boxes = await chart.locator('.usage-labels span').evaluateAll((nodes) =>
    nodes.map((node) => {
      const { left, right } = node.getBoundingClientRect()
      return { label: node.textContent?.trim(), left, right }
    }),
  )
  expect(boxes.length).toBeGreaterThan(1)
  for (const [index, box] of boxes.entries()) {
    expect(box.label).toBeTruthy()
    expect(box.right).toBeGreaterThan(box.left)
    if (index > 0) expect(box.left).toBeGreaterThanOrEqual(boxes[index - 1]!.right + 1)
  }
  return boxes.map(({ label }) => label!)
}

function expectHourlyScale(labels: string[]) {
  expect(labels[0]).toBe('00:00')
  for (const label of labels) expect(label).toMatch(/^\d{2}:00$/)
  const values = labels.map((label) => Number(label.slice(0, 2)))
  const step = values[1]! - values[0]!
  expect([1, 2, 3, 4, 6, 8, 12]).toContain(step)
  expect(values.filter((value, index) => index && value - values[index - 1]! !== step)).toEqual([])
}

async function metricTransition(button: Locator) {
  return button.evaluate(async (control) => {
    const plot = control.closest('[data-testid="ai-usage-chart"]')!.querySelector('.usage-plot')!
    const geometry = () => {
      const path = plot.querySelector('path[data-usage-area]')!
      return getComputedStyle(path).d || path.getAttribute('d') || ''
    }
    const before = geometry()
    const drawn = new Set([before])
    let animated = false
    if (!(control instanceof HTMLButtonElement)) throw new Error('Expected a metric button')
    control.click()
    const until = performance.now() + 650
    do {
      await new Promise<void>((done) => requestAnimationFrame(() => done()))
      drawn.add(geometry())
      // Count only movement/painting inside the actual chart, excluding metric-button feedback.
      animated ||= plot
        .getAnimations({ subtree: true })
        .some((change) => Number(change.effect?.getTiming().duration) > 25)
    } while (performance.now() < until)
    return { changed: before !== geometry(), animated: animated || drawn.size > 2 }
  })
}

test('@flow admin AI usage compares archived and active spend, browses the timeline and fits mobile', async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const context = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(context)
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 1000 })
    // Real admin login, route and shell. Give only this browser an English copy of its
    // existing session to avoid writing to the shared flow administrator's locale.
    await page.route('**/api/v1/me', async (route) => {
      const response = await route.fetch()
      const me = await response.json()
      await route.fulfill({ response, json: { ...me, user: { ...me.user, locale: 'en' } } })
    })
    let empty = false
    await page.route('**/api/v1/admin/analytics/ai-usage', (route) =>
      route.fulfill({ json: empty ? { ...history, departments: [], days: [] } : history }),
    )
    const hourlyDates: string[] = []
    await page.route('**/api/v1/admin/analytics/ai-usage/hours?*', (route) => {
      const day = new URL(route.request().url()).searchParams.get('day')!
      hourlyDates.push(day)
      return route.fulfill({ json: day === hours.day ? hours : { day, hours: [] } })
    })
    await page.goto('/admin/analytics')
    const chart = page.getByTestId('ai-usage-chart')
    await expect(chart.getByRole('heading', { name: 'AI usage' })).toBeVisible()
    const cost = chart.getByRole('button', { name: /^Estimated cost/ })
    const tokens = chart.getByRole('button', { name: /^Tokens/ })
    const plot = chart.getByRole('slider', { name: 'Explore usage by time' })
    const start = chart.getByRole('slider', { name: 'Range start' })
    const end = chart.getByRole('slider', { name: 'Range end' })
    await expect(cost).toContainText(sum(dayRows, 'costUzs'))
    await expect(tokens).toContainText(sum(dayRows, 'tokens'))
    await expect(start).toHaveAttribute('aria-valuetext', '2026-11-01')
    await expect(end).toHaveAttribute('aria-valuetext', history.today)
    const checkedCurves = async () => {
      await Promise.all(
        [digital, research].map(async (dept) => {
          const area = plot.locator(`path[data-usage-area="${dept.id}"]`)
          const line = plot.locator(`path[data-usage-line="${dept.id}"]`)
          await expect(area).toBeVisible()
          await expect(area).toHaveAttribute('d', /C.+Z/i)
          await expect(line).toHaveAttribute('d', /C/i)
          expect(
            await area.evaluate((path) => (path as SVGGraphicsElement).getBBox().height),
          ).toBeGreaterThan(0)
        }),
      )
    }
    await checkedCurves()
    const desktopMonth = await visibleTicks(chart)
    expect(desktopMonth.length).toBeGreaterThan(3)
    await mkdir(captures, { recursive: true })
    await chart.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: resolve(captures, 'admin-ai-usage-desktop.png'),
      animations: 'disabled',
    })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    expect(await metricTransition(tokens)).toEqual({ changed: true, animated: true })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await metricTransition(cost)).toEqual({ changed: true, animated: false })
    await page.emulateMedia({ reducedMotion: 'no-preference' })

    await chart.getByRole('button', { name: 'All time', exact: true }).click()
    await expect(cost).toContainText(sum(history.days, 'costUzs'))
    const former = chart.getByRole('button', { name: archived.name })
    await former.click()
    await expect(former).toHaveAttribute('aria-pressed', 'true')
    await expect(cost).toContainText(number(historical.costUzs))
    await expect(tokens).toContainText(number(historical.tokens))
    await former.click()
    const handle = await end.boundingBox()
    if (!handle) throw new Error('The visible range end must be draggable')
    const x = handle.x + handle.width / 2
    const y = handle.y + handle.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 90, y, { steps: 8 })
    await page.mouse.up()
    await expect(end).not.toHaveAttribute('aria-valuetext', history.today)
    await expect(start).toHaveAttribute('aria-valuetext', historical.day)
    await chart.getByRole('button', { name: 'Month', exact: true }).click()
    const month = chart.locator('input[type=month]')
    await month.fill('2026-10')
    await expect(cost).toContainText(number(historical.costUzs))
    await month.fill('2026-11')
    await start.focus()
    await start.press('ArrowRight')
    await expect(start).toHaveAttribute('aria-valuetext', '2026-11-02')
    await expect(chart.getByRole('button', { name: 'Custom', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(cost).toContainText(
      sum(
        dayRows.filter((row) => row.day > '2026-11-01'),
        'costUzs',
      ),
    )
    await chart.locator('input[type=date][aria-label="Range start"]').fill(history.today)
    await expect(start).toHaveAttribute('aria-valuetext', history.today)
    await expect.poll(() => hourlyDates).toContain(history.today)
    await tokens.click()
    await plot.focus()
    await plot.press('End')
    await expect(plot.getByRole('status')).toContainText('23:00')
    for (let index = 0; index < 8; index += 1) await plot.press('ArrowLeft')
    const tip = plot.getByRole('status')
    await expect(tip).toContainText('15:00')
    await Promise.all(
      hours.hours
        .filter((row) => row.hour === 15)
        .map((row) => expect(tip).toContainText(number(row.tokens))),
    )
    expectHourlyScale(await visibleTicks(chart))
    await page.screenshot({
      path: resolve(captures, 'admin-ai-usage-hourly.png'),
      animations: 'disabled',
    })
    await plot.press('Escape')
    await expect(tip).toHaveCount(0)

    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(() => chart.locator('.usage-labels span').count()).toBeLessThan(8)
    expectHourlyScale(await visibleTicks(chart))
    await chart.locator('input[type=date][aria-label="Range start"]').fill('2026-11-10')
    await expect(start).toHaveAttribute('aria-valuetext', '2026-11-10')
    await expect.poll(() => chart.locator('.usage-labels span').count()).toBe(2)
    const twoDays = await visibleTicks(chart)
    expect(twoDays[0]).toMatch(/10\b/)
    expect(twoDays[1]).toMatch(/11\b/)
    await plot.focus()
    await plot.press('Home')
    await expect(plot.getByRole('status')).toContainText(/Nov.*10/)
    await plot.press('ArrowRight')
    await expect(plot.getByRole('status')).toContainText(/Nov.*11/)
    await plot.press('Escape')
    await chart.getByRole('button', { name: 'Month', exact: true }).click()
    await cost.click()
    await expect(tokens).toContainText(sum(dayRows, 'tokens'))
    await checkedCurves()
    expect((await visibleTicks(chart)).length).toBeLessThan(desktopMonth.length)
    const withinViewport = await chart.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      return (
        rect.left >= 0 &&
        rect.right <= window.innerWidth + 1 &&
        node.scrollWidth <= node.clientWidth + 1
      )
    })
    expect(withinViewport).toBe(true)
    await chart.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }))
    await expect(former).toBeInViewport({ ratio: 1 })
    await expect(former).toBeVisible()
    await page.screenshot({
      path: resolve(captures, 'admin-ai-usage-mobile.png'),
      animations: 'disabled',
    })
    empty = true
    await page.reload()
    await expect(chart).toContainText(/no .*usage|no .*recorded/i)
    await expect(chart.getByRole('slider')).toHaveCount(0)
    await expect(cost).toContainText('0')
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})
