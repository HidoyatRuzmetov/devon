import { describe, expect, it } from 'vitest'
import { describeWrite } from '../../src/audit-writes.js'

describe('fallback audit receipts', () => {
  it('captures a domain change without copying SQL or secret field values', () => {
    const receipt = describeWrite(
      'update "app"."users" set "work_start_date" = $1, "updated_at" = $2 where id = $3 returning id',
      {
        command: 'UPDATE',
        rowCount: 1,
        rows: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            password: 'example-must-not-leak',
          },
        ],
      },
    )
    expect(receipt).toMatchObject({
      action: 'data.record.updated',
      subjectType: 'users',
      after: { rowsAffected: 1, fields: ['work_start_date', 'updated_at'] },
    })
    expect(JSON.stringify(receipt)).not.toContain('example-must-not-leak')
    expect(JSON.stringify(receipt)).not.toContain('returning')
  })
  it('ignores reads, failed matches and background bookkeeping', () => {
    expect(
      describeWrite('select * from app.users', {
        command: 'SELECT',
        rowCount: 1,
        rows: [],
      }),
    ).toBeNull()
    expect(
      describeWrite('delete from app.projects where id=$1', {
        command: 'DELETE',
        rowCount: 0,
        rows: [],
      }),
    ).toBeNull()
    expect(
      describeWrite('update app.sessions set last_seen_at=now()', {
        command: 'UPDATE',
        rowCount: 1,
        rows: [],
      }),
    ).toBeNull()
    expect(
      describeWrite('update app.portal_onboarding set updated_at=now()', {
        command: 'UPDATE',
        rowCount: 1,
        rows: [],
      }),
    ).toBeNull()
  })
  it('includes new domain tables by default', () => {
    expect(
      describeWrite('insert into app.future_feature (id, title) values ($1,$2)', {
        command: 'INSERT',
        rowCount: 1,
        rows: [],
      }),
    ).toMatchObject({
      action: 'data.record.created',
      subjectType: 'future_feature',
      after: { fields: ['id', 'title'] },
    })
  })
})
