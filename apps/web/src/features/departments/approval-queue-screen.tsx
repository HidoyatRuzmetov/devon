// `/departments/requests` -- super-admin approval queue (TECH-SPEC §2.2). A `member`/`head` visiting
// this route gets a 403 from the API (`{kind:'instance'}`, `can()`); rendered as the shared "forbidden"
// state rather than a raw error.
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import { Badge, Button, Dialog, DialogContent, StateView, toast } from '@devon/ui'
import { ApiError } from '../../lib/api-client.js'
import { useMeQuery } from '../../lib/session.js'
import { approveRequest, fetchAllRequests, rejectRequest, type DepartmentRequest } from './api.js'

export default function ApprovalQueueScreen() {
  const t = useT()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const [filter, setFilter] = React.useState<'pending' | 'all'>('pending')
  const [rejectTarget, setRejectTarget] = React.useState<DepartmentRequest | null>(null)
  const [reason, setReason] = React.useState('')

  const query = useQuery({
    queryKey: ['departments', 'requests', 'all', filter],
    queryFn: () => fetchAllRequests(filter === 'pending' ? 'pending' : undefined),
  })

  const approve = useMutation({
    mutationFn: (id: string) => approveRequest(id, meQuery.data?.csrfToken ?? ''),
    onSuccess: () => {
      toast(t('departments.approvalQueue.approvedToast'))
      void queryClient.invalidateQueries({ queryKey: ['departments', 'requests', 'all'] })
    },
  })
  const reject = useMutation({
    mutationFn: () => rejectRequest(rejectTarget!.id, reason, meQuery.data?.csrfToken ?? ''),
    onSuccess: () => {
      toast(t('departments.approvalQueue.rejectedToast'))
      setRejectTarget(null)
      setReason('')
      void queryClient.invalidateQueries({ queryKey: ['departments', 'requests', 'all'] })
    },
  })

  if (query.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 403) {
      return (
        <StateView kind="forbidden" titleKey="state.denied.title" bodyKey="state.denied.body" />
      )
    }
    return <StateView kind="error" titleKey="state.error.title" bodyKey="state.error.body" />
  }

  const requests = query.data.requests

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-h2 text-foreground">{t('departments.approvalQueue.title')}</h1>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={filter === 'pending' ? 'primary' : 'secondary'}
            onClick={() => setFilter('pending')}
          >
            {t('departments.approvalQueue.filterPending')}
          </Button>
          <Button
            size="sm"
            variant={filter === 'all' ? 'primary' : 'secondary'}
            onClick={() => setFilter('all')}
          >
            {t('departments.approvalQueue.filterAll')}
          </Button>
        </div>
      </div>

      {requests.length === 0 ? (
        <StateView kind="empty" titleKey="departments.approvalQueue.empty.title" />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {requests.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-body font-medium text-foreground">{r.name}</p>
                  <p className="text-small text-muted-foreground">
                    {t('departments.approvalQueue.requestedBy')}: {r.requesterName} ·{' '}
                    {t('departments.approvalQueue.unitsCount', { count: r.units.length })}
                  </p>
                  {r.description ? (
                    <p className="text-small text-muted-foreground">{r.description}</p>
                  ) : null}
                </div>
                <Badge
                  tone={
                    r.status === 'approved'
                      ? 'success'
                      : r.status === 'rejected'
                        ? 'destructive'
                        : 'neutral'
                  }
                >
                  {t(`departments.pending.status.${r.status}`)}
                </Badge>
              </div>
              {r.status === 'pending' ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    loading={approve.isPending}
                    onClick={() => approve.mutate(r.id)}
                  >
                    {t('departments.approvalQueue.approve')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setRejectTarget(r)}>
                    {t('departments.approvalQueue.reject')}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={rejectTarget !== null} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent title={t('departments.approvalQueue.rejectDialogTitle')}>
          <div className="flex flex-col gap-3 pt-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-small text-foreground">
                {t('departments.approvalQueue.rejectReasonLabel')}
              </span>
              <textarea
                className="min-h-20 w-full rounded-sm border border-border bg-card px-3 py-2 text-body text-foreground"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <Button
              variant="destructive"
              loading={reject.isPending}
              onClick={() => reject.mutate()}
            >
              {t('departments.approvalQueue.rejectSubmit')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
