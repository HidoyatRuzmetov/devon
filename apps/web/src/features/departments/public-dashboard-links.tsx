import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { dashboardLinkSchema } from '@devon/contracts'
import { Button, Input, toast } from '@devon/ui'
import { SettingsSection } from '../accounts/settings-section.js'
import { ConfirmDialog } from './components/confirm-dialog.js'
import { Copy, ExternalLink, Link2 } from 'lucide-react'
import { useT } from '@devon/i18n'
import { apiClient } from '../../lib/api-client.js'
import { useMeQuery } from '../../lib/session.js'

export function PublicDashboardLinks({ departmentId }: { departmentId: string }) {
  const me = useMeQuery()
  const t = useT(),
    client = useQueryClient()
  const path = `/api/v1/departments/${departmentId}/public-links`
  const queryKey = ['public-dashboard-links', departmentId]
  const links = useQuery({
    queryKey,
    queryFn: () => apiClient.get(path, z.array(dashboardLinkSchema)),
  })
  const [label, setLabel] = React.useState('')
  const [days, setDays] = React.useState('30')
  const [issued, setIssued] = React.useState<{ id: string; url: string } | null>(null)
  const [closing, setClosing] = React.useState<string | null>(null)
  const atLimit =
    (links.data?.filter((l) => !l.revokedAt && (!l.expiresAt || new Date(l.expiresAt) > new Date()))
      .length ?? 0) >= 10
  const create = useMutation({
    mutationFn: () =>
      apiClient.post(
        path,
        {
          label: label.trim() || t('publicDashboard.defaultLabel'),
          days: days === 'never' ? null : Number(days),
        },
        dashboardLinkSchema.extend({ token: z.string() }),
        me.data?.csrfToken ?? '',
      ),
    onSuccess: (link) => {
      setIssued({ id: link.id, url: `${location.origin}/view/#${link.token}` })
      setLabel('')
      void client.invalidateQueries({ queryKey })
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => apiClient.delete(`${path}/${id}`, me.data?.csrfToken ?? ''),
    onSuccess: (_, id) => {
      if (issued?.id === id) setIssued(null)
      setClosing(null)
      void client.invalidateQueries({ queryKey })
    },
  })
  return (
    <div className="flex flex-col gap-5">
      <SettingsSection
        title={t('publicDashboard.title')}
        description={t('publicDashboard.description')}
      >
        <div className="rounded-lg border border-primary/15 bg-primary/5 p-4 text-small">
          <p className="font-medium">{t('publicDashboard.visible')}</p>
          <p className="mt-1 text-muted-foreground">{t('publicDashboard.hidden')}</p>
          <p className="mt-3">{t('publicDashboard.anyone')}</p>
        </div>
        <form
          className="mt-5 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <label className="flex min-w-48 flex-1 flex-col gap-1.5 text-small">
            {t('publicDashboard.label')}
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={80}
              placeholder={t('publicDashboard.defaultLabel')}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-small">
            {t('publicDashboard.expiry')}
            <select
              className="min-h-11 rounded-md border border-border bg-card px-3"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            >
              {['7', '30', '90', 'never'].map((v) => (
                <option key={v} value={v}>
                  {t(`publicDashboard.days${v}`)}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={create.isPending || links.isPending || atLimit}>
            <Link2 className="size-4" />
            {t('publicDashboard.create')}
          </Button>
        </form>
        {atLimit && (
          <p className="mt-3 text-small text-muted-foreground">{t('publicDashboard.limit')}</p>
        )}
        {create.isError && (
          <p role="alert" className="mt-3 text-small text-destructive">
            {t('publicDashboard.error')}
          </p>
        )}
        {issued && (
          <div className="mt-5 rounded-lg border border-primary/30 bg-card p-4">
            <p className="text-small font-medium">{t('publicDashboard.ready')}</p>
            <p className="mt-1 text-small text-muted-foreground">{t('publicDashboard.copyOnce')}</p>
            <label className="mt-3 block">
              <span className="sr-only">{t('publicDashboard.link')}</span>
              <Input readOnly value={issued.url} onFocus={(e) => e.currentTarget.select()} />
            </label>
            <div className="mt-3 flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(issued.url)
                    .then(() => toast(t('publicDashboard.copied')))
                    .catch(() => toast(t('publicDashboard.copyFallback')))
                }}
              >
                <Copy className="size-4" />
                {t('publicDashboard.copy')}
              </Button>
              <Button asChild variant="secondary">
                <a href={issued.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4" />
                  {t('publicDashboard.preview')}
                </a>
              </Button>
            </div>
          </div>
        )}
      </SettingsSection>
      <SettingsSection
        title={t('publicDashboard.links')}
        description={t('publicDashboard.revokeHint')}
      >
        {links.isPending ? (
          <p>{t('publicDashboard.loading')}</p>
        ) : links.isError ? (
          <p role="alert">
            {t('publicDashboard.error')}{' '}
            <Button variant="secondary" onClick={() => void links.refetch()}>
              {t('publicDashboard.retry')}
            </Button>
          </p>
        ) : !links.data?.length ? (
          <p className="text-small text-muted-foreground">{t('publicDashboard.empty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {links.data.map((link) => {
              const closed = Boolean(link.revokedAt),
                expired = Boolean(link.expiresAt && new Date(link.expiresAt) <= new Date())
              return (
                <li
                  key={link.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                >
                  <div>
                    <p className="text-small font-medium">{link.label}</p>
                    <p className="mt-1 text-caption text-muted-foreground">
                      {closed
                        ? t('publicDashboard.closed')
                        : expired
                          ? t('publicDashboard.expired')
                          : link.expiresAt
                            ? `${t('publicDashboard.expires')} ${new Date(link.expiresAt).toLocaleDateString()}`
                            : t('publicDashboard.daysnever')}
                    </p>
                  </div>
                  {!closed && !expired && (
                    <Button variant="secondary" onClick={() => setClosing(link.id)}>
                      {t('publicDashboard.revoke')}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </SettingsSection>
      <ConfirmDialog
        open={closing !== null}
        onOpenChange={(open) => {
          if (!open) setClosing(null)
        }}
        title={t('publicDashboard.revoke')}
        body={t('publicDashboard.revokeConfirm')}
        confirmLabel={t('publicDashboard.revoke')}
        cancelLabel={t('publicDashboard.cancel')}
        loading={revoke.isPending}
        error={revoke.isError ? t('publicDashboard.error') : undefined}
        onConfirm={() => {
          if (closing) revoke.mutate(closing)
        }}
      />
    </div>
  )
}
