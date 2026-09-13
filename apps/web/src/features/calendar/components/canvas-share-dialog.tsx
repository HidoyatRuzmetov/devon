// Sharing one private canvas to a project or an event (v1.1 SPEC §10, EPIC-018).
//
// SHARED PRIMITIVE (see this package's notes): consumed by `features/personal`'s canvas detail. It
// lives here because this package owns the realtime layer, the sharing rule and its copy.
//
// **The screen's whole job is to make the privacy rule impossible to misread.** A person's canvas is
// the one place in this product nobody else can look -- not colleagues, not the boshqarma boshligʻi
// -- so a button that says "share" on that screen has to say exactly what it does before it is
// pressed, not after. Hence the standing note: sharing publishes a *copy*, the original stays
// private, later edits to the original do not travel, and the share can be taken back at any moment.
// That is four facts, and all four are on screen in plain words rather than in a help article.
import * as React from 'react'
import { useT } from '@devon/i18n'
import {
  Button,
  Dialog,
  DialogContent,
  Field,
  RadioGroup,
  RadioOption,
  Select,
  StateView,
  Switch,
  toast,
} from '@devon/ui'
import { CircleAlert, Info } from 'lucide-react'
import { ApiError } from '../../../lib/api-client.js'
import { useDepartment, useMeQuery } from '../../../lib/session.js'
import { useEventsQuery } from '../../events/hooks.js'
import { useProjectsQuery } from '../../projects/hooks.js'
import { useShareCanvas } from '../../../lib/realtime/canvas-hooks.js'
import type { CanvasScope } from '../../../lib/realtime/canvas-api.js'

export type CanvasShareDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  canvasId: string
}

