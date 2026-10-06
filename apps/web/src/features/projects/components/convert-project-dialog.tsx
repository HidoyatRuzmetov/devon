import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import { Button, Dialog, DialogContent, toast } from '@devon/ui'
import { useMeQuery } from '../../../lib/session.js'
import { navigate } from '../../../lib/router.js'
import { useMembers } from '../../work/hooks.js'
import { fullName } from '../../work/lib/format.js'
import { createProjectFromCard } from '../api.js'

/** The caller renders this only for editable, ungrouped cards. Server rechecks both conditions. */
export function ConvertProjectDialog({ cardId }: { cardId: string }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [selected, setSelected] = React.useState<string[]>([])
  const me = useMeQuery().data
  const members = useMembers()
  const qc = useQueryClient()
  const convert = useMutation({
    mutationFn: () =>
      createProjectFromCard(cardId, [...new Set([me!.user.id, ...selected])], me!.csrfToken),
    onSuccess: (project) => {
      void qc.invalidateQueries({ queryKey: ['projects'] })
      void qc.invalidateQueries({ queryKey: ['work'] })
      setOpen(false)
      toast(t('projectEdit.converted'))
      navigate(`/projects/view?id=${encodeURIComponent(project.id)}`)
    },
  })
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {t('projectEdit.convert')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t('projectEdit.convert')} className="max-w-120">
          <div className="mt-4 flex flex-col gap-4">
            <p className="text-small text-muted-foreground">{t('projectEdit.convertHint')}</p>
            <fieldset className="flex max-h-64 flex-col gap-2 overflow-y-auto">
              <legend className="mb-2 text-small font-medium">{t('projects.field.members')}</legend>
              {members.map((m) => (
                <label key={m.userId} className="flex items-center gap-2 text-small">
                  <input
                    type="checkbox"
                    disabled={m.userId === me?.user.id}
                    checked={m.userId === me?.user.id || selected.includes(m.userId)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, m.userId]
                          : selected.filter((id) => id !== m.userId),
                      )
                    }
                  />
                  {fullName(m)}
                </label>
              ))}
            </fieldset>
            {convert.isError ? (
              <p role="alert" className="text-small text-destructive">
                {t('projectEdit.error')}
              </p>
            ) : null}
            <Button
              onClick={() => convert.mutate()}
              loading={convert.isPending}
              disabled={!me || selected.filter((id) => id !== me.user.id).length === 0}
            >
              {t('projectEdit.convert')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
