import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { WORK_TITLE_MAX, checkinCreateTaskSchema } from '@devon/contracts'
import { useT } from '@devon/i18n'
import { Button, Dialog, DialogContent, Input, Textarea, toast } from '@devon/ui'
import { z } from 'zod'
import { useCsrfToken } from '../work/hooks.js'
import { apiClient } from '../../lib/api-client.js'

export function CheckinCreateTask({
  cycleId,
  memberUserId,
  memberName,
  onClose,
  onCreated,
}: {
  cycleId: string
  memberUserId: string
  memberName: string
  onClose: () => void
  onCreated: () => void
}) {
  const t = useT(),
    qc = useQueryClient(),
    csrf = useCsrfToken()
  const [operationId] = React.useState(() => crypto.randomUUID())
  const [title, setTitle] = React.useState('')
  const [priority, setPriority] = React.useState<'none' | 'low' | 'medium' | 'high' | 'urgent'>(
    'none',
  )
  const [checklist, setChecklist] = React.useState('')
  const payload = checkinCreateTaskSchema.safeParse({
    operationId,
    title,
    priority,
    checklist: checklist
      .split('\n')
      .map((v) => v.trim())
      .filter(Boolean),
  })
  const create = useMutation({
    mutationFn: () => {
      if (!payload.success) throw new Error('invalid_task')
      return apiClient.post(
        `/api/v1/checkins/cycles/${cycleId}/members/${memberUserId}/tasks`,
        payload.data,
        z.object({ id: z.string().uuid() }),
        csrf,
      )
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['checkins'] }),
        qc.invalidateQueries({ queryKey: ['work'] }),
      ])
      toast.success(t('checkins.added'))
      onCreated()
    },
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !create.isPending) onClose()
      }}
    >
      <DialogContent title={t('checkinTask.create')}>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (payload.success && !create.isPending) create.mutate()
          }}
        >
          <p className="text-small text-muted-foreground">
            {t('checkinTask.forPerson', { name: memberName })}
          </p>
          <fieldset disabled={create.isPending} className="space-y-4">
            <label className="block space-y-1.5 text-small">
              <span>{t('work.field.title')}</span>
              <Input
                required
                maxLength={WORK_TITLE_MAX}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="block space-y-1.5 text-small">
              <span>{t('work.field.priority')}</span>
              <select
                className="h-10 w-full rounded-md border border-border bg-card px-3"
                value={priority}
                onChange={(event) => setPriority(event.target.value as typeof priority)}
              >
                {(['none', 'low', 'medium', 'high', 'urgent'] as const).map((value) => (
                  <option key={value} value={value}>
                    {t(`work.priority.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5 text-small">
              <span>{t('checkinTask.deliverables')}</span>
              <Textarea
                rows={4}
                required
                value={checklist}
                onChange={(event) => setChecklist(event.target.value)}
                placeholder={t('checkinTask.onePerLine')}
              />
            </label>
          </fieldset>
          {create.isError ? (
            <p role="alert" className="text-small text-destructive">
              {t('checkins.saveError')}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={create.isPending} onClick={onClose}>
              {t('checkins.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={!payload.success || create.isPending}
              loading={create.isPending}
            >
              {t('checkinTask.createAndAdd')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