export function CanvasShareDialog({
  open,
  onOpenChange,
  canvasId,
}: CanvasShareDialogProps): React.JSX.Element {
  const t = useT()
  const [scope, setScope] = React.useState<CanvasScope>('project')
  const [targetId, setTargetId] = React.useState('')
  const [allowEdit, setAllowEdit] = React.useState(true)
  const share = useShareCanvas()

  // Both lists are already cached for most sessions (the sidebar prefetches them), so opening this
  // dialog usually costs nothing.
  const projectsQuery = useProjectsQuery()
  const eventsQuery = useEventsQuery()

  // Only what the *server* will actually accept.
  //
  // `/projects` and `/events` both return everything in the department -- a member may read every
  // project without belonging to one -- but `POST /canvas-shares` refuses a target the person is not
  // part of (`canPublishCanvasTo`). Offering all of them made every non-membership a trap: pick a
  // colleague's project, press Ulashish, get a 403. So the list is narrowed here to exactly the rule
  // the server enforces -- owner or member for a project, organizer or an RSVP for an event -- and a
  // head, who may publish into anything in their own department, sees the unfiltered list.
  //
  // The filter is a convenience, never the control: the server still decides, and the error below
  // exists for the case where these two answers disagree (a membership revoked mid-session).
  const myUserId = useMeQuery().data?.user.id ?? null
  const isHead = useDepartment().department?.role === 'head'

  const targets = React.useMemo(() => {
    if (scope === 'project') {
      return (projectsQuery.data ?? [])
        .filter(
          (p) => isHead || (myUserId !== null && (p.ownerUserId === myUserId || p.members.includes(myUserId))),
        )
        .map((p) => ({ value: p.id, label: p.title }))
    }
    return (eventsQuery.data?.items ?? [])
      .filter((e) => isHead || e.canManage || e.myRsvp !== null)
      .map((e) => ({ value: e.id, label: e.title }))
  }, [scope, projectsQuery.data, eventsQuery.data, myUserId, isHead])

  // Changing the scope invalidates whatever was chosen under the old one -- and any complaint about
  // the previous choice with it.
  React.useEffect(() => {
    setTargetId('')
    setFailure(null)
  }, [scope])

  const loading = scope === 'project' ? projectsQuery.isPending : eventsQuery.isPending
  const scopeGroupId = React.useId()
  const targetSelectId = React.useId()
  const allowEditId = React.useId()
  const [failure, setFailure] = React.useState<string | null>(null)

  function submit(e: React.FormEvent): void {
    e.preventDefault()
    if (!targetId) return
    setFailure(null)
    share.mutate(
      { canvasId, scope, targetId, allowEdit },
      {
        onSuccess: () => {
          onOpenChange(false)
          setTargetId('')
          toast.success(t('realtime.canvas.share.toast'))
        },
        onError: (err) => {
          // The dialog used to close on success and do *nothing at all* on failure -- press Ulashish,
          // watch the button stop spinning, and never learn that the server said no (found in the
          // browser: a member sharing into a project they are not in, 403 `not_a_participant`).
          // `403` has one cause worth naming and one action a person can take, so it gets its own
          // sentence; everything else gets the honest generic one.
          const code = err instanceof ApiError ? err.code : null
          setFailure(
            code === 'forbidden' || code === 'not_a_participant'
              ? 'realtime.canvas.share.failed.notParticipant'
              : 'realtime.canvas.share.failed.generic',
          )
        },
      },
    )
  }

  function body(): React.JSX.Element {
    if (loading)
      return <StateView kind="loading" titleKey="realtime.canvas.loading.title" compact />
    if (targets.length === 0) {
      return (
        <StateView
          kind="empty"
          titleKey="realtime.canvas.share.noTargets.title"
          bodyKey="realtime.canvas.share.noTargets.body"
          compact
        />
      )
    }
    return (
      <>
        <Field label={t('realtime.canvas.share.target')} htmlFor={targetSelectId}>
          <Select
            id={targetSelectId}
            value={targetId}
            onChange={(e) => {
              setTargetId(e.currentTarget.value)
              setFailure(null)
            }}
            options={[
              { value: '', label: t('realtime.canvas.share.targetPlaceholder') },
              ...targets,
            ]}
          />
        </Field>

        <div className="flex items-start gap-3">
          <Switch
            id={allowEditId}
            checked={allowEdit}
            onCheckedChange={setAllowEdit}
            aria-describedby={`${allowEditId}-help`}
          />
          <span className="flex flex-col gap-0.5">
            {/* `htmlFor` on a real id rather than a wrapping <label>: the control is a Radix
                `Switch` (a <button role="switch">), and wrapping a button in a label associates
                nothing -- clicking the text would not toggle it. */}
            <label htmlFor={allowEditId} className="text-body text-foreground">
              {t('realtime.canvas.share.allowEdit')}
            </label>
            <span id={`${allowEditId}-help`} className="text-caption text-muted-foreground">
              {t('realtime.canvas.share.allowEditHelp')}
            </span>
          </span>
        </div>

        {failure ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-caption text-foreground"
          >
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
            {t(failure)}
          </p>
        ) : null}

        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={share.isPending} disabled={!targetId}>
            {share.isPending
              ? t('realtime.canvas.share.sharing')
              : t('realtime.canvas.share.submit')}
          </Button>
        </div>
      </>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('realtime.canvas.share.title')} className="max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <p className="text-body text-muted-foreground">
            {t('realtime.canvas.share.description')}
          </p>

          <p className="flex items-start gap-2 rounded-md border border-border bg-surface-2 p-3 text-caption text-muted-foreground">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t('realtime.canvas.share.privacyNote')}
          </p>

          <fieldset className="flex flex-col gap-2">
            <legend id={scopeGroupId} className="pb-2 text-caption font-medium text-foreground">
              {t('realtime.canvas.share.scope')}
            </legend>
            <RadioGroup
              aria-labelledby={scopeGroupId}
              value={scope}
              onValueChange={(next) => setScope(next as CanvasScope)}
            >
              <RadioOption value="project" label={t('realtime.canvas.share.scopeProject')} />
              <RadioOption value="event" label={t('realtime.canvas.share.scopeEvent')} />
            </RadioGroup>
          </fieldset>

          {body()}

          <p className="text-caption text-muted-foreground">{t('realtime.canvas.share.onlyMine')}</p>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default CanvasShareDialog
