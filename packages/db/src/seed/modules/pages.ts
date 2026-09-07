// Demo seed for pages + onboarding-lite (MODULE-GUIDE.md "Seeds", TECH-SPEC §3.5): six department
// pages (a "how we work" page, two briefs, three notes) and one enabled onboarding template. Runs
// after `core.ts` (order 0, users/department/memberships) -- `created_by_user_id`/`updated_by_user_id`
// reference `DEMO_USERS`' ids, and this module's own `app.pages`/`app.onboarding_templates` carry no
// owner column (RLS only checks `department_id`, per `0700_analytics_pages.sql`), so -- unlike
// `personal.ts`'s owner-only tables -- this module never needs to re-point the transaction-local
// `app.user_id` GUC; `demo.ts`'s outer `demoContext()` already sets `app.department_id` to
// `DEMO_DEPARTMENT.id` for the whole seed transaction.
import { sql } from 'drizzle-orm'
import { DEMO_DEPARTMENT, DEMO_USERS } from '../fixtures.js'
import { demoId } from '../ids.js'
import type { SeedModuleContext } from '../module-loader.js'

export const order = 600

// A minimal, self-contained mirror of `apps/api/src/modules/pages/schemas.ts`'s `TiptapNode` -- that
// file lives in a different package (`@devon/api` depends on `@devon/db`, never the other way around),
// so this seed builds its own small Tiptap `JSONContent` doc directly rather than importing across
// that boundary, the same way `work-fixtures.ts` never imports anything from `apps/api`.
type TiptapNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
}

const HEAD = DEMO_USERS.find((u) => u.role === 'head')!
const MEMBER = DEMO_USERS.find((u) => u.role === 'member')!
const DEPT = DEMO_DEPARTMENT.id

function doc(...content: TiptapNode[]): TiptapNode {
  return { type: 'doc', content }
}
function heading(level: number, text: string): TiptapNode {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] }
}
function paragraph(text: string): TiptapNode {
  return { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }
}
function bulletList(...items: string[]): TiptapNode {
  return {
    type: 'bulletList',
    content: items.map((text) => ({
      type: 'listItem',
      content: [paragraph(text)],
    })),
  }
}
function taskList(...items: { text: string; checked: boolean }[]): TiptapNode {
  return {
    type: 'taskList',
    content: items.map((item) => ({
      type: 'taskItem',
      attrs: { checked: item.checked },
      content: [paragraph(item.text)],
    })),
  }
}
function callout(text: string): TiptapNode {
  return { type: 'callout', attrs: { variant: 'info' }, content: [paragraph(text)] }
}

type PageFixture = {
  key: string
  kind: 'how_we_work' | 'onboarding' | 'brief' | 'note'
  title: string
  authorUserId: string
  blocks: TiptapNode
}

const PAGE_FIXTURES: readonly PageFixture[] = [
  {
    key: 'how-we-work',
    kind: 'how_we_work',
    title: 'Biz qanday ishlaymiz',
    authorUserId: HEAD.id,
    blocks: doc(
      heading(1, 'Biz qanday ishlaymiz'),
      paragraph(
        "Bo'limimiz har hafta dushanba kuni rejalashtirish, juma kuni esa yakunlar bilan ishlaydi. Har bir topshiriq beruvchi va bajaruvchiga ega bo'lishi shart.",
      ),
      heading(2, 'Kunlik tartib'),
      bulletList(
        'Ertalab 09:00 - shaxsiy vazifalarni koʻrib chiqish',
        'Kun davomida - boshqaruv taxtasi orqali muvofiqlashtirish',
        'Kechqurun 18:00 - kunlik xulosa',
      ),
      heading(2, "Muddatlar bo'yicha qoida"),
      callout("Muddati o'tgan topshiriqlar har juma kuni bo'lim yig'ilishida ko'rib chiqiladi."),
    ),
  },
  {
    key: 'brief-analytics',
    kind: 'brief',
    title: 'Tahlil boʻyicha qisqacha maʼlumot',
    authorUserId: MEMBER.id,
    blocks: doc(
      heading(1, 'Tahlil boʻyicha qisqacha maʼlumot'),
      paragraph(
        "Analitika sahifasi orqali har bir xodim o'z ishini, bo'lim esa umumiy yukni kuzatib boradi.",
      ),
      bulletList(
        'Haftalik bajarilgan vazifalar soni',
        "O'z vaqtida bajarilish darajasi",
        "Har bir xodim va bo'lim boʻyicha yuklama",
      ),
    ),
  },
  {
    key: 'brief-onboarding-plan',
    kind: 'brief',
    title: 'Yangi xodimlarni moslashtirish rejasi',
    authorUserId: HEAD.id,
    blocks: doc(
      heading(1, 'Yangi xodimlarni moslashtirish rejasi'),
      paragraph(
        "Har bir yangi xodim uchun birinchi hafta davomida moslashuv roʻyxati avtomatik ravishda uning shaxsiy vazifalariga qo'shiladi.",
      ),
      taskList(
        { text: 'Ish oʻrnini tayyorlash', checked: true },
        { text: "Bo'lim bilan tanishtirish", checked: false },
      ),
    ),
  },
  {
    key: 'note-meeting-2026-09-01',
    kind: 'note',
    title: "01.09.2026 - Bo'lim yig'ilishi",
    authorUserId: HEAD.id,
    blocks: doc(
      heading(2, 'Muhokama qilingan mavzular'),
      bulletList('Uchinchi chorak rejalari', 'Yangi loyihalar taqsimoti'),
    ),
  },
  {
    key: 'note-holidays',
    kind: 'note',
    title: '2026-yil bayram kunlari',
    authorUserId: MEMBER.id,
    blocks: doc(
      paragraph('1-sentabr - Mustaqillik kuni'),
      paragraph('1-oktabr - Oʻqituvchilar va murabbiylar kuni'),
    ),
  },
  {
    key: 'note-tools',
    kind: 'note',
    title: 'Foydali havolalar',
    authorUserId: MEMBER.id,
    blocks: doc(bulletList('Ichki hujjatlar arxivi', "Bo'lim taqvimi", 'IT yordam xizmati')),
  },
]

