// "A project template creates the objective task list in one click" (EPIC-005 outcome) plus a plain
// from-scratch project -- one dialog, two tabs' worth of fields shown/hidden by a toggle rather than
// two separate dialogs, since they share every field except which endpoint ends up called.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, Dialog, DialogContent, DialogTrigger, Input, toast } from '@devon/ui'
import { useMembers } from '../../work/hooks.js'
import { fullName } from '../../work/lib/format.js'
import {
  useCreateFromTemplateMutation,
  useCreateProjectMutation,
  useTemplatesQuery,
} from '../hooks.js'

export function CreateProjectDialog() {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [mode, setMode] = React.useState<'scratch' | 'template'>('template')
  const [title, setTitle] = React.useState('')
  const [ownerUserId, setOwnerUserId] = React.useState('')
  const [memberIds, setMemberIds] = React.useState<string[]>([])
  const [templateKey, setTemplateKey] = React.useState('')

  const members = useMembers()
  const templatesData = useTemplatesQuery().data
  const templates = templatesData ?? []
  const createProject = useCreateProjectMutation()
  const createFromTemplate = useCreateFromTemplateMutation()

  React.useEffect(() => {
    if (templatesData && templatesData.length > 0 && !templateKey)
      setTemplateKey(templatesData[0]!.key)
  }, [templatesData, templateKey])

  function toggleMember(id: string) {
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]))
  }

  function reset() {
    setTitle('')
    setOwnerUserId('')
    setMemberIds([])
  }

  async function submit() {
    if (!ownerUserId || memberIds.length === 0) return
    try {
      if (mode === 'template') {
        await createFromTemplate.mutateAsync({
          templateKey,
          title: title.trim() || undefined,
          ownerUserId,
          members: Array.from(new Set([ownerUserId, ...memberIds])),
        })
      } else {
        if (!title.trim()) return
        await createProject.mutateAsync({
          title: title.trim(),
          ownerUserId,
          members: Array.from(new Set([ownerUserId, ...memberIds])),
        })
      }
      toast(t('projects.create.success'))
      reset()
      setOpen(false)
    } catch {
      toast(t('projects.create.error'))
    }
  }

  const pending = createProject.isPending || createFromTemplate.isPending

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">{t('projects.create.button')}</Button>
      </DialogTrigger>
      <DialogContent title={t('projects.create.title')} className="max-w-140">
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={mode === 'template' ? 'primary' : 'secondary'}
              onClick={() => setMode('template')}
            >
              {t('projects.create.fromTemplate')}
            </Button>
            <Button
              size="sm"
              variant={mode === 'scratch' ? 'primary' : 'secondary'}
              onClick={() => setMode('scratch')}
            >
              {t('projects.create.fromScratch')}
            </Button>
          </div>

          {mode === 'template' ? (
            <label className="flex flex-col gap-1.5 text-small">
              <span className="text-caption font-medium text-muted-foreground">
                {t('projects.field.template')}
              </span>
              <select
                value={templateKey}
                onChange={(e) => setTemplateKey(e.target.value)}
                className="h-11 rounded-sm border border-border bg-card px-3"
              >
                {templates.map((tpl) => (
                  <option key={tpl.key} value={tpl.key}>
                    {tpl.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="flex flex-col gap-1.5 text-small">
            <span className="text-caption font-medium text-muted-foreground">
              {t('projects.field.title')}
            </span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('projects.field.titlePlaceholder')}
            />
          </label>

          <label className="flex flex-col gap-1.5 text-small">
            <span className="text-caption font-medium text-muted-foreground">
              {t('projects.field.owner')}
            </span>
            <select
              value={ownerUserId}
              onChange={(e) => setOwnerUserId(e.target.value)}
              className="h-11 rounded-sm border border-border bg-card px-3"
            >
              <option value="" disabled>
                {t('projects.field.ownerPlaceholder')}
              </option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {fullName(m)}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1.5 text-small">
            <span className="text-caption font-medium text-muted-foreground">
              {t('projects.field.members')}
            </span>
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-sm border border-border p-2">
              {members.map((m) => (
                <label key={m.userId} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={memberIds.includes(m.userId)}
                    onChange={() => toggleMember(m.userId)}
                  />
                  {fullName(m)}
                </label>
              ))}
            </div>
          </div>

          <Button
            onClick={() => void submit()}
            loading={pending}
            disabled={!ownerUserId || memberIds.length === 0}
          >
            {t('projects.create.submit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
