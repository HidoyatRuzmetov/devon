import { describe, expect, it } from 'vitest'
import { checkTenancyCoverage, GLOBAL_ALLOWLIST, TENANCY } from '../../src/tenancy.js'

describe('TENANCY registry', () => {
  it('classifies every table it declares as one of the four known classes', () => {
    const known = new Set(['tenant_root', 'department_owned', 'user_owned', 'global', 'audit'])
    for (const cls of Object.values(TENANCY)) expect(known.has(cls)).toBe(true)
  })

  it('gives every global table a non-empty GLOBAL_ALLOWLIST justification', () => {
    for (const [name, cls] of Object.entries(TENANCY)) {
      if (cls !== 'global') continue
      expect(GLOBAL_ALLOWLIST[name]?.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('checkTenancyCoverage', () => {
  it('passes when every table is classified', () => {
    const result = checkTenancyCoverage(Object.keys(TENANCY))
    expect(result.ok).toBe(true)
    expect(result.unclassified).toEqual([])
  })

  it('fails an unclassified table -- this is the mechanism the migrate gate relies on', () => {
    const result = checkTenancyCoverage([
      ...Object.keys(TENANCY),
      'app.a_new_table_nobody_classified',
    ])
    expect(result.ok).toBe(false)
    expect(result.unclassified).toEqual(['app.a_new_table_nobody_classified'])
  })

  it('is not fooled by a table that happens to already be classified', () => {
    const result = checkTenancyCoverage(['app.departments', 'app.memberships'])
    expect(result.ok).toBe(true)
  })
})
