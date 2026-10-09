// These loops mutate one live canvas/page sequentially; parallel actions would race its tool,
// locale, viewport and saved history. They are dependent browser transitions, not independent I/O.
/* eslint-disable no-restricted-syntax */
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Browser, type TestInfo } from '@playwright/test'
import { authedPatch, authedPost, flowClientHeaders, login, newFlowContext } from './flow-api.js'
import { settleCapture } from './platform-capture.js'
import { FLOW_WEB_BASE_URL } from './flow-env.js'
import AxeBuilder from '@axe-core/playwright'
import { visualLabel } from './visual-label.js'
import { THEME_STORAGE_KEY } from '../../src/lib/constants.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'Ishonchli#2026'

async function openCanvas(browser: Browser, touch = false) {
  const context = touch
    ? await browser.newContext({
        baseURL: FLOW_WEB_BASE_URL,
        extraHTTPHeaders: flowClientHeaders(),
        hasTouch: true,
      })
    : await newFlowContext(browser)
  await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
  expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  const title = `Nested canvas ${randomUUID()}`
  const response = await authedPost(context, '/api/v1/personal/canvases', {
    title,
    scene: {
      elements: [
        {
          id: 'drawing',
          type: 'freehand',
          x: 80,
          y: 80,
          w: 80,
          h: 30,
          color: '#1f2937',
          strokeWidth: 6,
          points: [
            { x: 80, y: 80 },
            { x: 120, y: 110 },
            { x: 160, y: 80 },
          ],
        },
        {
          id: 'box',
          type: 'rectangle',
          x: 240,
          y: 80,
          w: 100,
          h: 60,
          color: '#2f6fed',
          strokeWidth: 4,
        },
        {
          id: 'label',
          type: 'text',
          x: 80,
          y: 200,
          w: 160,
          h: 28,
          color: '#1f2937',
          strokeWidth: 2,
          text: 'Original label',
        },
      ],
      appState: { retained: 'existing app state' },
    },
    stickies: [{ id: 'note', x: 400, y: 80, color: '#fde68a', text: 'Original note' }],
  })
  expect(response.status()).toBe(201)
  const canvas = await response.json()
  const page = await context.newPage()
  await page.goto('/personal')
  await page.getByRole('tab', { name: 'Canvas', exact: true }).click()
  await page
    .getByRole('listitem')
    .filter({ has: page.getByText(title, { exact: true }) })
    .getByRole('button', { name: 'Open', exact: true })
    .click()
  const svg = page.locator('svg[width="2400"][height="1400"]')
  await expect(svg.locator('polyline')).toHaveCount(1)
  return { context, page, canvas, svg }
}

