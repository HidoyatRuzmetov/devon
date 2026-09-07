// `/admin/settings` -- registration toggle, four-locale maintenance mode, the sentinel key, and the
// wipe switch (TECH-SPEC §11: typed phrase + password + optional 2FA + a 60-second, server-verified
// countdown with cancel).
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import { LOCALES, LOCALE_LABEL } from '@devon/i18n'
import { Badge, Button, Dialog, DialogContent, Input, StateView, toast } from '@devon/ui'
import { useMeQuery } from '../../lib/session.js'
import {
  cancelWipe,
  executeWipe,
  fetchAdminInstanceDetail,
  fetchMaintenance,
  fetchSentinelStatus,
  fetchWipeStatus,
  patchMaintenance,
  patchRegistration,
  rotateSentinelKey,
  startWipe,
} from './api.js'
import { AdminScreen } from './admin-screen.js'

function RegistrationCard() {
  const t = useT()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['admin', 'instance'], queryFn: fetchAdminInstanceDetail })

  const toggle = useMutation({
    mutationFn: (open: boolean) => patchRegistration(open, meQuery.data?.csrfToken ?? ''),
    onSuccess: () => {
      toast(t('admin.console.settings.registrationSavedToast'))
      void queryClient.invalidateQueries({ queryKey: ['admin', 'instance'] })
    },
  })

  return (
    <section className="rounded-md border border-border bg-card p-6">
      <h2 className="mb-1 text-h3 text-foreground">
        {t('admin.console.settings.registrationTitle')}
      </h2>
      <p className="mb-4 text-small text-muted-foreground">
        {t('admin.console.settings.registrationBody')}
      </p>
      {query.isPending ? (
        <StateView kind="loading" titleKey="state.loading" />
      ) : (
        <Button
          variant={query.data?.registrationOpen ? 'destructive' : 'primary'}
          loading={toggle.isPending}
          onClick={() => toggle.mutate(!query.data?.registrationOpen)}
        >
          {t(
            query.data?.registrationOpen
              ? 'admin.console.settings.registrationClose'
              : 'admin.console.settings.registrationOpen',
          )}
        </Button>
      )}
    </section>
  )
}

