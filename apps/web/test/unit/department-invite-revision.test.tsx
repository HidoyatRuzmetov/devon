import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RealtimeMessage } from '../../src/lib/realtime/client.js'
import { useInvitePassword } from '../../src/features/departments/use-invite-refresh.js'

const listener = vi.hoisted(() => ({ receive: (_message: RealtimeMessage) => {} }))
vi.mock('../../src/lib/realtime/hooks.js', () => ({
  useChannel: (channel: string, receive: (message: RealtimeMessage, channel: string) => void) => {
    listener.receive = (message) => receive(message, channel)
  },
}))

describe('shared invitation revisions', () => {
  it('keeps the freshly returned password on its own event and hides it on a later rotation, including another tab of the same account', () => {
    const hook = renderHook(() => useInvitePassword('department', 1))
    act(() => hook.result.current[1]({ password: 'ExampleOnly123', revision: 2 }))
    act(() =>
      listener.receive({
        type: 'departments.invite.changed',
        payload: { revision: 2 },
        actorUserId: 'same-user',
      }),
    )
    expect(hook.result.current[0]).toBe('ExampleOnly123')
    act(() =>
      listener.receive({
        type: 'departments.invite.changed',
        payload: { revision: 3 },
        actorUserId: 'same-user',
      }),
    )
    expect(hook.result.current[0]).toBeNull()
    act(() => hook.result.current[1]({ password: 'ExampleLateOldResponse123', revision: 2 }))
    expect(hook.result.current[0]).toBeNull()
  })
  it('catches missed rotations through metadata reconciliation without hiding a newer local response', () => {
    const hook = renderHook(({ revision }) => useInvitePassword('department', revision), {
      initialProps: { revision: 1 },
    })
    act(() => hook.result.current[1]({ password: 'ExampleOnly123', revision: 3 }))
    act(() => hook.result.current[1]({ password: 'ExampleOlderResponse123', revision: 2 }))
    expect(hook.result.current[0]).toBe('ExampleOnly123')
    hook.rerender({ revision: 2 })
    expect(hook.result.current[0]).toBe('ExampleOnly123')
    hook.rerender({ revision: 4 })
    expect(hook.result.current[0]).toBeNull()
  })
  it('isolates passwords and revisions when switching departments and ignores late responses from the previous department', () => {
    const hook = renderHook(
      ({ departmentId, revision }) => useInvitePassword(departmentId, revision),
      {
        initialProps: { departmentId: 'first', revision: 8 },
      },
    )
    const oldReveal = hook.result.current[1]
    const oldEvent = listener.receive
    act(() => oldReveal({ password: 'ExampleFirstDepartment123', revision: 9 }))
    hook.rerender({ departmentId: 'second', revision: 1 })
    expect(hook.result.current[0]).toBeNull()
    act(() => hook.result.current[1]({ password: 'ExampleSecondDepartment123', revision: 2 }))
    expect(hook.result.current[0]).toBe('ExampleSecondDepartment123')
    act(() => {
      oldReveal({ password: 'ExampleLateFirstResponse123', revision: 10 })
      oldEvent({ type: 'departments.invite.changed', payload: { revision: 11 } })
    })
    expect(hook.result.current[0]).toBe('ExampleSecondDepartment123')
  })
})
