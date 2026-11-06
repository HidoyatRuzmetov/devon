import * as React from 'react'

/** Local, account-scoped recovery. Publishing remains an explicit server mutation. */
export function useDurableDraft<T>(
  key: string,
  initial: T,
  revision: number,
  parseDraft: (raw: unknown) => T | null,
) {
  const [restored, setRestored] = React.useState(() => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
      if (
        raw &&
        typeof raw === 'object' &&
        'value' in raw &&
        'revision' in raw &&
        typeof raw.revision === 'number'
      ) {
        const value = parseDraft(raw.value)
        if (value !== null) return { value, revision: raw.revision }
      }
    } catch {
      /* A malformed/unsupported draft cannot break the editor. */
    }
    return null
  })
  const [value, setValue] = React.useState(restored?.value ?? initial)
  const current = React.useRef(value)
  const [baseRevision, setBaseRevision] = React.useState(restored?.revision ?? revision)
  const [storageFailed, setStorageFailed] = React.useState(false)
  const update = React.useCallback(
    (next: React.SetStateAction<T>) => {
      const resolved =
        typeof next === 'function' ? (next as (previous: T) => T)(current.current) : next
      current.current = resolved
      setValue(resolved)
      try {
        localStorage.setItem(key, JSON.stringify({ value: resolved, revision: baseRevision }))
        setStorageFailed(false)
      } catch {
        setStorageFailed(true)
      }
    },
    [key, baseRevision],
  )
  const [resetKey, setResetKey] = React.useState(0)
  const discard = () => {
    setResetKey((key) => key + 1)
    setRestored(null)
    current.current = initial
    setValue(initial)
    setBaseRevision(revision)
    try {
      localStorage.removeItem(key)
      setStorageFailed(false)
    } catch {
      setStorageFailed(true)
    }
  }
  const acknowledge = (submitted: T, nextRevision: number) => {
    setBaseRevision(nextRevision)
    try {
      if (JSON.stringify(current.current) === JSON.stringify(submitted))
        localStorage.removeItem(key)
      else
        localStorage.setItem(
          key,
          JSON.stringify({ value: current.current, revision: nextRevision }),
        )
    } catch {
      setStorageFailed(true)
    }
  }
  return {
    value,
    update,
    baseRevision,
    storageFailed,
    restored: !!restored,
    resetKey,
    discard,
    acknowledge,
  }
}
