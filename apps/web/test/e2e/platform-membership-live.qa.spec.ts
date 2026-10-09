import { expect, test } from '@playwright/test'
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

test('@qa an already-open applicant receives committed membership changes through the real broker', async ({
  browser,
}) => {
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const applicant = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('membership.head'),
      headPassword: examplePassword(),
      departmentName: 'Membership freshness QA',
    })
    expect(
      (
        await authedPatch(head, `/api/v1/departments/${department.departmentId}/invite/approval`, {
          joinRequiresApproval: true,
        })
      ).status(),
    ).toBe(204)
    await joinDepartmentAsNewUser(applicant, {
      login: uniqueLogin('membership.applicant'),
      password: examplePassword(),
      joinKey: department.joinKey,
      joinPassword: department.joinPassword,
    })
    expect((await authedPatch(applicant, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const userId = (await (await applicant.request.get('/api/v1/me')).json()).user.id
    const config = await (await applicant.request.get('/api/v1/realtime/config')).json()
    expect(config.enabled).toBe(true)
    expect(config.channels.department).toBe('')
    const page = await applicant.newPage()
    const wire: {
      connections: number
      publications: { channel: string; type: string; payload: unknown }[]
      errors: string[]
    } = { connections: 0, publications: [], errors: [] }
    const reads: { memberships: { departmentId: string; role: string }[] }[] = []
    const configuredDepartments: string[] = []
    page.on('pageerror', (error) => wire.errors.push(error.message))
    page.on('response', (response) => {
      if (
        response.status() === 200 &&
        new URL(response.url()).pathname === '/api/v1/realtime/config'
      )
        void response
          .json()
          .then((value) => configuredDepartments.push(value.channels.department))
          .catch(() => {})
      if (response.status() === 200 && new URL(response.url()).pathname === '/api/v1/me')
        void response
          .json()
          .then((value) => reads.push(value))
          .catch(() => {})
    })
    page.on('websocket', (socket) =>
      socket.on('framereceived', ({ payload }) => {
        for (const line of payload.toString().split('\n')) {
          let value: unknown
          try {
            value = JSON.parse(line)
          } catch {
            continue
          }
          for (const row of Array.isArray(value) ? value : [value]) {
            if (row?.connect?.client) wire.connections++
            if (row?.push?.pub?.data?.type)
              wire.publications.push({ channel: row.push.channel, ...row.push.pub.data })
          }
        }
      }),
    )
    await page.goto('/')
    await expect.poll(() => wire.connections).toBe(1)
    await expect.poll(() => reads.length).toBeGreaterThan(0)
    expect(reads.at(-1)?.memberships).toEqual([])
    const beforeReads = reads.length
    const requests = await (
      await head.request.get(`/api/v1/departments/${department.departmentId}/join-requests`)
    ).json()
    const receipt = requests.requests.find((row: { userId: string }) => row.userId === userId)
    expect(receipt).toBeTruthy()
    expect(
      (
        await authedPost(
          head,
          `/api/v1/departments/${department.departmentId}/join-requests/${userId}/approve`,
          { expectedVersion: receipt.version },
        )
      ).status(),
    ).toBe(204)
    expect((await (await applicant.request.get('/api/v1/me')).json()).memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ departmentId: department.departmentId, role: 'member' }),
      ]),
    )
    await expect
      .poll(
        () => wire.publications.filter((row) => row.type === 'departments.join_request.decided'),
        { timeout: 8_000 },
      )
      .toEqual(
        expect.arrayContaining([expect.objectContaining({ channel: config.channels.personal })]),
      )
    await expect
      .poll(
        () =>
          reads
            .slice(beforeReads)
            .some((row) => row.memberships.some((m) => m.departmentId === department.departmentId)),
        { timeout: 5_000 },
      )
      .toBe(true)
    await expect(page.locator('a[href="/work"]').first()).toBeVisible()
    await expect
      .poll(() => configuredDepartments, { timeout: 5_000 })
      .toContain(`dept:${department.departmentId}`)
    await page.screenshot({
      path: test.info().outputPath('approved-without-reload.png'),
      fullPage: true,
    })
    expect(wire.errors).toEqual([])
    await test.info().attach('membership-broker-and-reads', {
      body: JSON.stringify({ wire, reads }, null, 2),
      contentType: 'application/json',
    })
  } finally {
    await Promise.all([admin.close(), head.close(), applicant.close()])
  }
})
