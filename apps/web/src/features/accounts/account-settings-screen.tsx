// `/account` -- EPIC-001: profile photo, sessions/devices, 2FA, password change, account deletion.
// One screen with a few sections rather than several thin routes (this module's own
// screens/components only, per MODULE-GUIDE.md "Web features").
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import {
  ClipboardList,
  Palette,
  Image as ImageIcon,
  KeyRound,
  Monitor,
  ShieldAlert,
  Smartphone,
  Tablet,
  Trash2,
} from 'lucide-react'
import { useT, useLocale, formatDate, formatRelativeTime } from '@devon/i18n'
import {
  Badge,
  Button,
  cn,
  Collapsible,
  Dialog,
  DialogContent,
  initialsFromName,
  Input,
  PageHeader,
  SectionCard,
  Stagger,
  StaggerItem,
  StateView,
  toast,
} from '@devon/ui'
import { avatarUrl } from '../../lib/avatar.js'
import { ApiError } from '../../lib/api-client.js'
import { useMeQuery } from '../../lib/session.js'
import {
  avatarErrorKey,
  cancelAccountDeletion,
  changePassword,
  disableTotp,
  enrollTotp,
  fetchDeletionStatus,
  fetchSessions,
  fetchTwoFactorStatus,
  removeAvatar,
  requestAccountDeletion,
  revokeAllSessions,
  revokeSession,
  uploadAvatar,
  verifyTotpEnroll,
  type AvatarUploadStage,
  type SessionView,
} from './api.js'
import { MyFieldsSection } from '../fields/components/my-fields-section.js'
import { AvatarPicker } from './avatar-picker.js'
import { describeUserAgent } from './device-label.js'
import { ProfileSection } from './profile-section.js'
import { AppearanceSection } from './appearance-section.js'
import { SettingsNavigation } from './settings-navigation.js'

/** Every user eventually opens this list (item handoff), and a real department can rack up dozens
 * of stale sessions -- five is enough to answer "is this me right now?" without turning the account
 * page into the tallest screen in the product; everything else sits behind one disclosure. */
const SESSIONS_COLLAPSED_COUNT = 5

function useCsrfToken(): string {
  const meQuery = useMeQuery()
  return meQuery.data?.csrfToken ?? ''
}

/** TECH-SPEC §2.1 "photo (optional)": choose -> upload straight to the presigned URL -> the server
 * scans, checks and resizes -> the shell avatar updates from the refreshed `/me`. Removal is a plain
 * action with a toast, not a confirm dialog (DESIGN.md: undo over confirm; a photo is re-uploadable
 * in seconds, so neither is warranted). */
function PhotoSection() {
  const t = useT()
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  const meQuery = useMeQuery()
  const user = meQuery.data?.user ?? null
  const [stage, setStage] = React.useState<AvatarUploadStage | null>(null)
  const [errorKey, setErrorKey] = React.useState<string | null>(null)

  const upload = useMutation({
    mutationFn: (file: File) => uploadAvatar(file, csrfToken, setStage),
    onSuccess: async () => {
      setErrorKey(null)
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      toast(t('accounts.photo.savedToast'))
    },
    onError: (err) => setErrorKey(avatarErrorKey(err)),
    onSettled: () => setStage(null),
  })
  const remove = useMutation({
    mutationFn: () => removeAvatar(csrfToken),
    onSuccess: async () => {
      setErrorKey(null)
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      toast(t('accounts.photo.removedToast'))
    },
    onError: () => setErrorKey('accounts.photo.error.generic'),
  })

  let body: React.ReactNode
  if (meQuery.isPending) {
    body = <StateView kind="loading" titleKey="state.loading" />
  } else if (meQuery.isError) {
    body = <StateView kind="error" titleKey="state.error.title" bodyKey="state.error.body" />
  } else if (!user) {
    body = <StateView kind="forbidden" titleKey="state.forbidden.title" />
  } else {
    body = (
      <AvatarPicker
        currentSrc={avatarUrl(user.avatarKey, 128)}
        file={null}
        alt={t('accounts.photo.alt')}
        initials={initialsFromName(user.givenName, user.familyName)}
        hueSeed={user.id}
        onSelect={(file) => upload.mutate(file)}
        onRemove={() => remove.mutate()}
        busy={stage}
        errorKey={errorKey}
        disabled={remove.isPending}
      />
    )
  }

  return (
    <SectionCard
      id="section-photo"
      title={t('accounts.photo.title')}
      description={t('accounts.photo.subtitle')}
    >
      {body}
    </SectionCard>
  )
}

