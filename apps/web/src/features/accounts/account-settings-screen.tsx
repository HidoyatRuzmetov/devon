// `/account` -- EPIC-001: sessions/devices, 2FA, password change, account deletion. One screen with a
// few sections rather than several thin routes (this module's own screens/components only, per
// MODULE-GUIDE.md "Web features").
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { useT } from '@devon/i18n'
import { Badge, Button, Dialog, DialogContent, Input, Separator, StateView, toast } from '@devon/ui'
import { useMeQuery } from '../../lib/session.js'
import {
  cancelAccountDeletion,
  changePassword,
  disableTotp,
  enrollTotp,
  fetchDeletionStatus,
  fetchSessions,
  fetchTwoFactorStatus,
  requestAccountDeletion,
  revokeAllSessions,
  revokeSession,
  verifyTotpEnroll,
  type SessionView,
} from './api.js'

function useCsrfToken(): string {
  const meQuery = useMeQuery()
  return meQuery.data?.csrfToken ?? ''
}

function SessionsSection() {
  const t = useT()
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['accounts', 'sessions'], queryFn: fetchSessions })

  const revokeOne = useMutation({
    mutationFn: (id: string) => revokeSession(id, csrfToken),
    onSuccess: () => {
      toast(t('accounts.sessions.revokedToast'))
      void queryClient.invalidateQueries({ queryKey: ['accounts', 'sessions'] })
    },
  })
  const revokeAll = useMutation({
    mutationFn: () => revokeAllSessions(csrfToken),
    onSuccess: () => {
      toast(t('accounts.sessions.revokedAllToast'))
      window.location.href = '/login?signedOut=1'
    },
  })

  let body: React.ReactNode
  if (query.isPending) {
    body = <StateView kind="loading" titleKey="state.loading" />
  } else if (query.isError) {
    body = <StateView kind="error" titleKey="state.error.title" bodyKey="state.error.body" />
  } else if (query.data.sessions.length === 0) {
    body = <StateView kind="empty" titleKey="accounts.sessions.empty.title" />
  } else {
    body = (
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {query.data.sessions.map((s: SessionView) => (
          <li key={s.id} className="flex items-center justify-between gap-3 p-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-body text-foreground">
                {s.userAgent ?? '—'}{' '}
                {s.isCurrent ? <Badge>{t('accounts.sessions.current')}</Badge> : null}
              </span>
              <span className="text-small text-muted-foreground">
                {s.ip ?? '—'} ·{' '}
                {t('accounts.sessions.lastSeen', { when: new Date(s.lastSeenAt).toLocaleString() })}
              </span>
            </div>
            {!s.isCurrent ? (
              <Button
                variant="ghost"
                size="sm"
                loading={revokeOne.isPending}
                onClick={() => revokeOne.mutate(s.id)}
              >
                {t('accounts.sessions.revoke')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-h3 text-foreground">{t('accounts.sessions.title')}</h2>
          <p className="text-small text-muted-foreground">{t('accounts.sessions.subtitle')}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          loading={revokeAll.isPending}
          onClick={() => {
            if (window.confirm(t('accounts.sessions.revokeAllConfirm'))) revokeAll.mutate()
          }}
        >
          {t('accounts.sessions.revokeAll')}
        </Button>
      </div>

      {body}
    </section>
  )
}

function TwoFactorSection() {
  const t = useT()
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  const statusQuery = useQuery({ queryKey: ['accounts', '2fa'], queryFn: fetchTwoFactorStatus })

  const [enrolling, setEnrolling] = React.useState<{ secret: string; otpauthUri: string } | null>(
    null,
  )
  const [code, setCode] = React.useState('')
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[] | null>(null)
  const [disableOpen, setDisableOpen] = React.useState(false)
  const [disablePassword, setDisablePassword] = React.useState('')
  const [disableError, setDisableError] = React.useState(false)

  const enroll = useMutation({
    mutationFn: () => enrollTotp(csrfToken),
    onSuccess: (result) => setEnrolling(result),
  })
  const verify = useMutation({
    mutationFn: () => verifyTotpEnroll(code, csrfToken),
    onSuccess: (result) => {
      setRecoveryCodes(result.recoveryCodes)
      setEnrolling(null)
      setCode('')
      void queryClient.invalidateQueries({ queryKey: ['accounts', '2fa'] })
    },
  })
  const disable = useMutation({
    mutationFn: () => disableTotp(disablePassword, csrfToken),
    onSuccess: () => {
      setDisableOpen(false)
      setDisablePassword('')
      setDisableError(false)
      void queryClient.invalidateQueries({ queryKey: ['accounts', '2fa'] })
    },
    onError: () => setDisableError(true),
  })

  const enabled = statusQuery.data?.ok ?? false

  let mainContent: React.ReactNode
  if (recoveryCodes) {
    mainContent = (
      <div className="flex flex-col gap-3 rounded-md border border-border bg-muted p-4">
        <h3 className="text-body font-medium text-foreground">
          {t('accounts.twoFactor.enroll.recoveryTitle')}
        </h3>
        <p className="text-small text-muted-foreground">
          {t('accounts.twoFactor.enroll.recoveryBody')}
        </p>
        <ul className="grid grid-cols-2 gap-2 font-mono text-small text-foreground">
          {recoveryCodes.map((c) => (
            <li key={c} className="rounded-sm border border-border bg-card px-2 py-1">
              {c}
            </li>
          ))}
        </ul>
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(recoveryCodes.join('\n'))
            toast(t('accounts.twoFactor.enroll.recoveryCopied'))
          }}
        >
          {t('accounts.twoFactor.enroll.done')}
        </Button>
      </div>
    )
  } else if (enrolling) {
    mainContent = (
      <div className="flex flex-col gap-3 rounded-md border border-border p-4">
        <p className="text-small text-foreground">{t('accounts.twoFactor.enroll.step1')}</p>
        {/* Fixed black-on-white, never theme tokens: an authenticator app's camera needs the highest
            contrast it can find, not the current colour scheme. */}
        <div className="w-fit rounded-md border border-border bg-white p-3">
          <QRCodeSVG value={enrolling.otpauthUri} size={160} fgColor="#000000" bgColor="#ffffff" />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-small text-muted-foreground">
            {t('accounts.twoFactor.enroll.secretLabel')}
          </span>
          <code className="break-all rounded-sm bg-muted px-2 py-1 text-small">
            {enrolling.secret}
          </code>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-small text-foreground">
            {t('accounts.twoFactor.enroll.codeLabel')}
          </span>
          <Input value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} />
        </label>
        {verify.isError ? (
          <p role="alert" className="text-small text-destructive">
            {t('accounts.twoFactor.enroll.error')}
          </p>
        ) : null}
        <Button size="sm" loading={verify.isPending} onClick={() => verify.mutate()}>
          {t('accounts.twoFactor.enroll.verify')}
        </Button>
      </div>
    )
  } else if (enabled) {
    mainContent = (
      <Button variant="secondary" size="sm" className="w-fit" onClick={() => setDisableOpen(true)}>
        {t('accounts.twoFactor.disable')}
      </Button>
    )
  } else {
    mainContent = (
      <Button
        size="sm"
        className="w-fit"
        loading={enroll.isPending}
        onClick={() => enroll.mutate()}
      >
        {t('accounts.twoFactor.enable')}
      </Button>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-h3 text-foreground">{t('accounts.twoFactor.title')}</h2>
          <p className="text-small text-muted-foreground">{t('accounts.twoFactor.subtitle')}</p>
        </div>
        <Badge tone={enabled ? 'success' : 'neutral'}>
          {t(enabled ? 'accounts.twoFactor.enabled' : 'accounts.twoFactor.disabled')}
        </Badge>
      </div>

      {mainContent}

      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent title={t('accounts.twoFactor.disableDialog.title')}>
          <div className="flex flex-col gap-3 pt-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-small text-foreground">
                {t('accounts.twoFactor.disableDialog.passwordLabel')}
              </span>
              <Input
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
              />
            </label>
            {disableError ? (
              <p role="alert" className="text-small text-destructive">
                {t('accounts.twoFactor.disableDialog.error')}
              </p>
            ) : null}
            <Button
              variant="destructive"
              loading={disable.isPending}
              onClick={() => disable.mutate()}
            >
              {t('accounts.twoFactor.disableDialog.submit')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function PasswordSection() {
  const t = useT()
  const csrfToken = useCsrfToken()
  const [current, setCurrent] = React.useState('')
  const [next, setNext] = React.useState('')
  const [message, setMessage] = React.useState<'success' | 'error' | null>(null)

  const mutation = useMutation({
    mutationFn: () => changePassword(current, next, csrfToken),
    onSuccess: () => {
      setMessage('success')
      setCurrent('')
      setNext('')
    },
    onError: () => setMessage('error'),
  })

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-h3 text-foreground">{t('accounts.password.title')}</h2>
      <div className="flex max-w-sm flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-small text-foreground">{t('accounts.password.current')}</span>
          <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-small text-foreground">{t('accounts.password.new')}</span>
          <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        {message !== null ? (
          <p
            role={message === 'success' ? 'status' : 'alert'}
            className={
              message === 'success' ? 'text-small text-foreground' : 'text-small text-destructive'
            }
          >
            {message === 'success' ? t('accounts.password.success') : t('accounts.password.error')}
          </p>
        ) : null}
        <Button
          size="sm"
          className="w-fit"
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {t('accounts.password.submit')}
        </Button>
      </div>
    </section>
  )
}

function DeleteAccountSection() {
  const t = useT()
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  const statusQuery = useQuery({ queryKey: ['accounts', 'deletion'], queryFn: fetchDeletionStatus })

  const request = useMutation({
    mutationFn: () => requestAccountDeletion(csrfToken),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['accounts', 'deletion'] }),
  })
  const cancel = useMutation({
    mutationFn: () => cancelAccountDeletion(csrfToken),
    onSuccess: () => {
      toast(t('accounts.delete.cancelled'))
      void queryClient.invalidateQueries({ queryKey: ['accounts', 'deletion'] })
    },
  })

  const scheduledFor = statusQuery.data?.scheduledFor ?? null

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-h3 text-destructive">{t('accounts.delete.title')}</h2>
      <p className="max-w-lg text-small text-muted-foreground">{t('accounts.delete.warning')}</p>
      {scheduledFor ? (
        <div className="flex items-center gap-3">
          <p className="text-small text-foreground">
            {t('accounts.delete.scheduled', { date: new Date(scheduledFor).toLocaleDateString() })}
          </p>
          <Button
            variant="secondary"
            size="sm"
            loading={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {t('accounts.delete.cancel')}
          </Button>
        </div>
      ) : (
        <Button
          variant="destructive"
          size="sm"
          className="w-fit"
          loading={request.isPending}
          onClick={() => {
            if (window.confirm(t('accounts.delete.confirmDialog'))) request.mutate()
          }}
        >
          {t('accounts.delete.confirm')}
        </Button>
      )}
    </section>
  )
}

export default function AccountSettingsScreen() {
  const t = useT()
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <h1 className="text-h2 text-foreground">{t('accounts.settings.title')}</h1>
      <SessionsSection />
      <Separator />
      <TwoFactorSection />
      <Separator />
      <PasswordSection />
      <Separator />
      <DeleteAccountSection />
    </div>
  )
}