const ONBOARDING_ITEMS = [
  { key: 'welcome', text: "Bo'lim rahbari bilan tanishuv suhbati", ownerRole: 'newcomer' as const },
  {
    key: 'accounts',
    text: 'Ish hisoblarini faollashtirish (pochta, tizimlar)',
    ownerRole: 'newcomer' as const,
  },
  {
    key: 'buddy-meet',
    text: 'Yordamchi hamkasb (buddy) bilan uchrashuv',
    ownerRole: 'newcomer' as const,
  },
  {
    key: 'read-how-we-work',
    text: '"Biz qanday ishlaymiz" sahifasini o\'qib chiqish',
    ownerRole: 'newcomer' as const,
  },
  {
    key: 'first-task',
    text: 'Birinchi kichik topshiriqni bajarish',
    ownerRole: 'newcomer' as const,
  },
  {
    key: 'head-checkin',
    text: 'Yangi xodim bilan birinchi hafta yakunida suhbat',
    ownerRole: 'head' as const,
  },
  {
    key: 'buddy-checkin',
    text: 'Yangi xodimga birinchi ikki hafta davomida yordam berish',
    ownerRole: 'buddy' as const,
  },
]

export async function seed(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  let rows = 0

  for (let i = 0; i < PAGE_FIXTURES.length; i += 1) {
    const fixture = PAGE_FIXTURES[i]!
    const pageId = demoId(`pages.page.${fixture.key}`)
    const inserted = await tx.raw<{ id: string }>(sql`
      insert into app.pages
        (id, department_id, kind, title, blocks, created_by_user_id, updated_by_user_id)
      values (
        ${pageId}, ${DEPT}, ${fixture.kind}, ${fixture.title}, ${JSON.stringify(fixture.blocks)}::jsonb,
        ${fixture.authorUserId}, ${fixture.authorUserId}
      )
      on conflict (id) do nothing
      returning id
    `)
    if (inserted.length > 0) {
      rows += 1
      const versionInserted = await tx.raw<{ id: string }>(sql`
        insert into app.page_versions (id, department_id, page_id, title, blocks, author_user_id)
        values (
          ${demoId(`pages.page-version.${fixture.key}.1`)}, ${DEPT}, ${pageId}, ${fixture.title},
          ${JSON.stringify(fixture.blocks)}::jsonb, ${fixture.authorUserId}
        )
        on conflict (id) do nothing
        returning id
      `)
      rows += versionInserted.length
    }
  }

  const templateId = demoId('pages.onboarding-template.default')
  const items = ONBOARDING_ITEMS.map((item, sort) => ({
    id: demoId(`pages.onboarding-item.${item.key}`),
    text: item.text,
    ownerRole: item.ownerRole,
    sort,
  }))
  const templateInserted = await tx.raw<{ id: string }>(sql`
    insert into app.onboarding_templates (id, department_id, name, enabled, items, created_by_user_id)
    values (
      ${templateId}, ${DEPT}, ${'Yangi xodimni moslashtirish'}, true, ${JSON.stringify(items)}::jsonb, ${HEAD.id}
    )
    on conflict (id) do nothing
    returning id
  `)
  rows += templateInserted.length

  return rows
}
