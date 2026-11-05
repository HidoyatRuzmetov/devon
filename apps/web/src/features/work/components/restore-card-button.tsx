import { RotateCcw } from 'lucide-react'
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, Dialog, DialogContent, toast } from '@devon/ui'
import type { Card } from '../api.js'
import { useRestoreCardMutation } from '../hooks.js'
import { ApiError } from '../../../lib/api-client.js'
import { useProjectRestoreDetails, useRestoreProjectAndCardMutation } from '../../projects/hooks.js'

export function RestoreCardButton({ card }: { card: Card }) {
  const t = useT()
  const restore = useRestoreCardMutation()
  const [projectPrompt, setProjectPrompt] = React.useState(false)
  const project = useProjectRestoreDetails(projectPrompt ? card.projectId : null)
  const restoreGroup = useRestoreProjectAndCardMutation()
  const denied = card.canEdit === false
  return (
    <>
      <span
        title={denied ? t('state.denied.body') : undefined}
        className={denied ? 'cursor-not-allowed' : undefined}
      >
        <Button
          size="sm"
          variant="ghost"
          disabled={denied || restore.isPending}
          aria-label={t('personWork.restoreNamed', { title: card.title })}
          onClick={(event) => {
            event.stopPropagation()
            restore.mutate(card.id, {
              onSuccess: () => toast.success(t('personWork.restored')),
              onError: (error) => {
                if (
                  card.projectId &&
                  error instanceof ApiError &&
                  error.status === 409 &&
                  error.errors.some(
                    (item) => item.path === 'project' && item.code === 'restore_project_first',
                  )
                )
                  setProjectPrompt(true)
                else toast.error(t('work.deletion.failed'))
              },
            })
          }}
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          {t(restore.isPending ? 'personWork.restoring' : 'personWork.restore')}
        </Button>
      </span>
      <Dialog
        open={projectPrompt}
        onOpenChange={(open) => {
          if (!restoreGroup.isPending) setProjectPrompt(open)
        }}
      >
        {projectPrompt ? (
          <DialogContent title={t('personWork.restoreProjectDialogTitle')}>
            <div className="space-y-4 pt-2">
              {project.isPending ? (
                <p role="status" className="text-small text-muted-foreground">
                  {t('state.loading')}
                </p>
              ) : project.isError ? (
                <Button variant="ghost" onClick={() => void project.refetch()}>
                  {t('state.error.action')}
                </Button>
              ) : project.data.canRestore ? (
                <p className="text-small text-muted-foreground">
                  {t('personWork.restoreProjectDialogBody', {
                    project: project.data.title,
                    count: project.data.cardCount,
                  })}
                </p>
              ) : (
                <p className="text-small text-muted-foreground">
                  {t('personWork.restoreProjectDialogDenied', { project: project.data.title })}
                </p>
              )}
              {restoreGroup.isError ? (
                <p role="alert" className="text-small text-destructive">
                  {t('work.deletion.failed')}
                </p>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="ghost"
                  disabled={restoreGroup.isPending}
                  onClick={() => setProjectPrompt(false)}
                >
                  {t('checkins.cancel')}
                </Button>
                {project.data?.canRestore ? (
                  <Button
                    loading={restoreGroup.isPending}
                    disabled={restoreGroup.isPending}
                    onClick={() => {
                      if (card.projectId)
                        restoreGroup.mutate(
                          { projectId: card.projectId, cardId: card.id },
                          {
                            onSuccess: () => {
                              setProjectPrompt(false)
                              toast.success(t('personWork.restored'))
                            },
                          },
                        )
                    }}
                  >
                    <RotateCcw className="size-4" aria-hidden="true" />
                    {t('personWork.restoreProjectDialogConfirm')}
                  </Button>
                ) : null}
              </div>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  )
}
