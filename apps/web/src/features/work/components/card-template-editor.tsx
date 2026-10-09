import * as React from 'react'
import { cardTemplatePayloadSchema } from '@devon/contracts'
import { useT } from '@devon/i18n'
import { Button, Dialog, DialogContent, Field, Input, Select, Textarea, toast } from '@devon/ui'
import { useCreateTemplateMutation, usePatchTemplateMutation } from '../hooks-plus.js'
import type { WorkTemplate } from '../api-plus.js'

interface CardTemplateEditorProps {
  template: WorkTemplate | null
  isHead: boolean
  onClose: () => void
  onCloseAutoFocus: (event: Event) => void
}

/** Opening an editor creates a draft. Query refreshes may update untouched payload metadata,
 * but they must never replace the name/title/checklist somebody is currently typing. */
export function CardTemplateEditor({
  template,
  isHead,
  onClose,
  onCloseAutoFocus,
}: CardTemplateEditorProps): React.JSX.Element {
  const t = useT()
  const id = React.useId()
  const create = useCreateTemplateMutation()
  const patch = usePatchTemplateMutation()
  const [name, setName] = React.useState(template?.name ?? '')
  const [scope, setScope] = React.useState<'personal' | 'department'>(template?.scope ?? 'personal')
  const [title, setTitle] = React.useState(
    typeof template?.payload['title'] === 'string' ? template.payload['title'] : '',
  )
  const [checklist, setChecklist] = React.useState(
    Array.isArray(template?.payload['checklist'])
      ? template.payload['checklist']
          .filter((item): item is string => typeof item === 'string')
          .join('\n')
      : '',
  )
  const [error, setError] = React.useState<'invalid' | 'saveFailed' | null>(null)
  const busyRef = React.useRef(false)
  const busy = create.isPending || patch.isPending

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (busyRef.current) return
    const payload = {
      ...(template?.payload ?? {}),
      title: title.trim(),
      checklist: checklist
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean),
    }
    if (
      !name.trim() ||
      name.trim().length > 120 ||
      !cardTemplatePayloadSchema.safeParse(payload).success
    ) {
      setError('invalid')
      return
    }
    busyRef.current = true
    setError(null)
    try {
      if (template)
        await patch.mutateAsync({ id: template.id, patch: { name: name.trim(), scope, payload } })
      else await create.mutateAsync({ kind: 'card', name: name.trim(), scope, payload })
      toast.success(t('work.templateEditor.saved'))
      onClose()
    } catch {
      setError('saveFailed')
    } finally {
      busyRef.current = false
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busyRef.current) onClose()
      }}
    >
      <DialogContent
        title={t(template ? 'work.templateEditor.editTitle' : 'work.templateEditor.new')}
        className="w-[calc(100vw-2rem)] max-w-140 [overflow-wrap:anywhere]"
        showClose={!busy}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          if (busyRef.current) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (busyRef.current) event.preventDefault()
        }}
      >
        <form onSubmit={(event) => void save(event)} className="mt-4 flex min-w-0 flex-col gap-4">
          <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
            <Field label={t('work.templateEditor.name')} htmlFor={`${id}-name`}>
              <Input
                id={`${id}-name`}
                value={name}
                maxLength={120}
                required
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label={t('work.templateEditor.scope')} htmlFor={`${id}-scope`}>
              <Select
                id={`${id}-scope`}
                value={scope}
                onChange={(event) => setScope(event.target.value as 'personal' | 'department')}
                options={[
                  { value: 'personal', label: t('work.templates.scopePersonal') },
                  ...(isHead
                    ? [{ value: 'department', label: t('work.templates.scopeDepartment') }]
                    : []),
                ]}
              />
            </Field>
            <Field label={t('work.templateEditor.cardTitle')} htmlFor={`${id}-title`}>
              <Input
                id={`${id}-title`}
                value={title}
                maxLength={300}
                required
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field
              label={t('work.templateEditor.checklist')}
              htmlFor={`${id}-checklist`}
              hint={t('work.templateEditor.checklistHint')}
            >
              <Textarea
                id={`${id}-checklist`}
                value={checklist}
                rows={5}
                onChange={(event) => setChecklist(event.target.value)}
              />
            </Field>
          </fieldset>
          {error ? (
            <p role="alert" className="text-small text-destructive">
              {t(`work.templateEditor.${error}`)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {t('common.save')}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