/** Sniffed straight from `userAgent` -- the sessions endpoint stores exactly what the browser sent
 * at login and nothing more (TECH-SPEC §2.1's device list has no client-side platform field to read
 * instead), so a best-effort icon from that string is what "device icons" can mean here. Wrong on an
 * unusual UA is a cosmetic miss, never a security signal -- the label text next to it is still the
 * real device name. */
function deviceIcon(userAgent: string | null): React.ComponentType<React.SVGProps<SVGSVGElement>> {
  const ua = (userAgent ?? '').toLowerCase()
  if (/ipad|tablet/.test(ua)) return Tablet
  if (/mobi|iphone|android/.test(ua)) return Smartphone
  return Monitor
}

function SessionsSection() {
  const t = useT()
  const locale = useLocale()
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['accounts', 'sessions'], queryFn: fetchSessions })
  const [revokeAllOpen, setRevokeAllOpen] = React.useState(false)
  const [showAll, setShowAll] = React.useState(false)

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
    body = (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void query.refetch() }}
      />
    )
  } else if (query.data.sessions.length === 0) {
    body = <StateView kind="empty" titleKey="accounts.sessions.empty.title" />
  } else {
    // Current session first, then most-recently-active -- "is this me right now?" is the first
    // question this list answers, so it should never be scrolled past the fold.
    const sorted = [...query.data.sessions].sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
      return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
    })
    const base = sorted.slice(0, SESSIONS_COLLAPSED_COUNT)
    const overflow = sorted.slice(SESSIONS_COLLAPSED_COUNT)

    const renderRow = (s: SessionView) => {
      const DeviceIcon = deviceIcon(s.userAgent)
      const device = describeUserAgent(s.userAgent)
      return (
        <StaggerItem
          key={s.id}
          as="li"
          exit="hidden"
          layout
          className={cn(
            'flex items-center justify-between gap-3 p-4',
            s.isCurrent && 'bg-accent/40',
          )}
        >
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
              <DeviceIcon className="size-4.5" aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-2 text-body text-foreground">
                <span className="truncate">
                  {device.label || t('accounts.sessions.unknownDevice')}
                </span>
                {s.isCurrent ? (
                  // A fact about this row, not a status (round2 SEV2 "Joriy qurilma") -- the
                  // brand-tone outline chip, not a status tone.
                  <Badge tone="primary" variant="outline">
                    {t('accounts.sessions.current')}
                  </Badge>
                ) : null}
              </span>
              <span className="truncate text-small text-muted-foreground">
                {s.ip ?? '—'} ·{' '}
                {t('accounts.sessions.lastSeen', {
                  when: formatRelativeTime(new Date(s.lastSeenAt), locale),
                })}
              </span>
            </div>
          </div>
          {!s.isCurrent ? (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              loading={revokeOne.isPending}
              onClick={() => revokeOne.mutate(s.id)}
            >
              {t('accounts.sessions.revoke')}
            </Button>
          ) : null}
        </StaggerItem>
      )
    }

    body = (
      <div className="flex flex-col gap-3">
        {/* UI-OVERHAUL.md §3 "Lists ... 24ms stagger" and "AnimatePresence for exit" -- round2 SEV2
            found zero motion primitives on this screen despite it being the one every user visits.
            `<Stagger presence>` puts framer-motion's presence boundary *inside* the list container
            (wrapping `AnimatePresence` around `Stagger` made the rows grandchildren, and their exits
            inert), so a revoked row animates out instead of vanishing and the survivors slide up;
            `StaggerItem`'s own `exit="hidden"` reverses its entrance variant for that. The overflow beyond `SESSIONS_COLLAPSED_COUNT` sits in its own
            `Collapsible` so "Yana N tasini koʻrsatish" expands with a real height animation instead
            of the extra rows simply appearing. */}
        <div className="overflow-hidden rounded-md border border-border">
          <Stagger presence as="ul" className="flex flex-col divide-y divide-border">
            {base.map(renderRow)}
          </Stagger>
          {overflow.length > 0 ? (
            <Collapsible open={showAll} id="sessions-overflow">
              <Stagger
                presence
                as="ul"
                className="flex flex-col divide-y divide-border border-t border-border"
              >
                {overflow.map(renderRow)}
              </Stagger>
            </Collapsible>
          ) : null}
        </div>
        {!showAll && overflow.length > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={showAll}
            aria-controls="sessions-overflow"
            onClick={() => setShowAll(true)}
          >
            {t('accounts.sessions.showAll', { count: overflow.length })}
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <SectionCard
      id="section-sessions"
      title={t('accounts.sessions.title')}
      description={t('accounts.sessions.subtitle')}
      actions={
        <Button variant="secondary" size="sm" onClick={() => setRevokeAllOpen(true)}>
          {t('accounts.sessions.revokeAll')}
        </Button>
      }
    >
      {body}
      {revokeOne.isError ? (
        <p role="alert" className="text-small text-destructive">
          {t('accounts.settings.saveError')}
        </p>
      ) : null}

      <Dialog open={revokeAllOpen} onOpenChange={setRevokeAllOpen}>
        <DialogContent title={t('accounts.sessions.revokeAll')}>
          <div className="flex flex-col gap-4 pt-4">
            <p className="text-body text-muted-foreground">
              {t('accounts.sessions.revokeAllConfirm')}
            </p>
            {revokeAll.isError ? (
              <p role="alert" className="text-small text-destructive">
                {t('accounts.settings.saveError')}
              </p>
            ) : null}
            <Button
              variant="destructive"
              loading={revokeAll.isPending}
              onClick={() => revokeAll.mutate()}
            >
              {t('accounts.sessions.revokeAll')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </SectionCard>
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
  const [disableError, setDisableError] = React.useState<'password' | 'failed' | null>(null)
  // UI-OVERHAUL.md §3 "Buttons: ... success check morph" -- the "Yoqish" button gets a beat of its
  // own drawn check before the screen advances to the QR step, instead of the QR code simply
  // appearing the instant the request resolves (round2 SEV2: "no success morph" on this exact button).
  const [justEnrolled, setJustEnrolled] = React.useState(false)

  const enroll = useMutation({
    mutationFn: () => enrollTotp(csrfToken),
    onSuccess: (result) => {
      setJustEnrolled(true)
      window.setTimeout(() => {
        setJustEnrolled(false)
        setEnrolling(result)
      }, 500)
    },
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
      setDisableError(null)
      void queryClient.invalidateQueries({ queryKey: ['accounts', '2fa'] })
    },
    onError: (error) =>
      setDisableError(error instanceof ApiError && error.status === 403 ? 'password' : 'failed'),
  })

  const enabled = statusQuery.data?.ok ?? false

  let mainContent: React.ReactNode
  if (statusQuery.isPending) {
    mainContent = <StateView kind="loading" titleKey="state.loading" />
  } else if (statusQuery.isError) {
    mainContent = (
      <StateView
        kind="error"
        titleKey="state.error.title"
        action={{ labelKey: 'state.error.action', onAction: () => void statusQuery.refetch() }}
      />
    )
  } else if (recoveryCodes) {
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
            try {
              await navigator.clipboard.writeText(recoveryCodes.join('\n'))
              toast(t('accounts.twoFactor.enroll.recoveryCopied'))
            } catch {
              toast.error(t('accounts.settings.saveError'))
            }
          }}
        >
          {t('accounts.twoFactor.enroll.copy')}
        </Button>
        <Button size="sm" onClick={() => setRecoveryCodes(null)}>
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
        <Button
          size="sm"
          variant="ghost"
          disabled={verify.isPending}
          onClick={() => {
            setEnrolling(null)
            setCode('')
            verify.reset()
            enroll.reset()
          }}
        >
          {t('accounts.twoFactor.enroll.cancel')}
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
        success={justEnrolled}
        onClick={() => enroll.mutate()}
      >
        {t('accounts.twoFactor.enable')}
      </Button>
    )
  }

  return (
    <SectionCard
      id="section-2fa"
      title={t('accounts.twoFactor.title')}
      description={t('accounts.twoFactor.subtitle')}
      headerAside={
        <Badge tone={enabled ? 'success' : 'neutral'}>
          {t(enabled ? 'accounts.twoFactor.enabled' : 'accounts.twoFactor.disabled')}
        </Badge>
      }
    >
      {mainContent}
      {enroll.isError ? (
        <p role="alert" className="text-small text-destructive">
          {t('accounts.settings.saveError')}
        </p>
      ) : null}

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
                {t(
                  disableError === 'password'
                    ? 'accounts.twoFactor.disableDialog.error'
                    : 'accounts.settings.saveError',
                )}
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
    </SectionCard>
  )
}

