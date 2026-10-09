// `/fields` -- "Maydonlar", the boshqarma boshligʻi's field manager (v1.1 SPEC §5, §3.1's Boshqaruv
// group).
//
// Head-only twice over: the sidebar entry declares `fields.definition.manage` and every write route
// behind this screen is `{kind:'department_managed'}` on the server. A xodim who types the URL gets
// the shared no-permission state, not a blank page (PERMISSIONS-AUDIT D12).
//
// What the head does here, in the order the screen presents it:
//   1. two tabs -- person fields and card fields -- because they are two different products (one is
//      about colleagues, one is about work) and mixing them is how a manager screen stops being
//      readable;
//   2. create / edit / reorder / archive, every destructive step with **undo** rather than a
//      confirm dialog (DESIGN.md);
//   3. for a person field: a progress bar (filled / total) and **"Toʻldirishni soʻrash"**, which
//      creates one request per colleague with no answer, sends each of them an inbox row and an
//      individual Telegram message in their own locale, and then nudges instead of duplicating.
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArrowDown,
  ArrowUp,
  BellRing,
  Columns3,
  Pencil,
  Plus,
  RotateCcw,
} from 'lucide-react'
import { useLocale, useT } from '@devon/i18n'
import { FIELD_CAPS } from '@devon/contracts'
import {
  Badge,
  Button,
  Celebrate,
  cn,
  IconButton,
  PageContainer,
  PageHeader,
  Progress,
  SegmentedControl,
  Skeleton,
  Stagger,
  StaggerItem,
  StateView,
  Switch,
  toast,
  toastWithUndo,
} from '@devon/ui'
import { ApiError } from '../../lib/api-client.js'
import { useCan } from '../../lib/can.js'
import { useForcedState } from '../../lib/forced-state.js'
import { ForcedStateBlock } from '../../shell/forced-state-block.js'
import { useMeQuery } from '../../lib/session.js'
import { useDepartment } from '../../lib/session.js'
import { useOnline } from '../../lib/use-online.js'
import { navigate } from '../../lib/router.js'
import {
  archiveDef,
  createDef,
  fetchDefs,
  notifyToFill,
  reorderDefs,
  restoreDef,
  updateDef,
  type DefDraft,
  type FieldDefDto,
} from './api.js'
import { fieldDescription, fieldLabel } from './format.js'
import { FieldFormDialog } from './components/field-form-dialog.js'
import { fieldErrorKey } from './error-key.js'

type Entity = 'person' | 'card'

const STORAGE_KEY = 'devon.fields.tab'

function readStoredTab(): Entity {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw === 'card' ? 'card' : 'person'
  } catch {
    return 'person'
  }
}

