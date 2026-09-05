import { describe, expect, it } from 'vitest'
import {
  CURRENT_DEPARTMENT_ID_FN,
  CURRENT_USER_ID_FN,
  departmentTableDDL,
  dropTableDDL,
  userTableDDL,
} from '../../src/rls.js'

describe('departmentTableDDL', () => {
  const ddl = departmentTableDDL('app', 'widgets').join('\n')

  it('adds a department_id column referencing app.departments', () => {
    expect(ddl).toMatch(/department_id uuid not null references app\.departments\(id\)/)
  })

  it('enables and forces row level security', () => {
    expect(ddl).toMatch(/alter table app\.widgets enable row level security/)
    expect(ddl).toMatch(/alter table app\.widgets force row level security/)
  })

  it('creates a policy scoped by app.current_department_id()', () => {
    expect(ddl).toContain(CURRENT_DEPARTMENT_ID_FN)
  })

  it('creates an index leading with department_id', () => {
    expect(ddl).toMatch(
      /create index if not exists widgets_department_id_idx on app\.widgets \(department_id\)/,
    )
  })

  it('rejects an unsafe identifier', () => {
    expect(() => departmentTableDDL('app', 'widgets; drop table app.users')).toThrow()
  })
})

describe('userTableDDL', () => {
  const ddl = userTableDDL('app', 'notes').join('\n')

  it('adds a user_id column', () => {
    expect(ddl).toMatch(/user_id uuid not null/)
  })

  it('scopes the policy to app.current_user_id() and never mentions actor_role', () => {
    expect(ddl).toContain(CURRENT_USER_ID_FN)
    expect(ddl).not.toMatch(/current_actor_role/)
  })
})

describe('dropTableDDL', () => {
  it('drops the qualified table', () => {
    expect(dropTableDDL('app', 'widgets')).toBe('drop table if exists app.widgets cascade')
  })

  it('rejects an unsafe identifier', () => {
    expect(() => dropTableDDL('app', 'widgets cascade; --')).toThrow()
  })
})
