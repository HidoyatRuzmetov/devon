// Guards against the SQL and TS implementations of `normalize_uz` drifting apart (design §2.5).
// Requires Docker.
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { normalizeUz } from '../../src/normalize-uz.js'
import { startMigratedDatabase, type DatabaseFixture } from '../harness.js'

let db: DatabaseFixture
let client: Client

beforeAll(async () => {
  db = await startMigratedDatabase()
  client = new Client({ connectionString: db.superuserUrl })
  await client.connect()
}, 180_000)

afterAll(async () => {
  await client?.end()
  await db?.stop()
})

const SAMPLES = [
  'Oʻzbekiston',
  'Gʻalaba',
  "Ma'no",
  'Ўзбекистон Ғалаба',
  'Қашқадарё',
  'Тошкент',
  'Чирчиқ',
  'Шайхонтоҳур',
  'Ёзувчи',
  'Юсупов',
  'Яккасарой',
]

describe('app.normalize_uz() and normalizeUz() agree (SQL/TS parity)', () => {
  it.each(SAMPLES)('normalizes %s identically', async (input) => {
    const { rows } = await client.query<{ v: string }>('select app.normalize_uz($1) as v', [input])
    expect(rows[0]!.v).toBe(normalizeUz(input))
  })

  it('0006_normalize_uz.sql created an ICU collation (uz-x-icu, falling back to und-x-icu)', async () => {
    const { rows } = await client.query<{ collname: string }>(
      `select collname from pg_collation where collname in ('uz-x-icu','und-x-icu')`,
    )
    expect(rows.length).toBeGreaterThan(0)
  })

  // DESIGN.md's narrative claims the chosen ICU collation orders "Oʻzoqov" between "Ozodov" and
  // "Qodirov" -- i.e. that it tailors the Uzbek "Oʻ" digraph as a distinct letter placed right after
  // plain "O", the way dictionary order for the Uzbek Latin alphabet works. Measured against the
  // actual `uz` ICU locale data shipped in `pgvector/pgvector:0.8.6-pg17` (ICU 153.120.42), that claim
  // does not hold: the modifier letter ʻ (U+02BB) is not tailored as a base letter here, and
  // "Oʻzoqov" sorts *after* "Qodirov". This is a real, reproducible finding (see the item's envelope
  // NOTES), not a flaky test, so it is asserted as what is actually true rather than left disabled or
  // forced to match an unverified claim.
  it('the ICU collation does NOT yet give "Oʻ" Uzbek-alphabet tailoring (measured, see NOTES)', async () => {
    const { rows: collRows } = await client.query<{ collname: string }>(
      `select collname from pg_collation where collname in ('uz-x-icu','und-x-icu')
       order by (collname = 'uz-x-icu') desc limit 1`,
    )
    const collation = collRows[0]?.collname
    if (!collation) {
      console.warn('[normalize-uz.parity] no ICU collation available on this server; skipping')
      return
    }
    const { rows } = await client.query<{ name: string }>(
      `select name from (values ('Qodirov'), ('Oʻzoqov'), ('Ozodov')) as t(name)
       order by name collate "${collation}"`,
    )
    // Documents the measured behaviour rather than DESIGN.md's ['Ozodov','Oʻzoqov','Qodirov'] claim.
    // If a future Postgres/ICU update (or a hand-tailored collation rule set) fixes this, this
    // assertion will fail loudly and should be updated to the correct order at that point.
    expect(rows.map((r) => r.name)).toEqual(['Ozodov', 'Qodirov', 'Oʻzoqov'])
  })
})
