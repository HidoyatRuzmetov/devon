// `/admin/audit` -- paginated audit log, hash-chain verification, CSV export.
import * as React from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useT, useLocale, formatDate, formatTime } from '@devon/i18n'
import { AnimatedCheck, Badge, Button, Input, StateView, toast } from '@devon/ui'
import { AlertTriangle } from 'lucide-react'
import { auditExportUrl, fetchAuditEvents, fetchAuditVerify } from './api.js'
import { AdminScreen } from './admin-screen.js'

/** UI-OVERHAUL.md §2 "Admin console ... audit viewer with chain-verify badge animation": the check
 * draws in the moment a chain verification comes back clean, instead of a badge that is simply
 * already there -- "verified" is an event, not a static label. Starts unchecked and flips true one
 * frame after mount (the same trick every "draw in on arrival" spot in this app uses, since
 * `AnimatedCheck`'s own `initial={false}` means a check born already-`true` never animates). A broken
 * chain gets a plain (still) warning icon: alarm, never celebration. */
function ChainVerifyBadge({ ok }: { ok: boolean }) {
  const t = useT()
  const [checked, setChecked] = React.useState(false)
  React.useEffect(() => {
    if (!ok) return
    const id = requestAnimationFrame(() => setChecked(true))
    return () => cancelAnimationFrame(id)
  }, [ok])

  return (
    <Badge tone={ok ? 'success' : 'destructive'} className="gap-1">
      {ok ? (
        <AnimatedCheck checked={checked} className="size-3.5" />
      ) : (
        <AlertTriangle className="size-3.5" aria-hidden="true" />
      )}
      {t(ok ? 'admin.console.audit.chainOk' : 'admin.console.audit.chainBroken')}
    </Badge>
  )
}

function AuditBody() {
  const t = useT()
  const locale = useLocale()
  const [action, setAction] = React.useState('')
  const [cursors, setCursors] = React.useState<number[]>([])
  const cursor = cursors[cursors.length - 1]

  const listQuery = useQuery({
    queryKey: ['admin', 'audit', 'events', action, cursor],
    queryFn: () => fetchAuditEvents({ action: action || undefined, cursor }),
  })

  const verify = useMutation({
    mutationFn: fetchAuditVerify,
    onSuccess: (result) => {
      toast(
        result.ok
          ? t('admin.console.audit.verifyOkToast')
          : t('admin.console.audit.verifyFailedToast'),
      )
    },
  })

  if (listQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (listQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => listQuery.refetch() }}
      />
    )
  }

  const events = listQuery.data.events

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={action}
          onChange={(e) => {
            setAction(e.target.value)
            setCursors([])
          }}
          placeholder={t('admin.console.audit.actionFilterPlaceholder')}
          aria-label={t('admin.console.audit.actionFilterPlaceholder')}
          className="max-w-80"
        />
        <Button variant="secondary" onClick={() => verify.mutate()} loading={verify.isPending}>
          {t('admin.console.audit.verifyChain')}
        </Button>
        <a href={auditExportUrl(action || undefined)}>
          <Button variant="secondary">{t('admin.console.audit.export')}</Button>
        </a>
      </div>

      {verify.data ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-4 text-small text-foreground">
          <ChainVerifyBadge ok={verify.data.ok} />
          {t('admin.console.audit.chainRowsChecked', { count: verify.data.rows })}
        </div>
      ) : null}

      {events.length === 0 ? (
        <StateView kind="empty" titleKey="admin.console.audit.empty.title" />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-small">
            <thead className="border-b border-border bg-muted text-left text-caption text-muted-foreground">
              <tr>
                <th className="p-2">{t('admin.console.audit.columnAt')}</th>
                <th className="p-2">{t('admin.console.audit.columnAction')}</th>
                <th className="p-2">{t('admin.console.audit.columnActor')}</th>
                <th className="p-2">{t('admin.console.audit.columnSubject')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {events.map((e) => (
                <tr key={e.seq}>
                  <td className="p-2 text-foreground">
                    {formatDate(new Date(e.at), locale)} {formatTime(new Date(e.at), locale)}
                  </td>
                  <td className="p-2 font-mono text-foreground">{e.action}</td>
                  <td className="p-2 text-muted-foreground">{e.actorRole ?? '—'}</td>
                  <td className="p-2 text-muted-foreground">
                    {e.subjectType}
                    {e.subjectId ? ` · ${e.subjectId.slice(0, 8)}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={cursors.length === 0}
          onClick={() => setCursors((c) => c.slice(0, -1))}
        >
          {t('admin.console.audit.previousPage')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={listQuery.data.nextCursor === null}
          onClick={() => {
            if (listQuery.data.nextCursor !== null) {
              setCursors((c) => [...c, listQuery.data.nextCursor as number])
            }
          }}
        >
          {t('admin.console.audit.nextPage')}
        </Button>
      </div>
    </div>
  )
}

export default function AuditScreen() {
  return (
    <AdminScreen active="audit">
      <AuditBody />
    </AdminScreen>
  )
}
