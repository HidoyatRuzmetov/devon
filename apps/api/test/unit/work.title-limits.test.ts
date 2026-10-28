import {
  WORK_TITLE_MAX,
  cardTemplatePayloadSchema,
  projectTemplatePayloadSchema,
} from '@devon/contracts'
import { describe, expect, it } from 'vitest'
import {
  addMilestoneBodySchema,
  createProjectBodySchema,
  patchProjectBodySchema,
} from '../../src/modules/projects/schemas.js'
import { createCardBodySchema, patchCardBodySchema } from '../../src/modules/work/schemas.js'

describe('work title limits across input paths', () => {
  const valid = 'A'.repeat(WORK_TITLE_MAX)
  const long = valid + 'B'
  it('accepts the boundary and rejects a longer card title on create and update', () => {
    for (const schema of [createCardBodySchema, patchCardBodySchema]) {
      expect(schema.safeParse({ title: valid }).success).toBe(true)
      expect(schema.safeParse({ title: long }).success).toBe(false)
      expect(schema.safeParse({ title: '   ' }).success).toBe(false)
    }
  })
  it('bounds project and milestone input without requiring legacy titles in unrelated updates', () => {
    const ownerUserId = 'a0000000-0000-4000-8000-000000000001'
    const base = { ownerUserId, members: [ownerUserId] }
    expect(createProjectBodySchema.safeParse({ ...base, title: valid }).success).toBe(true)
    expect(createProjectBodySchema.safeParse({ ...base, title: long }).success).toBe(false)
    expect(
      createProjectBodySchema.safeParse({
        ...base,
        title: 'Project',
        milestones: [{ title: long, dueOn: null }],
      }).success,
    ).toBe(false)
    expect(addMilestoneBodySchema.safeParse({ title: valid }).success).toBe(true)
    expect(addMilestoneBodySchema.safeParse({ title: long }).success).toBe(false)
    expect(patchProjectBodySchema.safeParse({ status: 'active' }).success).toBe(true)
    expect(patchProjectBodySchema.safeParse({ title: long }).success).toBe(false)
  })
  it('prevents new templates from bypassing title limits', () => {
    expect(cardTemplatePayloadSchema.safeParse({ title: valid }).success).toBe(true)
    expect(cardTemplatePayloadSchema.safeParse({ title: long }).success).toBe(false)
    expect(projectTemplatePayloadSchema.safeParse({ title: long }).success).toBe(false)
  })
})