function PasswordSection() {
  const t = useT()
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  const meQuery = useMeQuery()
  const formId = React.useId()
  React.useEffect(() => {
    if (window.location.hash === '#section-password')
      document.getElementById(formId)?.querySelector('input')?.focus()
  }, [formId])
  const [current, setCurrent] = React.useState('')
  const [next, setNext] = React.useState('')
  const [message, setMessage] = React.useState<
    'success' | 'error' | 'validation' | 'failed' | null
  >(null)

  const mutation = useMutation({
    mutationFn: () => changePassword(current, next, csrfToken),
    onSuccess: async () => {
      setMessage('success')
      setCurrent('')
      setNext('')
      await queryClient.invalidateQueries({ queryKey: ['me'] })
    },
    onError: (error) =>
      setMessage(
        error instanceof ApiError && error.status === 422
          ? 'validation'
          : error instanceof ApiError && error.status === 403
            ? 'error'
            : 'failed',
      ),
  })

  return (
    <SectionCard
      id="section-password"
      title={t('accounts.password.title')}
      actions={
        <Button
          size="sm"
          form={formId}
          type="submit"
          loading={mutation.isPending}
          disabled={!current || !next}
        >
          {t('accounts.password.submit')}
        </Button>
      }
    >
      <form
        id={formId}
        className="flex max-w-sm flex-col gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (!mutation.isPending && current && next) mutation.mutate()
        }}
      >
        {meQuery.data?.user.mustChangePassword ? (
          <p role="status" className="text-small text-foreground">
            {t('accounts.password.temporary')}
          </p>
        ) : null}
        <label className="flex flex-col gap-1.5">
          <span className="text-small text-foreground">{t('accounts.password.current')}</span>
          <Input
            type="password"
            autoComplete="current-password"
            required
            maxLength={256}
            disabled={mutation.isPending}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-small text-foreground">{t('accounts.password.new')}</span>
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={256}
            disabled={mutation.isPending}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <p className="text-caption text-muted-foreground">{t('accounts.register.passwordHint')}</p>
        {message !== null ? (
          <p
            role={message === 'success' ? 'status' : 'alert'}
            className={
              message === 'success' ? 'text-small text-foreground' : 'text-small text-destructive'
            }
          >
            {t(`accounts.password.${message}`)}
          </p>
        ) : null}
      </form>
    </SectionCard>
  )
}

