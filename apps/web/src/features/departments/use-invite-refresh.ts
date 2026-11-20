import * as React from 'react'
import { useChannel } from '../../lib/realtime/hooks.js'

/** Compare the committed revision with events AND polled metadata. This handles other heads,
 * other tabs, reconnects and out-of-order responses without broadcasting a password. */
export function useInvitePassword(departmentId: string, currentRevision: number | undefined) {
  const [secret, setSecret] = React.useState<{
    departmentId: string
    password: string
    revision: number
  } | null>(null)
  const newestRevision = React.useRef({ departmentId, revision: currentRevision ?? 0 })
  if (newestRevision.current.departmentId !== departmentId)
    newestRevision.current = { departmentId, revision: currentRevision ?? 0 }
  if (currentRevision !== undefined)
    newestRevision.current.revision = Math.max(newestRevision.current.revision, currentRevision)
  const clearOlder = React.useCallback(
    (revision: number) => {
      if (newestRevision.current.departmentId !== departmentId) return
      newestRevision.current.revision = Math.max(newestRevision.current.revision, revision)
      setSecret((value) =>
        value && (value.departmentId !== departmentId || value.revision < revision) ? null : value,
      )
    },
    [departmentId],
  )
  useChannel(`dept:${departmentId}`, (message, channel) => {
    if (channel !== `dept:${departmentId}`) return
    const revision = message.payload['revision']
    if (message.type === 'departments.invite.changed' && typeof revision === 'number')
      clearOlder(revision)
  })
  React.useEffect(() => {
    clearOlder(currentRevision ?? 0)
  }, [currentRevision, clearOlder])
  const reveal = (value: { password: string; revision: number }) => {
    if (newestRevision.current.departmentId !== departmentId) return
    if (value.revision < newestRevision.current.revision) return
    newestRevision.current.revision = value.revision
    setSecret({ ...value, departmentId })
  }
  return [secret?.departmentId === departmentId ? secret.password : null, reveal] as const
}
