// Shared harness for the hardening integration suite (H1.2/H1.3/H1.6/H1.9/H1.16/H10.1/H25.1): a real
// migrated Postgres (Testcontainers) + the real Fastify app (`buildApp`), reusing the exact same
// `pg-fixture.ts`/`server-fixture.ts`/`http.ts` the `*:prove` scripts already use (see
// `test/checks/work-prove.ts`). Kept separate from `test/unit/**` (which runs against the in-memory
// fake `Deps` and never touches Docker, `test/vitest.config.ts`'s own header comment) -- these tests
// need a real Postgres to prove RLS/department-scoping and real transaction concurrency, which a fake
// in-memory store cannot exercise honestly.
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { startProveDatabase, type ProveDatabase } from '../checks/pg-fixture.js'
import { startProveServer, type ProveServer } from '../checks/server-fixture.js'
import { parseCookies, cookieHeader } from '../checks/http.js'
import { hashPassword } from '../../src/lib/password.js'

export const PASSWORD = 'Str0ngExampleValue123'

export type Db = ProveDatabase
export type Server = ProveServer

export async function startHarness(): Promise<{ db: Db; server: Server }> {
  const db = await startProveDatabase()
  const server = await startProveServer(db)
  return { db, server }
}

export async function stopHarness(h: { db: Db; server: Server }): Promise<void> {
  await h.server.stop()
  await h.db.stop()
}

/** One superuser client per call -- callers `await using`-style via try/finally is unnecessary since
 * this always closes its own connection before returning. Bypasses RLS by design (same as
 * `pg-fixture.ts`'s own header comment): this is test setup, not the thing under test. */
async function withSuperuser<T>(db: Db, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: db.superuserUrl })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

export type SeededDepartment = { id: string; slug: string }

export async function seedDepartment(
  db: Db,
  opts: { name: string; slug: string; joinRequiresApproval?: boolean },
): Promise<SeededDepartment> {
  const id = randomUUID()
  await withSuperuser(db, (c) =>
    c.query(`insert into app.departments (id, name, slug) values ($1, $2, $3)`, [
      id,
      opts.name,
      opts.slug,
    ]),
  )
  return { id, slug: opts.slug }
}

export type SeededUser = { id: string; login: string }

let userSeq = 0

/** Creates a real `app.users` row with a real argon2id hash of the shared test `PASSWORD`, plus an
 * active membership in `departmentId` at `role`. `instanceRole` is the *instance-wide* role
 * (`super_admin`/`head`/`member`, distinct from the department membership role) -- almost every caller
 * wants `'member'` here even for a department head, since I-8b reserves `super_admin` for the single
 * instance admin. */
export async function seedMember(
  db: Db,
  departmentId: string,
  opts: {
    role: 'head' | 'member'
    instanceRole?: 'member' | 'super_admin'
    login?: string
    passwordHash?: string
  },
): Promise<SeededUser> {
  userSeq += 1
  const id = randomUUID()
  const login = opts.login ?? `test.user.${userSeq}.${randomUUID().slice(0, 8)}`
  const passwordHash = opts.passwordHash ?? (await hashPassword(PASSWORD))
  await withSuperuser(db, async (c) => {
    await c.query(
      `insert into app.users (id, login, password_hash, given_name, family_name, role)
       values ($1, $2, $3, 'Test', 'User', $4)`,
      [id, login, passwordHash, opts.instanceRole ?? 'member'],
    )
    await c.query(
      `insert into app.memberships (id, department_id, user_id, role) values ($1, $2, $3, $4)`,
      [randomUUID(), departmentId, id, opts.role],
    )
  })
  return { id, login }
}

/** A user with no department membership at all (a fresh registrant, or an instance-wide super_admin
 * who is never also a department member per I-8b). */
export async function seedBareUser(
  db: Db,
  opts: { instanceRole?: 'member' | 'super_admin'; login?: string } = {},
): Promise<SeededUser> {
  userSeq += 1
  const id = randomUUID()
  const login = opts.login ?? `test.bare.${userSeq}.${randomUUID().slice(0, 8)}`
  const passwordHash = await hashPassword(PASSWORD)
  await withSuperuser(db, (c) =>
    c.query(
      `insert into app.users (id, login, password_hash, given_name, family_name, role)
       values ($1, $2, $3, 'Test', 'User', $4)`,
      [id, login, passwordHash, opts.instanceRole ?? 'member'],
    ),
  )
  return { id, login }
}

export type Session = {
  cookie: string
  csrf: string
  headers: Record<string, string>
}

export async function loginAs(
  baseUrl: string,
  login: string,
  password = PASSWORD,
): Promise<Session> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login, password }),
  })
  if (res.status !== 204) {
    throw new Error(`login failed for ${login}: ${res.status} ${await res.text()}`)
  }
  const cookies = parseCookies(res.headers.getSetCookie())
  const cookie = cookieHeader(cookies)
  const csrf = cookies['devon_csrf']!
  return {
    cookie,
    csrf,
    headers: {
      cookie,
      'x-csrf-token': csrf,
      'content-type': 'application/json',
    },
  }
}

/** Raw SQL escape hatch for setup a test needs that has no API route yet reachable quickly enough
 * (e.g. seeding an event/card directly to avoid re-deriving every module's full create flow in every
 * test file). Bypasses RLS -- test setup only, never the thing under assertion. */
export async function superuserQuery<T extends Record<string, unknown> = Record<string, unknown>>(
  db: Db,
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  return withSuperuser(db, async (c) => (await c.query<T>(text, params)).rows)
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)
}
