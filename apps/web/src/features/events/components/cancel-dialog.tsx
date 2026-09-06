// Cancel flow (TECH-SPEC §3.4: "cancel flow notifying RSVPed members"). A reason is required --
// `service.ts`'s `cancelEvent` sends it to everyone who RSVPed, so a blank reason would ship a blank
// notification.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, Dialog, DialogClose, DialogContent, toast } from '@devon/ui'
import { useCancelEventMutation } from '../hooks.js'
import { Field, Textarea } from './form-controls.js'

export function CancelDialog({
  open,
  onOpenChange,
  eventId,
  onCancelled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  eventId: string
  onCancelled: () => void
}) {
  const t = useT()
  const mutation = useCancelEventMutation(eventId)
  const [reason, setReason] = React.useState('')

  React.useEffect(() => {
    if (open) setReason('')
  }, [open])

  const handleConfirm = async () => {
    if (!reason.trim()) return
    try {
      await mutation.mutateAsync(reason.trim())
      onOpenChange(false)
      onCancelled()
      toast(t('events.actions.cancelEvent'))
    } catch {
      toast(t('events.error.title'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('events.cancelDialog.title')} className="max-w-110">
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-body text-muted-foreground">{t('events.cancelDialog.body')}</p>
          <Field label={t('events.cancelDialog.reasonLabel')} htmlFor="cancel-reason">
            <Textarea
              id="cancel-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('events.cancelDialog.reasonPlaceholder')}
              maxLength={1000}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">{t('events.cancelDialog.keepEvent')}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              loading={mutation.isPending}
              disabled={!reason.trim()}
            >
              {t('events.cancelDialog.confirm')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
