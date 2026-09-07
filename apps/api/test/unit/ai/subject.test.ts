// `featureRunSubject` decides which `Subject` (`@devon/contracts`) `POST /ai/features/:feature/run`
// checks `can()` against -- I-1 requires `plan_sprint` (the one personal-workspace feature) to be
// `{kind:'personal'}`, never `department_child`, regardless of which department its budget/flag bill
// against. A pure-function test: no Fastify app, no Postgres.
import { describe, expect, it } from 'vitest'
import { featureRunSubject } from '../../../src/modules/ai/index.js'
import { AI_FEATURE_IDS } from '../../../src/modules/ai/schemas.js'

// A minimal Fastify-request-shaped stand-in -- `featureRunSubject` only ever reads
// `.params.feature`/`.actor.userId`/`.actor.departmentId`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeRequest(feature: string, userId: string, departmentId: string | null): any {
  return {
    params: { feature },
    actor: { userId, departmentId, viewAs: null },
  }
}

describe('featureRunSubject', () => {
  it('is {kind: personal, ownerUserId} for plan_sprint (I-1: the one personal-workspace feature)', () => {
    const subject = featureRunSubject(fakeRequest('plan_sprint', 'user-1', 'dept-1'))
    expect(subject).toEqual({ kind: 'personal', ownerUserId: 'user-1' })
  })

  it('ignores departmentId entirely for plan_sprint, even when null', () => {
    const subject = featureRunSubject(fakeRequest('plan_sprint', 'user-1', null))
    expect(subject).toEqual({ kind: 'personal', ownerUserId: 'user-1' })
  })

  for (const feature of AI_FEATURE_IDS.filter((f) => f !== 'plan_sprint')) {
    it(`is {kind: department_child, departmentId} for ${feature}`, () => {
      const subject = featureRunSubject(fakeRequest(feature, 'user-1', 'dept-1'))
      expect(subject).toEqual({ kind: 'department_child', departmentId: 'dept-1' })
    })
  }
})
