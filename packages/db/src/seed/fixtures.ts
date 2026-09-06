// The demo dataset itself. Deliberately small: `ac.md` puts "the full §14 demo dataset (40 users, 250
// cards, events, AI traces)" out of scope for this item -- EPIC-000 ships the seed *framework*, its
// idempotence and the demo chip; realistic volume arrives with the epics that own those objects. One
// department, one head, one member is enough to prove the mechanism (deterministic ids, ON CONFLICT DO
// NOTHING, the data-driven demo chip) generically.
import { createHash } from 'node:crypto'
import { demoId, uuidv5 } from './ids.js'

export type DemoRole = 'head' | 'member'

export type DemoUserFixture = {
  id: string
  login: string
  givenName: string
  familyName: string
  title: string
  role: DemoRole
}

export type DemoDepartmentFixture = {
  id: string
  name: string
  slug: string
  localeDefault: string
}

export type DemoMembershipFixture = {
  id: string
  departmentId: string
  userId: string
  role: DemoRole
}

export const DEMO_DEPARTMENT: DemoDepartmentFixture = {
  id: demoId('department.digital-services'),
  name: 'Raqamli xizmatlar boshqarmasi',
  slug: 'raqamli-xizmatlar',
  localeDefault: 'uz-Latn',
}

export const DEMO_USERS: readonly DemoUserFixture[] = [
  {
    id: demoId('user.head'),
    login: 'demo.boshliq',
    givenName: 'Anvar',
    familyName: 'Aliyev',
    title: 'Boʻlim boshligʻi',
    role: 'head',
  },
  {
    id: demoId('user.member'),
    login: 'demo.xodim',
    givenName: 'Nodira',
    familyName: 'Karimova',
    title: 'Xodim',
    role: 'member',
  },
]

export const DEMO_MEMBERSHIPS: readonly DemoMembershipFixture[] = DEMO_USERS.map((user) => ({
  id: demoId(`membership.${user.role}`),
  departmentId: DEMO_DEPARTMENT.id,
  userId: user.id,
  role: user.role,
}))

/**
 * Deterministic and unusable by design. No login flow issues real credentials for these accounts in
 * this epic (auth ships in EPIC-001); the value exists only to satisfy `password_hash not null` and is
 * never printed, logged or returned by any endpoint.
 */
export function demoPasswordHash(userId: string): string {
  return `demo$unusable$${uuidv5(`password.${userId}`)}`
}

/**
 * A stable fingerprint of the fixture content, stored in `app.seed_runs.checksum` and echoed on a
 * repeat run ("demo seed already applied (checksum …) -- 0 rows written"). It documents *what* was
 * seeded for whoever reads `seed_runs` later; it is not a security control.
 */
export function computeDemoChecksum(): string {
  const payload = JSON.stringify({
    department: DEMO_DEPARTMENT,
    users: DEMO_USERS,
    memberships: DEMO_MEMBERSHIPS,
  })
  return createHash('sha256').update(payload).digest('hex').slice(0, 16)
}

/**
 * Every id this seed can ever write, in FK-safe delete order (children before parents). This is the
 * exact set `seed:reset --demo` deletes and nothing else (design §5.3) -- it never touches a row whose
 * id falls outside this list, and it never touches `audit.*` (I-3, I-5a).
 */
export const DEMO_DELETE_ORDER = [
  { table: 'app.memberships', ids: DEMO_MEMBERSHIPS.map((m) => m.id) },
  { table: 'app.departments', ids: [DEMO_DEPARTMENT.id] },
  { table: 'app.users', ids: DEMO_USERS.map((u) => u.id) },
] as const
