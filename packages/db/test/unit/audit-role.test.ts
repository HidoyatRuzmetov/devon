import type { PoolClient } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { insertAuditEvent } from '../../src/audit.js'
import type { Role } from '../../src/context.js'

const OWN_DEPARTMENT = '00000000-0000-4000-8000-000000000001'
const OTHER_DEPARTMENT = '00000000-0000-4000-8000-000000000002'
const cases: {
  name: string
  role: Role | null
  departmentRole?: 'head' | 'member'
  departmentId: string | null
  override?: string
  expected: Role | null
}[] = [
  {
    name: 'head acting inside their proven department',
    role: 'member',
    departmentRole: 'head',
    departmentId: OWN_DEPARTMENT,
    expected: 'head',
  },
  {
    name: 'ordinary department member',
    role: 'member',
    departmentRole: 'member',
    departmentId: OWN_DEPARTMENT,
    expected: 'member',
  },
  {
    name: 'instance administrator remains administrator',
    role: 'super_admin',
    departmentRole: 'head',
    departmentId: OWN_DEPARTMENT,
    expected: 'super_admin',
  },
  {
    name: 'unscoped event never borrows headship',
    role: 'member',
    departmentRole: 'head',
    departmentId: null,
    expected: 'member',
  },
  {
    name: 'another event department cannot borrow headship',
    role: 'member',
    departmentRole: 'head',
    departmentId: OWN_DEPARTMENT,
    override: OTHER_DEPARTMENT,
    expected: 'member',
  },
  {
    name: 'system actor remains unknown',
    role: null,
    departmentRole: 'head',
    departmentId: OWN_DEPARTMENT,
    expected: null,
  },
  {
    name: 'existing explicitly scoped head context is retained',
    role: 'head',
    departmentId: OWN_DEPARTMENT,
    expected: 'head',
  },
  {
    name: 'unknown department role remains member',
    role: 'member',
    departmentId: OWN_DEPARTMENT,
    expected: 'member',
  },
]

describe('new audit attribution without authorization elevation', () => {
  it.each(cases)('$name', async (row) => {
    const query = vi
      .fn<(text: string, values: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({ rows: [] })
    const context = {
      requestId: 'local-audit-role-fixture',
      userId: '00000000-0000-4000-8000-000000000003',
      actorRole: row.role,
      departmentId: row.departmentId,
      ...(row.departmentRole ? { departmentRole: row.departmentRole } : {}),
      actingForUserId: null,
      ip: '127.0.0.1',
      userAgent: 'Local fixture',
    }
    await insertAuditEvent({ query } as unknown as PoolClient, context, {
      action: 'work.card_created',
      subjectType: 'card',
      subjectId: 'local-card',
      ...(row.override ? { departmentId: row.override } : {}),
    })
    expect(query).toHaveBeenCalledOnce()
    expect(query.mock.calls[0]![1][1]).toBe(row.expected)
    expect(query.mock.calls[0]![1][3]).toBe(row.override ?? row.departmentId)
    expect(context.actorRole).toBe(row.role)
  })
})
