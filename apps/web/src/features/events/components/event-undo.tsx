import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import { Button, toast } from '@devon/ui'
import type { Me } from '../../../lib/api-schemas.js'
import { useMeQuery } from '../../../lib/session.js'

/** An event's interactive Undo belongs inside its modal. A global toast outside the modal
 * inherits the disabled page's pointer boundary, so a visible button there cannot be used. */
export function useEventUndo() {
  const t = useT()
  const queryClient = useQueryClient()
  const { data: me } = useMeQuery()
  const mounted = React.useRef(false)
  const generation = React.useRef(0)
  const [undo, setUndo] = React.useState<{
    message: string
    successMessage: string
    isCurrent: () => boolean
    action: () => Promise<unknown>
  } | null>(null)
  const [pending, setPending] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current += 1
    }
  }, [])

  const clear = React.useCallback(() => {
    generation.current += 1
    setUndo(null)
    setPending(false)
    setFailed(false)
  }, [])
  React.useEffect(clear, [
    clear,
    me?.user.id,
    me?.activeDepartmentId,
    me?.actingForUserId,
    me?.csrfToken,
  ])

  const captureScope = () => {
    const submitted = queryClient.getQueryData<Me | null>(['me'])
    return () => {
      const current = queryClient.getQueryData<Me | null>(['me'])
      return Boolean(
        mounted.current &&
        submitted &&
        current &&
        submitted.user.id === current.user.id &&
        submitted.activeDepartmentId === current.activeDepartmentId &&
        submitted.actingForUserId === current.actingForUserId &&
        submitted.csrfToken === current.csrfToken,
      )
    }
  }

  const show = (value: NonNullable<typeof undo>) => {
    if (!value.isCurrent()) return
    generation.current += 1
    setPending(false)
    setFailed(false)
    setUndo(value)
  }
  const handleUndo = async () => {
    if (!undo || pending || !undo.isCurrent()) return
    const commandGeneration = generation.current
    setPending(true)
    setFailed(false)
    try {
      await undo.action()
      if (!undo.isCurrent() || commandGeneration !== generation.current) return
      clear()
      toast(undo.successMessage)
    } catch {
      if (!undo.isCurrent() || commandGeneration !== generation.current) return
      setPending(false)
      setFailed(true)
    }
  }

  return {
    captureScope,
    clear,
    show,
    feedback: undo?.isCurrent() ? (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted p-3">
        <p role="status" className="text-small text-foreground">
          {failed ? t('events.error.body') : undo.message}
        </p>
        <Button size="sm" variant="secondary" loading={pending} onClick={handleUndo}>
          {t('events.actions.undo')}
        </Button>
      </div>
    ) : null,
  }
}