function evidenceDir(info: TestInfo) {
  const dir = join(
    import.meta.dirname,
    '../../../../artifacts/qa/2026-10/canvas-nested',
    process.env['QA_RUN_ID'] ?? 'default',
    info.project.name,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

test('@canvas nested moving an existing freehand stroke moves its visible points', async ({
  browser,
}, info) => {
  const { context, page, svg } = await openCanvas(browser)
  try {
    await settleCapture(page)
    await page.screenshot({ path: join(evidenceDir(info), 'stroke-before.png'), fullPage: true })
    const line = svg.locator('polyline')
    const before = await line.boundingBox()
    expect(before).toBeTruthy()
    await page.mouse.move(before!.x + 40, before!.y + 30)
    await page.mouse.down()
    await page.mouse.move(before!.x + 80, before!.y + 60, { steps: 5 })
    await page.mouse.up()
    const after = await line.boundingBox()
    writeFileSync(
      join(evidenceDir(info), 'stroke-move.json'),
      JSON.stringify({ before, after }, null, 2),
    )
    await page.screenshot({ path: join(evidenceDir(info), 'stroke-after.png'), fullPage: true })
    expect(after!.x - before!.x).toBeCloseTo(40, 0)
    expect(after!.y - before!.y).toBeCloseTo(30, 0)
  } finally {
    await context.close()
  }
})

test('@canvas nested Delete outside the editor cannot remove the selected shape', async ({
  browser,
}, info) => {
  const { context, page, svg } = await openCanvas(browser)
  try {
    const rect = svg.locator('g > rect').first()
    const box = await rect.boundingBox()
    await page.mouse.click(box!.x + 10, box!.y)
    await page.getByRole('button', { name: 'Share this canvas', exact: true }).focus()
    await page.keyboard.press('Delete')
    await page.screenshot({ path: join(evidenceDir(info), 'outside-delete.png'), fullPage: true })
    await expect(svg.locator('g > rect')).toHaveCount(1)
  } finally {
    await context.close()
  }
})

test('@canvas nested undo restores a sticky text edit and redo reapplies it', async ({
  browser,
}, info) => {
  const { context, page } = await openCanvas(browser)
  try {
    const note = page.getByRole('textbox', { name: 'Sticky note text', exact: true })
    await note.fill('Edited note')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await page.screenshot({ path: join(evidenceDir(info), 'sticky-undo.png'), fullPage: true })
    await expect(note).toHaveValue('Original note')
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect(note).toHaveValue('Edited note')
  } finally {
    await context.close()
  }
})

test('@canvas nested all tools have keyboard creation, selection, editing and persisted history', async ({
  browser,
}, info) => {
  const { context, page, canvas, svg } = await openCanvas(browser)
  try {
    const surface = page.getByRole('region', { name: 'Drawing canvas', exact: true })
    const objects = page.getByRole('combobox', { name: 'Selected object', exact: true })
    const undo = page.getByRole('button', { name: 'Undo', exact: true })
    const redo = page.getByRole('button', { name: 'Redo', exact: true })
    await expect(undo).toBeDisabled()
    await expect(redo).toBeDisabled()
    await objects.selectOption('label')
    await page.getByRole('button', { name: 'Edit text', exact: true }).focus()
    await page.keyboard.press('Enter')
    const text = page.getByRole('textbox', { name: 'Drawing text', exact: true })
    await expect(text).toBeFocused()
    await text.fill('Edited drawing label')
    await text.press('Enter')
    await expect(surface).toBeFocused()
    await surface.press('Control+z')
    await expect(svg.locator('text')).toHaveText('Original label')
    await surface.press('Control+Shift+z')
    await expect(svg.locator('text')).toHaveText('Edited drawing label')
    for (const [tool, tag] of [
      ['Rectangle', 'rect'],
      ['Ellipse', 'ellipse'],
      ['Arrow', 'line'],
    ] as const) {
      const count = await svg.locator(`g > ${tag}`).count()
      await page.getByRole('button', { name: tool, exact: true }).focus()
      await page.keyboard.press('Enter')
      await page.getByRole('button', { name: 'Add object', exact: true }).focus()
      await page.keyboard.press('Enter')
      await expect(svg.locator(`g > ${tag}`)).toHaveCount(count + 1)
      await expect(surface).toBeFocused()
      await surface.press('Shift+ArrowRight')
      await expect(page.getByRole('spinbutton', { name: 'Horizontal', exact: true })).toHaveValue(
        '110',
      )
      const id = await objects.inputValue()
      await page.getByRole('button', { name: 'Green', exact: true }).click()
      await page.getByRole('combobox', { name: 'Stroke width', exact: true }).selectOption('6')
      await expect(svg.locator(`[data-canvas-object="${id}"] > ${tag}`)).toHaveAttribute(
        'stroke',
        '#147d43',
      )
      await expect(svg.locator(`[data-canvas-object="${id}"] > ${tag}`)).toHaveAttribute(
        'stroke-width',
        '6',
      )
    }
    const marker = await svg.locator('g > line').last().getAttribute('marker-end')
    expect(marker).toMatch(/^url\(#arrowhead-/)
    await expect(svg.locator(`#${marker!.slice(5, -1)}`)).toHaveCount(1)
    await page.getByRole('button', { name: 'Pen', exact: true }).click()
    const beforePen = await svg.locator('g > polyline').count()
    await page.getByRole('button', { name: 'Add object', exact: true }).click()
    await expect(undo).toBeDisabled()
    await surface.press('Shift+ArrowRight')
    await surface.press('Shift+ArrowDown')
    await surface.press('Shift+ArrowLeft')
    await surface.press('Enter')
    await expect(svg.locator('g > polyline')).toHaveCount(beforePen + 1)
    await page.getByRole('button', { name: 'Pen', exact: true }).click()
    await page.getByRole('button', { name: 'Add object', exact: true }).click()
    await page.getByRole('button', { name: 'Cancel drawing', exact: true }).click()
    await expect(svg.locator('g > polyline')).toHaveCount(beforePen + 1)
    await page.getByRole('button', { name: 'Text', exact: true }).click()
    await page.getByRole('button', { name: 'Add object', exact: true }).click()
    await expect(text).toBeFocused()
    await text.fill('Keyboard-created text')
    await text.press('Enter')
    await page.getByRole('button', { name: 'Eraser', exact: true }).click()
    const eraseTarget = svg.locator('[data-canvas-object="box"] > rect')
    await eraseTarget.scrollIntoViewIfNeeded()
    await eraseTarget.click()
    await expect(svg.locator('[data-canvas-object="box"]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(svg.locator('[data-canvas-object="box"]')).toHaveCount(1)
    await objects.selectOption('box')
    await surface.focus()
    await surface.press('Delete')
    await expect(svg.locator('[data-canvas-object="box"]')).toHaveCount(0)
    await surface.press('Control+z')
    await expect(svg.locator('[data-canvas-object="box"]')).toHaveCount(1)
    await page.getByRole('button', { name: 'Add sticky note', exact: true }).click()
    const newNote = page.getByRole('textbox', { name: 'Sticky note text', exact: true }).last()
    await newNote.fill('Keyboard note')
    const handle = newNote
      .locator('..')
      .getByRole('button', { name: 'Move sticky note', exact: true })
    await handle.focus()
    await handle.press('Shift+ArrowRight')
    await expect(page.getByRole('spinbutton', { name: 'Horizontal', exact: true })).toHaveValue(
      '70',
    )
    await page.getByRole('button', { name: 'Pink', exact: true }).click()
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
    await expect(page.locator('main').getByText('85%', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect(page.locator('main').getByText('100%', { exact: true })).toBeVisible()
    const targetCount = (await objects.locator('option').count()) - 1
    await expect
      .poll(async () => {
        const saved = await (
          await context.request.get(`/api/v1/personal/canvases/${canvas.id}`)
        ).json()
        return {
          count: saved.scene.elements.length + saved.stickies.length,
          note: saved.stickies.at(-1)?.text,
          x: saved.stickies.at(-1)?.x,
          color: saved.stickies.at(-1)?.color,
          appState: saved.scene.appState,
        }
      })
      .toEqual({
        count: targetCount,
        note: 'Keyboard note',
        x: 70,
        color: '#fbcfe8',
        appState: { retained: 'existing app state' },
      })
    await settleCapture(page)
    await page.screenshot({ path: join(evidenceDir(info), 'keyboard-history.png'), fullPage: true })
    await page.reload()
    await page.getByRole('tab', { name: 'Canvas', exact: true }).click()
    await page
      .getByRole('listitem')
      .filter({ has: page.getByText(canvas.title, { exact: true }) })
      .getByRole('button', { name: 'Open', exact: true })
      .click()
    await expect(objects.locator('option')).toHaveCount(targetCount + 1)
    await expect(
      page.getByRole('textbox', { name: 'Sticky note text', exact: true }).last(),
    ).toHaveValue('Keyboard note')
  } finally {
    await context.close()
  }
})

test('@canvas nested captured drag finishes outside the paper and lost capture cancels cleanly', async ({
  browser,
}, info) => {
  const { context, page, canvas, svg } = await openCanvas(browser)
  try {
    const box = svg.locator('[data-canvas-object="box"] > rect')
    const start = await box.boundingBox()
    await page.evaluate(() => {
      window.addEventListener(
        'pointerdown',
        (event) => {
          document.documentElement.dataset['qaPointer'] = String(event.pointerId)
        },
        { once: true, capture: true },
      )
    })
    await page.mouse.move(start!.x + 10, start!.y + 10)
    await page.mouse.down()
    await page.mouse.move(start!.x + 40, start!.y + 50, { steps: 3 })
    await svg.locator('[data-canvas-object="box"]').evaluate((element) => {
      element.releasePointerCapture(Number(document.documentElement.dataset['qaPointer']))
    })
    await page.mouse.up()
    await expect(box).toHaveAttribute('x', '240')
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
    await page.mouse.move(start!.x + 10, start!.y + 10)
    await page.mouse.down()
    await page.mouse.move(start!.x + 30, start!.y + 30)
    await page.keyboard.press('Escape')
    const captureAfterEscape = await svg
      .locator('[data-canvas-object="box"]')
      .evaluate((element) =>
        element.hasPointerCapture(Number(document.documentElement.dataset['qaPointer'])),
      )
    writeFileSync(
      join(evidenceDir(info), 'escape-capture.json'),
      JSON.stringify({ captureAfterEscape }),
    )
    await page.mouse.up()
    expect(captureAfterEscape).toBe(false)
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
    const surface = page.getByRole('region', { name: 'Drawing canvas', exact: true })
    await surface.scrollIntoViewIfNeeded()
    const bounds = await surface.boundingBox()
    const beforeCount = await svg.locator('g > rect').count()
    await page.mouse.move(bounds!.x + 30, bounds!.y + 300)
    await page.mouse.down()
    await page.mouse.move(bounds!.x + 100, bounds!.y - 20, { steps: 5 })
    await page.mouse.up()
    await expect(svg.locator('g > rect')).toHaveCount(beforeCount + 1)
    const drawn = svg.locator('g > rect').last()
    const height = await drawn.getAttribute('height')
    await page.mouse.move(bounds!.x + 160, bounds!.y + 380, { steps: 4 })
    await expect(drawn).toHaveAttribute('height', height!)
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
    await page.mouse.click(bounds!.x + 180, bounds!.y + 400, { button: 'right' })
    await expect(svg.locator('g > rect')).toHaveCount(beforeCount + 1)
    await page.keyboard.press('Escape')
    await expect
      .poll(async () => {
        const saved = await (
          await context.request.get(`/api/v1/personal/canvases/${canvas.id}`)
        ).json()
        return saved.scene.elements.length
      })
      .toBe(4)
    await page.screenshot({
      path: join(evidenceDir(info), 'pointer-boundaries.png'),
      fullPage: true,
    })
  } finally {
    await context.close()
  }
})

test('@canvas nested localised controls reflow, preserve focus and contrast at 200 percent text', async ({
  browser,
}, info) => {
  test.setTimeout(420_000)
  const { context, page, canvas } = await openCanvas(browser)
  try {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    const observations = []
    for (const locale of ['uz-Latn', 'uz-Cyrl', 'ru', 'en'] as const) {
      expect((await authedPatch(context, '/api/v1/me', { locale })).status()).toBe(200)
      await page.reload()
      await page
        .getByRole('tab', {
          name: visualLabel('personal', locale, 'personal.tabs.canvas'),
          exact: true,
        })
        .click()
      await page
        .getByRole('listitem')
        .filter({ has: page.getByText(canvas.title, { exact: true }) })
        .getByRole('button', {
          name: visualLabel('personal', locale, 'personal.canvas.open'),
          exact: true,
        })
        .click()
      const object = page.getByRole('combobox', {
        name: visualLabel('canvas-controls', locale, 'personal.canvas.controls.object'),
        exact: true,
      })
      await object.selectOption('label')
      for (const theme of ['light', 'dark']) {
        await page.evaluate(
          ({ key, value }) => {
            localStorage.setItem(key, value)
            document.documentElement.dataset['theme'] = value
          },
          { key: THEME_STORAGE_KEY, value: theme },
        )
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 900 })
          for (const scale of [1, 2]) {
            await page.evaluate((factor) => {
              const root = document.documentElement
              for (const [token, px, line] of [
                ['caption', 12, 16],
                ['small', 13, 18],
                ['body', 14, 20],
                ['h1', 30, 36],
                ['h2', 24, 32],
                ['h3', 20, 28],
              ] as const) {
                root.style.setProperty(`--text-${token}`, `${px * factor}px`)
                root.style.setProperty(`--text-${token}--line-height`, `${line * factor}px`)
              }
            }, scale)
            await settleCapture(page)
            const overflow = await page.evaluate(() => ({
              viewport: innerWidth,
              doc: document.documentElement.scrollWidth,
            }))
            if (overflow.doc > overflow.viewport) {
              const selectorDiagnostic = await object.evaluate((select) => {
                const label = select.closest('label')!
                const caption = label.querySelector('span')!
                const range = document.createRange()
                range.selectNodeContents(caption)
                const initial = {
                  doc: document.documentElement.scrollWidth,
                  labelWidth: label.clientWidth,
                  labelScroll: label.scrollWidth,
                  caption: caption.getBoundingClientRect().toJSON(),
                  glyphs: range.getBoundingClientRect().toJSON(),
                  select: select.getBoundingClientRect().toJSON(),
                  font: getComputedStyle(select).font,
                  appearance: getComputedStyle(select).appearance,
                  overflow: getComputedStyle(select).overflowX,
                }
                const style = select.getAttribute('style')
                const labelStyle = label.getAttribute('style')
                ;(select as HTMLElement).style.appearance = 'none'
                const withoutAppearance = {
                  doc: document.documentElement.scrollWidth,
                  labelScroll: label.scrollWidth,
                }
                ;(select as HTMLElement).style.contain = 'inline-size layout'
                const containedSelect = {
                  doc: document.documentElement.scrollWidth,
                  labelScroll: label.scrollWidth,
                }
                if (style === null) select.removeAttribute('style')
                else select.setAttribute('style', style)
                label.style.overflow = 'hidden'
                const clippedLabel = {
                  doc: document.documentElement.scrollWidth,
                  labelScroll: label.scrollWidth,
                }
                if (labelStyle === null) label.removeAttribute('style')
                else label.setAttribute('style', labelStyle)
                return { initial, withoutAppearance, containedSelect, clippedLabel }
              })
              writeFileSync(
                join(evidenceDir(info), 'selector-diagnostic.json'),
                JSON.stringify(selectorDiagnostic, null, 2),
              )
              const offenders = await page.locator('main *').evaluateAll((nodes) =>
                nodes
                  .map((node) => ({
                    tag: node.tagName,
                    text: node.textContent?.slice(0, 80),
                    className: node.getAttribute('class'),
                    rect: node.getBoundingClientRect().toJSON(),
                  }))
                  .filter(
                    (node) => node.rect.right > innerWidth && !node.className?.includes('absolute'),
                  ),
              )
              writeFileSync(
                join(evidenceDir(info), 'overflow-before.json'),
                JSON.stringify({ locale, theme, width, scale, overflow, offenders }, null, 2),
              )
              const documentOffenders = await page.locator('body *').evaluateAll((nodes) =>
                nodes
                  .map((node) => {
                    const style = getComputedStyle(node)
                    return {
                      tag: node.tagName,
                      text: node.textContent?.slice(0, 80),
                      className: node.getAttribute('class'),
                      rect: node.getBoundingClientRect().toJSON(),
                      overflow: style.overflowX,
                      position: style.position,
                      visibility: style.visibility,
                      clientWidth: node.clientWidth,
                      scrollWidth: node.scrollWidth,
                    }
                  })
                  .filter(
                    (node) => node.rect.right > innerWidth || node.scrollWidth > node.clientWidth,
                  ),
              )
              writeFileSync(
                join(evidenceDir(info), 'document-overflow-before.json'),
                JSON.stringify(documentOffenders, null, 2),
              )
              await page.screenshot({
                path: join(evidenceDir(info), 'overflow-before.png'),
                fullPage: true,
              })
            }
            expect(overflow.doc).toBeLessThanOrEqual(overflow.viewport)
            const buttons = await page.locator('main button:not([disabled])').evaluateAll((nodes) =>
              nodes
                .map((node) => {
                  const rect = node.getBoundingClientRect()
                  return {
                    label: node.getAttribute('aria-label') ?? node.textContent,
                    width: rect.width,
                    height: rect.height,
                  }
                })
                .filter((node) => node.width && node.height),
            )
            expect(buttons.filter((button) => button.width < 24 || button.height < 24)).toEqual([])
            const result = await new AxeBuilder({ page })
              .include('main')
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
              .analyze()
            expect(result.violations).toEqual([])
            observations.push({ locale, theme, width, scale, overflow, buttons })
            if (width === 320 || (width === 1440 && scale === 1))
              await page.screenshot({
                path: join(
                  evidenceDir(info),
                  `controls-${locale}-${theme}-${width}-text${scale}.png`,
                ),
                fullPage: true,
              })
          }
        }
      }
    }
    writeFileSync(
      join(evidenceDir(info), 'reflow.json'),
      JSON.stringify({ observations, errors }, null, 2),
    )
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test('@canvas mouse Pan and native object selection preserve the saved scene and undo history', async ({
  browser,
}, info) => {
  const { context, page, canvas } = await openCanvas(browser)
  try {
    const surface = page.getByRole('region', { name: 'Drawing canvas', exact: true })
    const objects = page.getByRole('combobox', { name: 'Selected object', exact: true })
    const undo = page.getByRole('button', { name: 'Undo', exact: true })
    let sceneWrites = 0
    page.on('request', (request) => {
      if (
        request.method() === 'PATCH' &&
        new URL(request.url()).pathname === `/api/v1/personal/canvases/${canvas.id}`
      )
        sceneWrites++
    })
    await objects.focus()
    await objects.press('ArrowDown')
    await expect(objects).toHaveValue('drawing')
    await objects.press('Delete')
    await expect(page.locator('[data-canvas-object="drawing"]')).toHaveCount(1)
    await page.getByRole('button', { name: 'Pan canvas', exact: true }).click()
    await surface.scrollIntoViewIfNeeded()
    await surface.evaluate((element) => {
      element.scrollLeft = 100
      element.scrollTop = 100
    })
    const bounds = await surface.boundingBox()
    await page.mouse.move(bounds!.x + 160, bounds!.y + 300)
    await page.mouse.down()
    await page.mouse.move(bounds!.x + 90, bounds!.y + 250, { steps: 5 })
    await page.mouse.up()
    await expect
      .poll(() =>
        surface.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop })),
      )
      .toEqual({ left: 170, top: 150 })
    await expect(undo).toBeDisabled()
    await page.mouse.move(bounds!.x + 160, bounds!.y + 300)
    await page.mouse.down()
    await page.mouse.move(bounds!.x + 120, bounds!.y + 260)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect
      .poll(() =>
        surface.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop })),
      )
      .toEqual({ left: 170, top: 150 })
    await surface.press('ArrowDown')
    await expect.poll(() => surface.evaluate((element) => element.scrollTop)).toBeGreaterThan(150)
    await expect(undo).toBeDisabled()
    const saved = await (await context.request.get(`/api/v1/personal/canvases/${canvas.id}`)).json()
    expect(saved.version).toBe(canvas.version)
    expect(saved.scene.appState).toEqual({ retained: 'existing app state' })
    expect(sceneWrites).toBe(0)
    await settleCapture(page)
    await page.screenshot({
      path: join(evidenceDir(info), 'mouse-pan-selection.png'),
      fullPage: true,
    })
  } finally {
    await context.close()
  }
})

test('@canvas a native touchscreen can choose Pan and scroll without editing', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'chromium', 'Native touch gesture uses Chromium CDP.')
  const { context, page, canvas } = await openCanvas(browser, true)
  try {
    await page.setViewportSize({ width: 390, height: 844 })
    const pan = page.getByRole('button', { name: 'Pan canvas', exact: true })
    await pan.scrollIntoViewIfNeeded()
    await pan.tap()
    await expect(pan).toHaveAttribute('aria-pressed', 'true')
    const surface = page.getByRole('region', { name: 'Drawing canvas', exact: true })
    await surface.scrollIntoViewIfNeeded()
    const bounds = await surface.boundingBox()
    const client = await context.newCDPSession(page)
    await client.send('Input.synthesizeScrollGesture', {
      x: bounds!.x + 180,
      y: Math.min(bounds!.y + 350, 744),
      yDistance: -120,
      gestureSourceType: 'touch',
      preventFling: true,
    })
    await expect.poll(() => surface.evaluate((element) => element.scrollTop)).toBeGreaterThan(40)
    const selectTool = page.getByRole('button', { name: 'Select', exact: true })
    await selectTool.scrollIntoViewIfNeeded()
    await selectTool.tap()
    await expect(selectTool).toHaveAttribute('aria-pressed', 'true')
    const saved = await (await context.request.get(`/api/v1/personal/canvases/${canvas.id}`)).json()
    expect(saved.version).toBe(canvas.version)
    await client.detach()
  } finally {
    await context.close()
  }
})

