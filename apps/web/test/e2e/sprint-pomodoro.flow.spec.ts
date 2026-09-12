// @flow -- H30.1 flow 4/6: the personal workspace's sprint + Pomodoro (TECH-SPEC §3.3), owner-only
// and never department-scoped (I-1) -- creating a sprint with a goal and logging a completed focus
// session, both landing on the real `/personal` page.
import { expect, test } from '@playwright/test'
import {
  authedPost,
  createApprovedDepartment,
  examplePassword,
  newFlowContext,
  loginAsSuperAdmin,
  uniqueLogin,
} from './flow-api.js'

test('@flow personal workspace: a sprint with a goal, then a completed Pomodoro session', async ({
  browser,
}) => {
  const superAdminContext = await newFlowContext(browser)
  await loginAsSuperAdmin(superAdminContext)

  // The personal workspace still needs an active department context for the shell to render at all
  // (`AppShell` gates on `useDepartment()`) even though sprints/Pomodoro are owner-only, never
  // department-scoped (I-1) -- one head is enough.
  const context = await newFlowContext(browser)
  const page = await context.newPage()
  const user = { login: uniqueLogin('flow.sprint'), password: examplePassword() }
  await createApprovedDepartment(context, superAdminContext, {
    headLogin: user.login,
    headPassword: user.password,
    departmentName: `Sprint flow ${user.login.slice(-8)}`,
  })
  await superAdminContext.close()

  const goal = `Flow goal ${Date.now()}`
  const now = Date.now()
  const sprintRes = await authedPost(context, '/api/v1/personal/sprints', {
    kind: 'day',
    startsAt: new Date(now).toISOString(),
    endsAt: new Date(now + 8 * 60 * 60 * 1000).toISOString(),
    goal,
  })
  expect(sprintRes.status()).toBe(201)

  await page.goto('/personal')
  await page.getByRole('tab', { name: 'Davrlar' }).click()
  await expect(page.getByText(goal)).toBeVisible()

  const statsBefore = await context.request.get('/api/v1/personal/pomodoro/stats')
  const before = (await statsBefore.json()) as { today: { focusSessions: number; focusMinutes: number } }

  const startedAt = new Date(now - 25 * 60 * 1000).toISOString()
  const endedAt = new Date(now).toISOString()
  const sessionRes = await authedPost(context, '/api/v1/personal/pomodoro/sessions', {
    kind: 'focus',
    startedAt,
    endedAt,
    completed: true,
  })
  expect(sessionRes.status()).toBe(201)

  const statsAfter = await context.request.get('/api/v1/personal/pomodoro/stats')
  const after = (await statsAfter.json()) as { today: { focusSessions: number; focusMinutes: number } }
  expect(after.today.focusSessions).toBe(before.today.focusSessions + 1)
  expect(after.today.focusMinutes).toBeGreaterThan(before.today.focusMinutes)

  // Real UI: the Pomodoro panel's own stats tiles pick up the new session on reload.
  await page.reload()
  await page.getByRole('tab', { name: 'Pomodoro' }).click()
  await expect(page.getByText(String(after.today.focusSessions)).first()).toBeVisible()

  await context.close()
})
