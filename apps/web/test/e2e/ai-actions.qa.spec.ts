import { expect, test } from '@playwright/test'
import type { AiConversation } from '@devon/contracts'
import {
  authedPatch,
  createApprovedDepartment,
  examplePassword,
  joinDepartmentAsNewUser,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'

for (const role of ['head', 'member'] as const) {
  test(`@flow ${role} confirms a persisted AI action with a scanned file and resumes history`, async ({
    browser,
  }, testInfo) => {
    test.setTimeout(120_000)
    const admin = await newFlowContext(browser)
    const head = await newFlowContext(browser)
    const member = await newFlowContext(browser)
    const context = role === 'head' ? head : member
    const isPage = role === 'head'
    const title = isPage ? 'AI publication browser test' : 'Review the published directory'
    const proposalTitle = isPage ? 'Publish the directory page' : 'Create the review task'
    const fileName = isPage ? 'directory.html' : 'review.txt'
    const fileBody = isPage
      ? '<!doctype html><title>Directory fixture</title><p>Synthetic directory for browser verification.</p>'
      : 'Synthetic contact directory review evidence.'
    try {
      await loginAsSuperAdmin(admin)
      const department = await createApprovedDepartment(head, admin, {
        headLogin: uniqueLogin('ai.action.head'),
        headPassword: examplePassword(),
        departmentName: `AI action browser ${role}`,
      })
      if (role === 'member')
        await joinDepartmentAsNewUser(member, {
          login: uniqueLogin('ai.action.member'),
          password: examplePassword(),
          joinKey: department.joinKey,
          joinPassword: department.joinPassword,
        })
      expect(
        (
          await authedPatch(head, '/api/v1/ai/settings', {
            budgetUzsPerMonth: 10000000,
            flags: { semantic_ask: true, catch_up: false },
          })
        ).status(),
      ).toBe(200)
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
      const records = async (): Promise<{ id: string; title: string }[]> => {
        const response = await context.request.get(isPage ? '/api/v1/pages' : '/api/v1/cards')
        expect(response.status()).toBe(200)
        const data = await response.json()
        return isPage ? data : data.items
      }
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.setViewportSize({
        width: role === 'head' ? 1440 : 390,
        height: role === 'head' ? 1000 : 844,
      })
      await page.goto('/assistant')
      const composer = page.getByTestId('ai-composer').getByRole('textbox')
      await expect(composer).toBeVisible()
      await page.locator('input[type="file"][aria-label="Attach files"]').setInputFiles({
        name: fileName,
        mimeType: isPage ? 'text/html' : 'text/plain',
        buffer: Buffer.from(fileBody),
      })
      await expect(page.getByLabel('File checked and ready', { exact: true })).toBeVisible()
      await composer.fill(
        isPage
          ? 'Create a page named AI publication browser test with a brief introduction and attach this directory.'
          : 'Create a task to review the published directory and attach this review evidence.',
      )
      await page.getByRole('button', { name: 'Send message', exact: true }).click()
      const proposal = page.getByRole('region', { name: proposalTitle, exact: true })
      await expect(proposal).toBeVisible({ timeout: 30_000 })
      await expect(proposal).toContainText(title)
      await expect(proposal).toContainText(fileName)
      await expect(proposal).not.toContainText('"type":"doc"')
      expect((await records()).some((record) => record.title === title)).toBe(false)
      const conversationId = new URL(page.url()).searchParams.get('conversation')!
      expect(conversationId).toBeTruthy()
      const read = async () =>
        (await (
          await context.request.get(`/api/v1/ai/conversations/${conversationId}`)
        ).json()) as AiConversation
      const pending = await read()
      expect(pending.messages.flatMap((message) => message.proposals ?? [])).toMatchObject([
        { status: 'pending' },
      ])
      expect(
        pending.messages.find((message) => message.role === 'user')?.attachments,
      ).toMatchObject([{ name: fileName }])
      await page.reload()
      await expect(
        proposal.getByRole('button', { name: 'Confirm and apply', exact: true }),
      ).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`proposal-${role}.png`) })
      await proposal.getByRole('button', { name: 'Confirm and apply', exact: true }).click()
      await expect(proposal).toContainText('Applied', { timeout: 30_000 })
      await expect(
        proposal.getByRole('button', { name: 'Confirm and apply', exact: true }),
      ).toHaveCount(0)
      const after = await read()
      const applied = after.messages.flatMap((message) => message.proposals ?? [])[0]!
      expect(applied.status).toBe('executed')
      expect((await records()).filter((record) => record.title === title)).toHaveLength(1)
      const conversationUrl = page.url()
      await page.reload()
      await expect(proposal).toContainText('Applied')
      await proposal.getByRole('link').filter({ hasText: applied.result!.label }).click()
      await expect(page).toHaveURL(isPage ? /\/pages\?page=/ : /\/work\/card\?id=/)
      const download = page.getByRole('link', { name: fileName, exact: true })
      await expect(download).toBeVisible()
      const response = await context.request.get((await download.getAttribute('href'))!)
      expect(response.status()).toBe(200)
      expect(response.headers()['content-disposition']).toContain('attachment')
      expect(response.headers()['x-content-type-options']).toBe('nosniff')
      expect(await response.text()).toBe(fileBody)
      await page.goto(conversationUrl)
      await expect(proposal).toContainText('Applied')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.getByRole('button', { name: 'New conversation', exact: true }).click()
      if (role === 'member')
        await page.getByRole('button', { name: 'Saved conversations', exact: true }).click()
      await page
        .getByRole('button', {
          name: new RegExp(isPage ? '^Create a page named' : '^Create a task to'),
        })
        .click()
      await expect(proposal).toContainText('Applied')
      expect(errors).toEqual([])
    } finally {
      await member.close()
      await head.close()
      await admin.close()
    }
  })
}