function MaintenanceCard() {
  const t = useT()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['admin', 'maintenance'], queryFn: fetchMaintenance })
  const [messages, setMessages] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    if (query.data?.message) setMessages(query.data.message)
  }, [query.data?.message])

  const save = useMutation({
    mutationFn: (enabled: boolean) =>
      patchMaintenance({ enabled, message: messages }, meQuery.data?.csrfToken ?? ''),
    onSuccess: () => {
      toast(t('admin.console.settings.maintenanceSavedToast'))
      void queryClient.invalidateQueries({ queryKey: ['admin', 'maintenance'] })
    },
  })

  if (query.isPending) {
    return <StateView kind="loading" titleKey="state.loading" />
  }

  return (
    <section className="rounded-md border border-border bg-card p-6">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-h3 text-foreground">{t('admin.console.settings.maintenanceTitle')}</h2>
        {query.data?.enabled ? (
          <Badge tone="warning">{t('admin.console.settings.maintenanceOnBadge')}</Badge>
        ) : null}
      </div>
      <p className="mb-4 text-small text-muted-foreground">
        {t('admin.console.settings.maintenanceBody')}
      </p>
      <div className="flex flex-col gap-3">
        {LOCALES.map((locale) => (
          <label key={locale} className="flex flex-col gap-1.5">
            <span className="text-small text-foreground">{LOCALE_LABEL[locale]}</span>
            <textarea
              className="min-h-16 w-full rounded-sm border border-border bg-card px-3 py-2 text-body text-foreground"
              value={messages[locale] ?? ''}
              onChange={(e) => setMessages((m) => ({ ...m, [locale]: e.target.value }))}
              placeholder={t('admin.console.settings.maintenanceMessagePlaceholder')}
            />
          </label>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <Button
          variant={query.data?.enabled ? 'destructive' : 'primary'}
          loading={save.isPending}
          onClick={() => save.mutate(!query.data?.enabled)}
        >
          {t(
            query.data?.enabled
              ? 'admin.console.settings.maintenanceDisable'
              : 'admin.console.settings.maintenanceEnable',
          )}
        </Button>
        {query.data?.enabled ? (
          <Button variant="secondary" loading={save.isPending} onClick={() => save.mutate(true)}>
            {t('admin.console.settings.maintenanceSaveMessage')}
          </Button>
        ) : null}
      </div>
    </section>
  )
}

function SentinelCard() {
  const t = useT()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['admin', 'sentinel', 'status'],
    queryFn: fetchSentinelStatus,
  })

  const rotate = useMutation({
    mutationFn: () => rotateSentinelKey(meQuery.data?.csrfToken ?? ''),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'sentinel', 'status'] })
    },
  })

  return (
    <section className="rounded-md border border-border bg-card p-6">
      <h2 className="mb-1 text-h3 text-foreground">{t('admin.console.settings.sentinelTitle')}</h2>
      <p className="mb-4 text-small text-muted-foreground">
        {t('admin.console.settings.sentinelBody')}
      </p>
      {query.isPending ? (
        <StateView kind="loading" titleKey="state.loading" />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Badge tone={query.data?.hasActiveKey ? 'success' : 'warning'}>
              {t(
                query.data?.hasActiveKey
                  ? 'admin.console.settings.sentinelConfigured'
                  : 'admin.console.settings.sentinelNotConfigured',
              )}
            </Badge>
            <Button
              size="sm"
              variant="secondary"
              loading={rotate.isPending}
              onClick={() => rotate.mutate()}
            >
              {t(
                query.data?.hasActiveKey
                  ? 'admin.console.settings.sentinelRotate'
                  : 'admin.console.settings.sentinelGenerate',
              )}
            </Button>
          </div>
          {query.data?.publicKeyB64 ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-small text-foreground">
                {t('admin.console.settings.sentinelPublicKeyLabel')}
              </span>
              <code className="select-all break-all rounded-sm border border-border bg-muted p-3 text-small">
                {query.data.publicKeyB64}
              </code>
              <p className="text-caption text-muted-foreground">
                {t('admin.console.settings.sentinelPublicKeyHint')}
              </p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}

const WIPE_POLL_MS = 1000

function WipeCard() {
  const t = useT()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const instanceQuery = useQuery({
    queryKey: ['admin', 'instance'],
    queryFn: fetchAdminInstanceDetail,
  })
  const [open, setOpen] = React.useState(false)
  const [phrase, setPhrase] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [totpCode, setTotpCode] = React.useState('')
  const executedRef = React.useRef(false)

  const statusQuery = useQuery({
    queryKey: ['admin', 'wipe', 'status'],
    queryFn: fetchWipeStatus,
    refetchInterval: WIPE_POLL_MS,
  })
  const pending = statusQuery.data ?? null
  const secondsRemaining = pending
    ? Math.max(0, Math.ceil((new Date(pending.countdownEndsAt).getTime() - Date.now()) / 1000))
    : 0

  const start = useMutation({
    mutationFn: () =>
      startWipe(
        { phrase, password, totpCode: totpCode || undefined },
        meQuery.data?.csrfToken ?? '',
      ),
    onSuccess: () => {
      setOpen(false)
      setPhrase('')
      setPassword('')
      setTotpCode('')
      executedRef.current = false
      void queryClient.invalidateQueries({ queryKey: ['admin', 'wipe'] })
    },
    onError: () => toast(t('admin.console.settings.wipeStartFailedToast')),
  })
  const cancel = useMutation({
    mutationFn: () => cancelWipe(meQuery.data?.csrfToken ?? ''),
    onSuccess: () => {
      toast(t('admin.console.settings.wipeCancelledToast'))
      void queryClient.invalidateQueries({ queryKey: ['admin', 'wipe'] })
    },
  })
  const execute = useMutation({
    mutationFn: () => executeWipe(meQuery.data?.csrfToken ?? ''),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'wipe'] }),
  })

  React.useEffect(() => {
    if (pending?.status === 'countdown' && secondsRemaining <= 0 && !executedRef.current) {
      executedRef.current = true
      execute.mutate()
    }
  }, [pending?.status, secondsRemaining, execute])

  const expectedPhrase =
    instanceQuery.data !== undefined
      ? `WIPE ${instanceQuery.data.userCount} ${instanceQuery.data.isDemo ? 'DEMO' : 'PROD'}`
      : ''

  function renderWipeStatus(): React.ReactNode {
    if (pending && pending.status === 'countdown') {
      return (
        <div className="flex flex-col gap-3 rounded-md border border-destructive bg-destructive/10 p-4">
          <p className="text-h2 tabular-nums text-destructive">{secondsRemaining}s</p>
          <p className="text-small text-foreground">
            {t('admin.console.settings.wipeCountdownBody')}
          </p>
          <Button variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate()}>
            {t('admin.console.settings.wipeCancel')}
          </Button>
        </div>
      )
    }
    if (pending?.status === 'executing') {
      return <StateView kind="loading" titleKey="admin.console.settings.wipeExecuting" />
    }
    if (pending?.status === 'failed') {
      return (
        <div className="rounded-md border border-destructive bg-destructive/10 p-4 text-small text-foreground">
          {t('admin.console.settings.wipeFailed')}: {pending.failureReason}
        </div>
      )
    }
    return (
      <Button variant="destructive" onClick={() => setOpen(true)}>
        {t('admin.console.settings.wipeStartCta')}
      </Button>
    )
  }

  return (
    <section className="rounded-md border border-destructive bg-card p-6">
      <h2 className="mb-1 text-h3 text-destructive">{t('admin.console.settings.wipeTitle')}</h2>
      <p className="mb-4 text-small text-muted-foreground">
        {t('admin.console.settings.wipeBody')}
      </p>

      {renderWipeStatus()}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t('admin.console.settings.wipeDialogTitle')}>
          <div className="flex flex-col gap-3 pt-4">
            <p className="text-body text-muted-foreground">
              {t('admin.console.settings.wipeDialogBody')}
            </p>
            <label className="flex flex-col gap-1.5">
              <span className="text-small text-foreground">
                {t('admin.console.settings.wipePhraseLabel', { phrase: expectedPhrase })}
              </span>
              <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-small text-foreground">
                {t('admin.console.settings.wipePasswordLabel')}
              </span>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-small text-foreground">
                {t('admin.console.settings.wipeTotpLabel')}
              </span>
              <Input value={totpCode} onChange={(e) => setTotpCode(e.target.value)} maxLength={6} />
            </label>
            <Button
              variant="destructive"
              disabled={phrase !== expectedPhrase || password.length === 0}
              loading={start.isPending}
              onClick={() => start.mutate()}
            >
              {t('admin.console.settings.wipeConfirmCta')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function SettingsBody() {
  return (
    <div className="flex flex-col gap-6">
      <RegistrationCard />
      <MaintenanceCard />
      <SentinelCard />
      <WipeCard />
    </div>
  )
}

export default function SettingsScreen() {
  return (
    <AdminScreen active="settings">
      <SettingsBody />
    </AdminScreen>
  )
}
