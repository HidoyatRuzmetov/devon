import { describe, expect, it, vi } from 'vitest'
import type { Tx } from '@devon/db'
import { emitIdentityUpdated } from '../../../src/modules/accounts/identity-events.js'

describe('account identity updates', () => {
  it('refreshes every active department using identifiers only', async () => {
    const emit = vi.fn()
    const raw = vi.fn(async () => [
      { department_id: 'department-one' },
      { department_id: 'department-two' },
    ])
    await emitIdentityUpdated(
      { raw, emit } as unknown as Tx,
      'user-id',
      'accounts.user.avatar_updated',
    )
    expect(emit.mock.calls.map(([event]) => event)).toEqual([
      {
        type: 'accounts.user.avatar_updated',
        departmentId: 'department-one',
        payload: { userId: 'user-id' },
      },
      {
        type: 'accounts.user.avatar_updated',
        departmentId: 'department-two',
        payload: { userId: 'user-id' },
      },
    ])
  })

  it('still refreshes the personal channel for an account without a department', async () => {
    const emit = vi.fn()
    await emitIdentityUpdated(
      { raw: async () => [], emit } as unknown as Tx,
      'user-id',
      'accounts.profile.updated',
    )
    expect(emit).toHaveBeenCalledWith({
      type: 'accounts.profile.updated',
      departmentId: null,
      payload: { userId: 'user-id' },
    })
  })
})
