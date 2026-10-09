import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../src/lib/api-client.js'
import { useQueuedSave } from '../../src/features/personal/lib/use-queued-save.js'

type Record = { version: number; title: string; body: string }
type Patch = { version: number; title?: string; body?: string }
const initial: Record = { version: 1, title: 'Original', body: '' }

describe('personal autosave revisions', () => {
  it('acknowledges a draft already present in the fresh server snapshot without another write', async () => {
    const save = vi.fn<(input: Patch) => Promise<Record>>()
    const acknowledge = vi.fn()
    const { result, rerender } = renderHook(
      ({ record }) => useQueuedSave<Record, Patch>(record, save, acknowledge),
      { initialProps: { record: initial } },
    )
    const remote = { ...initial, version: 2, title: 'Same desired title' }
    rerender({ record: remote })
    await act(async () => {
      expect(await result.current.enqueue({ title: remote.title }, 1)).toBe(true)
    })
    expect(save).not.toHaveBeenCalled()
    expect(acknowledge).toHaveBeenCalledWith(remote, { title: remote.title })
    expect(result.current.state).toBe('saved')
  })
  it('keeps the draft revision through a remote refresh and pauses until explicit retry', async () => {
    const save = vi
      .fn<(input: Patch) => Promise<Record>>()
      .mockRejectedValueOnce(new ApiError(409, 'conflict', null))
      .mockResolvedValueOnce({ version: 3, title: 'Latest local', body: 'Remote body' })
    const { result, rerender } = renderHook(
      ({ record }) => useQueuedSave<Record, Patch>(record, save),
      { initialProps: { record: initial } },
    )
    rerender({ record: { version: 2, title: 'Remote', body: 'Remote body' } })
    await act(async () => {
      expect(await result.current.enqueue({ title: 'Local' }, 1)).toBe(false)
    })
    expect(save).toHaveBeenLastCalledWith({ title: 'Local', version: 1 })
    expect(result.current.state).toBe('conflict')
    await act(async () => {
      expect(await result.current.enqueue({ title: 'Latest local' }, 1)).toBe(false)
    })
    expect(save).toHaveBeenCalledTimes(1)
    await act(async () => {
      expect(await result.current.retry({})).toBe(true)
    })
    expect(save).toHaveBeenLastCalledWith({ title: 'Latest local', version: 2 })
    expect(result.current.state).toBe('saved')
  })

  it('rebases only acknowledged local revisions and retains the latest queued fields', async () => {
    let release!: (record: Record) => void
    const first = new Promise<Record>((resolve) => {
      release = resolve
    })
    const save = vi
      .fn<(input: Patch) => Promise<Record>>()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ version: 3, title: 'Latest', body: 'Latest body' })
    const { result } = renderHook(() => useQueuedSave<Record, Patch>(initial, save))
    let operation!: Promise<boolean>
    act(() => {
      operation = result.current.enqueue({ body: 'Earlier' }, 1)
    })
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    act(() => {
      void result.current.enqueue({ title: 'Latest', body: 'Latest body' }, 1)
    })
    await act(async () => {
      release({ ...initial, version: 2, body: 'Earlier' })
      expect(await operation).toBe(true)
    })
    expect(save.mock.calls).toEqual([
      [{ body: 'Earlier', version: 1 }],
      [{ title: 'Latest', body: 'Latest body', version: 2 }],
    ])
  })

  it('does not cross an unseen remote revision after an acknowledged local save', async () => {
    const save = vi
      .fn<(input: Patch) => Promise<Record>>()
      .mockResolvedValueOnce({ ...initial, version: 2, title: 'Local saved' })
      .mockRejectedValueOnce(new ApiError(409, 'conflict', null))
    const { result, rerender } = renderHook(
      ({ record }) => useQueuedSave<Record, Patch>(record, save),
      { initialProps: { record: initial } },
    )
    await act(async () => {
      await result.current.enqueue({ title: 'Local saved' }, 1)
    })
    rerender({ record: { version: 3, title: 'Remote', body: 'Remote body' } })
    await act(async () => {
      await result.current.enqueue({ body: 'My earlier draft' }, 1)
    })
    expect(save).toHaveBeenLastCalledWith({ body: 'My earlier draft', version: 2 })
    expect(result.current.state).toBe('conflict')
  })

  it('finishes an already authorized queued save after unmount', async () => {
    let release!: (record: Record) => void
    const first = new Promise<Record>((resolve) => {
      release = resolve
    })
    const save = vi
      .fn<(input: Patch) => Promise<Record>>()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ version: 3, title: 'Original', body: 'Latest' })
    const { result, unmount } = renderHook(() => useQueuedSave<Record, Patch>(initial, save))
    let operation!: Promise<boolean>
    act(() => {
      operation = result.current.enqueue({ body: 'Earlier' }, 1)
    })
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    act(() => {
      void result.current.enqueue({ body: 'Latest' }, 1)
    })
    unmount()
    release({ ...initial, version: 2, body: 'Earlier' })
    expect(await operation).toBe(true)
    expect(save).toHaveBeenLastCalledWith({ body: 'Latest', version: 2 })
  })
})
