import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useForcedState } from '../../src/lib/forced-state.js'
import { navigate, replaceSearchParam } from '../../src/lib/router.js'

afterEach(() => {
  vi.unstubAllEnvs()
  window.history.replaceState(null, '', '/')
})

describe('useForcedState (design.md §8: ?__state= behind DEVON_E2E)', () => {
  it('is always null when DEVON_E2E is not "1", even with a valid ?__state= param', () => {
    vi.stubEnv('DEVON_E2E', '0')
    navigate('/?__state=error')
    const { result } = renderHook(() => useForcedState())
    expect(result.current).toBeNull()
  })

  it('returns the forced kind when DEVON_E2E="1" and the param is one of the five kinds', () => {
    vi.stubEnv('DEVON_E2E', '1')
    navigate('/?__state=forbidden')
    const { result } = renderHook(() => useForcedState())
    expect(result.current).toBe('forbidden')
  })

  it('ignores an unrecognised ?__state= value even when the flag is on', () => {
    vi.stubEnv('DEVON_E2E', '1')
    navigate('/?__state=not-a-real-state')
    const { result } = renderHook(() => useForcedState())
    expect(result.current).toBeNull()
  })

  it('reacts live to the param changing without a remount', () => {
    vi.stubEnv('DEVON_E2E', '1')
    navigate('/')
    const { result } = renderHook(() => useForcedState())
    expect(result.current).toBeNull()
    act(() => replaceSearchParam('__state', 'offline'))
    expect(result.current).toBe('offline')
  })
})
