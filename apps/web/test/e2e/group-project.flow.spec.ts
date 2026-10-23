// @flow -- H30.1 flow 3/6: a group project with an objective task and a subjective task, both
// completed, and the real project page reflecting the resulting progress -- TECH-SPEC §3.2's
// "Project progress = weighted completion of objective tasks and members' subjective tasks", proved
// live rather than only at the repo-function level (`packages/projects` unit tests already cover the
// arithmetic; this proves the whole path: create -> complete -> re-render).
import { expect, test } from '@playwright/test'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  examplePassword,
  newFlowContext,
  loginAsSuperAdmin,
  uniqueLogin,
} from './flow-api.js'

test('@flow group project: personal tasks remain separate from milestone progress', async ({
  browser,
}) => {
  // This multi-user journey includes setup, both task lifecycles, milestone edits and two
  // overlapping delete/undo receipts. Keep individual assertions strict while allowing the
  // complete sequence to finish on the shared development runner.
  test.setTimeout(90_000)
  const superAdminContext = await newFlowContext(browser)
  await loginAsSuperAdmin(superAdminContext)

  const headContext = await newFlowContext(browser)
  const headPage = await headContext.newPage()
  const head = {
    login: uniqueLogin('flow.phead'),
    password: examplePassword(),
  }
  await createApprovedDepartment(headContext, superAdminContext, {
    headLogin: head.login,
    headPassword: head.password,
    departmentName: `Project flow ${head.login.slice(-8)}`,
  })

  await superAdminContext.close()

  const meRes = await headContext.request.get('/api/v1/me')
  const me = (await meRes.json()) as { user: { id: string } }

  const templatesRes = await headContext.request.get('/api/v1/projects/templates')
  expect(templatesRes.status()).toBe(200)
  const templates = (await templatesRes.json()) as {
    key: string
    title: string
  }[]
  expect(templates.length).toBeGreaterThan(0)

  const projectTitle = `Flow project ${Date.now()}`
  const createRes = await authedPost(headContext, '/api/v1/projects/from-template', {
    templateKey: templates[0]!.key,
    title: projectTitle,
    ownerUserId: me.user.id,
    members: [me.user.id],
  })
  expect(createRes.status()).toBe(201)
  const project = (await createRes.json()) as { id: string; milestones: unknown[]; colour: string }
  expect(project.milestones).toEqual([])

  // Legacy task scopes remain readable within the single personal-task section.
  await headPage.goto(`/projects/view?id=${project.id}`)
  await expect(headPage.getByText('Boshqarma vazifalari')).toHaveCount(0)
  await expect(headPage.getByText('Oʻz vazifalarim')).toBeVisible()

  // Existing production projects can track work entirely with milestones and no task cards.
  const firstMilestone = await authedPost(
    headContext,
    `/api/v1/projects/${project.id}/milestones`,
    {
      title: 'Initial discovery',
    },
  )
  const discovery = (await firstMilestone.json()) as { milestones: { id: string }[] }
  await authedPost(headContext, `/api/v1/projects/${project.id}/milestones`, { title: 'Approval' })
  await authedPatch(
    headContext,
    `/api/v1/projects/${project.id}/milestones/${discovery.milestones[0]!.id}`,
    { done: true },
  )
  await headPage.reload()
  await expect(headPage.getByText('50', { exact: true })).toBeVisible()
  await headPage.goto('/projects')
  await expect(headPage.getByText('1/2 bosqich', { exact: true })).toBeVisible()
  await headPage.goto(`/projects/view?id=${project.id}`)

  // One objective task, one subjective task, both for this project.
  const objectiveRes = await authedPost(headContext, '/api/v1/cards', {
    title: 'Flow objective task',
    projectId: project.id,
    projectScope: 'objective',
    assigneeUserId: me.user.id,
  })
  expect(objectiveRes.status()).toBe(201)
  const objective = (await objectiveRes.json()) as {
    id: string
    version: number
  }

  const subjectiveRes = await authedPost(headContext, '/api/v1/cards', {
    title: 'Flow subjective task',
    projectId: project.id,
    projectScope: 'subjective',
    assigneeUserId: me.user.id,
  })
  expect(subjectiveRes.status()).toBe(201)
  const subjective = (await subjectiveRes.json()) as {
    id: string
    version: number
  }

  const beforeRes = await headContext.request.get(`/api/v1/projects/${project.id}`)
  const before = (await beforeRes.json()) as {
    progress: number
    objectiveDone: number
    subjectiveDone: number
  }
  expect(before.objectiveDone).toBe(0)
  expect(before.subjectiveDone).toBe(0)
  expect(before.progress).toBe(0.5)

  // Personal checklists do not change the milestone completion percentage.
  const stepResponse = await authedPost(headContext, `/api/v1/cards/${objective.id}/checklist`, {
    text: 'First step',
  })
  const step = (await stepResponse.json()) as { id: string }
  await authedPost(headContext, `/api/v1/cards/${objective.id}/checklist`, { text: 'Second step' })
  await authedPatch(headContext, `/api/v1/cards/${objective.id}/checklist/${step.id}`, {
    done: true,
  })
  await headPage.reload()
  await expect(headPage.getByText('50', { exact: true })).toBeVisible()

  // The head overview links to the portfolio and to events in the next thirty days.
  expect((await authedPatch(headContext, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  const futureTitle = `Upcoming project review ${Date.now()}`
  const outsideTitle = `Later project review ${Date.now()}`
  const startsAt = new Date(Date.now() + 3 * 86_400_000)
  const futureResponse = await authedPost(headContext, '/api/v1/events', {
    title: futureTitle,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
    reminderOffsetsMinutes: [],
  })
  expect(futureResponse.status()).toBe(201)
  const futureEvent = (await futureResponse.json()) as { id: string; status: string }
  expect(futureEvent.status).toBe('open')
  const laterAt = new Date(Date.now() + 35 * 86_400_000)
  expect(
    (
      await authedPost(headContext, '/api/v1/events', {
        title: outsideTitle,
        startsAt: laterAt.toISOString(),
        endsAt: new Date(laterAt.getTime() + 3_600_000).toISOString(),
        reminderOffsetsMinutes: [],
      })
    ).status(),
  ).toBe(201)
  expect(
    (
      await authedPost(headContext, `/api/v1/events/${futureEvent.id}/rsvp`, {
        status: 'yes',
        guests: 0,
      })
    ).status(),
  ).toBe(200)
  const partialProject = (await (
    await headContext.request.get(`/api/v1/projects/${project.id}`)
  ).json()) as { progress: number }
  expect(partialProject.progress).toBe(0.5)
  await headPage.goto('/')
  await expect(
    headPage.getByRole('heading', { name: 'Upcoming · next 30 days', exact: true }),
  ).toBeVisible()
  const upcomingRow = headPage.getByRole('link').filter({ hasText: futureTitle })
  await expect(upcomingRow).toHaveAttribute('href', /\/work\/calendar\?month=.+&from=overview/)
  await expect(headPage.getByText(outsideTitle, { exact: true })).toHaveCount(0)
  await expect(
    headPage
      .getByRole('main')
      .getByRole('link')
      .filter({ has: headPage.getByText('Group projects', { exact: true }) }),
  ).toHaveAttribute('href', '/projects?from=overview')
  await headPage.screenshot({
    path: test.info().outputPath('head-home-upcoming-and-partial-project.png'),
    fullPage: true,
  })
  expect((await authedPatch(headContext, '/api/v1/me', { locale: 'uz-Latn' })).status()).toBe(200)
  await headPage.goto(`/projects/view?id=${project.id}`)

  // Complete both tasks -- the real `PATCH /cards/:id` state transition.
  const latestObjective = (await (
    await headContext.request.get(`/api/v1/cards/${objective.id}`)
  ).json()) as { version: number }
  const doneObjective = await authedPatch(headContext, `/api/v1/cards/${objective.id}`, {
    status: 'done',
    version: latestObjective.version,
  })
  expect(doneObjective.status()).toBe(200)
  const doneSubjective = await authedPatch(headContext, `/api/v1/cards/${subjective.id}`, {
    status: 'done',
    version: subjective.version,
  })
  expect(doneSubjective.status()).toBe(200)

  const afterRes = await headContext.request.get(`/api/v1/projects/${project.id}`)
  const after = (await afterRes.json()) as {
    progress: number
    objectiveDone: number
    objectiveTotal: number
    subjectiveDone: number
    subjectiveTotal: number
  }
  expect(after.objectiveDone).toBe(1)
  expect(after.objectiveTotal).toBe(1)
  expect(after.subjectiveDone).toBe(1)
  expect(after.subjectiveTotal).toBe(1)
  expect(after.progress).toBe(0.5)

  await headPage.reload()
  await expect(headPage.getByText('50', { exact: true })).toBeVisible()
  const remaining = (await afterRes.json()).milestones.find(
    (milestone: { doneAt: string | null }) => !milestone.doneAt,
  ) as { id: string }
  expect(
    (
      await authedPatch(headContext, `/api/v1/projects/${project.id}/milestones/${remaining.id}`, {
        done: true,
      })
    ).status(),
  ).toBe(200)

  // Real UI, reloaded: the project's progress ring reads 100%.
  await headPage.reload()
  await expect(headPage.getByText('100', { exact: true })).toBeVisible()

  // Create only a chosen checkpoint, then edit/delete/undo it using actual controls.
  const addMilestone = headPage.getByPlaceholder('Bosqich nomini yozing')
  await addMilestone.fill('Chosen checkpoint')
  await addMilestone.locator('..').getByRole('button', { name: 'Saqlash', exact: true }).click()
  await headPage
    .getByRole('button', { name: 'Bosqichni tahrirlash: Chosen checkpoint', exact: true })
    .click()
  const milestoneDialog = headPage.getByRole('dialog')
  await milestoneDialog.getByLabel('Bosqich nomi', { exact: true }).fill('Updated checkpoint')
  await milestoneDialog.getByLabel('Muddat (ixtiyoriy)').fill('2027-02-02')
  await milestoneDialog.getByRole('button', { name: 'Saqlash', exact: true }).click()
  await expect(headPage.getByText('Updated checkpoint', { exact: true })).toBeVisible()
  await headPage
    .getByRole('button', { name: 'Bosqichni tahrirlash: Updated checkpoint', exact: true })
    .click()
  await milestoneDialog.getByRole('button', { name: 'Bosqichni oʻchirish', exact: true }).click()
  await expect(headPage.getByText('Updated checkpoint', { exact: true })).toHaveCount(0)
  const milestoneDeletionToast = headPage.locator('[data-sonner-toast]').filter({
    has: headPage.getByText('Bosqich oʻchirildi.', { exact: true }),
  })
  await expect(
    milestoneDeletionToast.getByRole('button', { name: 'Bekor qilish', exact: true }),
  ).toBeVisible()

  // Project deletion hides its tasks, and undo remains usable after navigation unmounts the page.
  // Retain the real milestone receipt so both distinct Undo actions overlap, as they can in CI.
  await headPage.getByRole('button', { name: 'Loyihani oʻchirish', exact: true }).click()
  await expect(headPage).toHaveURL(/\/projects$/)
  const projectDeletionToast = headPage.locator('[data-sonner-toast]').filter({
    has: headPage.getByText(
      'Loyiha va uning vazifalari oʻchirildi. Hozir bekor qilishingiz mumkin.',
      { exact: true },
    ),
  })
  await expect(
    milestoneDeletionToast.getByRole('button', { name: 'Bekor qilish', exact: true }),
  ).toBeVisible()
  await projectDeletionToast.getByRole('button', { name: 'Bekor qilish', exact: true }).click()
  await expect(headPage).toHaveURL(new RegExp(`/projects/view\\?id=${project.id}`))
  await expect(headPage.getByText('100', { exact: true })).toBeVisible()
  await expect(headPage.getByText('Flow objective task', { exact: true })).toBeVisible()
  await milestoneDeletionToast.getByRole('button', { name: 'Bekor qilish', exact: true }).click()
  await expect(headPage.getByText('Updated checkpoint', { exact: true })).toBeVisible()

  await headContext.close()
})
