import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
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

test('@qa uploaded photos reach project and live stacks, each hovered person is named and raised', async ({
  browser,
}) => {
  test.setTimeout(150_000)
  if (process.env['FLOW_REALTIME'] !== '1')
    throw new Error('Avatar interactions require the real local broker (FLOW_REALTIME=1)')
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('avatar.head'),
      headPassword: examplePassword(),
      departmentName: 'Avatar interaction checks',
    })
    await joinDepartmentAsNewUser(member, {
      login: uniqueLogin('avatar.member'),
      password: examplePassword(),
      ...department,
    })
    expect(
      (
        await authedPatch(member, '/api/v1/accounts/profile', {
          givenName: 'Dilnoza',
          familyName: 'Karimova',
        })
      ).ok(),
    ).toBe(true)
    expect((await authedPatch(head, '/api/v1/me', { locale: 'en' })).ok()).toBe(true)
    expect((await authedPatch(member, '/api/v1/me', { locale: 'en' })).ok()).toBe(true)
    const memberPage = await member.newPage()
    await memberPage.goto('/account')
    const finalized = memberPage.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/accounts/avatar') &&
        response.request().method() === 'POST',
    )
    await memberPage
      .locator('#section-photo input[type="file"]')
      .setInputFiles(join(import.meta.dirname, 'fixtures/account-avatar.png'))
    expect((await finalized).status()).toBe(200)
    const memberMe = (await (await member.request.get('/api/v1/me')).json()) as {
      user: { id: string; avatarKey: string }
    }
    const headMe = (await (await head.request.get('/api/v1/me')).json()) as { user: { id: string } }
    expect(memberMe.user.avatarKey).toMatch(/^avatars\//)
    // The event roster used to discard avatar keys at its SQL/DTO boundary entirely.
    const startsAt = new Date(Date.now() + 86_400_000).toISOString()
    const eventResponse = await authedPost(head, '/api/v1/events', {
      title: 'Avatar roster review',
      category: 'training',
      startsAt,
      endsAt: new Date(Date.now() + 90_000_000).toISOString(),
    })
    expect(eventResponse.status()).toBe(201)
    const event = (await eventResponse.json()) as { id: string }
    expect(
      (
        await authedPost(member, `/api/v1/events/${event.id}/rsvp`, { status: 'yes', guests: 0 })
      ).ok(),
    ).toBe(true)
    expect(
      (
        await authedPost(member, `/api/v1/events/${event.id}/comments`, {
          body: 'The pilot guide is ready for review.',
        })
      ).ok(),
    ).toBe(true)
    const carpool = await authedPost(member, `/api/v1/events/${event.id}/carpools`, { seats: 3 })
    expect(carpool.ok()).toBe(true)
    expect((await carpool.json()).driver.avatarKey).toBe(memberMe.user.avatarKey)
    const rsvps = (await (await head.request.get(`/api/v1/events/${event.id}/rsvps`)).json()) as {
      items: Array<{ userId: string; avatarKey: string | null }>
    }
    expect(rsvps.items.find((row) => row.userId === memberMe.user.id)?.avatarKey).toBe(
      memberMe.user.avatarKey,
    )
    const comments = (await (
      await head.request.get(`/api/v1/events/${event.id}/comments`)
    ).json()) as { items: Array<{ author: { avatarKey: string | null } }> }
    expect(comments.items[0]?.author.avatarKey).toBe(memberMe.user.avatarKey)
    const expectedPhoto = `/api/v1/accounts/avatar/${memberMe.user.avatarKey.split('/').slice(1).join('/')}/64`
    const projectResponse = await authedPost(head, '/api/v1/projects', {
      title: 'Service pilot colleagues',
      ownerUserId: headMe.user.id,
      members: [headMe.user.id, memberMe.user.id],
    })
    expect(projectResponse.status()).toBe(201)
    const headPage = await head.newPage()
    await headPage.setViewportSize({ width: 1440, height: 1000 })
    await headPage.goto('/projects')
    const projectPeople = headPage.getByRole('group', { name: 'Members', exact: true })
    const photoFace = projectPeople.getByRole('button', { name: 'Dilnoza Karimova', exact: true })
    await expect(photoFace.locator('img')).toHaveAttribute('src', expectedPhoto)
    await expect(photoFace.locator('img')).toBeVisible()
    await photoFace.hover()
    await expect(
      headPage.getByRole('tooltip', { name: 'Dilnoza Karimova', exact: true }),
    ).toBeVisible()
    await expect
      .poll(() => photoFace.evaluate((element) => getComputedStyle(element).zIndex))
      .toBe('30')
    const headFace = projectPeople.getByRole('button', { name: 'Test Head', exact: true })
    await headFace.hover()
    await expect(headPage.getByRole('tooltip', { name: 'Test Head', exact: true })).toBeVisible()
    await expect
      .poll(() => headFace.evaluate((element) => getComputedStyle(element).zIndex))
      .toBe('30')
    const output = join(import.meta.dirname, '../../../../artifacts/qa/2026-10/avatar-interactions')
    await mkdir(output, { recursive: true })
    await headPage.screenshot({ path: join(output, 'project-person-hover.png') })
    await photoFace.focus()
    await expect(
      headPage.getByRole('tooltip', { name: 'Dilnoza Karimova', exact: true }),
    ).toBeVisible()
    await headPage.emulateMedia({ reducedMotion: 'reduce' })
    await expect
      .poll(() =>
        photoFace
          .locator(':scope > span')
          .evaluate((element) => getComputedStyle(element).transform),
      )
      .toBe('none')
    await headPage.emulateMedia({ reducedMotion: 'no-preference' })

    // The SVG chart is a separate renderer: prove its real photo also survives PNG export.
    const unitResponse = await authedPost(
      head,
      `/api/v1/departments/${department.departmentId}/units`,
      { name: 'Pilot services' },
    )
    expect(unitResponse.status()).toBe(201)
    const unit = (await unitResponse.json()) as { id: string }
    expect(
      (
        await authedPost(head, `/api/v1/departments/${department.departmentId}/unit-roles`, {
          unitId: unit.id,
          userId: memberMe.user.id,
          role: 'head',
        })
      ).ok(),
    ).toBe(true)
    await headPage.goto('/structure')
    await headPage.getByRole('tab', { name: 'Org chart', exact: true }).click()
    const tree = headPage.getByRole('tree', { name: 'Avatar interaction checks' })
    const svgPhoto = tree.locator(`image[href="${expectedPhoto}"]`)
    await expect(svgPhoto).toBeVisible()
    const photoPoint = await svgPhoto.evaluate((element) => {
      const image = element as SVGImageElement
      const point = new DOMPoint(
        image.x.baseVal.value + image.width.baseVal.value / 2,
        image.y.baseVal.value + image.height.baseVal.value / 2,
      ).matrixTransform(image.getCTM()!)
      return { x: point.x, y: point.y, width: image.ownerSVGElement!.width.baseVal.value }
    })
    const downloading = headPage.waitForEvent('download')
    await headPage.getByRole('button', { name: 'Export as PNG' }).click()
    const downloaded = await downloading
    const exportPath = join(output, 'org-chart-with-photo.png')
    await downloaded.saveAs(exportPath)
    const exported = await readFile(exportPath)
    const exportedPixel = await headPage.evaluate(
      async ({ encoded, point, source }) => {
        const decode = (src: string) =>
          new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image()
            image.onload = () => resolve(image)
            image.onerror = reject
            image.src = src
          })
        const [png, avatar] = await Promise.all([
          decode(`data:image/png;base64,${encoded}`),
          decode(source),
        ])
        const canvas = document.createElement('canvas')
        canvas.width = png.width
        canvas.height = png.height
        const context = canvas.getContext('2d')!
        context.drawImage(png, 0, 0)
        const scale = png.width / point.width
        const actual = [
          ...context.getImageData(Math.round(point.x * scale), Math.round(point.y * scale), 1, 1)
            .data,
        ]
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.drawImage(avatar, 0, 0)
        const expected = [...context.getImageData(avatar.width / 2, avatar.height / 2, 1, 1).data]
        return { actual, expected }
      },
      { encoded: exported.toString('base64'), point: photoPoint, source: expectedPhoto },
    )
    expect(
      exportedPixel.actual.every(
        (value, index) => Math.abs(value - exportedPixel.expected[index]!) <= 8,
      ),
    ).toBe(true)
    await headPage.screenshot({ path: join(output, 'org-chart-profile-photo.png') })
    await memberPage.goto('/work')
    await headPage.goto('/work')
    const liveGroup = headPage.getByRole('group', {
      name: 'Karimova Dilnoza is looking at this board too',
    })
    const liveFace = liveGroup.getByRole('button', { name: 'Karimova Dilnoza', exact: true })
    await expect(liveFace.locator('img')).toHaveAttribute('src', expectedPhoto)
    await expect(headPage.locator(`img[src="${expectedPhoto}"]`)).toHaveCount(2)
    await liveFace.hover()
    await expect(
      headPage.getByRole('tooltip', { name: 'Karimova Dilnoza', exact: true }),
    ).toBeVisible()
    await headPage.screenshot({ path: join(output, 'live-person-hover.png') })

    // The roster and connection info must update after removal without reloading the colleague's tab.
    await memberPage.goto('/account')
    const removed = memberPage.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/accounts/avatar') &&
        response.request().method() === 'DELETE',
    )
    await memberPage.locator('#section-photo').getByRole('button', { name: 'Remove photo' }).click()
    expect((await removed).status()).toBe(204)
    await expect(
      memberPage.locator('#section-photo').getByRole('button', { name: 'Remove photo' }),
    ).toHaveCount(0)
    await memberPage.goto('/work')
    await expect(liveFace.locator('img')).toHaveCount(0)
    await expect(liveFace).toContainText('KD')
  } finally {
    await Promise.all([admin.close(), head.close(), member.close()])
  }
})