export default function FieldsScreen(): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const online = useOnline()
  const forced = useForcedState()
  const queryClient = useQueryClient()
  const { departmentId } = useDepartment()
  const csrfToken = useMeQuery().data?.csrfToken ?? ''
  const permission = useCan('fields.definition.manage')

  const [entity, setEntity] = React.useState<Entity>(() => readStoredTab())
  const [showArchived, setShowArchived] = React.useState(false)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<FieldDefDto | null>(null)
  const dialogSession = React.useRef(0)

  function openForm(def: FieldDefDto | null = null): void {
    dialogSession.current += 1
    setEditing(def)
    setDialogOpen(true)
  }

  const query = useQuery({
    queryKey: ['fields', 'defs', 'all', departmentId],
    queryFn: () => fetchDefs(undefined, true),
    enabled: departmentId !== null && permission.allowed,
  })

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ['fields'] })
  }

  function reportError(err: unknown, fallbackKey: string): void {
    if (err instanceof ApiError && err.errors.length > 0) {
      const key = fieldErrorKey(err.errors[0]!.code)
      if (key) {
        toast.error(t(key))
        return
      }
    }
    toast.error(t(fallbackKey))
  }

  const create = useMutation({
    mutationFn: (draft: DefDraft) => createDef(draft, csrfToken),
    onSuccess: (data) => {
      refresh()
      toast.success(t('fields.manager.created', { name: fieldLabel(data.def, locale) }))
    },
    onError: (err) => reportError(err, 'fields.manager.createFailed'),
  })

  const edit = useMutation({
    mutationFn: (input: { id: string; patch: Partial<Omit<DefDraft, 'appliesTo' | 'key'>> }) =>
      updateDef(input.id, input.patch, csrfToken),
    onSuccess: () => {
      refresh()
      toast.success(t('fields.manager.saved'))
    },
    onError: (err) => reportError(err, 'fields.manager.saveFailed'),
  })

  const archive = useMutation({
    mutationFn: (id: string) => archiveDef(id, csrfToken),
    onSuccess: (data) => {
      refresh()
      // Undo over confirm: the column is gone from every table immediately and comes straight back
      // if that was a mistake -- its answers were never deleted, only hidden.
      toastWithUndo({
        message: t('fields.manager.archived', { name: fieldLabel(data.def, locale) }),
        undoLabel: t('fields.manager.undo'),
        onUndo: () => restore.mutate(data.def.id),
      })
    },
    onError: (err) => reportError(err, 'fields.manager.archiveFailed'),
  })

  const restore = useMutation({
    mutationFn: (id: string) => restoreDef(id, csrfToken),
    onSuccess: () => {
      refresh()
      toast.success(t('fields.manager.restored'))
    },
    onError: (err) => reportError(err, 'fields.manager.restoreFailed'),
  })

  const reorder = useMutation({
    mutationFn: (ids: readonly string[]) => reorderDefs(ids, csrfToken),
    onSuccess: refresh,
    onError: (err) => reportError(err, 'fields.manager.reorderFailed'),
  })

  // The burst belongs to the button that was pressed, so the row id travels with it rather than a
  // single screen-level `useCelebrate` firing on whichever card happens to render first.
  const [askedDefId, setAskedDefId] = React.useState<string | null>(null)

  const notify = useMutation({
    mutationFn: (id: string) => notifyToFill(id, csrfToken),
    onSuccess: (result, id) => {
      refresh()
      // "Nobody to ask" is not a win -- only an ask or a nudge that actually went out is.
      if (result.asked > 0 || result.reminded > 0) setAskedDefId(id)
      toast.success(
        result.asked > 0
          ? t('fields.manager.asked', { count: result.asked })
          : result.reminded > 0
            ? t('fields.manager.nudged', { count: result.reminded })
            : t('fields.manager.nobodyToAsk'),
      )
    },
    onError: (err) => reportError(err, 'fields.manager.askFailed'),
  })

  const allDefs = React.useMemo(() => query.data?.defs ?? [], [query.data?.defs])
  const defs = React.useMemo(
    () =>
      allDefs
        .filter((d) => d.appliesTo === entity)
        .filter((d) => (showArchived ? true : d.archivedAt === null))
        .sort((a, b) => a.order - b.order),
    [allDefs, entity, showArchived],
  )
  const liveCount = allDefs.filter((d) => d.appliesTo === entity && d.archivedAt === null).length
  const cap = query.data?.caps[entity] ?? FIELD_CAPS[entity]
  const liveDefs = React.useMemo(() => defs.filter((d) => d.archivedAt === null), [defs])

  function move(id: string, delta: number): void {
    const index = liveDefs.findIndex((def) => def.id === id)
    if (index < 0) return
    const target = index + delta
    if (target < 0 || target >= liveDefs.length) return
    const ids = liveDefs.map((d) => d.id)
    const moved = ids[index]!
    ids.splice(index, 1)
    ids.splice(target, 0, moved)
    reorder.mutate(ids)
  }

  if (forced) return <ForcedStateBlock kind={forced} />

  if (!permission.allowed) {
    return (
      <StateView
        kind="forbidden"
        titleKey="state.denied.title"
        bodyKey="fields.manager.denied.body"
        action={{ labelKey: 'fields.manager.denied.action', onAction: () => navigate('/account') }}
      />
    )
  }

  if (!online) {
    return (
      <StateView
        kind="offline"
        titleKey="state.offline.banner"
        bodyKey="state.offline.empty"
        action={{ labelKey: 'state.error.action', onAction: () => window.location.reload() }}
      />
    )
  }

  if (query.isPending) {
    return (
      <PageContainer>
        <PageHeader title={t('fields.manager.title')} description={t('fields.manager.subtitle')} />
        <div className="mt-6 flex flex-col gap-3" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-20 w-full rounded-md" />
          ))}
        </div>
      </PageContainer>
    )
  }

  if (query.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void query.refetch() }}
      />
    )
  }

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-small text-muted-foreground">
        <Switch
          checked={showArchived}
          onCheckedChange={setShowArchived}
          aria-label={t('fields.manager.showArchived')}
        />
        {t('fields.manager.showArchived')}
      </label>
      <Button onClick={() => openForm()} disabled={liveCount >= cap}>
        <Plus aria-hidden="true" className="size-4" />
        {t('fields.manager.create')}
      </Button>
    </div>
  )

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t('shell.nav.group.manageHead')}
        title={t('fields.manager.title')}
        description={t('fields.manager.subtitle')}
        actions={header}
      />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label={t('fields.manager.tabsAria')}
          value={entity}
          onValueChange={(value) => {
            const next = value === 'card' ? 'card' : 'person'
            setEntity(next)
            try {
              window.localStorage.setItem(STORAGE_KEY, next)
            } catch {
              // Storage disabled: the choice still holds for this session.
            }
          }}
          options={[
            { value: 'person', label: t('fields.manager.tab.person') },
            { value: 'card', label: t('fields.manager.tab.card') },
          ]}
        />
        <p className="flex items-center gap-2 text-small text-muted-foreground">
          <Columns3 aria-hidden="true" className="size-4" />
          {t('fields.manager.capCount', { used: liveCount, cap })}
        </p>
      </div>

      {defs.length === 0 ? (
        <div className="mt-6">
          <StateView
            kind="empty"
            titleKey={
              entity === 'person'
                ? 'fields.manager.empty.person.title'
                : 'fields.manager.empty.card.title'
            }
            bodyKey={
              entity === 'person'
                ? 'fields.manager.empty.person.body'
                : 'fields.manager.empty.card.body'
            }
            action={{
              labelKey: 'fields.manager.create',
              onAction: () => openForm(),
            }}
          />
        </div>
      ) : (
        <Stagger className="mt-6 flex flex-col gap-3">
          {defs.map((def) => {
            const archived = def.archivedAt !== null
            const liveIndex = liveDefs.findIndex((live) => live.id === def.id)
            const progress = def.progress
            const pct =
              progress && progress.total > 0
                ? Math.round((progress.filled / progress.total) * 100)
                : 0
            return (
              <StaggerItem key={def.id}>
                <article
                  className={cn(
                    'rounded-md border border-border bg-card p-4 shadow-1',
                    'transition-colors duration-(--dur-micro) ease-out',
                    archived && 'opacity-60',
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="flex flex-wrap items-center gap-2 text-h3 text-foreground">
                        {fieldLabel(def, locale)}
                        <Badge tone="neutral">{t(`fields.type.${def.type}`)}</Badge>
                        {def.required ? (
                          <Badge tone="attention">{t('fields.manager.requiredBadge')}</Badge>
                        ) : null}
                        {def.visibleTo === 'head_only' ? (
                          <Badge tone="primary">{t('fields.visibility.headOnly')}</Badge>
                        ) : null}
                        {archived ? (
                          <Badge tone="neutral">{t('fields.manager.archivedBadge')}</Badge>
                        ) : null}
                      </h2>
                      <p className="mt-1 text-small text-muted-foreground">
                        <code translate="no" className="rounded-sm bg-muted px-1 py-0.5">
                          field:{def.key}
                        </code>
                        {fieldDescription(def, locale) ? ` — ${fieldDescription(def, locale)}` : ''}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      {!archived ? (
                        <>
                          <IconButton
                            aria-label={t('fields.manager.moveUp')}
                            disabled={liveIndex === 0 || reorder.isPending}
                            onClick={() => move(def.id, -1)}
                          >
                            <ArrowUp aria-hidden="true" className="size-4" />
                          </IconButton>
                          <IconButton
                            aria-label={t('fields.manager.moveDown')}
                            disabled={liveIndex === liveDefs.length - 1 || reorder.isPending}
                            onClick={() => move(def.id, 1)}
                          >
                            <ArrowDown aria-hidden="true" className="size-4" />
                          </IconButton>
                          <IconButton
                            aria-label={t('fields.manager.edit')}
                            onClick={() => openForm(def)}
                          >
                            <Pencil aria-hidden="true" className="size-4" />
                          </IconButton>
                          <IconButton
                            aria-label={t('fields.manager.archive')}
                            onClick={() => archive.mutate(def.id)}
                          >
                            <Archive aria-hidden="true" className="size-4" />
                          </IconButton>
                        </>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => restore.mutate(def.id)}
                        >
                          <RotateCcw aria-hidden="true" className="size-4" />
                          {t('fields.manager.restore')}
                        </Button>
                      )}
                    </div>
                  </div>

                  {def.appliesTo === 'person' && progress && !archived ? (
                    <div className="mt-4 flex flex-wrap items-center gap-4">
                      <div className="min-w-48 flex-1">
                        <Progress
                          value={pct}
                          label={t('fields.manager.progressLabel', {
                            filled: progress.filled,
                            total: progress.total,
                          })}
                        />
                        <p className="mt-1 text-small text-muted-foreground">
                          {t('fields.manager.progressLabel', {
                            filled: progress.filled,
                            total: progress.total,
                          })}
                          {progress.openRequests > 0
                            ? ` · ${t('fields.manager.waitingOn', { count: progress.openRequests })}`
                            : ''}
                        </p>
                      </div>
                      <span className="relative inline-flex shrink-0">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={notify.isPending || progress.filled >= progress.total}
                          onClick={() => notify.mutate(def.id)}
                        >
                          <BellRing aria-hidden="true" className="size-4" />
                          {progress.openRequests > 0
                            ? t('fields.manager.nudge')
                            : t('fields.manager.ask')}
                        </Button>
                        <Celebrate
                          play={askedDefId === def.id}
                          onDone={() => setAskedDefId(null)}
                        />
                      </span>
                    </div>
                  ) : null}
                </article>
              </StaggerItem>
            )
          })}
        </Stagger>
      )}

      <FieldFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        appliesTo={entity}
        existing={editing}
        used={liveCount}
        cap={cap}
        saving={create.isPending || edit.isPending}
        onSubmit={(draft) => {
          const submittedSession = dialogSession.current
          const closeSubmittedForm = () => {
            if (submittedSession === dialogSession.current) setDialogOpen(false)
          }
          if (editing) {
            const { appliesTo: _appliesTo, key: _key, ...patch } = draft
            edit.mutate({ id: editing.id, patch }, { onSuccess: closeSubmittedForm })
          } else {
            create.mutate(draft, { onSuccess: closeSubmittedForm })
          }
        }}
      />
    </PageContainer>
  )
}
