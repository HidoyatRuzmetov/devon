// SPEC §11: "a unit test that fails when an emitted event name has no registry entry or a registry
// entry names an event nothing emits".
//
// This is the test that makes the notification pipeline impossible to break silently again. Before
// v1.1 the registry was keyed on twelve invented names, nine of which nothing emitted, and three of
// the twenty-six emitted names were covered -- and nothing anywhere noticed, because a lookup miss is
// a `return`, not an error. So the mapping is now checked against the source itself: every
// `tx.emit({ type: '...' })` in `apps/api/src` is enumerated statically and the two name sets must be
// equal, in both directions.
//
// Static scanning rather than importing the modules: an emit site is a literal in a repo file and can
// be read without booting Fastify, opening a pool or having Docker running (this is a `fast`-profile
// unit test). The scan is deliberately narrow -- `.emit(` followed by the first `type: '<literal>'` --
// which also means a *computed* event type would be invisible to it; that is a constraint the
// convention already imposes (`packages/db/src/events.ts`: "the module that emits an event owns its
// name", written out in full at the call site).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  NOTIFICATION_REGISTRY,
  REGISTERED_EVENT_NAMES,
  blankFacts,
  specFor,
  type EventFacts,
  type NotificationSpec,
  type RecipientRule,
} from '../../src/modules/notifications/registry.js'
import { REASONS } from '../../src/modules/notifications/schemas.js'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')

function everyTsFile(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) everyTsFile(full, out)
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

/** Every `<something>.emit({ type: '<name>', ... })` in the API source, as a set of names. */
function emittedEventNames(): { names: Set<string>; sites: Map<string, string[]> } {
  const names = new Set<string>()
  const sites = new Map<string, string[]>()
  for (const file of everyTsFile(SRC)) {
    const source = readFileSync(file, 'utf8')
    let index = source.indexOf('.emit(')
    while (index !== -1) {
      const window = source.slice(index, index + 400)
      const match = /type:\s*'([^']+)'/.exec(window)
      if (match) {
        const name = match[1]!
        names.add(name)
        sites.set(name, [...(sites.get(name) ?? []), file])
      }
      index = source.indexOf('.emit(', index + 1)
    }
  }
  return { names, sites }
}

const LOCALES = ['uz-Latn', 'uz-Cyrl', 'ru', 'en'] as const

const VALID_RULES: readonly RecipientRule[] = [
  'assignee',
  'giver',
  'creator',
  'watchers',
  'mentioned',
  'organizer',
  'rsvped',
  'carpool_driver',
  'project_members',
  'target_user',
  'head',
  'department',
  'super_admins',
]

/** A fully-populated fact bag -- the second input every builder is exercised with, so a builder that
 * only survives blanks (or only survives a happy path) is caught. */
function fullFacts(eventType: string): EventFacts {
  return {
    ...blankFacts(eventType),
    departmentId: '00000000-0000-0000-0000-0000000000d1',
    subjectId: '00000000-0000-0000-0000-0000000000a1',
    subjectTitle: 'Hafta yakuni boʻyicha taqdimot',
    actorUserId: '00000000-0000-0000-0000-0000000000u1',
    actorName: 'Anvar Aliyev',
    departmentName: 'Raqamli xizmatlar boshqarmasi',
    at: new Date('2026-09-20T09:00:00.000Z'),
    extra: {
      status: 'pending_approval',
      decision: 'approved',
      role: 'boshliq',
      seats: 3,
      place: 'Katta zal',
      question: 'Qaysi kun qulay?',
      reason: 'Yomgʻir kutilmoqda',
      changes: 'status,assignee,dueAt',
      excerpt: 'Yaxshi, boshlayapman.',
    },
  }
}

