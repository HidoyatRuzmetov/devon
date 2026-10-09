import * as React from 'react'
import { useT } from '@devon/i18n'
import { Pencil } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTrigger,
  IconButton,
  Input,
  toastWithUndo,
} from '@devon/ui'
import type { Milestone } from '../api.js'
import {
  useAddMilestoneMutation,
  useDeleteMilestoneMutation,
  usePatchMilestoneMutation,
} from '../hooks.js'

export function MilestoneActions({
  projectId,
  milestone,
  onDeleted,
}: {
  projectId: string
  milestone: Milestone
  onDeleted?: () => void
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState(milestone.title)
  const [dueOn, setDueOn] = React.useState(milestone.dueOn ?? '')
  const save = usePatchMilestoneMutation(projectId)
  const remove = useDeleteMilestoneMutation(projectId)
  const restore = useAddMilestoneMutation(projectId)
  const deleting = React.useRef(false)
  async function removeMilestone() {
    if (save.isPending || remove.isPending) return
    deleting.current = true
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
      deleting.current = false
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <IconButton
          onClick={() => {
            deleting.current = false
            setTitle(milestone.title)
            setDueOn(milestone.dueOn ?? '')
          }}
          aria-label={t('projectLifecycle.editMilestoneLabel', { title: milestone.title })}
          tooltip={t('projectLifecycle.editMilestone')}
        >
          <Pencil aria-hidden="true" />
        </IconButton>
      </DialogTrigger>
      <DialogContent
        title={t('projectLifecycle.editMilestone')}
        onCloseAutoFocus={(event) => {
          if (deleting.current && onDeleted) {
            event.preventDefault()
            onDeleted()
          }
        }}
      >
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!title.trim() || save.isPending || remove.isPending) return
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
              disabled={save.isPending || remove.isPending}
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-small">
            {t('projectLifecycle.milestoneDue')}
            <Input
              type="date"
              disabled={save.isPending || remove.isPending}
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-4">
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
  )
}
