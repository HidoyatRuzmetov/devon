// Real Fastify + isolated migrated Postgres. All accounts/events are synthetic local fixtures.
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { carpoolDto, carpoolListResponseSchema } from '../../src/modules/events/schemas.js'
import {
  loginAs,
  seedDepartment,
  seedMember,
  startHarness,
  stopHarness,
  superuserQuery,
  type Db,
  type Server,
  type Session,
} from './harness.js'

let db: Db
let server: Server
let peopleFixture: Awaited<ReturnType<typeof createPeople>>
beforeAll(async () => {
  const harness = await startHarness()
  db = harness.db
  server = harness.server
  // Widen the actual insert interleaving: without the event-level lock, competing cars both pass
  // their empty participation read before either insert commits. This never touches a real DB.
  await superuserQuery(
    db,
    `create function app.test_delay_carpool_insert() returns trigger language plpgsql as $$
    begin perform pg_sleep(0.08); return new; end $$;
    create trigger test_delay_carpools before insert on app.carpools for each row execute function app.test_delay_carpool_insert();
    create trigger test_delay_carpool_seats before insert on app.carpool_seats for each row execute function app.test_delay_carpool_insert();`,
  )
  // Five real sign-ins for the suite, instead of repeatedly exhausting the production login
  // limiter. Event IDs still isolate every test's rides; no security setting is disabled.
  peopleFixture = await createPeople()
})
afterEach(async () => {
  if (peopleFixture)
    await superuserQuery(db, "update app.memberships set status='active' where department_id=$1", [
      peopleFixture.department.id,
    ])
})
afterAll(async () => {
  if (server && db) await stopHarness({ db, server })
})

