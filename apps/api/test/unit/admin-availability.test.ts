// Pure, DB-free coverage for `modules/admin/availability-gate.ts`'s `decideAvailability` -- the
// maintenance/department-paused decision itself, isolated from Fastify and Postgres.
import { describe, expect, it } from 'vitest'
import { decideAvailability } from '../../src/modules/admin/availability-gate.js'

describe('decideAvailability', () => {
  it('allows everything when maintenance is off and the department (if any) is active', () => {
    expect(
      decideAvailability({
        maintenanceEnabled: false,
        actorRole: 'member',
        exempt: false,
        action: 'read',
        departmentStatus: 'active',
      }),
    ).toEqual({ allow: true })
  })

  it('blocks a member with 503 "maintenance" when maintenance is on and the route is not exempt', () => {
    expect(
      decideAvailability({
        maintenanceEnabled: true,
        actorRole: 'member',
        exempt: false,
        action: 'read',
        departmentStatus: null,
      }),
    ).toEqual({ allow: false, problem: 'maintenance' })
  })

  it('lets an exempt route (login, /instance, health checks) through even during maintenance', () => {
    expect(
      decideAvailability({
        maintenanceEnabled: true,
        actorRole: null,
        exempt: true,
        action: null,
        departmentStatus: null,
      }),
    ).toEqual({ allow: true })
  })

  it('a super_admin bypasses maintenance entirely, exempt or not', () => {
    expect(
      decideAvailability({
        maintenanceEnabled: true,
        actorRole: 'super_admin',
        exempt: false,
        action: 'update',
        departmentStatus: 'active',
      }),
    ).toEqual({ allow: true })
  })

  it('blocks a non-read action on a paused department', () => {
    expect(
      decideAvailability({
        maintenanceEnabled: false,
        actorRole: 'head',
        exempt: false,
        action: 'update',
        departmentStatus: 'paused_by_admin',
      }),
    ).toEqual({ allow: false, problem: 'department_paused' })
  })

  it('still allows reading a paused department (so members can see why it is frozen)', () => {
    expect(
      decideAvailability({
        maintenanceEnabled: false,
        actorRole: 'member',
        exempt: false,
        action: 'read',
        departmentStatus: 'paused_by_admin',
      }),
    ).toEqual({ allow: true })
  })

  it('blocks writes to an archived department the same way as a paused one', () => {
    expect(
      decideAvailability({
        maintenanceEnabled: false,
        actorRole: 'head',
        exempt: false,
        action: 'delete',
        departmentStatus: 'archived',
      }),
    ).toEqual({ allow: false, problem: 'department_paused' })
  })

  it('a super_admin can still act on a paused department (the lever they operate)', () => {
    expect(
      decideAvailability({
        maintenanceEnabled: false,
        actorRole: 'super_admin',
        exempt: false,
        action: 'update',
        departmentStatus: 'paused_by_admin',
      }),
    ).toEqual({ allow: true })
  })

  it('a route with no department subject (action null) is never blocked by department status', () => {
    expect(
      decideAvailability({
        maintenanceEnabled: false,
        actorRole: 'member',
        exempt: false,
        action: null,
        departmentStatus: null,
      }),
    ).toEqual({ allow: true })
  })
})
