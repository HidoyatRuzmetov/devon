import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, Dialog, DialogContent, Input, toastWithUndo } from '@devon/ui'
import type { Milestone } from '../api.js'
import {
  useAddMilestoneMutation,
  useDeleteMilestoneMutation,
  usePatchMilestoneMutation,
} from '../hooks.js'

export function MilestoneActions({
  projectId,
  milestone,
}: {
  projectId: string
  milestone: Milestone
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState(milestone.title)
  const [dueOn, setDueOn] = React.useState(milestone.dueOn ?? '')
  const save = usePatchMilestoneMutation(projectId)
  const remove = useDeleteMilestoneMutation(projectId)
  const restore = useAddMilestoneMutation(projectId)
  async function removeMilestone() {
    try {
      await remove.mutateAsync(milestone.id)
      setOpen(false)
      toastWithUndo({
        message: t('projectLifecycle.milestoneDeleted'),
        undoLabel: t('action.undo'),
        durationMs: 20_000,
        onUndo: () =>
          restore.mutate({
            title: milestone.title,
            dueOn: milestone.dueOn,
            done: milestone.doneAt !== null,
          }),
      })
    } catch {
      /* The mutation hook reports the error. */
    }
  }
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setTitle(milestone.title)
          setDueOn(milestone.dueOn ?? '')
          setOpen(true)
        }}
        aria-label={t('projectLifecycle.editMilestoneLabel', { title: milestone.title })}
      >
        {t('projectLifecycle.editMilestone')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t('projectLifecycle.editMilestone')}>
          <form
            className="mt-4 flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              save.mutate(
                { milestoneId: milestone.id, patch: { title: title.trim(), dueOn: dueOn || null } },
                {
                  onSuccess: () => setOpen(false),
                },
              )
            }}
          >
            <label className="flex flex-col gap-1 text-small">
              {t('projectLifecycle.milestoneTitle')}
              <Input
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-small">
              {t('projectLifecycle.milestoneDue')}
              <Input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
            </label>
            <div className="flex justify-between gap-3">
              <Button
                variant="secondary"
                type="button"
                disabled={save.isPending || remove.isPending}
                onClick={() => void removeMilestone()}
              >
                {t('projectLifecycle.deleteMilestone')}
              </Button>
              <Button
                type="submit"
                disabled={!title.trim() || remove.isPending}
                loading={save.isPending}
              >
                {t('work.action.save')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