function request(method: string, path: string, session: Session, body?: unknown) {
  return fetch(`${server.baseUrl}/api/v1/events${path}`, {
    method,
    headers:
      body === undefined
        ? { cookie: session.cookie, 'x-csrf-token': session.csrf }
        : session.headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function createPeople() {
  const department = await seedDepartment(db, {
    name: 'Carpool local QA',
    slug: `carpool-${randomUUID()}`,
  })
  const people = await Promise.all(
    ['head', 'member', 'member', 'member', 'member'].map(async (role) => {
      const user = await seedMember(db, department.id, { role: role as 'head' | 'member' })
      return { ...user, session: await loginAs(server.baseUrl, user.login) }
    }),
  )
  return { department, people }
}
async function fixture() {
  const { department, people } = peopleFixture
  const [head, driver, passenger, waiting, newcomer] = people
  const response = await request('POST', '', head!.session, {
    title: 'Carpool local QA',
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    endsAt: new Date(Date.now() + 90_000_000).toISOString(),
  })
  expect(response.status).toBe(201)
  const event = (await response.json()) as { id: string }
  const path = `/${event.id}/carpools`
  async function offer(session: Session, seats = 3) {
    const response = await request('POST', path, session, { seats })
    expect(response.status).toBe(201)
    return carpoolDto.parse(await response.json())
  }
  async function list() {
    const response = await request('GET', path, head!.session)
    expect(response.status).toBe(200)
    return carpoolListResponseSchema.parse(await response.json()).items
  }
  return {
    department,
    head: head!,
    driver: driver!,
    passenger: passenger!,
    waiting: waiting!,
    newcomer: newcomer!,
    event,
    path,
    offer,
    list,
  }
}
async function conflict(response: Response, reason: string) {
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({
    code: 'conflict',
    errors: [{ path: 'carpool', code: reason }],
  })
}

describe('one carpool role per person per event', () => {
  it('rejects drivers in any car, duplicate offers and second confirmed or waitlisted reservations', async () => {
    const f = await fixture()
    const first = await f.offer(f.head.session, 1)
    const second = await f.offer(f.driver.session, 1)
    await conflict(
      await request('POST', `${f.path}/${second.id}/claim`, f.head.session, { seats: 1 }),
      'driver_cannot_be_passenger',
    )
    await conflict(
      await request('POST', `${f.path}/${first.id}/claim`, f.head.session, { seats: 1 }),
      'driver_cannot_be_passenger',
    )
    await conflict(
      await request('POST', f.path, f.head.session, { seats: 3 }),
      'driver_already_offering',
    )
    expect(
      (await request('POST', `${f.path}/${first.id}/claim`, f.passenger.session, { seats: 1 }))
        .status,
    ).toBe(204)
    await conflict(
      await request('POST', `${f.path}/${second.id}/claim`, f.passenger.session, { seats: 1 }),
      'passenger_already_booked',
    )
    await conflict(
      await request('POST', f.path, f.passenger.session, { seats: 3 }),
      'passenger_already_booked',
    )
    expect(
      (await request('POST', `${f.path}/${first.id}/claim`, f.waiting.session, { seats: 1 }))
        .status,
    ).toBe(204)
    expect(
      (await f.list())
        .find((c) => c.id === first.id)
        ?.passengers.find((p) => p.userId === f.waiting.id)?.status,
    ).toBe('waitlist')
    await conflict(
      await request('POST', `${f.path}/${second.id}/claim`, f.waiting.session, { seats: 1 }),
      'passenger_already_booked',
    )
  })

  it('serializes simultaneous bookings in different cars and simultaneous driver/passenger requests', async () => {
    const f = await fixture()
    const first = await f.offer(f.head.session)
    const second = await f.offer(f.driver.session)
    const bookings = await Promise.all(
      [first, second].map((car) =>
        request('POST', `${f.path}/${car.id}/claim`, f.passenger.session, { seats: 1 }),
      ),
    )
    expect(bookings.map((r) => r.status).sort()).toEqual([204, 409])
    expect(
      (await f.list()).flatMap((c) => c.passengers).filter((p) => p.userId === f.passenger.id),
    ).toHaveLength(1)
    const mixed = await Promise.all([
      request('POST', f.path, f.newcomer.session, { seats: 2 }),
      request('POST', `${f.path}/${first.id}/claim`, f.newcomer.session, { seats: 1 }),
    ])
    expect(mixed.filter((r) => r.status === 201 || r.status === 204)).toHaveLength(1)
    expect(mixed.filter((r) => r.status === 409)).toHaveLength(1)
    const cars = await f.list()
    expect(
      cars.filter((c) => c.driver.id === f.newcomer.id).length +
        cars.flatMap((c) => c.passengers).filter((p) => p.userId === f.newcomer.id).length,
    ).toBe(1)
  })

  it('serializes duplicate offers but allows the same person to participate in separate events', async () => {
    const f = await fixture()
    const offers = await Promise.all(
      [1, 2].map(() => request('POST', f.path, f.driver.session, { seats: 2 })),
    )
    expect(offers.map((r) => r.status).sort()).toEqual([201, 409])
    const other = await request('POST', '', f.head.session, {
      title: 'Another local event',
      startsAt: new Date(Date.now() + 172_800_000).toISOString(),
      endsAt: new Date(Date.now() + 176_400_000).toISOString(),
    })
    expect(other.status).toBe(201)
    const event = (await other.json()) as { id: string }
    expect(
      (await request('POST', `/${event.id}/carpools`, f.driver.session, { seats: 2 })).status,
    ).toBe(201)
  })
})

describe('safe driver edits, queues and deletion', () => {
  it('persists and clears departure details, rejects reducing occupied seats, and promotes on capacity increase', async () => {
    const f = await fixture()
    const car = await f.offer(f.driver.session, 2)
    const departureAt = new Date(Date.now() + 82_800_000).toISOString()
    const update = await request('PATCH', `${f.path}/${car.id}`, f.driver.session, {
      departurePlace: 'Main entrance',
      departureAt,
      note: 'Blue car',
    })
    expect(update.status).toBe(200)
    expect(carpoolDto.parse(await update.json())).toMatchObject({
      departurePlace: 'Main entrance',
      departureAt,
      note: 'Blue car',
    })
    expect((await f.list())[0]).toMatchObject({ departurePlace: 'Main entrance', departureAt })
    expect(
      (await request('POST', `${f.path}/${car.id}/claim`, f.passenger.session, { seats: 2 }))
        .status,
    ).toBe(204)
    expect(
      (await request('POST', `${f.path}/${car.id}/claim`, f.waiting.session, { seats: 1 })).status,
    ).toBe(204)
    await conflict(
      await request('PATCH', `${f.path}/${car.id}`, f.driver.session, { seats: 1 }),
      'carpool_capacity_below_claimed',
    )
    const increased = await request('PATCH', `${f.path}/${car.id}`, f.driver.session, {
      seats: 3,
      departurePlace: null,
      departureAt: null,
      note: null,
    })
    expect(increased.status).toBe(200)
    expect(carpoolDto.parse(await increased.json())).toMatchObject({
      seats: 3,
      seatsClaimed: 3,
      departurePlace: null,
      departureAt: null,
      note: null,
    })
    expect((await f.list())[0]?.passengers.every((p) => p.status === 'confirmed')).toBe(true)
    const audit = await superuserQuery(
      db,
      "select action from audit.events where subject_id=$1 and action='events.carpool_updated'",
      [car.id],
    )
    expect(audit).toHaveLength(2)
  })

  it('keeps confirmed reservations intact and preserves queue order across retries and reductions', async () => {
    const f = await fixture()
    const car = await f.offer(f.driver.session, 3)
    expect(
      (await request('POST', `${f.path}/${car.id}/claim`, f.passenger.session, { seats: 2 }))
        .status,
    ).toBe(204)
    expect(
      (await request('POST', `${f.path}/${car.id}/claim`, f.waiting.session, { seats: 2 })).status,
    ).toBe(204)
    // A small newcomer waits behind the earlier party even though one seat is free.
    expect(
      (await request('POST', `${f.path}/${car.id}/claim`, f.newcomer.session, { seats: 1 })).status,
    ).toBe(204)
    expect(
      (await f.list())[0]?.passengers.filter((p) => p.status === 'confirmed').map((p) => p.userId),
    ).toEqual([f.passenger.id])
    const before = await superuserQuery(
      db,
      'select claimed_at from app.carpool_seats where carpool_id=$1 and user_id=$2',
      [car.id, f.waiting.id],
    )
    expect(
      (await request('POST', `${f.path}/${car.id}/claim`, f.waiting.session, { seats: 2 })).status,
    ).toBe(204)
    expect(
      await superuserQuery(
        db,
        'select claimed_at from app.carpool_seats where carpool_id=$1 and user_id=$2',
        [car.id, f.waiting.id],
      ),
    ).toEqual(before)
    // Decreasing an existing confirmed party frees room and promotes the oldest waitlisted party.
    expect(
      (await request('POST', `${f.path}/${car.id}/claim`, f.passenger.session, { seats: 1 }))
        .status,
    ).toBe(204)
    const current = (await f.list())[0]!
    expect(current.passengers.find((p) => p.userId === f.waiting.id)?.status).toBe('confirmed')
    expect(current.passengers.find((p) => p.userId === f.newcomer.id)?.status).toBe('waitlist')
    await conflict(
      await request('POST', `${f.path}/${car.id}/claim`, f.passenger.session, { seats: 2 }),
      'carpool_claim_capacity_unavailable',
    )
    expect((await f.list())[0]?.seatsClaimed).toBe(3)
    await conflict(
      await request('POST', `${f.path}/${car.id}/claim`, f.newcomer.session, { seats: 4 }),
      'carpool_claim_exceeds_capacity',
    )
  })

  it('requires every confirmed and waitlisted passenger to leave before auditable deletion', async () => {
    const f = await fixture()
    const car = await f.offer(f.driver.session, 1)
    expect(
      (await request('POST', `${f.path}/${car.id}/claim`, f.passenger.session, { seats: 1 }))
        .status,
    ).toBe(204)
    expect(
      (await request('POST', `${f.path}/${car.id}/claim`, f.waiting.session, { seats: 1 })).status,
    ).toBe(204)
    await conflict(
      await request('DELETE', `${f.path}/${car.id}`, f.driver.session),
      'carpool_has_passengers',
    )
    expect((await request('DELETE', `${f.path}/${car.id}/claim`, f.passenger.session)).status).toBe(
      204,
    )
    await conflict(
      await request('DELETE', `${f.path}/${car.id}`, f.driver.session),
      'carpool_has_passengers',
    )
    expect((await request('DELETE', `${f.path}/${car.id}/claim`, f.waiting.session)).status).toBe(
      204,
    )
    expect((await request('DELETE', `${f.path}/${car.id}`, f.driver.session)).status).toBe(204)
    expect((await request('DELETE', `${f.path}/${car.id}`, f.driver.session)).status).toBe(204)
    expect(await f.list()).toEqual([])
    expect(
      (await superuserQuery(db, 'select status from app.carpools where id=$1', [car.id]))[0]?.[
        'status'
      ],
    ).toBe('cancelled')
    expect(
      await superuserQuery(
        db,
        "select action from audit.events where subject_id=$1 and action='events.carpool_deleted'",
        [car.id],
      ),
    ).toHaveLength(1)
    // Removing an empty offer frees the driver's role without reviving the cancelled offer.
    const other = await f.offer(f.head.session)
    expect(
      (await request('POST', `${f.path}/${other.id}/claim`, f.driver.session, { seats: 1 })).status,
    ).toBe(204)
  })

  it('does not let an unrelated member edit/delete, a wrong parent mutate, or a claim race lose a seat', async () => {
    const f = await fixture()
    const car = await f.offer(f.driver.session)
    expect(
      (await request('PATCH', `${f.path}/${car.id}`, f.passenger.session, { note: 'Wrong editor' }))
        .status,
    ).toBe(403)
    expect((await request('DELETE', `${f.path}/${car.id}`, f.passenger.session)).status).toBe(403)
    expect(
      (
        await request('PATCH', `/${randomUUID()}/carpools/${car.id}`, f.driver.session, {
          seats: 2,
        })
      ).status,
    ).toBe(404)
    const noCsrf = await fetch(`${server.baseUrl}/api/v1/events${f.path}/${car.id}`, {
      method: 'DELETE',
      headers: { cookie: f.driver.session.cookie },
    })
    expect(noCsrf.status).toBe(403)
    const race = await Promise.all([
      request('DELETE', `${f.path}/${car.id}`, f.driver.session),
      request('POST', `${f.path}/${car.id}/claim`, f.passenger.session, { seats: 1 }),
    ])
    expect(race.map((r) => r.status).sort()).toEqual([204, 409])
    const cars = await f.list()
    expect(cars.length === 0 || cars[0]!.passengers.some((p) => p.userId === f.passenger.id)).toBe(
      true,
    )
  })

  it('does not promote legacy duplicates or former members when another passenger releases a seat', async () => {
    const f = await fixture()
    const car = await f.offer(f.driver.session, 1)
    const other = await f.offer(f.head.session, 2)
    expect(
      (await request('POST', `${f.path}/${car.id}/claim`, f.passenger.session, { seats: 1 }))
        .status,
    ).toBe(204)
    expect(
      (await request('POST', `${f.path}/${other.id}/claim`, f.waiting.session, { seats: 1 }))
        .status,
    ).toBe(204)
    // Faithful legacy setup: earlier API versions allowed the same rider in two cars and a
    // driver in another car's queue. New requests cannot create either shape.
    await Promise.all(
      [f.waiting.id, f.head.id].map((userId) =>
        superuserQuery(
          db,
          "insert into app.carpool_seats (id,department_id,carpool_id,user_id,seats_claimed,status) values ($1,$2,$3,$4,1,'waitlist')",
          [randomUUID(), f.department.id, car.id, userId],
        ),
      ),
    )
    expect(
      (await request('POST', `${f.path}/${car.id}/claim`, f.newcomer.session, { seats: 1 })).status,
    ).toBe(204)
    await superuserQuery(
      db,
      "update app.memberships set status='removed' where department_id=$1 and user_id=$2",
      [f.department.id, f.newcomer.id],
    )
    expect((await request('DELETE', `${f.path}/${car.id}/claim`, f.passenger.session)).status).toBe(
      204,
    )
    expect((await f.list()).find((c) => c.id === car.id)?.seatsClaimed).toBe(0)
    expect(
      (await f.list())
        .find((c) => c.id === car.id)
        ?.passengers.every((p) => p.status === 'waitlist'),
    ).toBe(true)
  })

  it.each(['cancelled', 'done', 'past'])(
    'blocks new participation for %s events but still permits releases and empty deletion',
    async (state) => {
      const f = await fixture()
      const car = await f.offer(f.driver.session, 1)
      expect(
        (await request('POST', `${f.path}/${car.id}/claim`, f.passenger.session, { seats: 1 }))
          .status,
      ).toBe(204)
      expect(
        (await request('POST', `${f.path}/${car.id}/claim`, f.waiting.session, { seats: 1 }))
          .status,
      ).toBe(204)
      if (state === 'past') {
        await superuserQuery(
          db,
          "update app.events set starts_at=now()-interval '2 hours', ends_at=now()-interval '1 hour' where id=$1",
          [f.event.id],
        )
      } else {
        await superuserQuery(db, 'update app.events set status=$1 where id=$2', [state, f.event.id])
      }
      await conflict(await request('POST', f.path, f.head.session, { seats: 2 }), 'event_not_open')
      await conflict(
        await request('POST', `${f.path}/${car.id}/claim`, f.newcomer.session, { seats: 1 }),
        'event_not_open',
      )
      await conflict(
        await request('PATCH', `${f.path}/${car.id}`, f.driver.session, { seats: 2 }),
        'event_not_open',
      )
      expect(
        (await request('DELETE', `${f.path}/${car.id}/claim`, f.passenger.session)).status,
      ).toBe(204)
      expect((await f.list())[0]?.passengers[0]?.status).toBe('waitlist')
      await conflict(
        await request('DELETE', `${f.path}/${car.id}`, f.driver.session),
        'carpool_has_passengers',
      )
      expect((await request('DELETE', `${f.path}/${car.id}/claim`, f.waiting.session)).status).toBe(
        204,
      )
      expect((await request('DELETE', `${f.path}/${car.id}`, f.driver.session)).status).toBe(204)
    },
  )
})
