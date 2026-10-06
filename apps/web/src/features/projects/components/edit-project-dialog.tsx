import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, Dialog, DialogContent, Input, Textarea, toast } from '@devon/ui'
import { useActor } from '../../../lib/can.js'
import { ApiError } from '../../../lib/api-client.js'
import { useMembers } from '../../work/hooks.js'
import { fullName } from '../../work/lib/format.js'
import { projectStatusSchema, type Project } from '../api.js'
import { usePatchProjectMutation } from '../hooks.js'

export function EditProjectDialog({ project }: { project: Project }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t('projectEdit.edit')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t('projectEdit.edit')} className="max-w-140">
          {open ? <ProjectForm project={project} onSaved={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

function ProjectForm({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const t = useT()
  const members = useMembers()
  const actor = useActor()
  const head = actor?.memberships.some(
    (m) => m.departmentId === actor.departmentId && m.role === 'head',
  )
  const save = usePatchProjectMutation(project.id)
  const [version] = React.useState(project.version)
  const [title, setTitle] = React.useState(project.title)
  const [description, setDescription] = React.useState(project.description?.text ?? '')
  const [owner, setOwner] = React.useState(project.ownerUserId)
  const [selected, setSelected] = React.useState(project.members)
  const [status, setStatus] = React.useState(project.status)
  const [start, setStart] = React.useState(project.startOn ?? '')
  const [target, setTarget] = React.useState(project.targetOn ?? '')
  const [colour, setColour] = React.useState(project.colour)
  return (
    <form
      className="mt-4 flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(
          {
            title: title.trim(),
            description: description.trim() || null,
            ownerUserId: owner,
            members: [...new Set([owner, ...selected])],
            status,
            startOn: start || null,
            targetOn: target || null,
            colour,
            version,
          },
          {
            onSuccess: () => {
              toast(t('projectEdit.saved'))
              onSaved()
            },
          },
        )
      }}
    >
      <label className="flex flex-col gap-1.5 text-small">
        {t('projects.field.title')}
        <Input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1.5 text-small">
        {t('projectEdit.description')}
        <Textarea
          maxLength={20000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-small">
          {t('projects.field.owner')}
          <select
            disabled={!head}
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className="h-11 rounded-sm border border-border bg-card px-3"
          >
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {fullName(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-small">
          {t('projectEdit.status')}
          <select
            value={status}
            onChange={(e) => setStatus(projectStatusSchema.parse(e.target.value))}
            className="h-11 rounded-sm border border-border bg-card px-3"
          >
            {projectStatusSchema.options.map((value) => (
              <option key={value} value={value}>
                {t(`projects.status.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-small">
          {t('projectEdit.start')}
          <Input
            type="date"
            value={start}
            max={target || undefined}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-small">
          {t('projectEdit.target')}
          <Input
            type="date"
            value={target}
            min={start || undefined}
            onChange={(e) => setTarget(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-small">
          {t('projectEdit.colour')}
          <Input type="color" value={colour} onChange={(e) => setColour(e.target.value)} />
        </label>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-small font-medium">{t('projects.field.members')}</legend>
        <p className="text-caption text-muted-foreground">{t('projectEdit.membersHint')}</p>
        <div className="flex max-h-48 flex-col gap-2 overflow-y-auto rounded-sm border border-border p-3">
          {members.map((m) => (
            <label key={m.userId} className="flex items-center gap-2 text-small">
              <input
                type="checkbox"
                checked={m.userId === owner || selected.includes(m.userId)}
                disabled={m.userId === owner}
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
        </div>
      </fieldset>
      {save.isError ? (
        <p role="alert" className="text-small text-destructive">
          {t(
            save.error instanceof ApiError && save.error.status === 409
              ? 'projectEdit.conflict'
              : 'projectEdit.error',
          )}
        </p>
      ) : null}
      <Button type="submit" loading={save.isPending} disabled={!title.trim()}>
        {t('work.action.save')}
      </Button>
    </form>
  )
}
