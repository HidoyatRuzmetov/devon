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

test('@flow group project: objective + subjective tasks complete and progress reflects it', async ({
  browser,
}) => {
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

  // Real UI: the project page renders (title, and both task-scope tabs).
  await headPage.goto(`/projects/view?id=${project.id}`)
  await expect(headPage.getByText('Boshqarma vazifalari')).toBeVisible()
  await expect(headPage.getByText('Oʻz vazifalarim')).toBeVisible()

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

  // Checklist steps are real partial progress, even before the task itself is marked done.
  const stepResponse = await authedPost(headContext, `/api/v1/cards/${objective.id}/checklist`, {
    text: 'First step',
  })
  const step = (await stepResponse.json()) as { id: string }
  await authedPost(headContext, `/api/v1/cards/${objective.id}/checklist`, { text: 'Second step' })
  await authedPatch(headContext, `/api/v1/cards/${objective.id}/checklist/${step.id}`, {
    done: true,
  })
  await headPage.reload()
  await expect(headPage.getByText('25', { exact: true })).toBeVisible()

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
  expect(after.progress).toBe(1)

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
  await headPage.getByRole('button', { name: 'Bekor qilish', exact: true }).click()
  await expect(headPage.getByText('Updated checkpoint', { exact: true })).toBeVisible()

  // Project deletion hides its tasks, and undo remains usable after navigation unmounts the page.
  await headPage.getByRole('button', { name: 'Loyihani oʻchirish', exact: true }).click()
  await expect(headPage).toHaveURL(/\/projects$/)
  await headPage.getByRole('button', { name: 'Bekor qilish', exact: true }).click()
  await expect(headPage).toHaveURL(new RegExp(`/projects/view\\?id=${project.id}`))
  await expect(headPage.getByText('100', { exact: true })).toBeVisible()
  await expect(headPage.getByText('Flow objective task', { exact: true })).toBeVisible()

  await headContext.close()
})
