import { expect, type Browser, type Page } from '@playwright/test'
import type { Locale } from '@devon/i18n'
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
import { FLOW_WEB_BASE_URL } from './flow-env.js'

/** Synthetic head/member identities and ordinary real API data; no integration credentials. */
export async function eventFixture(
  browser: Browser,
  locale: Locale = 'en',
  theme: 'light' | 'dark' = 'light',
) {
  const head = await newFlowContext(browser)
  const admin = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  const external: string[] = []
  await Promise.all(
    [head, admin, member].map((context) =>
      context.route('**/*', (route) => {
        if (new URL(route.request().url()).origin === FLOW_WEB_BASE_URL) return route.continue()
        external.push(new URL(route.request().url()).hostname)
        return route.abort('blockedbyclient')
      }),
    ),
  )
  await loginAsSuperAdmin(admin)
  const department = await createApprovedDepartment(head, admin, {
    headLogin: uniqueLogin('nested.event.visual'),
    headPassword: examplePassword(),
    departmentName: 'Synthetic Nested Events Department',
  })
  await admin.close()
  await joinDepartmentAsNewUser(member, {
    login: uniqueLogin('nested.event.member'),
    password: examplePassword(),
    joinKey: department.joinKey,
    joinPassword: department.joinPassword,
  })
  expect((await authedPatch(head, '/api/v1/me', { locale })).status()).toBe(200)
  expect((await authedPatch(member, '/api/v1/me', { locale })).status()).toBe(200)
  const response = await authedPost(head, '/api/v1/events', {
    title: 'Synthetic Nested Event',
    category: 'other',
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    endsAt: new Date(Date.now() + 90_000_000).toISOString(),
  })
  expect(response.status()).toBe(201)
  const event = (await response.json()) as { id: string; startsAt: string; endsAt: string }
  const headPage = await head.newPage()
  const memberPage = await member.newPage()
  await Promise.all(
    [headPage, memberPage].map(async (page) => {
      await page.addInitScript((value) => localStorage.setItem('devon_theme', value), theme)
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
    }),
  )
  const open = async (page: Page, tab: string) => {
    await page.goto(`/events?event=${event.id}`)
    const detail = page.getByRole('dialog', { name: 'Synthetic Nested Event', exact: true })
    await expect(detail).toBeVisible()
    await detail.getByRole('tab', { name: tab, exact: true }).click()
    return detail
  }
  return {
    head,
    member,
    headPage,
    memberPage,
    event,
    open,
    close: async () => {
      await Promise.all([head.close(), member.close()])
      expect(external).toEqual([])
    },
  }
}
