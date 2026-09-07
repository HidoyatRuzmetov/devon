// `/admin/settings` -- registration toggle, four-locale maintenance mode, the sentinel key, and the
// wipe switch (TECH-SPEC §11: typed phrase + password + optional 2FA + a 60-second, server-verified
// countdown with cancel).
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import { LOCALES, LOCALE_LABEL } from '@devon/i18n'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  IconButton,
  Input,
  ProgressRing,
  StateView,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@devon/ui'
import { AlertTriangle, Copy } from 'lucide-react'
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
        // round2 SEV3 #26: closing registration is reversible, not a destruction -- painting it
        // the same solid red as the wipe card's own button flattened the danger scale that card is
        // trying to establish. A Switch (this product's own "takes effect now" control) plus a
        // subtle status badge reads as a routine setting; red now means only one thing in this
        // whole console: the wipe.
        <label className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-body text-foreground">
            {t('admin.console.settings.registrationSwitchLabel')}
            <Badge tone={query.data?.registrationOpen ? 'info' : 'neutral'}>
              {t(
                query.data?.registrationOpen
                  ? 'admin.console.settings.registrationStatusOpen'
                  : 'admin.console.settings.registrationStatusClosed',
              )}
            </Badge>
          </span>
          <Switch
            checked={query.data?.registrationOpen ?? false}
            disabled={toggle.isPending}
            onCheckedChange={(next) => toggle.mutate(next)}
          />
        </label>
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
  const [previewLocale, setPreviewLocale] = React.useState<string>(LOCALES[0])

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

      {/* UI-OVERHAUL.md §2 "maintenance message editor in four locales with live preview": one tab
          per locale to edit, the banner exactly as a locked-out member would see it rendered
          alongside -- so a head never publishes a message they have not actually read back. */}
      <Tabs value={previewLocale} onValueChange={setPreviewLocale}>
        <TabsList>
          {LOCALES.map((locale) => (
            <TabsTrigger key={locale} value={locale}>
              {LOCALE_LABEL[locale]}
            </TabsTrigger>
          ))}
        </TabsList>
        {LOCALES.map((locale) => (
          <TabsContent key={locale} value={locale} className="pt-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-small font-medium text-foreground">
                  {t('admin.console.settings.maintenanceMessageLabel')}
                </span>
                <textarea
                  className="min-h-28 w-full rounded-sm border border-border bg-card px-3 py-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={messages[locale] ?? ''}
                  onChange={(e) => setMessages((m) => ({ ...m, [locale]: e.target.value }))}
                  placeholder={t('admin.console.settings.maintenanceMessagePlaceholder')}
                />
              </label>
              <div className="flex flex-col gap-1.5">
                <span className="text-small font-medium text-foreground">
                  {t('admin.console.settings.maintenancePreviewLabel')}
                </span>
                <div className="flex min-h-28 flex-col gap-2 rounded-md border border-warning bg-warning/10 p-4">
                  <div className="flex items-center gap-2 text-small font-medium text-foreground">
                    <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden="true" />
                    {t('admin.console.settings.maintenancePreviewBadge')}
                  </div>
                  <p className="text-body text-foreground">
                    {(messages[locale] ?? '').trim() ||
                      t('admin.console.settings.maintenancePreviewEmpty')}
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>

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
            {/* DESIGN.md §2.1: green is success/approved/on-track only (round2 SEV2 "Sozlangan"). */}
            <Badge tone={query.data?.hasActiveKey ? 'info' : 'warning'}>
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
              {/* round2 SEV3 #26: the key had no copy affordance at all -- an inline icon button
                  next to the field, the same recipe the invite link and its own review copy. */}
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 select-all break-all rounded-sm border border-border bg-muted p-3 text-small">
                  {query.data.publicKeyB64}
                </code>
                <IconButton
                  aria-label={t('admin.console.settings.sentinelCopyKey')}
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(query.data?.publicKeyB64 ?? '')
                      .then(() => toast(t('admin.console.settings.sentinelKeyCopiedToast')))
                  }}
                >
                  <Copy className="size-4" aria-hidden="true" />
                </IconButton>
              </div>
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

const WIPE_COUNTDOWN_SECONDS_DEFAULT = 60
const WIPE_STEPS = ['warning', 'phrase', 'credentials', 'review'] as const
type WipeStep = (typeof WIPE_STEPS)[number]

function WipeCard() {
  const t = useT()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const instanceQuery = useQuery({
    queryKey: ['admin', 'instance'],
    queryFn: fetchAdminInstanceDetail,
  })
  const [open, setOpen] = React.useState(false)
  const [step, setStep] = React.useState<WipeStep>('warning')
  const [phrase, setPhrase] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [totpCode, setTotpCode] = React.useState('')
  const executedRef = React.useRef(false)
  // The countdown's own duration -- captured from `startWipe`'s response so the ring drains at the
  // right rate; a page reload mid-countdown has nothing but `countdownEndsAt` to go on (design.md's
  // documented "60-second ... countdown" is the honest fallback for that one case).
  const totalSecondsRef = React.useRef(WIPE_COUNTDOWN_SECONDS_DEFAULT)

  const statusQuery = useQuery({
    queryKey: ['admin', 'wipe', 'status'],
    queryFn: fetchWipeStatus,
    refetchInterval: WIPE_POLL_MS,
  })
  const pending = statusQuery.data ?? null
  const secondsRemaining = pending
    ? Math.max(0, Math.ceil((new Date(pending.countdownEndsAt).getTime() - Date.now()) / 1000))
    : 0

  function closeDialog() {
    setOpen(false)
    setStep('warning')
  }

  const start = useMutation({
    mutationFn: () =>
      startWipe(
        { phrase, password, totpCode: totpCode || undefined },
        meQuery.data?.csrfToken ?? '',
      ),
    onSuccess: (result) => {
      totalSecondsRef.current = result.countdownSeconds
      closeDialog()
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
      const totalSeconds = totalSecondsRef.current
      const ringPercent =
        totalSeconds > 0 ? Math.max(0, Math.min(100, (secondsRemaining / totalSeconds) * 100)) : 0
      return (
        <div className="flex items-center gap-4 rounded-md border border-destructive bg-destructive/10 p-4">
          <ProgressRing
            value={ringPercent}
            size={64}
            strokeWidth={5}
            toneClassName="text-destructive"
            label={t('admin.console.settings.wipeCountdownAria', { seconds: secondsRemaining })}
          >
            <span className="text-small font-semibold tabular-nums text-destructive">
              {secondsRemaining}s
            </span>
          </ProgressRing>
          <div className="flex flex-1 flex-col gap-2">
            <p className="text-small text-foreground">
              {t('admin.console.settings.wipeCountdownBody')}
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="self-start"
              loading={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              {t('admin.console.settings.wipeCancel')}
            </Button>
          </div>
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

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) setOpen(true)
          else closeDialog()
        }}
      >
        <DialogContent title={t('admin.console.settings.wipeDialogTitle')} className="max-w-lg">
          <div className="flex flex-col gap-4 pt-4">
            <div className="flex items-center gap-1.5" aria-hidden="true">
              {WIPE_STEPS.map((s, i) => (
                <span
                  key={s}
                  className={
                    'h-1 flex-1 rounded-full ' +
                    (WIPE_STEPS.indexOf(step) >= i ? 'bg-destructive' : 'bg-muted')
                  }
                />
              ))}
            </div>
            <p className="text-caption text-muted-foreground">
              {t('admin.console.settings.wipeStepOf', {
                step: WIPE_STEPS.indexOf(step) + 1,
                total: WIPE_STEPS.length,
              })}
            </p>

            {renderWipeStep()}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )

  // TECH-SPEC §11's ceremony ("typed phrase + password + optional 2FA + a 60-second, server-verified
  // countdown with cancel") as a multi-step dialog (UI-OVERHAUL.md §2 "wipe ceremony as a multi-step
  // full dialog"): a warning the head must actively pass through, then the phrase, then credentials,
  // then a review that shows exactly what is about to be submitted -- each step's own `disabled` gate
  // keeps the "Next" affordance honest, never simply hidden.
  function renderWipeStep(): React.ReactNode {
    if (step === 'warning') {
      return (
        <>
          <div className="flex items-start gap-3 rounded-md border border-destructive bg-destructive/10 p-4">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
            <p className="text-body text-foreground">
              {t('admin.console.settings.wipeDialogBody')}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeDialog}>
              {t('admin.console.settings.wipeStepCancel')}
            </Button>
            <Button variant="destructive" onClick={() => setStep('phrase')}>
              {t('admin.console.settings.wipeStepContinue')}
            </Button>
          </div>
        </>
      )
    }
    if (step === 'phrase') {
      return (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-small text-foreground">
              {t('admin.console.settings.wipePhraseLabel', { phrase: expectedPhrase })}
            </span>
            <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} />
          </label>
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep('warning')}>
              {t('admin.console.settings.wipeStepBack')}
            </Button>
            <Button
              variant="destructive"
              disabled={phrase !== expectedPhrase}
              onClick={() => setStep('credentials')}
            >
              {t('admin.console.settings.wipeStepContinue')}
            </Button>
          </div>
        </>
      )
    }
    if (step === 'credentials') {
      return (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-small text-foreground">
              {t('admin.console.settings.wipePasswordLabel')}
            </span>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-small text-foreground">
              {t('admin.console.settings.wipeTotpLabel')}
            </span>
            <Input value={totpCode} onChange={(e) => setTotpCode(e.target.value)} maxLength={6} />
          </label>
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep('phrase')}>
              {t('admin.console.settings.wipeStepBack')}
            </Button>
            <Button
              variant="destructive"
              disabled={password.length === 0}
              onClick={() => setStep('review')}
            >
              {t('admin.console.settings.wipeStepContinue')}
            </Button>
          </div>
        </>
      )
    }
    return (
      <>
        <dl className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3 text-small">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">
              {t('admin.console.settings.wipeReviewPhrase')}
            </dt>
            <dd className="font-mono text-foreground">{phrase}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">
              {t('admin.console.settings.wipeReviewPassword')}
            </dt>
            <dd className="text-foreground">{'•'.repeat(Math.min(password.length, 12))}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t('admin.console.settings.wipeReviewTotp')}</dt>
            <dd className="font-mono text-foreground">
              {totpCode || t('admin.console.settings.wipeReviewTotpNone')}
            </dd>
          </div>
        </dl>
        <p className="text-small text-muted-foreground">
          {t('admin.console.settings.wipeReviewBody')}
        </p>
        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={() => setStep('credentials')}>
            {t('admin.console.settings.wipeStepBack')}
          </Button>
          <Button variant="destructive" loading={start.isPending} onClick={() => start.mutate()}>
            {t('admin.console.settings.wipeConfirmCta')}
          </Button>
        </div>
      </>
    )
  }
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
