import { expect, test } from '@playwright/test'
import {
  authedPatch,
  createApprovedDepartment,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'

test('@flow pure Pomodoro completes a phase without loading history or activity statistics', async ({
  browser,
}, info) => {
  test.setTimeout(90_000)
  const admin = await newFlowContext(browser)
  const context = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    await createApprovedDepartment(context, admin, {
      headLogin: uniqueLogin('flow.timer'),
      headPassword: examplePassword(),
      departmentName: 'Timer flow',
    })
    await authedPatch(context, '/api/v1/me', { locale: 'en' })
    await authedPatch(context, '/api/v1/personal/pomodoro/settings', {
      focusMin: 1,
      cyclesBeforeLong: 1,
      autoStart: false,
      sound: 'none',
      notifications: false,
    })
    const page = await context.newPage()
    const historyReads: string[] = []
    const artworkReads = new Set<string>()
    page.on('request', (request) => {
      // Vite serves tiny ?import&url JavaScript modules for every URL import; count image
      // transfers only, which is the lazy-loading contract in both development and release.
      if (request.resourceType() === 'image' && /sprite.*\.webp/.test(request.url()))
        artworkReads.add(request.url())
      if (request.method() === 'GET' && /\/pomodoro\/(stats|sessions)/.test(request.url()))
        historyReads.push(request.url())
    })
    await page.clock.install()
    await page.goto('/personal?tab=pomodoro')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const scene = page.locator('.pomodoro-character-scene')
    await expect(scene).toHaveAttribute('data-motion', 'on')
    const sprite = page.locator(
      '.pomodoro-character-layer[data-active="true"] .pomodoro-character-sprite',
    )
    await expect(sprite).toHaveAttribute('data-ready', 'true')
    const frames = new Set([await sprite.getAttribute('data-frame')])
    for (let step = 0; step < 50; step++) {
      await page.clock.runFor(65)
      frames.add(await sprite.getAttribute('data-frame'))
    }
    expect(frames.size).toBe(24)
    // Entry downloads one visible story, the next story, and the completion reaction.
    expect(artworkReads.size).toBeLessThanOrEqual(3)
    const activities = new Set([await scene.getAttribute('data-activity')])
    const captured = new Set<string>()
    const captureActivity = async () => {
      const name = (await scene.getAttribute('data-activity'))!
      if (captured.has(name)) return
      captured.add(name)
      await expect(sprite).toHaveAttribute('data-ready', 'true')
      await page.clock.runFor(1500)
      await scene.screenshot({ path: info.outputPath(`activity-${name}.png`) })
    }
    await captureActivity()
    for (let index = 0; index < 10; index++) {
      const before = await scene.getAttribute('data-activity')
      await page.clock.runFor(4000)
      await expect(scene).toHaveAttribute('data-story-complete', 'true')
      await page.clock.fastForward(20000)
      await expect(scene).toHaveAttribute('data-activity', before!)
      await page.clock.fastForward(40000)
      await expect(scene).not.toHaveAttribute('data-activity', before!)
      activities.add(await scene.getAttribute('data-activity'))
      await captureActivity()
      expect(
        await sprite.evaluate((element: HTMLCanvasElement) => {
          const pixels = element
            .getContext('2d')!
            .getImageData(0, 0, element.width, element.height).data
          return pixels.some((value, i) => i % 4 === 3 && value > 0)
        }),
      ).toBe(true)
    }
    expect(activities.size).toBe(11)
    const beforeBreak = await scene.getAttribute('data-activity')
    await page.getByRole('button', { name: 'Short break', exact: true }).click()
    await expect(scene).toHaveAttribute('data-mode', 'break')
    await expect(scene).not.toHaveAttribute('data-activity', beforeBreak!)
    const breakActivities = new Set([await scene.getAttribute('data-activity')])
    await captureActivity()
    for (let index = 0; index < 11; index++) {
      const before = await scene.getAttribute('data-activity')
      await page.clock.runFor(4000)
      await expect(scene).toHaveAttribute('data-story-complete', 'true')
      await page.clock.fastForward(20000)
      await expect(scene).toHaveAttribute('data-activity', before!)
      await page.clock.fastForward(40000)
      await expect(scene).not.toHaveAttribute('data-activity', before!)
      breakActivities.add(await scene.getAttribute('data-activity'))
      await captureActivity()
    }
    expect(breakActivities.size).toBe(12)
    expect(new Set([...activities, ...breakActivities]).size).toBe(14)
    await page.getByRole('button', { name: 'Focus', exact: true }).click()
    await expect(scene).toHaveAttribute('data-mode', 'focus')
    await page.getByRole('button', { name: 'Character animation', exact: true }).click()
    await expect(scene).toHaveAttribute('data-motion', 'off')
    await page.getByRole('button', { name: 'Character animation', exact: true }).click()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(scene).toHaveAttribute('data-motion', 'off')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(page.getByRole('timer')).toHaveText('1:00')
    await expect(page.locator('.pomodoro-history')).toHaveCount(0)
    await expect(page.getByText(/sessions this week|session history|focus minutes/i)).toHaveCount(0)
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect(scene).toHaveAttribute('data-activity', 'nap')
    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    await expect(scene).not.toHaveAttribute('data-activity', 'nap')
    const completion = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' && response.url().includes('/pomodoro/sessions/'),
    )
    await page.clock.fastForward(61000)
    expect((await completion).ok()).toBe(true)
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()
    await expect(scene).toHaveAttribute('data-mode', 'complete')
    await expect(scene).toHaveAttribute('data-activity', 'complete')
    await captureActivity()
    expect(captured.size).toBe(15)
    // Receipts support reliable completion/retry; they are not a user-facing history feature.
    const receipts = (await (
      await context.request.get('/api/v1/personal/pomodoro/sessions')
    ).json()) as { completed: boolean }[]
    expect(receipts.filter((row) => row.completed)).toHaveLength(1)
    expect(historyReads).toEqual([])
  } finally {
    await Promise.allSettled([admin.close(), context.close()])
  }
})
