import * as React from 'react'
import { ApiError } from './api-client.js'

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'

/** One record's autosaves are ordered and coalesced. A failed save retains its exact fields for
 * an explicit retry; a later field save never reuses a version from before the previous response. */
export function useQueuedSave<T extends { version: number }, P extends { version: number }>(
  record: T | null,
  save: (patch: P) => Promise<T>,
  onSaved?: (updated: T, patch: Omit<P, 'version'>) => void,
) {
  type Draft = Omit<P, 'version'>
  const base = React.useRef(record)
  const pending = React.useRef<{ fields: Draft; version: number } | null>(null)
  const ownVersions = React.useRef<{ from: number; to: number } | null>(null)
  const running = React.useRef<Promise<boolean> | null>(null)
  const saveRef = React.useRef(save)
  const onSavedRef = React.useRef(onSaved)
  const mounted = React.useRef(true)
  const [state, setState] = React.useState<SaveState>('idle')
  const stateRef = React.useRef<SaveState>('idle')

  const showState = React.useCallback((next: SaveState) => {
    stateRef.current = next
    if (mounted.current) setState(next)
  }, [])

  React.useLayoutEffect(() => {
    if (record && (!base.current || record.version >= base.current.version)) base.current = record
    saveRef.current = save
    onSavedRef.current = onSaved
  }, [record, save, onSaved])
  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const flush = React.useCallback((): Promise<boolean> => {
    if (running.current) return running.current
    if (!pending.current) return Promise.resolve(true)
    showState('saving')
    const operation = Promise.resolve()
      .then(async () => {
        while (pending.current) {
          const desired = pending.current
          pending.current = null
          if (!base.current) {
            pending.current = desired
            showState('error')
            return false
          }
          const previous = base.current as Record<string, unknown>
          const own = ownVersions.current
          const version =
            own && desired.version >= own.from && desired.version <= own.to
              ? own.to
              : desired.version
          const fields = Object.fromEntries(
            Object.entries(desired.fields).filter(
              ([key, value]) => JSON.stringify(value) !== JSON.stringify(previous[key]),
            ),
          ) as Draft
          if (Object.keys(fields).length === 0) {
            onSavedRef.current?.(base.current, desired.fields)
            continue
          }
          try {
            // nosemgrep: query-in-loop -- Each queued write requires the previous acknowledged version.
            const updated = await saveRef.current({ ...fields, version } as P)
            ownVersions.current = {
              from: own?.to === version ? own.from : version,
              to: updated.version,
            }
            if (!base.current || updated.version >= base.current.version) base.current = updated
            onSavedRef.current?.(updated, fields)
          } catch (error) {
            const newer = pending.current as { fields: Draft; version: number } | null
            pending.current = {
              fields: Object.assign({}, fields, newer?.fields) as Draft,
              version: newer ? Math.min(desired.version, newer.version) : desired.version,
            }
            showState(error instanceof ApiError && error.status === 409 ? 'conflict' : 'error')
            return false
          }
        }
        showState('saved')
        return true
      })
      .finally(() => {
        running.current = null
      })
    running.current = operation
    return operation
  }, [showState])

  const enqueue = React.useCallback(
    (patch: Draft, version: number) => {
      if (Object.keys(patch).length === 0)
        return running.current ?? Promise.resolve(!pending.current)
      pending.current = {
        fields: { ...pending.current?.fields, ...patch },
        version: pending.current ? Math.min(pending.current.version, version) : version,
      }
      // Further typing retains the draft. Only an explicit retry may cross a remote revision.
      if (stateRef.current === 'conflict' || stateRef.current === 'error')
        return Promise.resolve(false)
      return flush()
    },
    [flush],
  )
  const retry = React.useCallback(
    (patch: Draft) => {
      if (!base.current) return Promise.resolve(false)
      pending.current = {
        fields: { ...pending.current?.fields, ...patch },
        version: base.current.version,
      }
      return flush()
    },
    [flush],
  )
  return { state, enqueue, retry, isPending: state === 'saving' }
}
