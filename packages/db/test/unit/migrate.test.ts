import { describe, expect, it } from 'vitest'
import { substituteVars } from '../../src/migrate.js'

describe('substituteVars (migrate:apply)', () => {
  it('replaces every ${VAR_NAME} token with its value', () => {
    const out = substituteVars("create role x with password '${POSTGRES_MIGRATOR_PASSWORD}'", {
      POSTGRES_MIGRATOR_PASSWORD: 'example-value',
    })
    expect(out).toBe("create role x with password 'example-value'")
  })

  it('replaces every occurrence of a repeated token', () => {
    const out = substituteVars('${X} and ${X} again', { X: 'y' })
    expect(out).toBe('y and y again')
  })

  it('throws loudly on an unresolved token instead of shipping the literal placeholder', () => {
    expect(() => substituteVars('${MISSING}', {})).toThrow(/unresolved variable \$\{MISSING\}/)
  })

  it('leaves SQL with no tokens unchanged', () => {
    const sql = 'create table if not exists app.foo (id uuid primary key)'
    expect(substituteVars(sql, {})).toBe(sql)
  })
})
