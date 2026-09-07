// `/admin/departments` -- table, status pills, and a row drawer (view-as, pause with a reason sheet,
// archive/restore) instead of a wall of inline buttons per row (UI-OVERHAUL.md §2 "Admin console ...
// departments table with status pills and row drawer").
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useT, formatDate, useLocale, LOCALE_LABEL } from '@devon/i18n'
import {
  Badge,
  Button,
  IconButton,
  Input,
  Sheet,
  SheetContent,
  Stagger,
  StaggerItem,
  StateView,
  toast,
} from '@devon/ui'
import { Eye, X } from 'lucide-react'
import { navigate } from '../../lib/router.js'
import { useMeQuery } from '../../lib/session.js'
import { ApiError } from '../../lib/api-client.js'
import {
  archiveDepartment,
  fetchAdminDepartment,
  fetchAdminDepartments,
  pauseDepartment,
  restoreDepartment,
  resumeDepartment,
  startViewAs,
  type AdminDepartmentDetail,
  type AdminDepartmentRow,
} from './api.js'
import { AdminScreen } from './admin-screen.js'

const STATUS_TONE: Record<AdminDepartmentRow['status'], 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  paused_by_admin: 'warning',
  deletion_requested: 'warning',
  archived: 'neutral',
}

function DepartmentDrawer({
  id,
  onClose,
  onPause,
}: {
  id: string
  onClose: () => void
  onPause: (row: AdminDepartmentDetail) => void
}) {
  const t = useT()
  const locale = useLocale()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const detailQuery = useQuery({
    queryKey: ['admin', 'departments', 'detail', id],
    queryFn: () => fetchAdminDepartment(id),
  })
  const csrfToken = meQuery.data?.csrfToken ?? ''
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'departments'] })

  const resume = useMutation({
    mutationFn: () => resumeDepartment(id, csrfToken),
    onSuccess: () => {
      toast(t('admin.console.departments.resumedToast'))
      invalidate()
      onClose()
    },
  })
  const archive = useMutation({
    mutationFn: () => archiveDepartment(id, csrfToken),
    onSuccess: () => {
      toast(t('admin.console.departments.archivedToast'))
      invalidate()
      onClose()
    },
  })
  const restore = useMutation({
    mutationFn: () => restoreDepartment(id, csrfToken),
    onSuccess: () => {
      toast(t('admin.console.departments.restoredToast'))
      invalidate()
      onClose()
    },
  })
  const viewAs = useMutation({
    mutationFn: () => startViewAs(id, csrfToken),
    onSuccess: () => {
      toast(t('admin.console.departments.viewAsStartedToast'))
      navigate('/')
    },
  })

  const d = detailQuery.data

  return (
    <Sheet
      direction="right"
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        side="right"
        title={d?.name ?? t('admin.console.departments.drawerTitle')}
        className="flex flex-col gap-0"
      >
        <header className="flex items-center justify-between gap-2 border-b border-border p-4">
          <h2 className="min-w-0 truncate text-h3 text-foreground">
            {d?.name ?? t('state.loading')}
          </h2>
          <IconButton aria-label={t('admin.console.departments.drawerClose')} onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </IconButton>
        </header>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">{renderDetail()}</div>

        {d ? (
          <footer className="flex flex-wrap items-center gap-2 border-t border-border p-4">
            {d.status === 'active' ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => viewAs.mutate()}
                  loading={viewAs.isPending}
                >
                  <Eye className="mr-1.5 size-4" aria-hidden="true" />
                  {t('admin.console.departments.viewAs')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => onPause(d)}>
                  {t('admin.console.departments.pause')}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => archive.mutate()}
                  loading={archive.isPending}
                >
                  {t('admin.console.departments.archive')}
                </Button>
              </>
            ) : null}
            {d.status === 'paused_by_admin' ? (
              <Button size="sm" onClick={() => resume.mutate()} loading={resume.isPending}>
                {t('admin.console.departments.resume')}
              </Button>
            ) : null}
            {d.status === 'archived' ? (
              <Button size="sm" onClick={() => restore.mutate()} loading={restore.isPending}>
                {t('admin.console.departments.restore')}
              </Button>
            ) : null}
          </footer>
        ) : null}
      </SheetContent>
    </Sheet>
  )

  function renderDetail(): React.ReactNode {
    if (detailQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
    if (detailQuery.isError || !d) {
      return (
        <StateView
          kind="error"
          titleKey="state.error.title"
          bodyKey="state.error.body"
          action={{ labelKey: 'state.error.action', onAction: () => detailQuery.refetch() }}
        />
      )
    }
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[d.status]}>
            {t(`admin.console.departments.status.${d.status}`)}
          </Badge>
          <span className="font-mono text-small text-muted-foreground">{d.slug}</span>
        </div>
        {d.description ? <p className="text-body text-foreground">{d.description}</p> : null}
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-small">
          <div>
            <dt className="text-muted-foreground">
              {t('admin.console.departments.memberCountLabel')}
            </dt>
            <dd className="tabular-nums text-foreground">{d.memberCount}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('admin.console.departments.headLabel')}</dt>
            <dd className="text-foreground">{d.headName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('admin.console.departments.createdLabel')}</dt>
            <dd className="text-foreground">{formatDate(new Date(d.createdAt), locale)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('admin.console.departments.localeLabel')}</dt>
            <dd className="text-foreground">{LOCALE_LABEL[d.localeDefault]}</dd>
          </div>
        </dl>
      </>
    )
  }
}

