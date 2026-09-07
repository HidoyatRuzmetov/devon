// `/departments/requests` -- super-admin approval queue (TECH-SPEC §2.2). A `member`/`head` visiting
// this route gets a 403 from the API (`{kind:'instance'}`, `can()`); rendered as the shared "forbidden"
// state rather than a raw error. Rebuilt to this pass's brief: "approval queue for the super admin
// with approve/reject sheets" -- a row opens a routed-feeling side panel with the full request, and
// approve/reject both happen from there.
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import {
  Badge,
  Button,
  DataList,
  DataRow,
  IconButton,
  PageHeader,
  Reveal,
  Sheet,
  SheetContent,
  StateView,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
} from '@devon/ui'
import { ChevronRight, X } from 'lucide-react'
import { ApiError } from '../../lib/api-client.js'
import { useMeQuery } from '../../lib/session.js'
import { approveRequest, fetchAllRequests, rejectRequest, type DepartmentRequest } from './api.js'

const STATUS_TONE = { pending: 'neutral', approved: 'success', rejected: 'destructive' } as const

export default function ApprovalQueueScreen() {
  const t = useT()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const [filter, setFilter] = React.useState<'pending' | 'all'>('pending')
  const [openRequest, setOpenRequest] = React.useState<DepartmentRequest | null>(null)
  const [rejecting, setRejecting] = React.useState(false)
  const [reason, setReason] = React.useState('')

  const query = useQuery({
    queryKey: ['departments', 'requests', 'all', filter],
    queryFn: () => fetchAllRequests(filter === 'pending' ? 'pending' : undefined),
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['departments', 'requests', 'all'] })

  const approve = useMutation({
    mutationFn: (id: string) => approveRequest(id, meQuery.data?.csrfToken ?? ''),
    onSuccess: () => {
      toast(t('departments.approvalQueue.approvedToast'))
      setOpenRequest(null)
      void invalidate()
    },
  })
  const reject = useMutation({
    mutationFn: () => rejectRequest(openRequest!.id, reason, meQuery.data?.csrfToken ?? ''),
    onSuccess: () => {
      toast(t('departments.approvalQueue.rejectedToast'))
      setOpenRequest(null)
      setRejecting(false)
      setReason('')
      void invalidate()
    },
  })

  if (query.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 403) {
      return (
        <StateView kind="forbidden" titleKey="state.denied.title" bodyKey="state.denied.body" />
      )
    }
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => query.refetch() }}
      />
    )
  }

  const requests = query.data.requests

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('departments.approvalQueue.title')}
        tabs={
          <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <TabsList>
              <TabsTrigger value="pending">
                {t('departments.approvalQueue.filterPending')}
              </TabsTrigger>
              <TabsTrigger value="all">{t('departments.approvalQueue.filterAll')}</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      {requests.length === 0 ? (
        <StateView kind="empty" titleKey="departments.approvalQueue.empty.title" />
      ) : (
        <Reveal>
          <DataList label={t('departments.approvalQueue.title')}>
            {requests.map((r) => (
              <DataRow
                key={r.id}
                interactive
                onClick={() => setOpenRequest(r)}
                trailing={
                  <>
                    <Badge tone={STATUS_TONE[r.status]}>
                      {t(`departments.pending.status.${r.status}`)}
                    </Badge>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                  </>
                }
              >
                <div className="min-w-0">
                  <p className="truncate text-body font-medium text-foreground">{r.name}</p>
                  <p className="truncate text-small text-muted-foreground">
                    {t('departments.approvalQueue.requestedBy')}: {r.requesterName} ·{' '}
                    {t('departments.approvalQueue.unitsCount', { count: r.units.length })}
                  </p>
                </div>
              </DataRow>
            ))}
          </DataList>
        </Reveal>
      )}

      <Sheet
        direction="right"
        open={openRequest !== null}
        onOpenChange={(open) => {
          if (!open) {
            setOpenRequest(null)
            setRejecting(false)
            setReason('')
          }
        }}
      >
        <SheetContent
          title={openRequest?.name ?? ''}
          side="right"
          className="flex flex-col gap-5 overflow-y-auto p-5"
        >
          {openRequest ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-h3 text-foreground">{openRequest.name}</h2>
                  <p className="text-small text-muted-foreground">
                    {t('departments.approvalQueue.requestedBy')}: {openRequest.requesterName}
                  </p>
                </div>
                <IconButton
                  aria-label={t('structure.units.chart.closePanel')}
                  onClick={() => setOpenRequest(null)}
                >
                  <X className="size-4" aria-hidden="true" />
                </IconButton>
              </div>

              <Badge tone={STATUS_TONE[openRequest.status]} className="w-fit">
                {t(`departments.pending.status.${openRequest.status}`)}
              </Badge>

              {openRequest.description ? (
                <p className="text-small text-foreground">{openRequest.description}</p>
              ) : null}

              <div className="flex flex-col gap-2">
                <span className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
                  {t('departments.approvalQueue.unitsCount', { count: openRequest.units.length })}
                </span>
                {openRequest.units.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {openRequest.units.map((u, i) => (
                      <span
                        key={i}
                        className="inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-2.5 text-caption font-medium text-foreground"
                      >
                        <span
                          aria-hidden="true"
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: u.colour ?? undefined }}
                        />
                        {u.name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              {openRequest.status === 'pending' ? (
                rejecting ? (
                  <div className="flex flex-col gap-3">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-small text-foreground">
                        {t('departments.approvalQueue.rejectReasonLabel')}
                      </span>
                      <textarea
                        autoFocus
                        className="min-h-24 w-full rounded-sm border border-border bg-card px-3 py-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" onClick={() => setRejecting(false)}>
                        {t('departments.approvalQueue.rejectCancel')}
                      </Button>
                      <Button
                        variant="destructive"
                        loading={reject.isPending}
                        onClick={() => reject.mutate()}
                      >
                        {t('departments.approvalQueue.rejectSubmit')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-auto flex gap-2 pt-4">
                    <Button
                      className="flex-1"
                      loading={approve.isPending}
                      onClick={() => approve.mutate(openRequest.id)}
                    >
                      {t('departments.approvalQueue.approve')}
                    </Button>
                    <Button
                      variant="secondary"
                      className="flex-1"
                      onClick={() => setRejecting(true)}
                    >
                      {t('departments.approvalQueue.reject')}
                    </Button>
                  </div>
                )
              ) : null}
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
