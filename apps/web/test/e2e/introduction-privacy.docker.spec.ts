/* eslint-disable no-restricted-syntax -- Workflow steps and authorization assertions depend on the previous saved decision. */
import { test, expect, type BrowserContext } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  authedPatch,
  authedPost,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  registerUser,
  uniqueLogin,
} from './flow-api.js'

const output = resolve(import.meta.dirname, '../../../../artifacts/qa/viewer-v2/introduction')
test('Only the current approved introduction is shared; submission status belongs to its account', async ({
  browser,
}) => {
  mkdirSync(output, { recursive: true })
  const admin = await newFlowContext(browser),
    head = await newFlowContext(browser),
    author = await newFlowContext(browser),
    peer = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const register = async (context: BrowserContext, givenName: string) => {
      await registerUser(context, {
        login: uniqueLogin('intro.privacy'),
        password: examplePassword(),
        givenName,
        familyName: 'Review',
      })
      const me = await (await context.request.get('/api/v1/me')).json()
      const result = spawnSync(
        'docker',
        [
          'exec',
          '-i',
          'devon-onboarding-review-postgres-1',
          'psql',
          '-X',
          '-q',
          '-v',
          'ON_ERROR_STOP=1',
          '-U',
          'postgres',
          '-d',
          'devon_qa_onboarding_docker',
        ],
        {
          input: `update app.users set onboarding_required=false where id='${me.user.id}';`,
          encoding: 'utf8',
          timeout: 15_000,
        },
      )
      expect(result.status).toBe(0)
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    }
    await register(head, 'Anvar')
    const requested = await authedPost(head, '/api/v1/departments/requests', {
      name: 'Introductions · Private submissions',
      locale: 'en',
      units: [{ name: 'Research' }],
    })
    expect(requested.status()).toBe(201)
    const approved = await authedPost(
      admin,
      `/api/v1/departments/requests/${(await requested.json()).id}/approve`,
      {},
    )
    expect(approved.status()).toBe(200)
    const department = await approved.json()
    for (const [context, name] of [
      [author, 'Aziza'],
      [peer, 'Lola'],
    ] as const) {
      await register(context, name)
      expect(
        (
          await authedPost(context, '/api/v1/departments/join', {
            key: department.joinKey,
            password: department.joinPassword,
          })
        ).status(),
      ).toBe(200)
    }
    const submit = async (context: BrowserContext, title: string) => {
      const response = await authedPost(context, '/api/v1/onboarding/documents', {
        title,
        filename: 'introduction.html',
        html: `<!doctype html><html><body style="font:20px system-ui;padding:32px;color:#102b43"><h1>${title}</h1><p>Department introduction review example.</p></body></html>`,
      })
      expect(response.status()).toBe(201)
      return (await response.json()).id as string
    }
    const first = await submit(author, 'The approved welcome')
    const declined = await submit(author, 'A declined draft')
    const replacement = await submit(author, 'Our updated department introduction')
    const privateDraft = await submit(peer, 'A colleague’s private draft')
    const list = async (context: BrowserContext, view = 'published') => {
      const response = await context.request.get(`/api/v1/onboarding/documents?view=${view}`)
      expect(response.status()).toBe(200)
      return response.json()
    }
    expect((await list(peer)).items).toEqual([])
    expect(
      (await list(author, 'mine')).items.map((item: { id: string }) => item.id).sort(),
    ).toEqual([first, declined, replacement].sort())
    expect((await list(peer, 'mine')).items.map((item: { id: string }) => item.id)).toEqual([
      privateDraft,
    ])
    expect((await peer.request.get('/api/v1/onboarding/documents?view=review')).status()).toBe(403)
    for (const suffix of ['', '/render'])
      expect(
        (await peer.request.get(`/api/v1/onboarding/documents/${first}${suffix}`)).status(),
      ).toBe(404)
    expect((await head.request.get(`/api/v1/onboarding/documents/${first}/render`)).status()).toBe(
      200,
    )
    expect(
      (
        await authedPost(head, `/api/v1/onboarding/documents/${first}/decision`, {
          action: 'publish',
          revision: 0,
        })
      ).status(),
    ).toBe(200)
    expect(
      (
        await authedPost(head, `/api/v1/onboarding/documents/${declined}/decision`, {
          action: 'reject',
          revision: 1,
        })
      ).status(),
    ).toBe(200)
    expect((await list(peer)).items.map((item: { id: string }) => item.id)).toEqual([first])
    expect(
      (await list(author, 'mine')).items.find((item: { id: string }) => item.id === declined)
        .rejected,
    ).toBe(true)
    for (const context of [head, peer])
      for (const suffix of ['', '/render'])
        expect(
          (await context.request.get(`/api/v1/onboarding/documents/${declined}${suffix}`)).status(),
        ).toBe(404)
    expect(
      (await list(head, 'review')).items.map((item: { id: string }) => item.id).sort(),
    ).toEqual([replacement, privateDraft].sort())
    const authorPage = await author.newPage()
    await authorPage.goto('/help?tab=materials')
    await expect(
      authorPage.getByRole('heading', {
        name: 'The approved welcome',
        exact: true,
      }),
    ).toBeVisible()
    await expect(authorPage.getByText('Awaiting approval', { exact: true })).toHaveCount(0)
    await expect(authorPage.getByText('Declined', { exact: true })).toHaveCount(0)
    await authorPage.screenshot({
      path: resolve(output, '01-shared-approved-only.png'),
      animations: 'disabled',
    })
    await authorPage.getByRole('button', { name: 'My submissions', exact: true }).click()
    await expect(authorPage.getByText('Declined', { exact: true })).toBeVisible()
    await expect(authorPage.getByText('Awaiting approval', { exact: true })).toBeVisible()
    await expect(
      authorPage.getByRole('heading', { name: 'A colleague’s private draft' }),
    ).toHaveCount(0)
    await authorPage.screenshot({
      path: resolve(output, '02-personal-submission-status.png'),
      animations: 'disabled',
    })
    const headPage = await head.newPage()
    await headPage.goto('/help?tab=materials')
    await headPage.getByRole('button', { name: 'Review submissions', exact: true }).click()
    const candidate = headPage.locator('article').filter({
      has: headPage.getByRole('heading', {
        name: 'Our updated department introduction',
        exact: true,
      }),
    })
    await expect(candidate).toBeVisible()
    await expect(
      headPage.getByRole('heading', {
        name: 'The approved welcome',
        exact: true,
      }),
    ).toHaveCount(0)
    await expect(
      headPage.getByRole('heading', { name: 'A declined draft', exact: true }),
    ).toHaveCount(0)
    await headPage.screenshot({
      path: resolve(output, '03-head-review-queue.png'),
      animations: 'disabled',
    })
    await candidate.getByRole('button', { name: 'Preview', exact: true }).click()
    await expect(
      headPage
        .frameLocator('iframe')
        .getByRole('heading', { name: 'Our updated department introduction' }),
    ).toBeVisible()
    await headPage.getByRole('button', { name: 'Close preview', exact: true }).click()
    await candidate.getByRole('button', { name: 'Approve and publish', exact: true }).click()
    await expect(
      headPage.getByRole('button', {
        name: 'Published introduction',
        exact: true,
      }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(headPage.locator('article')).toHaveCount(1)
    await expect(
      headPage.getByRole('heading', {
        name: 'Our updated department introduction',
        exact: true,
      }),
    ).toBeVisible()
    await headPage.screenshot({
      path: resolve(output, '04-replacement-is-current.png'),
      animations: 'disabled',
    })
    for (const context of [head, author, peer])
      expect((await list(context)).items.map((item: { id: string }) => item.id)).toEqual([
        replacement,
      ])
    for (const suffix of ['', '/render'])
      expect(
        (await peer.request.get(`/api/v1/onboarding/documents/${first}${suffix}`)).status(),
      ).toBe(404)
    expect(
      (await list(author, 'mine')).items.find((item: { id: string }) => item.id === first)
        .superseded,
    ).toBe(true)
    expect((await list(head, 'review')).items.map((item: { id: string }) => item.id)).toEqual([
      privateDraft,
    ])
    expect(
      (
        await authedPost(head, `/api/v1/onboarding/documents/${first}/decision`, {
          action: 'publish',
          revision: 2,
        })
      ).status(),
    ).toBe(409)
  } finally {
    await Promise.all([admin.close(), head.close(), author.close(), peer.close()])
  }
})
