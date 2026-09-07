#!/usr/bin/env node
// Round-2 design-lead verification: the interaction states the route script cannot reach
// (card-detail sheet, board drag preview, people hover card, pomodoro log, toasts at 390,
// theme transition, table selection/bulk bar, reduced motion). Drives a running `pnpm start --demo`.
//
//   node e2e/scripts/ui-round2-interactions.mjs --out <dir>
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const args = process.argv.slice(2)
const argOf = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i === -1 ? d : (args[i + 1] ?? d)
}
const BASE = argOf('base', 'http://127.0.0.1:5173').replace(/\/$/, '')
const OUT = argOf('out', 'agentic/ledger/ui-blitz/latest/round2/interactions')
const LOGIN = argOf('login', 'demo.boshliq')
const PASSWORD = argOf('password', 'Ishonchli#2026')

const log = []
const note = (m) => {
  console.log(`[round2] ${m}`)
  log.push(m)
}

async function signIn(context) {
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="identifier"]', LOGIN)
  await page.fill('input[name="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE}/`, { timeout: 20_000 })
  return page
}

async function shot(page, name, opts = {}) {
  await page.screenshot({ path: join(OUT, `${name}.png`), ...opts })
  note(`shot ${name}`)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()

  // ---- desktop, light ----
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })
  await ctx.addInitScript(() => {
    try {
      window.localStorage.setItem('devon_theme', 'light')
    } catch {}
  })
  const page = await signIn(ctx)

  // 1. card detail sheet over the board
  try {
    await page.goto(`${BASE}/work`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const card = page.locator('[data-testid="card-tile"], article, [role="button"]').filter({ hasText: 'Oylik hisobotni tayyorlash' }).first()
    await card.click({ timeout: 8000 })
    await page.waitForTimeout(900)
    await shot(page, 'card-detail__1440__light')
    const overlay = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('div,section,aside'))
      const found = els
        .map((el) => ({ el, cs: getComputedStyle(el), r: el.getBoundingClientRect() }))
        .filter((x) => x.cs.position === 'fixed' && x.r.height > 400 && x.r.width > 300)
        .map((x) => ({
          tag: x.el.tagName,
          cls: String(x.el.className).slice(0, 120),
          rect: [Math.round(x.r.x), Math.round(x.r.y), Math.round(x.r.width), Math.round(x.r.height)],
          bg: x.cs.backgroundColor,
          z: x.cs.zIndex,
        }))
      return { found, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }
    })
    note(`card-detail fixed layers: ${JSON.stringify(overlay)}`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  } catch (e) {
    note(`card-detail FAILED: ${String(e).slice(0, 200)}`)
  }

  // 2. board drag: is a pointer adapter wired? probe the dnd attributes + try a pointer drag
  try {
    await page.goto(`${BASE}/work`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const probe = await page.evaluate(() => {
      const draggables = Array.from(document.querySelectorAll('[draggable="true"]')).length
      const anyCard = document.querySelector('[draggable="true"]')
      return {
        draggableCount: draggables,
        touchAction: anyCard ? getComputedStyle(anyCard).touchAction : null,
        userSelect: anyCard ? getComputedStyle(anyCard).userSelect : null,
      }
    })
    note(`drag probe: ${JSON.stringify(probe)}`)
    const src = page.locator('[draggable="true"]').first()
    const box = await src.boundingBox()
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + 20)
      await page.mouse.down()
      await page.mouse.move(box.x + 320, box.y + 120, { steps: 12 })
      await page.waitForTimeout(400)
      await shot(page, 'board-drag__1440__light')
      const mid = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('body > *'))
        return nodes.map((n) => ({ tag: n.tagName, cls: String(n.className).slice(0, 80) }))
      })
      note(`drag body children: ${JSON.stringify(mid).slice(0, 600)}`)
      await page.mouse.up()
      await page.waitForTimeout(600)
    }
  } catch (e) {
    note(`drag FAILED: ${String(e).slice(0, 200)}`)
  }

  // 3. people hover card
  try {
    await page.goto(`${BASE}/people`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const person = page.locator('text=Xolmatov Bahodir Yusufovich').first()
    await person.hover()
    await page.waitForTimeout(1200)
    await shot(page, 'people-hovercard__1440__light')
    const hc = await page.evaluate(() => document.querySelectorAll('[data-radix-popper-content-wrapper]').length)
    note(`people hovercard popper count: ${hc}`)
  } catch (e) {
    note(`hovercard FAILED: ${String(e).slice(0, 200)}`)
  }

  // 4. pomodoro log
  try {
    await page.goto(`${BASE}/personal`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    const tab = page.getByRole('tab', { name: /Pomodoro/i }).first()
    await tab.click({ timeout: 8000 })
    await page.waitForTimeout(1200)
    await shot(page, 'personal-pomodoro__1440__light', { fullPage: true })
  } catch (e) {
    note(`pomodoro FAILED: ${String(e).slice(0, 200)}`)
  }

  // 5. table selection / bulk bar
  try {
    await page.goto(`${BASE}/work/table`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const boxes = page.locator('table input[type="checkbox"], table [role="checkbox"]')
    const n = await boxes.count()
    note(`table checkbox count: ${n}`)
    if (n > 2) {
      await boxes.nth(1).click()
      await boxes.nth(2).click()
      await page.waitForTimeout(700)
      await shot(page, 'table-selection__1440__light')
    }
    const sticky = await page.evaluate(() => {
      const th = document.querySelector('table thead')
      return th ? { position: getComputedStyle(th).position, top: getComputedStyle(th).top } : null
    })
    note(`table thead sticky: ${JSON.stringify(sticky)}`)
  } catch (e) {
    note(`table selection FAILED: ${String(e).slice(0, 200)}`)
  }

  // 6. theme transition mid-frame
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(900)
    const themeBtn = page.locator('header button, [role="banner"] button').filter({ has: page.locator('svg') })
    const vt = await page.evaluate(() => typeof document.startViewTransition === 'function')
    note(`startViewTransition available: ${vt}`)
    const toggle = page.getByRole('button', { name: /mavzu|тема|theme|Yorug|Tund/i }).first()
    await toggle.click({ timeout: 8000 })
    await page.waitForTimeout(120)
    await shot(page, 'theme-mid__1440')
    await page.waitForTimeout(1200)
    await shot(page, 'theme-after__1440')
  } catch (e) {
    note(`theme FAILED: ${String(e).slice(0, 200)}`)
  }

  await ctx.close()

  // ---- 390: toast over the bottom tab bar ----
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light', hasTouch: true, isMobile: true })
  await m.addInitScript(() => {
    try {
      window.localStorage.setItem('devon_theme', 'light')
    } catch {}
  })
  try {
    const mp = await signIn(m)
    await mp.goto(`${BASE}/personal`, { waitUntil: 'networkidle' })
    await mp.waitForTimeout(1200)
    const cb = mp.locator('button[role="checkbox"], input[type="checkbox"]').first()
    await cb.click({ timeout: 8000 })
    await mp.waitForTimeout(700)
    await shot(mp, 'toast-mobile__390__light')
    const geom = await mp.evaluate(() => {
      const toast = document.querySelector('[data-sonner-toaster]')
      const bar = document.querySelector('nav[class*="fixed"], [data-testid="bottom-tab-bar"]')
      const g = (el) => (el ? (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }))(el.getBoundingClientRect()) : null)
      return { toast: g(toast), toastStyle: toast ? { bottom: getComputedStyle(toast).bottom, offset: toast.style.cssText.slice(0, 200) } : null, bar: g(bar) }
    })
    note(`mobile toast geometry: ${JSON.stringify(geom)}`)
    // celebration check: does the row survive long enough to animate?
    await mp.waitForTimeout(1500)
    await shot(mp, 'toast-mobile-after__390__light')
  } catch (e) {
    note(`mobile toast FAILED: ${String(e).slice(0, 200)}`)
  }
  await m.close()

  // ---- reduced motion ----
  const r = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', reducedMotion: 'reduce' })
  try {
    const rp = await signIn(r)
    await rp.goto(`${BASE}/work`, { waitUntil: 'networkidle' })
    await rp.waitForTimeout(1200)
    await shot(rp, 'reduced__work__1440__light')
  } catch (e) {
    note(`reduced FAILED: ${String(e).slice(0, 200)}`)
  }
  await r.close()

  await browser.close()
  console.log('\n===== NOTES =====')
  for (const l of log) console.log(l)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
