import * as React from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useScopeTransition } from '../../src/features/work/lib/use-scope-transition.js'

function surfaceHarness() {
  const surface = document.createElement('div')
  surface.style.opacity = '1'
  surface.dataset['scopeTestSurface'] = 'true'
  document.body.append(surface)
  const animations: { frames: Keyframe[]; finish: () => void; cancel: ReturnType<typeof vi.fn> }[] =
    []
  surface.animate = vi.fn((frames: Keyframe[] | PropertyIndexedKeyframes | null) => {
    let resolve!: () => void
    let reject!: () => void
    const finished = new Promise<void>((yes, no) => {
      resolve = yes
      reject = no
    })
    const keyframes = frames as Keyframe[]
    const cancel = vi.fn(() => {
      surface.style.opacity = '1'
      reject()
    })
    const entry = {
      frames: keyframes,
      finish: () => {
        surface.style.opacity = String(keyframes.at(-1)!['opacity'])
        resolve()
      },
      cancel,
    }
    animations.push(entry)
    return { finished, cancel } as unknown as Animation
  }) as typeof surface.animate
  return { surface, ref: { current: surface }, animations }
}

afterEach(() => {
  vi.restoreAllMocks()
  document.querySelectorAll('[data-scope-test-surface]').forEach((surface) => surface.remove())
})

describe('scope surface transitions', () => {
  it('reverses an outgoing fade from its visible opacity without committing a stale scope', async () => {
    const { surface, ref, animations } = surfaceHarness()
    const commit = vi.fn()
    const hook = renderHook(() => useScopeTransition<string>('all', commit, ref))
    let outgoing!: Promise<void>
    act(() => {
      outgoing = hook.result.current('mine')
    })
    surface.style.opacity = '0.42'
    let restore!: Promise<void>
    act(() => {
      restore = hook.result.current('all')
    })
    expect(animations[0]!.cancel).toHaveBeenCalledOnce()
    expect(animations[1]!.frames).toEqual([{ opacity: 0.42 }, { opacity: 1 }])
    await act(async () => {
      animations[1]!.finish()
      await restore
      await outgoing
    })
    expect(commit).not.toHaveBeenCalled()
    expect(surface.style.opacity).toBe('1')
  })

  it('interrupts an incoming fade continuously and commits only at the invisible midpoint', async () => {
    const { surface, ref, animations } = surfaceHarness()
    const hook = renderHook(() => {
      const [value, setValue] = React.useState('all')
      return { value, change: useScopeTransition(value, setValue, ref) }
    })
    let first!: Promise<void>
    act(() => {
      first = hook.result.current.change('mine')
    })
    expect(hook.result.current.value).toBe('all')
    await act(async () => {
      animations[0]!.finish()
    })
    expect(hook.result.current.value).toBe('mine')
    surface.style.opacity = '0.24'
    let reverse!: Promise<void>
    act(() => {
      reverse = hook.result.current.change('all')
    })
    expect(animations[2]!.frames).toEqual([{ opacity: 0.24 }, { opacity: 0 }])
    expect(hook.result.current.value).toBe('mine')
    await act(async () => {
      animations[2]!.finish()
    })
    expect(hook.result.current.value).toBe('all')
    await act(async () => {
      animations[3]!.finish()
      await reverse
      await first
    })
    expect(surface.style.opacity).toBe('1')
  })

  it('does not overwrite an external navigation with a queued scope change', async () => {
    const { surface, ref, animations } = surfaceHarness()
    const commit = vi.fn()
    const hook = renderHook(({ value }) => useScopeTransition(value, commit, ref), {
      initialProps: { value: 'all' },
    })
    let pending!: Promise<void>
    act(() => {
      pending = hook.result.current('mine')
    })
    surface.style.opacity = '0.35'
    hook.rerender({ value: 'filtered' })
    expect(animations[1]!.frames).toEqual([{ opacity: 0.35 }, { opacity: 1 }])
    await act(async () => {
      animations[1]!.finish()
      await pending
    })
    expect(commit).not.toHaveBeenCalled()
  })

  it('cancels queued commits on unmount', async () => {
    const { ref, animations } = surfaceHarness()
    const commit = vi.fn()
    const hook = renderHook(() => useScopeTransition<string>('all', commit, ref))
    let pending!: Promise<void>
    act(() => {
      pending = hook.result.current('mine')
    })
    hook.unmount()
    await pending
    expect(animations[0]!.cancel).toHaveBeenCalledOnce()
    expect(commit).not.toHaveBeenCalled()
  })

  it('commits immediately without animations when reduced motion is enabled', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    const { ref, animations } = surfaceHarness()
    const commit = vi.fn()
    const hook = renderHook(() => useScopeTransition<string>('all', commit, ref))
    await act(async () => {
      await hook.result.current('mine')
    })
    expect(commit).toHaveBeenCalledWith('mine')
    expect(animations).toHaveLength(0)
  })
})
