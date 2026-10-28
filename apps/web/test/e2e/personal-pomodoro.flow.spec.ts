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
}) => {
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
    page.on('request', (request) => {
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
    const frameChanges = await sprite.evaluate((element) => {
      const animation = element.getAnimations()[0]!
      animation.pause()
      animation.currentTime = 0
      const first = getComputedStyle(element).backgroundPosition
      animation.currentTime = 850
      const middle = getComputedStyle(element).backgroundPosition
      animation.play()
      return first !== middle
    })
    expect(frameChanges).toBe(true)
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
    const completion = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' && response.url().includes('/pomodoro/sessions/'),
    )
    await page.clock.fastForward(61000)
    expect((await completion).ok()).toBe(true)
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()
    await expect(scene).toHaveAttribute('data-mode', 'complete')
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
