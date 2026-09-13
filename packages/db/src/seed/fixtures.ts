// The foundation of the demo dataset: the one department and the two accounts a presenter signs in
// as. Everything else about "Raqamli xizmatlar boshqarmasi" -- the other fourteen colleagues, the
// three bo'limlar, the quarter of work -- is `work-fixtures.ts`'s, because this file predates those
// epics and their modules own their own rows (MODULE-GUIDE.md "DB: seeds"). The two users here are
// still the *personas*: `demo.boshliq` is the boshqarma boshligʻi the head half of the demo is given
// from, `demo.xodim` is the colleague the other half is given from.
import { createHash } from 'node:crypto'
import { hash } from '@node-rs/argon2'
import { demoId } from './ids.js'

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

/**
 * The one seeded `super_admin` account (package `demo-super-admin`): a department head/member alone
 * cannot reach `/admin/*` (`GET /api/v1/admin/instance` answers `403` for them, per MODULE-GUIDE.md
 * "Running the app"), so without this fixture nobody could sign in and demo -- or screenshot -- the
 * super admin console against `pnpm start --demo`. Deliberately has no `app.memberships` row: a
 * super admin is global, not scoped to `DEMO_DEPARTMENT` (TECH-SPEC §2.1). Demo only -- `guard.ts`'s
 * `assertSeedAllowed` already refuses every seed module outside a non-production environment, the
 * same gate this fixture relies on to never reach a real deployment.
 */
export type DemoSuperAdminFixture = {
  id: string
  login: string
  givenName: string
  familyName: string
  title: string
}

export const DEMO_SUPER_ADMIN: DemoSuperAdminFixture = {
  id: demoId('user.super_admin'),
  login: 'admin.super',
  givenName: 'Sanjar',
  familyName: 'Neʼmatov',
  title: 'Super administrator',
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
    // He heads the whole boshqarma, not one of its bo'limlar -- the two boʻlim boshligʻi are Jasur
    // Qodirov and Dilnoza Rahimova (`work-fixtures.ts`), and the People page shows all three titles
    // side by side, so they have to be different words.
    title: 'Boshqarma boshligʻi',
    role: 'head',
  },
  {
    id: demoId('user.member'),
    login: 'demo.xodim',
    givenName: 'Nodira',
    familyName: 'Karimova',
    // "Xodim" is a role, not a job: on the People page it was the one card that said nothing about
    // what the person does, next to fifteen that did.
    title: 'Yetakchi mutaxassis',
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
 * The one password every demo account shares -- `demo.boshliq`, `demo.xodim` and `DEMO_SUPER_ADMIN`
 * (`admin.super`) alike -- documented here, in `MODULE-GUIDE.md` ("Running the app") and nowhere
 * else. A real argon2id hash (via `verifyPassword`, `apps/api/src/lib/password.ts`) so `POST
 * /api/v1/auth/login` actually accepts it -- every module needs a working demo session to be
 * testable end to end. `hash()` salts randomly per call, so two demo users get two different hash
 * strings for the same password; that has no effect on `ON CONFLICT DO NOTHING` idempotence, which is
 * keyed by each user's deterministic id, never by this value.
 */
export const DEMO_PASSWORD = 'Ishonchli#2026' // sample demo-only credential, not a production secret

export function demoPasswordHash(): Promise<string> {
  return hash(DEMO_PASSWORD)
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
    superAdmin: DEMO_SUPER_ADMIN,
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
  // `DEMO_SUPER_ADMIN` has no membership row (it is global, per the fixture's own doc comment above),
  // so it only ever needs to appear in this last, users-only entry -- `demo.ts`'s `runResetDemo`
  // indexes this array positionally (`DEMO_DELETE_ORDER[2].ids`) for both the session pre-delete and
  // the user delete itself, so appending here is enough for the super admin to be cleaned up by both.
  { table: 'app.users', ids: [...DEMO_USERS.map((u) => u.id), DEMO_SUPER_ADMIN.id] },
] as const