test('@canvas native Chromium touch draws and moves a shape without scrolling the paper', async ({
  browser,
}, info) => {
  test.skip(
    info.project.name !== 'chromium',
    'Native touch drag uses Chromium CDP; other engines have actual mouse/keyboard coverage, not synthetic touch claims.',
  )
  const { context, page, canvas, svg } = await openCanvas(browser, true)
  try {
    await page.setViewportSize({ width: 390, height: 844 })
    const rectangle = page.getByRole('button', { name: 'Rectangle', exact: true })
    await rectangle.scrollIntoViewIfNeeded()
    await rectangle.tap()
    const surface = page.getByRole('region', { name: 'Drawing canvas', exact: true })
    await surface.scrollIntoViewIfNeeded()
    const bounds = await surface.boundingBox()
    const client = await context.newCDPSession(page)
    await page.evaluate(() => {
      const events: object[] = []
      for (const type of [
        'pointerdown',
        'pointermove',
        'pointerup',
        'pointercancel',
        'lostpointercapture',
      ])
        document.addEventListener(
          type,
          (event) => {
            const pointer = event as PointerEvent
            events.push({
              type,
              pointerType: pointer.pointerType,
              primary: pointer.isPrimary,
              button: pointer.button,
              x: pointer.clientX,
              y: pointer.clientY,
              target:
                (pointer.target as Element)
                  .closest('[data-canvas-object]')
                  ?.getAttribute('data-canvas-object') ?? (pointer.target as Element).tagName,
            })
            document.documentElement.dataset['qaTouchEvents'] = JSON.stringify(events)
          },
          { capture: true },
        )
    })
    const start = { x: bounds!.x + 20, y: bounds!.y + 220 }
    await client.send('Input.synthesizeScrollGesture', {
      ...start,
      xDistance: 100,
      yDistance: 50,
      gestureSourceType: 'touch',
      preventFling: true,
    })
    await expect(svg.locator('g > rect')).toHaveCount(2)
    const box = svg.locator('g > rect').last()
    await box.scrollIntoViewIfNeeded()
    const before = await box.boundingBox()
    const originalX = Number(await box.getAttribute('x'))
    const originalY = Number(await box.getAttribute('y'))
    await client.send('Input.synthesizeScrollGesture', {
      x: before!.x + 20,
      y: before!.y + 20,
      xDistance: 50,
      yDistance: 40,
      gestureSourceType: 'touch',
      preventFling: true,
    })
    const diagnostic = await page.evaluate(() => ({
      events: JSON.parse(document.documentElement.dataset['qaTouchEvents'] ?? '[]'),
      scrollTop: document.querySelector('[aria-label="Drawing canvas"]')?.scrollTop,
    }))
    writeFileSync(
      join(evidenceDir(info), 'touch-diagnostic.json'),
      JSON.stringify({ before, originalX, diagnostic }, null, 2),
    )
    await page.screenshot({
      path: join(evidenceDir(info), 'native-touch-before.png'),
      fullPage: true,
    })
    const dragEvents = diagnostic.events as { type: string; x: number; y: number }[]
    // The native gesture's measured pointer distance can differ from its nominal requested
    // distance. The object must follow the actual finger position, with no relaxed tolerance.
    const contact = dragEvents.findLastIndex((event) => event.type === 'pointerdown')
    const fingerStart = dragEvents[contact]!
    const fingerEnd = dragEvents.slice(contact).findLast((event) => event.type === 'pointermove')!
    const displacement = { x: fingerEnd.x - fingerStart.x, y: fingerEnd.y - fingerStart.y }
    expect(displacement.x).toBeGreaterThan(40)
    expect(displacement.y).toBeGreaterThan(30)
    expect(Number(await box.getAttribute('x'))).toBeCloseTo(originalX + displacement.x, 0)
    expect(Number(await box.getAttribute('y'))).toBeCloseTo(originalY + displacement.y, 0)
    await expect
      .poll(async () => {
        const saved = await (
          await context.request.get(`/api/v1/personal/canvases/${canvas.id}`)
        ).json()
        return saved.scene.elements.at(-1)?.x
      })
      .toBeCloseTo(originalX + displacement.x, 0)
    expect(
      diagnostic.events.filter((event: { type: string }) => event.type === 'pointercancel'),
    ).toEqual([])
    const panButton = page.getByRole('button', { name: 'Pan canvas', exact: true })
    await panButton.scrollIntoViewIfNeeded()
    await settleCapture(page, false)
    await page.evaluate(() => {
      const events: object[] = []
      for (const type of [
        'pointerdown',
        'pointerup',
        'pointercancel',
        'click',
        'touchstart',
        'touchend',
      ])
        document.addEventListener(type, (event) => {
          const target = event.target as Element
          const button = target.closest('button')
          events.push({
            type,
            target: target.outerHTML.slice(0, 600),
            button: button?.getAttribute('aria-label'),
            buttonBounds: button?.getBoundingClientRect().toJSON(),
            defaultPrevented: event.defaultPrevented,
            active: document.activeElement?.outerHTML.slice(0, 160),
          })
          document.documentElement.dataset['qaPanClicks'] = JSON.stringify(events)
        })
    })
    const panHitBefore = await panButton.evaluate((button) => {
      const bounds = button.getBoundingClientRect()
      const hit = document.elementFromPoint(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      )
      return {
        bounds: bounds.toJSON(),
        hit: hit?.outerHTML,
        viewport: {
          top: visualViewport?.offsetTop,
          left: visualViewport?.offsetLeft,
          scale: visualViewport?.scale,
        },
        scrollY,
        disabled: (button as HTMLButtonElement).disabled,
      }
    })
    await panButton.tap()
    const panHitAfter = await page.evaluate(() => ({
      events: JSON.parse(document.documentElement.dataset['qaTouchEvents'] ?? '[]'),
      clicks: JSON.parse(document.documentElement.dataset['qaPanClicks'] ?? '[]'),
      pressed: document.querySelector('[aria-label="Pan canvas"]')?.getAttribute('aria-pressed'),
    }))
    writeFileSync(
      join(evidenceDir(info), 'pan-hit-target.json'),
      JSON.stringify({ panHitBefore, panHitAfter }, null, 2),
    )
    await expect(panButton).toHaveAttribute('aria-pressed', 'true')
    await surface.scrollIntoViewIfNeeded()
    const panBounds = await surface.boundingBox()
    const panStart = { x: panBounds!.x + 220, y: Math.min(panBounds!.y + 350, 744) }
    // The installed CDP protocol generates a continuous native touch scroll; a single raw move
    // only crossed Chrome's gesture threshold and was not a complete scroll gesture.
    await client.send('Input.synthesizeScrollGesture', {
      ...panStart,
      yDistance: -120,
      gestureSourceType: 'touch',
      preventFling: true,
    })
    const pan = await page.evaluate(() => ({
      events: JSON.parse(document.documentElement.dataset['qaTouchEvents'] ?? '[]'),
      scrollTop: document.querySelector('[aria-label="Drawing canvas"]')?.scrollTop,
      panPressed: document.querySelector('[aria-label="Pan canvas"]')?.getAttribute('aria-pressed'),
      cursor: getComputedStyle(document.querySelector('svg[width="2400"]')!).cursor,
      touchAction: getComputedStyle(document.querySelector('svg[width="2400"]')!).touchAction,
    }))
    writeFileSync(
      join(evidenceDir(info), 'native-pan.json'),
      JSON.stringify({ panStart, panBounds, pan }, null, 2),
    )
    await expect.poll(() => surface.evaluate((element) => element.scrollTop)).toBeGreaterThan(40)
    await surface.evaluate((element) => {
      element.scrollTop = 0
    })
    await page.getByRole('button', { name: 'Select', exact: true }).tap()
    await settleCapture(page)
    await page.screenshot({ path: join(evidenceDir(info), 'native-touch-390.png'), fullPage: true })
    await client.detach()
  } finally {
    await context.close()
  }
})
