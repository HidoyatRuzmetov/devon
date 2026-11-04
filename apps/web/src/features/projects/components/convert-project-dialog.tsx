import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogTrigger,
  IconButton,
  toast,
} from '@devon/ui'
import { FolderPlus } from 'lucide-react'
import { useMeQuery } from '../../../lib/session.js'
import { navigate } from '../../../lib/router.js'
import { useMembers } from '../../work/hooks.js'
import { fullName } from '../../work/lib/format.js'
import { createProjectFromCard } from '../api.js'

/** The caller renders this only for editable, ungrouped cards. Server rechecks both conditions. */
export function ConvertProjectDialog({
  cardId,
  iconOnly = false,
  open: controlledOpen,
  onOpenChange,
}: {
  cardId: string
  iconOnly?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const t = useT()
  const [localOpen, setLocalOpen] = React.useState(false)
  const open = controlledOpen ?? localOpen
  const setOpen = onOpenChange ?? setLocalOpen
  const [selected, setSelected] = React.useState<string[]>([])
  const me = useMeQuery().data
  const members = useMembers()
  const qc = useQueryClient()
  const checkboxPrefix = React.useId()
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!convert.isPending) setOpen(next)
      }}
    >
      {controlledOpen === undefined ? (
        <DialogTrigger asChild>
          {iconOnly ? (
            <IconButton
              aria-label={t('projectEdit.convert')}
              tooltip={t('projectEdit.convert')}
              onClick={() => {
                setSelected([])
                convert.reset()
              }}
            >
              <FolderPlus />
            </IconButton>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSelected([])
                convert.reset()
              }}
            >
              {t('projectEdit.convert')}
            </Button>
          )}
        </DialogTrigger>
      ) : null}
      <DialogContent title={t('projectEdit.convert')} className="max-w-120">
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-small text-muted-foreground">{t('projectEdit.convertHint')}</p>
          <fieldset
            disabled={convert.isPending}
            className="flex max-h-64 flex-col gap-2 overflow-y-auto"
          >
            <legend className="mb-2 text-small font-medium">{t('projects.field.members')}</legend>
            {members.map((m) => (
              <div key={m.userId} className="flex min-h-11 items-center gap-2 text-small">
                <Checkbox
                  id={`${checkboxPrefix}-${m.userId}`}
                  disabled={m.userId === me?.user.id}
                  checked={m.userId === me?.user.id || selected.includes(m.userId)}
                  onCheckedChange={(checked) =>
                    setSelected(
                      checked === true
                        ? [...selected, m.userId]
                        : selected.filter((id) => id !== m.userId),
                    )
                  }
                />
                <label
                  htmlFor={`${checkboxPrefix}-${m.userId}`}
                  className="min-w-0 flex-1 break-words"
                >
                  {fullName(m)}
                </label>
              </div>
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
  )
}
