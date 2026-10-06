// "A project template creates the objective task list in one click" (EPIC-005 outcome) plus a plain
// from-scratch project -- one dialog, two tabs' worth of fields shown/hidden by a toggle rather than
// two separate dialogs, since they share every field except which endpoint ends up called.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, Dialog, DialogContent, DialogTrigger, Input, toast } from '@devon/ui'
import { replaceSearchParam, useSearchParams } from '../../../lib/router.js'
import { useCreateCardMutation, useMembers } from '../../work/hooks.js'
import { useWorkTemplatesQuery } from '../../work/hooks-plus.js'
import { readProjectPayload } from '../../work/components/template-preview.js'
import { fullName } from '../../work/lib/format.js'
import { useActor } from '../../../lib/can.js'
import {
  useCreateFromTemplateMutation,
  useCreateProjectMutation,
  useTemplatesQuery,
} from '../hooks.js'

/** `offsetDays` from "create from template" to a real date. A template says "the kick-off note is
 * due three days in", never a calendar date, because the same template is used again next quarter. */
function offsetToIso(days: number | undefined): string | undefined {
  if (days === undefined) return undefined
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

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
  const createCard = useCreateCardMutation()
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
    if (!ownerUserId) return
    try {
      if (mode === 'gallery') {
        const template = galleryTemplates.find((tpl) => tpl.id === galleryId)
        const payload = template ? readProjectPayload(template.payload) : null
        if (!payload) {
          toast(t('projects.create.templateUnreadable'))
          return
        }
        const project = await createProject.mutateAsync({
          title: title.trim() || payload.title,
          ownerUserId,
          members: Array.from(new Set([ownerUserId, ...memberIds])),
          ...(payload.description ? { description: payload.description } : {}),
          ...(payload.colour ? { colour: payload.colour } : {}),
          ...(payload.milestones && payload.milestones.length > 0
            ? {
                milestones: payload.milestones.map((m) => ({
                  title: m.title,
                  dueOn: offsetToIso(m.offsetDays) ?? null,
                })),
              }
            : {}),
        })
        // The template's objective cards. Independent of each other, so one `Promise.all` rather
        // than an awaited loop (TECH-SPEC §16: no query in a loop).
        await Promise.all(
          (payload.cards ?? []).map((card) =>
            createCard.mutateAsync({
              title: card.title,
              projectId: project.id,
              projectScope: 'objective',
              assigneeUserId: ownerUserId,
              ...(card.estimateMin ? { estimateMin: card.estimateMin } : {}),
              ...(offsetToIso(card.offsetDays)
                ? { dueAt: new Date(`${offsetToIso(card.offsetDays)}T09:00:00.000Z`).toISOString() }
                : {}),
            }),
          ),
        )
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
                <label key={m.userId} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={m.userId === ownerUserId || memberIds.includes(m.userId)}
                    disabled={m.userId === ownerUserId}
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
            disabled={!ownerUserId || (mode === 'scratch' && !title.trim())}
          >
            {t('projects.create.submit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
