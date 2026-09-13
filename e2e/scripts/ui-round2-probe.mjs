#!/usr/bin/env node
// Round-2 targeted probes: table sticky header + bulk bar, label-chip contrast, hover card,
// board column overflow at 1440, gantt today-label collision, admin nav for a super admin.
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
const PASSWORD = argOf('password', 'Ishonchli#2026')

const out = []
const note = (m) => {
  console.log(`[probe] ${m}`)
  out.push(m)
}

async function signIn(context, login) {
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="identifier"]', login)
  await page.fill('input[name="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE}/`, { timeout: 20_000 })
  return page
}

// relative luminance contrast
function contrast(rgb1, rgb2) {
  const lum = (c) => {
    const [r, g, b] = c.map((v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const a = lum(rgb1)
  const b = lum(rgb2)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
const parse = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number)

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
  })
  await ctx.addInitScript(() => {
    try {
      window.localStorage.setItem('devon_theme', 'light')
    } catch {}
  })
  const page = await signIn(ctx, 'demo.boshliq')

  // --- table: sticky header under the top bar + bulk bar ---
  await page.goto(`${BASE}/work/table`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1400)
  const cbs = page.locator('button[role="checkbox"]')
  note(`table role=checkbox count: ${await cbs.count()}`)
  await page.mouse.wheel(0, 900)
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(OUT, 'table-scrolled__1440__light.png') })
  const stick = await page.evaluate(() => {
    const h = document.querySelector('.sticky')
    if (!h) return null
    const r = h.getBoundingClientRect()
    const topbar = document.querySelector('header')
    const tb = topbar ? topbar.getBoundingClientRect() : null
    return {
      header: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      topbar: tb ? [Math.round(tb.y), Math.round(tb.height)] : null,
      cs: getComputedStyle(h).top,
    }
  })
  note(`table sticky header after scroll: ${JSON.stringify(stick)}`)
  if ((await cbs.count()) > 2) {
    await cbs.nth(1).click()
    await cbs.nth(2).click()
    await page.waitForTimeout(700)
    await page.screenshot({ path: join(OUT, 'table-bulkbar__1440__light.png') })
    note('shot table-bulkbar')
  }

  // --- label chip contrast in card detail ---
  await page.goto(`${BASE}/work`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page
    .locator('[data-dnd-card]')
    .filter({ hasText: 'Oylik hisobotni tayyorlash' })
    .first()
    .click()
  await page.waitForTimeout(900)
  const chips = await page.evaluate(() => {
    const res = []
    document.querySelectorAll('button,span,div').forEach((el) => {
      const txt = (el.textContent || '').trim()
      if (!['Hisobot', 'IT', 'Muhim', 'Tashqi', 'Tezkor'].includes(txt)) return
      if (el.children.length) return
      const cs = getComputedStyle(el)
      res.push({
        txt,
        color: cs.color,
        bg: cs.backgroundColor,
        parentBg: getComputedStyle(el.parentElement).backgroundColor,
      })
    })
    return res
  })
  for (const c of chips) {
    let bg = parse(c.bg)
    if (!bg.length || c.bg.includes('rgba(0, 0, 0, 0)')) bg = parse(c.parentBg)
    const ratio = bg.length === 3 ? contrast(parse(c.color), bg).toFixed(2) : 'n/a'
    note(`label chip "${c.txt}" color=${c.color} bg=${c.bg} contrast=${ratio}`)
  }
  await page.screenshot({
    path: join(OUT, 'card-detail-labels__1440__light.png'),
    clip: { x: 1150, y: 620, width: 290, height: 130 },
  })
  await page.keyboard.press('Escape')

  // --- board: 4th/5th column clipping at 1440 ---
  await page.goto(`${BASE}/work`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const board = await page.evaluate(() => {
    const cols = Array.from(document.querySelectorAll('[data-dnd-column]'))
    const scroller = cols[0]?.parentElement
    const s = scroller
      ? {
          scrollWidth: scroller.scrollWidth,
          clientWidth: scroller.clientWidth,
          overflowX: getComputedStyle(scroller).overflowX,
        }
      : null
    return {
      columns: cols.length,
      scroller: s,
      rects: cols.map((c) => Math.round(c.getBoundingClientRect().right)),
    }
  })
  note(`board columns: ${JSON.stringify(board)}`)

  // --- people hover card ---
  await page.goto(`${BASE}/people`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1400)
  const cards = page.locator('a,button,article,li,div').filter({ hasText: 'Tahlilchi' })
  const target = page.getByText('Xolmatov Bahodir Yusufovich', { exact: false }).last()
  try {
    await target.hover({ timeout: 8000 })
    await page.waitForTimeout(1400)
    await page.screenshot({ path: join(OUT, 'people-hovercard__1440__light.png') })
    const hc = await page.evaluate(() => {
      const p = document.querySelectorAll('[data-radix-popper-content-wrapper]')
      return { poppers: p.length, text: p[0] ? p[0].textContent.slice(0, 200) : null }
    })
    note(`people hovercard: ${JSON.stringify(hc)}`)
  } catch (e) {
    note(`people hover failed: ${String(e).slice(0, 120)}`)
  }

  // --- gantt today label ---
  await page.goto(`${BASE}/work/timeline`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1400)
  const gantt = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*')).filter(
      (e) => e.children.length === 0 && (e.textContent || '').trim() === 'Bugun',
    )
    return els.map((e) => {
      const r = e.getBoundingClientRect()
      return {
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        cls: String(e.className).slice(0, 90),
      }
    })
  })
  note(`gantt "Bugun" labels: ${JSON.stringify(gantt)}`)
  await page.screenshot({
    path: join(OUT, 'gantt-today__1440__light.png'),
    clip: { x: 290, y: 400, width: 700, height: 120 },
  })

  // --- inbox reason chip geometry ---
  await page.goto(`${BASE}/inbox`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1400)
  await page.screenshot({
    path: join(OUT, 'inbox-reason-chip__1440__light.png'),
    clip: { x: 290, y: 215, width: 460, height: 180 },
  })
  const chip = await page.evaluate(() => {
    const heads = Array.from(document.querySelectorAll('*')).filter(
      (e) => (e.textContent || '').trim() === 'Qaror' && e.children.length <= 1,
    )
    return heads.slice(0, 4).map((e) => {
      const r = e.getBoundingClientRect()
      const svg = e.querySelector('svg') || e.parentElement?.querySelector('svg')
      const sr = svg ? svg.getBoundingClientRect() : null
      return {
        cls: String(e.className).slice(0, 120),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        svg: sr
          ? [Math.round(sr.x), Math.round(sr.y), Math.round(sr.width), Math.round(sr.height)]
          : null,
      }
    })
  })
  note(`inbox reason chips: ${JSON.stringify(chip)}`)

  await ctx.close()

  // --- super admin nav ---
  const sctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
  })
  const sp = await signIn(sctx, 'admin.super')
  await sp.goto(`${BASE}/work`, { waitUntil: 'networkidle' })
  await sp.waitForTimeout(1200)
  await sp.screenshot({ path: join(OUT, 'superadmin-on-work__1440__light.png') })
  note(`super admin at /work title: ${await sp.title()}`)
  const body = await sp.evaluate(() => document.body.innerText.slice(0, 400))
  note(`super admin /work body: ${JSON.stringify(body)}`)
  await sctx.close()

  await browser.close()
  console.log('\n===== NOTES =====')
  out.forEach((l) => console.log(l))
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
