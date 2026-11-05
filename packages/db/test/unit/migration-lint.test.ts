import { describe, expect, it } from 'vitest'
import { expectAllOk } from '../checks/assert.js'
import { lintMigrations } from '../checks/migration-lint.js'
import { readMigrationFiles } from '../harness.js'

describe('migration-lint', () => {
  const files = readMigrationFiles()

  it('found the shipped migrations', () => {
    expect(files.length).toBeGreaterThanOrEqual(7)
  })

  it('every shipped migration passes the lint', () => {
    expectAllOk(lintMigrations(files))
  })

  it('flags a destructive TRUNCATE outside a *_contract.sql file', () => {
    const results = lintMigrations([{ name: '0099_bad.sql', sql: 'truncate audit.events;' }])
    const r = results.find((x) => x.name.includes('no TRUNCATE'))
    expect(r?.ok).toBe(false)
  })

  it('allows a destructive statement inside a *_contract.sql file with a CONTRACT header', () => {
    const results = lintMigrations([
      {
        name: '0099_users_contract.sql',
        sql: '-- CONTRACT: safe because release 1.4 finished the expand step\ndrop column app.users.legacy_flag;',
      },
    ])
    const r = results.find((x) => x.name.includes('no DROP COLUMN'))
    expect(r?.ok).toBe(true)
  })

  it('flags a forbidden personal-data column name', () => {
    const results = lintMigrations([
      { name: '0099_bad.sql', sql: 'create table app.x (passport_number text);' },
    ])
    const r = results.find((x) => x.name.includes('forbidden personal-data'))
    expect(r?.ok).toBe(false)
  })

  it('does not flag ordinary words containing "inn" as a substring', () => {
    const results = lintMigrations([
      { name: '0099_ok.sql', sql: '-- this migration is just beginning, running fine' },
    ])
    const r = results.find((x) => x.name.includes('forbidden personal-data'))
    expect(r?.ok).toBe(true)
  })
  it('does not allow unrelated sensitive fields through the specific birthday exception', () => {
    for (const sql of [
      'create table app.other (birth_date date);',
      'create table app.account_birthdays (passport_number text);',
      "create table app.account_birthdays(id uuid); create table app.other(birth_date date not null check (birth_date >= date '1900-01-01'), id uuid);",
    ]) {
      const results = lintMigrations([{ name: '2031_birthdays.sql', sql }])
      expect(results.find((x) => x.name.includes('forbidden personal-data'))?.ok).toBe(false)
    }
  })

  it('keeps the directory date exception limited to the approved existing field projection', () => {
    for (const sql of [
      'create table app.other (birth_date date);',
      'select b.owner_user_id, b.birth_date, b.passport_number from app.account_birthdays b;',
    ]) {
      const results = lintMigrations([{ name: '2032_directory_birth_dates.sql', sql }])
      expect(results.find((x) => x.name.includes('forbidden personal-data'))?.ok).toBe(false)
    }
  })

  it('flags a bare SET on the app.* GUC namespace', () => {
    const results = lintMigrations([{ name: '0099_bad.sql', sql: "set app.department_id = 'x';" }])
    const r = results.find((x) => x.name.includes('bare SET'))
    expect(r?.ok).toBe(false)
  })

  it('does not flag SET ROLE / RESET ROLE', () => {
    const results = lintMigrations([
      { name: '0099_ok.sql', sql: 'set role devon_migrator;\nreset role;' },
    ])
    const r = results.find((x) => x.name.includes('bare SET'))
    expect(r?.ok).toBe(true)
  })

  it('flags a grant beyond INSERT/SELECT on an audit table', () => {
    const results = lintMigrations([
      { name: '0099_bad.sql', sql: 'grant update on audit.events to devon_app;' },
    ])
    const r = results.find((x) => x.name.includes('any grant on an audit.* table'))
    expect(r?.ok).toBe(false)
  })

  it('allows INSERT, SELECT grants on audit tables', () => {
    const results = lintMigrations([
      {
        name: '0099_ok.sql',
        sql: 'grant insert, select on audit.events, audit.anchors to devon_app;',
      },
    ])
    const r = results.find((x) => x.name.includes('any grant on an audit.* table'))
    expect(r?.ok).toBe(true)
  })
})