/** DESIGN.md §9.5: "danger zone ... every destructive action is a full dialog with a typed
 * confirmation -- never an inline button." Typing the account's own login (never a generic word: a
 * login is the one string every account holder already knows by heart and no phishing page could
 * have pre-filled) is what enables the submit button, the same shape `WipeCard` uses for the
 * instance-wide wipe (`features/admin/settings-screen.tsx`) one level further up in severity. */
function DeleteAccountSection() {
  const t = useT()
  const locale = useLocale()
  const csrfToken = useCsrfToken()
  const queryClient = useQueryClient()
  const meQuery = useMeQuery()
  const statusQuery = useQuery({ queryKey: ['accounts', 'deletion'], queryFn: fetchDeletionStatus })
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [typedLogin, setTypedLogin] = React.useState('')

  const request = useMutation({
    mutationFn: () => requestAccountDeletion(csrfToken),
    onSuccess: () => {
      setConfirmOpen(false)
      setTypedLogin('')
      void queryClient.invalidateQueries({ queryKey: ['accounts', 'deletion'] })
    },
  })
  const cancel = useMutation({
    mutationFn: () => cancelAccountDeletion(csrfToken),
    onSuccess: () => {
      toast(t('accounts.delete.cancelled'))
      void queryClient.invalidateQueries({ queryKey: ['accounts', 'deletion'] })
    },
  })

  const scheduledFor = statusQuery.data?.scheduledFor ?? null
  const expectedLogin = meQuery.data?.user.login ?? ''

  return (
    <SectionCard
      id="section-delete"
      className="border-destructive"
      title={t('accounts.delete.title')}
      description={t('accounts.delete.warning')}
    >
      {statusQuery.isPending ? (
        <StateView kind="loading" titleKey="state.loading" />
      ) : statusQuery.isError ? (
        <StateView
          kind="error"
          titleKey="state.error.title"
          action={{ labelKey: 'state.error.action', onAction: () => void statusQuery.refetch() }}
        />
      ) : scheduledFor ? (
        <div className="flex items-center gap-3">
          <p className="text-small text-foreground">
            {t('accounts.delete.scheduled', { date: formatDate(new Date(scheduledFor), locale) })}
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
          onClick={() => setConfirmOpen(true)}
        >
          {t('accounts.delete.confirm')}
        </Button>
      )}
      {cancel.isError ? (
        <p role="alert" className="text-small text-destructive">
          {t('accounts.settings.saveError')}
        </p>
      ) : null}

      <Dialog
        open={confirmOpen}
        onOpenChange={(next) => {
          setConfirmOpen(next)
          if (!next) setTypedLogin('')
        }}
      >
        <DialogContent title={t('accounts.delete.title')}>
          <div className="flex flex-col gap-3 pt-4">
            <p className="text-body text-muted-foreground">{t('accounts.delete.confirmDialog')}</p>
            {request.isError ? (
              <p role="alert" className="text-small text-destructive">
                {t('accounts.settings.saveError')}
              </p>
            ) : null}
            <label className="flex flex-col gap-1.5">
              <span className="text-small text-foreground">
                {t('accounts.delete.dialog.loginLabel', { login: expectedLogin })}
              </span>
              <Input value={typedLogin} onChange={(e) => setTypedLogin(e.target.value)} />
            </label>
            <Button
              variant="destructive"
              disabled={typedLogin !== expectedLogin || expectedLogin === ''}
              loading={request.isPending}
              onClick={() => request.mutate()}
            >
              {t('accounts.delete.confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}

interface SubNavItem {
  id: string
  labelKey: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
}

/** Three groups, not five flat rows -- `accounts.settings.{profile,security,dangerZone}` already
 * existed in the catalogue (a settings recipe this screen never finished wiring up) and are exactly
 * the grouping DESIGN.md's own settings recipe implies: what you look like, how you sign in, and the
 * one card that ends the account. */
const SUB_NAV_GROUPS: ReadonlyArray<{ headingKey: string; items: readonly SubNavItem[] }> = [
  {
    headingKey: 'accounts.settings.profile',
    items: [
      { id: 'section-profile', labelKey: 'profileEdit.heading', icon: ClipboardList },
      { id: 'section-photo', labelKey: 'accounts.photo.title', icon: ImageIcon },
      { id: 'section-appearance', labelKey: 'accounts.settings.appearance', icon: Palette },
      // v1.1 SPEC §5: the boshqarma's own columns about this person. `id: 'fields'` is deliberate --
      // it is the anchor `/account#fields` that a fill request's inbox row and its Telegram
      // "Toʻldirish" button both open.
      { id: 'fields', labelKey: 'fields.my.title', icon: ClipboardList },
    ],
  },
  {
    headingKey: 'accounts.settings.security',
    items: [
      { id: 'section-sessions', labelKey: 'accounts.sessions.title', icon: Monitor },
      { id: 'section-2fa', labelKey: 'accounts.twoFactor.title', icon: ShieldAlert },
      { id: 'section-password', labelKey: 'accounts.password.title', icon: KeyRound },
    ],
  },
  {
    headingKey: 'accounts.settings.dangerZone',
    items: [{ id: 'section-delete', labelKey: 'accounts.delete.title', icon: Trash2 }],
  },
]

/** DESIGN.md §9.5 puts two columns on this screen from the 1024px breakpoint up: a left sub-nav
 * and a stack of section cards. A plain anchor list rather than routed tabs -- every section stays
 * mounted (no section's own `useQuery` should refire on a tab switch that never unmounted it), and
 * `scroll-mt` on each card gives the jumped-to section room under the sticky app top bar. Below that
 * breakpoint the same list becomes the horizontal, scrollable strip DESIGN.md offers as the
 * alternative -- flattened there (a two-level scrolling strip of group headings would be its own new
 * pattern for one screen). */
function SettingsSubNav({ className, flat = false }: { className?: string; flat?: boolean }) {
  const t = useT()
  const items = flat ? SUB_NAV_GROUPS.flatMap((g) => g.items) : null
  return (
    <nav aria-label={t('accounts.settings.subnavAria')} className={className}>
      {flat && items ? (
        <ul className="flex gap-1 overflow-x-auto">
          {items.map((item) => (
            <li key={item.id} className="shrink-0">
              <a href={`#${item.id}`} className={SUB_NAV_LINK_CLASS}>
                <item.icon className="size-4 shrink-0" aria-hidden="true" />
                {t(item.labelKey)}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-4">
          {SUB_NAV_GROUPS.map((group) => (
            <div key={group.headingKey} className="flex flex-col gap-1">
              <p className="px-3 text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
                {t(group.headingKey)}
              </p>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <a href={`#${item.id}`} className={SUB_NAV_LINK_CLASS}>
                      <item.icon className="size-4 shrink-0" aria-hidden="true" />
                      {t(item.labelKey)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </nav>
  )
}

const SUB_NAV_LINK_CLASS =
  'flex items-center gap-2 whitespace-nowrap rounded-sm px-3 py-2 text-small text-muted-foreground transition-colors duration-(--dur-micro) hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function AccountSettingsScreen() {
  const t = useT()
  // round2 SEV2: this screen's own `mx-auto` re-centred a narrower box *inside* the shell's already-
  // centred `PageContainer` (app-shell.tsx wraps every route at the shared 1280px width) -- two nested
  // centering contexts of different widths is exactly what shifted this screen's heading 110px right
  // of where every other screen's starts, and dropped the eyebrow line other `PageHeader` call sites
  // all carry. Capping the width without re-centering keeps the left edge pinned to the same shared
  // gutter `PageContainer` already gives every other screen.
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        eyebrow={t('accounts.settings.eyebrow')}
        title={t('accounts.settings.title')}
        description={t('accounts.settings.subtitle')}
      />
      <SettingsNavigation />
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <SettingsSubNav className="sticky top-4 hidden shrink-0 basis-48 lg:block" />
        <SettingsSubNav className="lg:hidden" flat />
        <div className="flex min-w-0 flex-1 flex-col gap-6 [&_[id]]:scroll-mt-20">
          <ProfileSection />
          <PhotoSection />
          <AppearanceSection />
          <MyFieldsSection />
          <SessionsSection />
          <TwoFactorSection />
          <PasswordSection />
          <DeleteAccountSection />
        </div>
      </div>
    </div>
  )
}
