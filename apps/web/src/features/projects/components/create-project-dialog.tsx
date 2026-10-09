// "A project template creates the objective task list in one click" (EPIC-005 outcome) plus a plain
// from-scratch project -- one dialog, two tabs' worth of fields shown/hidden by a toggle rather than
// two separate dialogs, since they share every field except which endpoint ends up called.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, Checkbox, Dialog, DialogContent, DialogTrigger, Input, toast } from '@devon/ui'
import { replaceSearchParam, useSearchParams } from '../../../lib/router.js'
import { useMembers } from '../../work/hooks.js'
import { useWorkTemplatesQuery } from '../../work/hooks-plus.js'
import { fullName } from '../../work/lib/format.js'
import { useActor } from '../../../lib/can.js'
import {
  useCreateFromTemplateMutation,
  useCreateFromGalleryMutation,
  useCreateProjectMutation,
  useTemplatesQuery,
} from '../hooks.js'

export function CreateProjectDialog() {
  const t = useT()
  const actor = useActor()
  const head = actor?.memberships.some(
    (m) => m.departmentId === actor.departmentId && m.role === 'head',
  )
  const [open, setOpen] = React.useState(false)
  // v1.1 SPEC §7.2 adds a third source: the department/personal project templates the head curates
  // in `/work/templates`, alongside the built-in ones v1.0 shipped.
  const [mode, setMode] = React.useState<'scratch' | 'template' | 'gallery'>('scratch')
  const [title, setTitle] = React.useState('')
  const [ownerUserId, setOwnerUserId] = React.useState(actor?.userId ?? '')
  const [memberIds, setMemberIds] = React.useState<string[]>([])
  const [templateKey, setTemplateKey] = React.useState('')
  const [galleryId, setGalleryId] = React.useState('')

  const members = useMembers()
  const templatesData = useTemplatesQuery().data
  const templates = templatesData ?? []
  const createProject = useCreateProjectMutation()
  const createFromTemplate = useCreateFromTemplateMutation()
  const createFromGallery = useCreateFromGalleryMutation()
  const submitting = React.useRef(false)
  const galleryData = useWorkTemplatesQuery('project').data
  const galleryTemplates = React.useMemo(() => galleryData ?? [], [galleryData])
  const search = useSearchParams()

  // The gallery's "Create a project" button navigates here with the template already chosen
  // (`/projects?new=1&template=<id>`), so the stepper opens on that template rather than making
  // somebody find it a second time.
  const newParam = search.get('new')
  const templateParam = search.get('template')
  React.useEffect(() => {
    if (newParam !== '1') return
    setOpen(true)
    replaceSearchParam('new', null)
    if (templateParam) {
      setMode('gallery')
      setGalleryId(templateParam)
      replaceSearchParam('template', null)
    }
  }, [newParam, templateParam])

  React.useEffect(() => {
    if (galleryTemplates.length > 0 && !galleryId) setGalleryId(galleryTemplates[0]!.id)
  }, [galleryTemplates, galleryId])

  React.useEffect(() => {
    if (templatesData && templatesData.length > 0 && !templateKey)
      setTemplateKey(templatesData[0]!.key)
  }, [templatesData, templateKey])

  function toggleMember(id: string) {
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]))
  }

  function reset() {
    setTitle('')
    setOwnerUserId(actor?.userId ?? '')
    setMemberIds([])
  }

  async function submit() {
    if (!ownerUserId || submitting.current) return
    submitting.current = true
    try {
      if (mode === 'gallery') {
        await createFromGallery.mutateAsync({
          templateId: galleryId,
          ...(title.trim() ? { title: title.trim() } : {}),
          ownerUserId,
          members: Array.from(new Set([ownerUserId, ...memberIds])),
        })
      } else if (mode === 'template') {
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
    } finally {
      submitting.current = false
    }
  }

  const pending =
    createProject.isPending || createFromTemplate.isPending || createFromGallery.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting.current) setOpen(next)
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">{t('projects.create.button')}</Button>
      </DialogTrigger>
      <DialogContent title={t('projects.create.title')} className="max-w-140">
        <fieldset disabled={pending} className="mt-4 flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={mode === 'template' ? 'primary' : 'secondary'}
              onClick={() => setMode('template')}
            >
              {t('projects.create.fromTemplate')}
            </Button>
            {galleryTemplates.length > 0 ? (
              <Button
                size="sm"
                variant={mode === 'gallery' ? 'primary' : 'secondary'}
                onClick={() => setMode('gallery')}
              >
                {t('projects.create.fromGallery')}
              </Button>
            ) : null}
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

          {mode === 'gallery' ? (
            <label className="flex flex-col gap-1.5 text-small">
              <span className="text-caption font-medium text-muted-foreground">
                {t('projects.field.galleryTemplate')}
              </span>
              <select
                value={galleryId}
                onChange={(e) => setGalleryId(e.target.value)}
                className="h-11 rounded-sm border border-border bg-card px-3"
              >
                {galleryTemplates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </select>
              <span className="text-caption text-muted-foreground">
                {t('projects.field.galleryTemplateHint')}
              </span>
            </label>
          ) : null}

          <label className="flex flex-col gap-1.5 text-small">
            <span className="text-caption font-medium text-muted-foreground">
              {t('projects.field.title')}
            </span>
            <Input
              maxLength={200}
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
              disabled={!head}
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
                <label key={m.userId} className="flex min-h-11 items-center gap-2">
                  <Checkbox
                    checked={m.userId === ownerUserId || memberIds.includes(m.userId)}
                    disabled={m.userId === ownerUserId}
                    onCheckedChange={() => toggleMember(m.userId)}
                  />
                  {fullName(m)}
                </label>
              ))}
            </div>
          </div>

          <Button
            onClick={() => void submit()}
            loading={pending}
            disabled={!ownerUserId || (mode === 'scratch' && !title.trim())}
          >
            {t('projects.create.submit')}
          </Button>
        </fieldset>
      </DialogContent>
    </Dialog>
  )
}
