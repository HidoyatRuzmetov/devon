// A confirmation dialog for the department settings screen's destructive/high-stakes actions
// (UI-OVERHAUL.md §9.5: "every destructive action is a full dialog ... never an inline button" --
// this feature previously used `window.confirm()` for these, which is neither styled, translatable
// per-locale by this app's own catalogues, nor themeable). `typedConfirmValue`, when given, additionally
// requires typing that exact text before the confirm button enables -- the "typed confirmation" the
// recipe calls for on the true danger-zone actions (regenerating an invite, requesting deletion).
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, Dialog, DialogClose, DialogContent, Input } from '@devon/ui'

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive = false,
  loading = false,
  onConfirm,
  typedConfirmValue,
  typedConfirmLabel,
  error,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body: React.ReactNode
  confirmLabel: string
  cancelLabel: string
  destructive?: boolean
  loading?: boolean
  onConfirm: () => void
  /** When set, the confirm button stays disabled until the field below matches this exactly. */
  typedConfirmValue?: string
  typedConfirmLabel?: string
  error?: string | undefined
}) {
  const t = useT()
  const [typed, setTyped] = React.useState('')

  React.useEffect(() => {
    if (open) setTyped('')
  }, [open])

  const locked = typeof typedConfirmValue === 'string' && typed !== typedConfirmValue

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title}>
        <div className="flex flex-col gap-4">
          <div className="text-body text-muted-foreground">{body}</div>
          {loading ? (
            <p role="status" className="text-small text-muted-foreground">
              {t('departments.common.pendingAction')}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-small text-destructive">
              {error}
            </p>
          ) : null}
          {typeof typedConfirmValue === 'string' ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-small text-foreground">
                {typedConfirmLabel ?? t('departments.settings.dangerZone')}
              </span>
              <Input
                autoFocus
                disabled={loading}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={typedConfirmValue}
                className="font-mono"
              />
            </label>
          ) : null}
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">
                {loading ? t('departments.common.close') : cancelLabel}
              </Button>
            </DialogClose>
            <Button
              variant={destructive ? 'destructive' : 'primary'}
              disabled={locked || loading}
              loading={loading}
              onClick={() => {
                if (!loading && !locked) onConfirm()
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
