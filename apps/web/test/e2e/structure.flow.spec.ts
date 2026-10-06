import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'

test('@flow organization chart connects the department and nested units, opens people, and exports a complete PNG', async ({
  browser,
}, info) => {
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const dept = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('chart.head'),
      headPassword: examplePassword(),
      departmentName: 'Digital services',
    })
    expect((await authedPatch(head, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const addUnit = async (name: string, parentUnitId?: string) => {
      const response = await authedPost(head, `/api/v1/departments/${dept.departmentId}/units`, {
        name,
        parentUnitId,
      })
      expect(response.status()).toBe(201)
      return (await response.json()) as { id: string }
    }
    const first = await addUnit('Service delivery')
    await addUnit('Support team', first.id)
    await addUnit('Quality assurance')
    const page = await head.newPage()
    await page.goto('/structure')
    await page.getByRole('tab', { name: 'Org chart', exact: true }).click()
    const tree = page.getByRole('tree', { name: 'Digital services' })
    await expect(tree.getByRole('treeitem')).toHaveCount(4)
    await expect(tree.locator('path')).toHaveCount(3)
    const departmentBox = await tree
      .getByRole('treeitem', { name: 'Digital services', exact: true })
      .boundingBox()
    const firstBox = await tree
      .getByRole('treeitem', { name: 'Service delivery', exact: true })
      .boundingBox()
    const childBox = await tree
      .getByRole('treeitem', { name: 'Support team', exact: true })
      .boundingBox()
    expect(departmentBox!.y + departmentBox!.height).toBeLessThan(firstBox!.y)
    expect(firstBox!.y + firstBox!.height).toBeLessThan(childBox!.y)
    await tree.getByRole('treeitem', { name: 'Service delivery', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Service delivery', exact: true }).first(),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).last().click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export as PNG' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('Digital services.png')
    const imagePath = info.outputPath('organization.png')
    await download.saveAs(imagePath)
    const png = await readFile(imagePath)
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(png.readUInt32BE(16)).toBeGreaterThan(500)
    expect(png.readUInt32BE(20)).toBeGreaterThan(500)
    await info.attach('organization PNG', { path: imagePath, contentType: 'image/png' })
    const accessibility = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(
      accessibility.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
    ).toEqual([])
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(tree).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true)
  } finally {
    await Promise.all([head.close(), admin.close()])
  }
})