/** UI-OVERHAUL.md's own phrase: "pause with reason sheet" -- pausing a department is destructive
 * enough (every member is locked out) that it gets a dedicated bottom sheet, not a text field buried
 * in the row drawer's footer. */
function PauseReasonSheet({
  target,
  csrfToken,
  onClose,
  onDone,
}: {
  target: AdminDepartmentDetail
  csrfToken: string
  onClose: () => void
  onDone: () => void
}) {
  const t = useT()
  const queryClient = useQueryClient()
  const [reason, setReason] = React.useState('')
  const pause = useMutation({
    mutationFn: () => pauseDepartment(target.id, reason, csrfToken),
    onSuccess: () => {
      toast(t('admin.console.departments.pausedToast'))
      void queryClient.invalidateQueries({ queryKey: ['admin', 'departments'] })
      onDone()
    },
  })

  return (
    <Sheet
      direction="bottom"
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent side="bottom" title={t('admin.console.departments.pauseDialogTitle')}>
        <div className="mx-auto flex w-full max-w-md flex-col gap-3 p-4">
          <h2 className="text-h3 text-foreground">
            {t('admin.console.departments.pauseDialogTitle')}
          </h2>
          <p className="text-small text-muted-foreground">{target.name}</p>
          <label className="flex flex-col gap-1.5">
            <span className="text-small text-foreground">
              {t('admin.console.departments.pauseReasonLabel')}
            </span>
            <textarea
              className="min-h-20 w-full rounded-sm border border-border bg-card px-3 py-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('admin.console.departments.pauseCancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length === 0}
              loading={pause.isPending}
              onClick={() => pause.mutate()}
            >
              {t('admin.console.departments.pauseSubmit')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DepartmentsBody() {
  const t = useT()
  const locale = useLocale()
  const meQuery = useMeQuery()
  const [query, setQuery] = React.useState('')
  const [status, setStatus] = React.useState<string>('')
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [pauseTarget, setPauseTarget] = React.useState<AdminDepartmentDetail | null>(null)

  const listQuery = useQuery({
    queryKey: ['admin', 'departments', query, status],
    queryFn: () =>
      fetchAdminDepartments({ query: query || undefined, status: status || undefined }),
  })

  if (listQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (listQuery.isError) {
    if (listQuery.error instanceof ApiError && listQuery.error.status === 403) {
      return (
        <StateView kind="forbidden" titleKey="state.denied.title" bodyKey="state.denied.body" />
      )
    }
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => listQuery.refetch() }}
      />
    )
  }

  const departments = listQuery.data.departments

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('admin.console.departments.searchPlaceholder')}
          aria-label={t('admin.console.departments.searchPlaceholder')}
          className="max-w-80"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label={t('admin.console.departments.statusFilter')}
          className="h-11 rounded-sm border border-border bg-card px-3 text-body text-foreground"
        >
          <option value="">{t('admin.console.departments.statusAll')}</option>
          <option value="active">{t('admin.console.departments.statusActive')}</option>
          <option value="paused_by_admin">{t('admin.console.departments.statusPaused')}</option>
          <option value="archived">{t('admin.console.departments.statusArchived')}</option>
        </select>
      </div>

      {departments.length === 0 ? (
        <StateView kind="empty" titleKey="admin.console.departments.empty.title" />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-small">
            <thead className="border-b border-border bg-muted/40 text-caption text-muted-foreground">
              <tr>
                <th className="px-3 py-2">{t('admin.console.departments.columnName')}</th>
                <th className="px-3 py-2">{t('admin.console.departments.columnStatus')}</th>
                <th className="px-3 py-2">{t('admin.console.departments.columnHead')}</th>
                <th className="px-3 py-2">{t('admin.console.departments.columnMembers')}</th>
                <th className="px-3 py-2">{t('admin.console.departments.columnCreated')}</th>
              </tr>
            </thead>
            <Stagger
              as="tbody"
              className="divide-y divide-border"
              animateKey={`${query}:${status}`}
            >
              {departments.map((d) => (
                <StaggerItem
                  as="tr"
                  key={d.id}
                  tabIndex={0}
                  role="button"
                  aria-label={d.name}
                  onClick={() => setOpenId(d.id)}
                  onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === 'Enter') setOpenId(d.id)
                  }}
                  className="cursor-pointer bg-card transition-colors duration-(--dur-micro) ease-out hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <td className="px-3 py-2.5 font-medium text-foreground">{d.name}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={STATUS_TONE[d.status]}>
                      {t(`admin.console.departments.status.${d.status}`)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{d.headName ?? '—'}</td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                    {d.memberCount}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {formatDate(new Date(d.createdAt), locale)}
                  </td>
                </StaggerItem>
              ))}
            </Stagger>
          </table>
        </div>
      )}

      {openId ? (
        <DepartmentDrawer
          id={openId}
          onClose={() => setOpenId(null)}
          onPause={(detail) => {
            setOpenId(null)
            setPauseTarget(detail)
          }}
        />
      ) : null}

      {pauseTarget ? (
        <PauseReasonSheet
          target={pauseTarget}
          csrfToken={meQuery.data?.csrfToken ?? ''}
          onClose={() => setPauseTarget(null)}
          onDone={() => setPauseTarget(null)}
        />
      ) : null}
    </div>
  )
}

export default function DepartmentsScreen() {
  return (
    <AdminScreen active="departments">
      <DepartmentsBody />
    </AdminScreen>
  )
}
