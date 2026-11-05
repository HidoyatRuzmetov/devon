import { copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {
  authedPatch,
  createApprovedDepartment,
  csrfToken,
  examplePassword,
  flowClientHeaders,
  joinDepartmentAsNewUser,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'
import { FLOW_WEB_BASE_URL } from './flow-env.js'

test('@flow birthday letter writes real strokes, is dismissible, and appears once', async ({
  browser,
}) => {
  test.setTimeout(150_000)
  const root = resolve(import.meta.dirname, '../../../../artifacts/review/2026-11-05')
  await mkdir(resolve(root, 'recordings'), { recursive: true })
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const member = await browser.newContext({
    baseURL: FLOW_WEB_BASE_URL,
    extraHTTPHeaders: flowClientHeaders(),
    viewport: { width: 1440, height: 1000 },
    recordVideo: { dir: resolve(root, 'recordings'), size: { width: 1440, height: 1000 } },
  })
  const errors: string[] = []
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('birthday.head'),
      headPassword: examplePassword(),
      departmentName: 'Birthday celebration review',
    })
    await joinDepartmentAsNewUser(member, {
      login: uniqueLogin('birthday.member'),
      password: examplePassword(),
      ...department,
    })
    if (process.env['FLOW_BIRTHDAY_FIXTURE'] === '1') {
      expect(
        (
          await authedPatch(head, '/api/v1/ai/settings', {
            budgetUzsPerMonth: 10000000,
            flags: { semantic_ask: true, catch_up: false },
          })
        ).status(),
      ).toBe(200)
      const published = await (
        await member.request.get('/api/v1/accounts/professional-profile')
      ).json()
      expect(
        (
          await member.request.put('/api/v1/accounts/professional-profile', {
            headers: { 'x-csrf-token': await csrfToken(member) },
            data: {
              version: published.version,
              profile: {
                ...published.profile,
                position: 'chief_specialist',
                headline: 'Thoughtful software systems',
                skills: ['Software engineering'],
                hobbies: ['Reading', 'Hiking'],
              },
            },
          })
        ).status(),
      ).toBe(200)
    }
    expect((await authedPatch(member, '/api/v1/me', { locale: 'en' })).ok()).toBe(true)
    expect(
      (
        await authedPatch(member, '/api/v1/accounts/profile', {
          givenName: 'Dilnoza',
          familyName: 'Karimova',
        })
      ).ok(),
    ).toBe(true)
    const page = await member.newPage()
    await page.addInitScript(() => {
      const media: HTMLMediaElement[] = []
      Object.defineProperty(window, '__birthdayMedia', { value: media })
      const play = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function () {
        if (!media.includes(this)) media.push(this)
        return play.call(this)
      }
    })
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/account')
    const profile = page.locator('#section-profile')
    await expect(profile.getByLabel('Date of birth', { exact: true })).toBeVisible()
    const today = new Date(Date.now() + 18_000_000).toISOString().slice(0, 10)
    await profile.getByLabel('Date of birth', { exact: true }).fill(`2000-${today.slice(5)}`)
    await profile.getByRole('button', { name: 'Save', exact: true }).click()
    const letter = page.getByRole('dialog', { name: 'A birthday wish for you' })
    await expect(letter).toBeVisible({ timeout: 30_000 })
    await expect(letter.getByRole('heading', { name: 'Happy birthday, Dilnoza.' })).toBeVisible()
    if (process.env['FLOW_BIRTHDAY_FIXTURE'] === '1')
      await expect(letter.getByText(/fresh ideas for the systems you build/)).toHaveCount(1)
    const strokes = letter.locator('[data-ink]')
    expect(await strokes.count()).toBeGreaterThan(100)
    await expect
      .poll(() =>
        strokes.evaluateAll(
          (paths) =>
            paths.filter((path) => Number((path as SVGPathElement).style.opacity) > 0).length,
        ),
      )
      .toBeGreaterThan(4)
    await page.screenshot({ path: resolve(root, 'birthday-writing.png'), fullPage: true })
    const penBefore = await letter.locator('.birthday-quill').getAttribute('transform')
    await expect
      .poll(() => letter.locator('.birthday-quill').getAttribute('transform'))
      .not.toBe(penBefore)
    await expect(letter.getByRole('button', { name: 'Read it again' })).toBeVisible({
      timeout: 65_000,
    })
    const stamp = letter.locator('.birthday-wax-stamp')
    await expect(stamp).toBeVisible()
    await expect
      .poll(() => stamp.evaluate((element) => Number(element.getAnimations()[0]?.currentTime ?? 0)))
      .toBeGreaterThan(800)
    await page.screenshot({ path: resolve(root, 'birthday-seal-press.png'), fullPage: true })
    await expect(letter.locator('[data-birthday-seal="settled"]')).toBeVisible()
    await page.screenshot({ path: resolve(root, 'birthday-complete.png'), fullPage: true })
    expect(
      (await new AxeBuilder({ page }).include('.birthday-celebration').analyze()).violations,
    ).toEqual([])
    await letter.getByRole('button', { name: 'Play music', exact: true }).click()
    await expect(letter.locator('[data-birthday-music]')).toHaveAttribute(
      'data-birthday-music',
      'playing',
    )
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __birthdayMedia: HTMLMediaElement[] }).__birthdayMedia.filter(
            (audio) => !audio.paused,
          ).length,
      ),
    ).toBe(1)
    await letter.getByRole('button', { name: 'Mute music', exact: true }).click()
    await expect(letter.locator('[data-birthday-music]')).toHaveAttribute('aria-pressed', 'false')
    expect(await page.evaluate(() => localStorage.getItem('workportal.birthday.music-muted'))).toBe(
      'true',
    )
    await letter.getByRole('button', { name: 'Play music', exact: true }).click()
    await expect(letter.locator('[data-birthday-music]')).toHaveAttribute(
      'data-birthday-music',
      'playing',
    )
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect(letter.locator('[data-birthday-music]')).toHaveAttribute(
      'data-birthday-music',
      'off',
    )
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { __birthdayMedia: HTMLMediaElement[] }).__birthdayMedia.every(
            (audio) => audio.paused,
          ),
        ),
      )
      .toBe(true)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await letter.getByRole('button', { name: 'Play music', exact: true }).click()
    await expect(letter.locator('[data-birthday-music]')).toHaveAttribute(
      'data-birthday-music',
      'playing',
    )
    await letter.getByRole('button', { name: 'Thank you' }).click()
    await expect(letter).toHaveCount(0)
    expect(
      await page.evaluate(() =>
        (window as unknown as { __birthdayMedia: HTMLMediaElement[] }).__birthdayMedia.every(
          (audio) => audio.paused,
        ),
      ),
    ).toBe(true)
    await page.reload()
    await expect(page.locator('#section-profile')).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'A birthday wish for you' })).toHaveCount(0)
    expect(errors).toEqual([])
    const video = page.video()
    await member.close()
    if (video) await copyFile(await video.path(), resolve(root, 'birthday-celebration.webm'))

    // A second real account verifies immediate readable content under reduced motion, then Escape.
    const reduced = await browser.newContext({
      baseURL: FLOW_WEB_BASE_URL,
      extraHTTPHeaders: flowClientHeaders(),
      reducedMotion: 'reduce',
      viewport: { width: 390, height: 844 },
    })
    try {
      await joinDepartmentAsNewUser(reduced, {
        login: uniqueLogin('birthday.reduced'),
        password: examplePassword(),
        ...department,
      })
      await authedPatch(reduced, '/api/v1/me', { locale: 'en' })
      await authedPatch(reduced, '/api/v1/accounts/profile', {
        givenName: 'Aziza',
        familyName: 'Review',
        dateOfBirth: `2000-${today.slice(5)}`,
      })
      const reducedPage = await reduced.newPage()
      let opened = 0
      reducedPage.on('request', (request) => {
        if (request.url().endsWith('/birthday/open')) opened++
      })
      await reducedPage.addInitScript(() => {
        const play = HTMLMediaElement.prototype.play
        let gesture = false
        document.addEventListener(
          'pointerdown',
          () => {
            gesture = true
          },
          { once: true },
        )
        document.addEventListener(
          'keydown',
          () => {
            gesture = true
          },
          { once: true },
        )
        HTMLMediaElement.prototype.play = function () {
          if (!gesture)
            return Promise.reject(new DOMException('Autoplay blocked', 'NotAllowedError'))
          return play.call(this)
        }
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden',
        })
      })
      await reducedPage.goto('/')
      await expect(reducedPage.getByRole('main')).toBeVisible()
      expect(opened).toBe(0)
      await reducedPage.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'visible',
        })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      const reducedLetter = reducedPage.getByRole('dialog', { name: 'A birthday wish for you' })
      await expect(reducedLetter).toBeVisible({ timeout: 30_000 })
      await expect(reducedLetter.locator('[data-birthday-music]')).toHaveAttribute(
        'data-birthday-music',
        'blocked',
      )
      await expect(reducedLetter.locator('[data-birthday-music]')).toHaveAttribute(
        'aria-pressed',
        'false',
      )
      await reducedLetter.getByRole('button', { name: 'Play music', exact: true }).click()
      await expect(reducedLetter.locator('[data-birthday-music]')).toHaveAttribute(
        'data-birthday-music',
        'playing',
      )
      await expect(reducedLetter.locator('.birthday-confetti')).toHaveCount(0)
      await expect(reducedLetter.locator('[data-birthday-seal="settled"]')).toBeVisible()
      await expect(reducedLetter.getByRole('button', { name: 'Read now' })).toHaveCount(0)
      await expect
        .poll(() =>
          reducedLetter
            .locator('[data-ink]')
            .evaluateAll((paths) =>
              paths.every((path) => (path as SVGPathElement).style.strokeDashoffset === '0'),
            ),
        )
        .toBe(true)
      await reducedPage.screenshot({ path: resolve(root, 'birthday-mobile.png'), fullPage: true })
      await expect(reducedLetter.getByRole('button', { name: 'Thank you' })).toBeInViewport({
        ratio: 1,
      })
      expect(
        (await new AxeBuilder({ page: reducedPage }).include('.birthday-celebration').analyze())
          .violations,
      ).toEqual([])
      await reducedPage.keyboard.press('Escape')
      await expect(reducedLetter).toHaveCount(0)
    } finally {
      await reduced.close()
    }
  } finally {
    await Promise.allSettled([admin.close(), head.close(), member.close()])
  }
})
