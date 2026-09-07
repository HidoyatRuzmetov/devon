// `/admin/accounts` -- search, lock/unlock, reset password, force 2FA reset, anonymise/delete.
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import { Badge, Button, Dialog, DialogContent, Input, StateView, toast } from '@devon/ui'
import { useMeQuery } from '../../lib/session.js'
import { ApiError } from '../../lib/api-client.js'
import {
  anonymizeUser,
  fetchAdminUsers,
  forceTwoFactorReset,
  lockUser,
  resetUserPassword,
  unlockUser,
  type AdminUserRow,
} from './api.js'
import { AdminScreen } from './admin-screen.js'

const STATUS_TONE: Record<AdminUserRow['status'], 'success' | 'destructive' | 'neutral'> = {
  active: 'success',
  locked: 'destructive',
  deleted: 'neutral',
}

function AccountsBody() {
  const t = useT()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const [query, setQuery] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [lockTarget, setLockTarget] = React.useState<AdminUserRow | null>(null)
  const [reason, setReason] = React.useState('')
  const [temporaryPassword, setTemporaryPassword] = React.useState<{
    userId: string
    password: string
  } | null>(null)
  const [anonymizeTarget, setAnonymizeTarget] = React.useState<AdminUserRow | null>(null)

  const listQuery = useQuery({
    queryKey: ['admin', 'accounts', query, status],
    queryFn: () => fetchAdminUsers({ query: query || undefined, status: status || undefined }),
  })

  const csrfToken = meQuery.data?.csrfToken ?? ''
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'accounts'] })

  const lock = useMutation({
    mutationFn: () => lockUser(lockTarget!.id, reason, csrfToken),
    onSuccess: () => {
      toast(t('admin.console.accounts.lockedToast'))
      setLockTarget(null)
      setReason('')
      invalidate()
    },
  })
  const unlock = useMutation({
    mutationFn: (id: string) => unlockUser(id, csrfToken),
    onSuccess: () => {
      toast(t('admin.console.accounts.unlockedToast'))
      invalidate()
    },
  })
  const forceReset2fa = useMutation({
    mutationFn: (id: string) => forceTwoFactorReset(id, csrfToken),
    onSuccess: () => toast(t('admin.console.accounts.twoFactorResetToast')),
  })
  const resetPassword = useMutation({
    mutationFn: (id: string) => resetUserPassword(id, csrfToken),
    onSuccess: (result, id) =>
      setTemporaryPassword({ userId: id, password: result.temporaryPassword }),
  })
  const anonymize = useMutation({
    mutationFn: () => anonymizeUser(anonymizeTarget!.id, csrfToken),
    onSuccess: () => {
      toast(t('admin.console.accounts.anonymizedToast'))
      setAnonymizeTarget(null)
      invalidate()
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

  const users = listQuery.data.users

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('admin.console.accounts.searchPlaceholder')}
          aria-label={t('admin.console.accounts.searchPlaceholder')}
          className="max-w-80"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label={t('admin.console.accounts.statusFilter')}
          className="h-11 rounded-sm border border-border bg-card px-3 text-body text-foreground"
        >
          <option value="">{t('admin.console.accounts.statusAll')}</option>
          <option value="active">{t('admin.console.accounts.statusActive')}</option>
          <option value="locked">{t('admin.console.accounts.statusLocked')}</option>
          <option value="deleted">{t('admin.console.accounts.statusDeleted')}</option>
        </select>
      </div>

      {users.length === 0 ? (
        <StateView kind="empty" titleKey="admin.console.accounts.empty.title" />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-body font-medium text-foreground">
                    {u.givenName} {u.familyName}
                  </p>
                  <Badge tone={STATUS_TONE[u.status]}>
                    {t(`admin.console.accounts.status.${u.status}`)}
                  </Badge>
                  {u.role === 'super_admin' ? (
                    <Badge tone="info">{t('admin.console.accounts.role.superAdmin')}</Badge>
                  ) : null}
                </div>
                <p className="text-small text-muted-foreground">@{u.login}</p>
              </div>
              {u.status !== 'deleted' && u.role !== 'super_admin' ? (
                <div className="flex flex-wrap gap-2">
                  {u.status === 'active' ? (
                    <Button size="sm" variant="secondary" onClick={() => setLockTarget(u)}>
                      {t('admin.console.accounts.lock')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => unlock.mutate(u.id)}
                      loading={unlock.isPending && unlock.variables === u.id}
                    >
                      {t('admin.console.accounts.unlock')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => resetPassword.mutate(u.id)}
                    loading={resetPassword.isPending && resetPassword.variables === u.id}
                  >
                    {t('admin.console.accounts.resetPassword')}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => forceReset2fa.mutate(u.id)}
                    loading={forceReset2fa.isPending && forceReset2fa.variables === u.id}
                  >
                    {t('admin.console.accounts.forceTwoFactorReset')}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => setAnonymizeTarget(u)}>
                    {t('admin.console.accounts.anonymize')}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={lockTarget !== null} onOpenChange={(open) => !open && setLockTarget(null)}>
        <DialogContent title={t('admin.console.accounts.lockDialogTitle')}>
          <div className="flex flex-col gap-3 pt-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-small text-foreground">
                {t('admin.console.accounts.lockReasonLabel')}
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
              loading={lock.isPending}
              onClick={() => lock.mutate()}
            >
              {t('admin.console.accounts.lockSubmit')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={temporaryPassword !== null}
        onOpenChange={(open) => !open && setTemporaryPassword(null)}
      >
        <DialogContent title={t('admin.console.accounts.temporaryPasswordTitle')}>
          <div className="flex flex-col gap-3 pt-4">
            <p className="text-body text-muted-foreground">
              {t('admin.console.accounts.temporaryPasswordBody')}
            </p>
            <code className="select-all rounded-sm border border-border bg-muted p-3 text-center text-lead">
              {temporaryPassword?.password}
            </code>
            <Button onClick={() => setTemporaryPassword(null)}>
              {t('admin.console.accounts.temporaryPasswordClose')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={anonymizeTarget !== null}
        onOpenChange={(open) => !open && setAnonymizeTarget(null)}
      >
        <DialogContent title={t('admin.console.accounts.anonymizeDialogTitle')}>
          <div className="flex flex-col gap-3 pt-4">
            <p className="text-body text-muted-foreground">
              {t('admin.console.accounts.anonymizeDialogBody')}
            </p>
            <Button
              variant="destructive"
              loading={anonymize.isPending}
              onClick={() => anonymize.mutate()}
            >
              {t('admin.console.accounts.anonymizeSubmit')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function AccountsScreen() {
  return (
    <AdminScreen active="accounts">
      <AccountsBody />
    </AdminScreen>
  )
}
