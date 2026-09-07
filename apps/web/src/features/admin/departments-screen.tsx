// `/admin/departments` -- list, pause/resume/archive/restore, and the view-as lens (I-8a).
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import { Badge, Button, Dialog, DialogContent, Input, StateView, toast } from '@devon/ui'
import { navigate } from '../../lib/router.js'
import { useMeQuery } from '../../lib/session.js'
import { ApiError } from '../../lib/api-client.js'
import {
  archiveDepartment,
  fetchAdminDepartments,
  pauseDepartment,
  restoreDepartment,
  resumeDepartment,
  startViewAs,
  type AdminDepartmentRow,
} from './api.js'
import { AdminScreen } from './admin-screen.js'

const STATUS_TONE: Record<AdminDepartmentRow['status'], 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  paused_by_admin: 'warning',
  deletion_requested: 'warning',
  archived: 'neutral',
}

function DepartmentsBody() {
  const t = useT()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const [query, setQuery] = React.useState('')
  const [status, setStatus] = React.useState<string>('')
  const [pauseTarget, setPauseTarget] = React.useState<AdminDepartmentRow | null>(null)
  const [reason, setReason] = React.useState('')

  const listQuery = useQuery({
    queryKey: ['admin', 'departments', query, status],
    queryFn: () =>
      fetchAdminDepartments({ query: query || undefined, status: status || undefined }),
  })

  const csrfToken = meQuery.data?.csrfToken ?? ''
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'departments'] })

  const pause = useMutation({
    mutationFn: () => pauseDepartment(pauseTarget!.id, reason, csrfToken),
    onSuccess: () => {
      toast(t('admin.console.departments.pausedToast'))
      setPauseTarget(null)
      setReason('')
      invalidate()
    },
  })
  const resume = useMutation({
    mutationFn: (id: string) => resumeDepartment(id, csrfToken),
    onSuccess: () => {
      toast(t('admin.console.departments.resumedToast'))
      invalidate()
    },
  })
  const archive = useMutation({
    mutationFn: (id: string) => archiveDepartment(id, csrfToken),
    onSuccess: () => {
      toast(t('admin.console.departments.archivedToast'))
      invalidate()
    },
  })
  const restore = useMutation({
    mutationFn: (id: string) => restoreDepartment(id, csrfToken),
    onSuccess: () => {
      toast(t('admin.console.departments.restoredToast'))
      invalidate()
    },
  })
  const viewAs = useMutation({
    mutationFn: (id: string) => startViewAs(id, csrfToken),
    onSuccess: () => {
      toast(t('admin.console.departments.viewAsStartedToast'))
      navigate('/')
    },
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
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {departments.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-body font-medium text-foreground">{d.name}</p>
                  <Badge tone={STATUS_TONE[d.status]}>
                    {t(`admin.console.departments.status.${d.status}`)}
                  </Badge>
                </div>
                <p className="text-small text-muted-foreground">
                  {t('admin.console.departments.memberCount', { count: d.memberCount })}
                  {d.headName ? ` · ${d.headName}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {d.status === 'active' ? (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => viewAs.mutate(d.id)}
                      loading={viewAs.isPending && viewAs.variables === d.id}
                    >
                      {t('admin.console.departments.viewAs')}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setPauseTarget(d)}>
                      {t('admin.console.departments.pause')}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => archive.mutate(d.id)}
                      loading={archive.isPending && archive.variables === d.id}
                    >
                      {t('admin.console.departments.archive')}
                    </Button>
                  </>
                ) : null}
                {d.status === 'paused_by_admin' ? (
                  <Button
                    size="sm"
                    onClick={() => resume.mutate(d.id)}
                    loading={resume.isPending && resume.variables === d.id}
                  >
                    {t('admin.console.departments.resume')}
                  </Button>
                ) : null}
                {d.status === 'archived' ? (
                  <Button
                    size="sm"
                    onClick={() => restore.mutate(d.id)}
                    loading={restore.isPending && restore.variables === d.id}
                  >
                    {t('admin.console.departments.restore')}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={pauseTarget !== null} onOpenChange={(open) => !open && setPauseTarget(null)}>
        <DialogContent title={t('admin.console.departments.pauseDialogTitle')}>
          <div className="flex flex-col gap-3 pt-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-small text-foreground">
                {t('admin.console.departments.pauseReasonLabel')}
              </span>
              <textarea
                className="min-h-20 w-full rounded-sm border border-border bg-card px-3 py-2 text-body text-foreground"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <Button
              variant="destructive"
              disabled={reason.trim().length === 0}
              loading={pause.isPending}
              onClick={() => pause.mutate()}
            >
              {t('admin.console.departments.pauseSubmit')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
