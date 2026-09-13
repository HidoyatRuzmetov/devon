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
import { seedAiSettingsRow } from './flow-db.js'

test('@flow group project: objective + subjective tasks complete and progress reflects it', async ({
  browser,
}) => {
  const superAdminContext = await newFlowContext(browser)
  await loginAsSuperAdmin(superAdminContext)

  const headContext = await newFlowContext(browser)
  const headPage = await headContext.newPage()
  const head = { login: uniqueLogin('flow.phead'), password: examplePassword() }
  const { departmentId } = await createApprovedDepartment(headContext, superAdminContext, {
    headLogin: head.login,
    headPassword: head.password,
    departmentName: `Project flow ${head.login.slice(-8)}`,
  })
  // Works around a confirmed product bug, not this flow's own concern -- see `flow-db.ts`'s
  // `seedAiSettingsRow` header and `cross-department-access.test.ts`'s "AI settings" `it.fails`:
  // the project page calls `useAiSettingsQuery`, which 500s for any department whose
  // `ai_department_settings` row does not exist yet (RLS rejects the lazy-insert for a real head).
  seedAiSettingsRow(departmentId)
  await superAdminContext.close()

  const meRes = await headContext.request.get('/api/v1/me')
  const me = (await meRes.json()) as { user: { id: string } }

  const templatesRes = await headContext.request.get('/api/v1/projects/templates')
  expect(templatesRes.status()).toBe(200)
  const templates = (await templatesRes.json()) as { key: string; title: string }[]
  expect(templates.length).toBeGreaterThan(0)

  const projectTitle = `Flow project ${Date.now()}`
  const createRes = await authedPost(headContext, '/api/v1/projects/from-template', {
    templateKey: templates[0]!.key,
    title: projectTitle,
    ownerUserId: me.user.id,
    members: [me.user.id],
  })
  expect(createRes.status()).toBe(201)
  const project = (await createRes.json()) as { id: string }

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
  const objective = (await objectiveRes.json()) as { id: string; version: number }

  const subjectiveRes = await authedPost(headContext, '/api/v1/cards', {
    title: 'Flow subjective task',
    projectId: project.id,
    projectScope: 'subjective',
    assigneeUserId: me.user.id,
  })
  expect(subjectiveRes.status()).toBe(201)
  const subjective = (await subjectiveRes.json()) as { id: string; version: number }

  const beforeRes = await headContext.request.get(`/api/v1/projects/${project.id}`)
  const before = (await beforeRes.json()) as {
    progress: number
    objectiveDone: number
    subjectiveDone: number
  }
  expect(before.objectiveDone).toBe(0)
  expect(before.subjectiveDone).toBe(0)

  // Complete both tasks -- the real `PATCH /cards/:id` state transition.
  const doneObjective = await authedPatch(headContext, `/api/v1/cards/${objective.id}`, {
    status: 'done',
    version: objective.version,
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
  await expect(headPage.getByText('100')).toBeVisible()

  await headContext.close()
})