describe('the notification registry matches the events the API actually emits', () => {
  const { names: emitted, sites } = emittedEventNames()

  it('finds the emit sites at all (guards the scanner itself against a silent zero-match)', () => {
    // If this ever drops to zero the two assertions below would both pass vacuously, so the scanner
    // gets its own positive control -- the same reason `concurrency-races.test.ts` carries two.
    expect(emitted.size).toBeGreaterThan(20)
    expect(emitted.has('work.card.created')).toBe(true)
    expect(sites.get('work.card.created')?.[0]).toMatch(/work[\\/]repo\.ts$/)
  })

  it('has an entry for every emitted event name', () => {
    const missing = [...emitted].filter((name) => !(name in NOTIFICATION_REGISTRY)).sort()
    expect(
      missing,
      `these events are emitted but have no NOTIFICATION_REGISTRY entry -- add one (with notify:false and a reason, if it is deliberately silent): ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('has no entry naming an event nothing emits', () => {
    const orphans = REGISTERED_EVENT_NAMES.filter((name) => !emitted.has(name)).sort()
    expect(
      orphans,
      `these NOTIFICATION_REGISTRY entries name events no module emits -- delete them or emit them: ${orphans.join(', ')}`,
    ).toEqual([])
  })
})

describe('every registry entry is well formed', () => {
  const entries = Object.entries(NOTIFICATION_REGISTRY)

  it('a silent entry explains itself', () => {
    for (const [name, entry] of entries) {
      if (entry.notify === false) {
        expect(entry.why.length, `${name} is silent without a reason`).toBeGreaterThan(20)
      }
    }
  })

  it('a notifying entry names a real reason and real recipient rules', () => {
    for (const [name] of entries) {
      const spec = specFor(name)
      if (!spec) continue
      expect(REASONS as readonly string[], `${name}`).toContain(spec.reason)
      expect(spec.recipients.length, `${name} notifies nobody`).toBeGreaterThan(0)
      for (const rule of spec.recipients) {
        expect(VALID_RULES, `${name} names an unknown recipient rule`).toContain(rule)
      }
    }
  })

  it('builds a complete four-locale title and body for both a blank and a full fact bag', () => {
    for (const [name] of entries) {
      const spec = specFor(name)
      if (!spec) continue
      for (const facts of [blankFacts(name), fullFacts(name)]) {
        const title = spec.title(facts)
        for (const locale of LOCALES) {
          expect(typeof title[locale], `${name} title.${locale}`).toBe('string')
          expect(title[locale].trim().length, `${name} title.${locale} is empty`).toBeGreaterThan(0)
        }
        const body = spec.body(facts)
        if (body !== null) {
          for (const locale of LOCALES) {
            expect(body[locale].trim().length, `${name} body.${locale} is empty`).toBeGreaterThan(0)
          }
        }
      }
    }
  })

  it('never writes an ASCII apostrophe into user-facing copy (DESIGN.md §2.3)', () => {
    for (const [name] of entries) {
      const spec = specFor(name)
      if (!spec) continue
      // The blank bag only: the full bag deliberately injects user data (names, titles), which this
      // rule does not govern -- it governs the copy this file authors.
      const facts = blankFacts(name)
      const text = [spec.title(facts), spec.body(facts)]
        .filter((t): t is NonNullable<typeof t> => t !== null)
        .flatMap((t) => LOCALES.map((l) => t[l]))
        .join(' ')
      expect(text, `${name} uses an ASCII apostrophe -- use ʻ (U+02BB) / ʼ (U+02BC)`).not.toMatch(
        /[a-zA-Z]'[a-zA-Z]/,
      )
    }
  })

  it('deep links are app-relative routes the SPA can actually open', () => {
    for (const [name] of entries) {
      const spec = specFor(name)
      if (!spec) continue
      for (const facts of [blankFacts(name), fullFacts(name)]) {
        const link = spec.deepLink(facts)
        if (link === null) continue
        expect(link.startsWith('/'), `${name} deep link "${link}" is not app-relative`).toBe(true)
        expect(link, `${name} deep link leaks an undefined id`).not.toMatch(/undefined|null/)
      }
    }
  })
})

describe('recipient fan-out', () => {
  it('the actor is never notified about their own action', async () => {
    const { recipientsFor } = await import('../../src/modules/notifications/events.js')
    const spec = specFor('work.card.updated') as NotificationSpec
    const facts = fullFacts('work.card.updated')
    const recipients = recipientsFor(spec, {
      facts,
      byRule: {
        assignee: [facts.actorUserId!],
        giver: ['u-giver'],
        watchers: ['u-giver', 'u-watcher'],
      },
    })
    expect(recipients.sort()).toEqual(['u-giver', 'u-watcher'])
  })

  it('a rule with nobody behind it contributes nobody, and never a blank id', async () => {
    const { recipientsFor } = await import('../../src/modules/notifications/events.js')
    const spec = specFor('work.card.created') as NotificationSpec
    const recipients = recipientsFor(spec, {
      facts: blankFacts('work.card.created'),
      byRule: { assignee: [] },
    })
    expect(recipients).toEqual([])
  })
})
