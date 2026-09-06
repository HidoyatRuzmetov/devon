// AC-12 evidence producer (design.md §9): "first boot, consume, replay 410, second boot silent" --
// against a real, freshly migrated Postgres (test/checks/pg-fixture.ts), not the in-memory fake.
import { startProveDatabase } from './pg-fixture.js'
import { startProveServer } from './server-fixture.js'
import { step, assertEqual, assertTrue } from './http.js'

async function main(): Promise<void> {
  step('starting a fresh, migrated Postgres (Testcontainers)')
  const db = await startProveDatabase()
  const server = await startProveServer(db)
  console.log(`  api listening at ${server.baseUrl}`)

  try {
    step('first boot: ensureSetupToken() with zero users')
    const issued = await server.deps.ensureSetupToken()
    assertTrue(issued !== null, 'a setup token was issued on first boot')
    console.log(
      `  issued token (truncated): ${issued!.token.slice(0, 12)}... expires ${issued!.expiresAt.toISOString()}`,
    )

    step('opening the printed URL creates the super admin')
    const consumeRes = await fetch(`${server.baseUrl}/api/v1/setup/${issued!.token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        login: 'prove.admin',
        password: 'Str0ngExampleValue123',
        givenName: 'Aziz',
        familyName: 'Yusupov',
        locale: 'uz-Latn',
      }),
    })
    assertEqual(consumeRes.status, 201, 'POST /setup/{token} status')
    const created = (await consumeRes.json()) as { user: { role: string } }
    console.log(`  created user: ${JSON.stringify(created.user)}`)
    assertEqual(created.user.role, 'super_admin', 'created user role')

    step('replaying the SAME URL returns 410, forever')
    const replay1 = await fetch(`${server.baseUrl}/api/v1/setup/${issued!.token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        login: 'second.admin',
        password: 'Str0ngExampleValue123',
        givenName: 'X',
        familyName: 'Y',
        locale: 'uz-Latn',
      }),
    })
    assertEqual(replay1.status, 410, 'replay #1 status')
    console.log(`  body: ${JSON.stringify(await replay1.json())}`)

    const replay2 = await fetch(`${server.baseUrl}/api/v1/setup/${issued!.token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        login: 'third.admin',
        password: 'Str0ngExampleValue123',
        givenName: 'X',
        familyName: 'Y',
        locale: 'uz-Latn',
      }),
    })
    assertEqual(replay2.status, 410, 'replay #2 status')

    step('a restart with a super admin already present prints no further URL')
    const second = await server.deps.ensureSetupToken()
    assertTrue(second === null, 'ensureSetupToken() returns null once a super admin exists')

    console.log('\nsetup:prove PASSED')
  } finally {
    await server.stop()
    await db.stop()
  }
}

main().catch((err: unknown) => {
  console.error('\nsetup:prove FAILED')
  console.error(err)
  process.exit(1)
})
