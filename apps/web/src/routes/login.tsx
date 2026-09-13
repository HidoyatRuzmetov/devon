// `/login` (design.md §6.2, AC-13). "Pristine form is the empty state" -- there is no separate
// `<StateView kind="empty">` for the unforced default render, the two-field form already has exactly
// one primary action (design.md: "nothing to teach beyond the two fields").
import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Send } from 'lucide-react'
import { useT } from '@devon/i18n'
import { Button, IconButton, Input, Shake } from '@devon/ui'
import { login as apiLogin, requestPasswordReset, verifyTwoFactorLogin } from '../lib/api-client.js'
import { useForcedState } from '../lib/forced-state.js'
import { useOnline } from '../lib/use-online.js'
import { Link, navigate, useSearchParams } from '../lib/router.js'
import { ForcedStateBlock } from '../shell/forced-state-block.js'

// A failed attempt gets the same "no, try again" shake every native form control gives a rejected
// input -- one quick horizontal wag, never a colour change alone (DESIGN.md §2.5).
//
// v1.0 shipped this as a local keyframe here, with a note: "the one screen in the product that ever
// rejects a submission this way ... flagged for promotion if a second screen ever wants it". Three
// do now -- register, join, and every field with inline validation -- so the gesture is
// `<Shake>` in `packages/ui/src/motion`, and its reduced-motion replacement (a destructive ring that
// fades in place, rather than nothing at all) comes with it.

export function LoginRoute() {
  const t = useT()
  const forced = useForcedState()
  const online = useOnline()
  const params = useSearchParams()
  const signedOut = params.get('signedOut') === '1'
  const queryClient = useQueryClient()

  const [identifier, setIdentifier] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [shake, setShake] = React.useState(false)
  // `/login` also carries the "I forgot my password" moment inline (no separate route: `app.tsx`'s
  // `AUTH_ROUTES` is a fixed list this item does not own -- see NOTES).
  //
  // v1.1 (SPEC §2.2, WALKTHROUGH-FINDINGS §2.5): this used to be a dead end. It said "ask your
  // boshqarma boshligʻi" while the head had no way to reset anything -- the reset route was
  // super-admin-only -- so every forgotten password in every department escalated to the single
  // ministry super admin. Now the head *can* reset (`POST /departments/:id/members/:userId/
  // reset-password`) and this screen is the one click that tells them there is someone waiting.
  const [view, setView] = React.useState<'login' | 'forgot'>('login')
  const [requested, setRequested] = React.useState(false)
  const passwordFieldId = React.useId()
  // EPIC-001: set once the password step comes back `requires2fa: true` -- the form then swaps to a
  // single code field, submitted against the same `challengeToken` until it succeeds.
  const [challengeToken, setChallengeToken] = React.useState<string | null>(null)
  const [code, setCode] = React.useState('')

  const mutation = useMutation({
    mutationFn: () => apiLogin({ login: identifier, password }),
    onSuccess: async (result) => {
      setFailed(false)
      if (result.requires2fa) {
        setChallengeToken(result.challengeToken)
        return
      }
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      navigate('/')
    },
    onError: () => {
      setFailed(true)
      setShake(true)
    },
  })

  const twoFaMutation = useMutation({
    mutationFn: () => verifyTwoFactorLogin({ challengeToken: challengeToken ?? '', code }),
    onSuccess: async () => {
      setFailed(false)
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      navigate('/')
    },
    onError: () => {
      setFailed(true)
      setShake(true)
    },
  })

  // Deliberately uninformative on purpose: the endpoint answers 202 whether or not the login matched
  // anybody, and so does this screen, so it can never be used to find out who works here. It is rate
  // limited server-side and deduped to one open request per person per day.
  const askHead = useMutation({
    mutationFn: () => requestPasswordReset(identifier.trim()),
    onSuccess: () => setRequested(true),
    onError: () => setRequested(true),
  })

  if (forced) return <ForcedStateBlock kind={forced} />

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!online) return
    if (challengeToken) {
      if (!twoFaMutation.isPending) twoFaMutation.mutate()
      return
    }
    if (!mutation.isPending) mutation.mutate()
  }

  if (view === 'forgot') {
    return (
      <div className="mx-auto flex w-full max-w-105 flex-col gap-6 rounded-lg border border-border bg-card/90 p-8 shadow-2 backdrop-blur-sm">
        <div className="flex flex-col gap-1">
          <h1 className="text-h2 text-foreground">{t('login.forgot.title')}</h1>
          <p className="text-small text-muted-foreground">{t('login.forgot.body')}</p>
        </div>

        {requested ? (
          <div
            role="status"
            className="flex items-start gap-3 rounded-md border border-border bg-muted p-4"
          >
            <Send className="mt-0.5 size-4.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-small text-foreground">{t('login.forgot.sent')}</p>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              if (online && identifier.trim() && !askHead.isPending) askHead.mutate()
            }}
          >
            <label className="flex flex-col gap-1.5">
              <span data-shell-label className="text-small text-foreground">
                {t('login.forgot.loginLabel')}
              </span>
              <Input
                name="forgot-identifier"
                autoComplete="username"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            </label>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={askHead.isPending}
              disabled={!online || identifier.trim().length === 0}
            >
              {t('login.forgot.askHead')}
            </Button>
            <p className="text-small text-muted-foreground">{t('login.forgot.telegram')}</p>
          </form>
        )}

        <p className="text-small text-muted-foreground">{t('login.forgot.admin')}</p>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          onClick={() => {
            setRequested(false)
            setView('login')
          }}
        >
          {t('accounts.login2fa.back')}
        </Button>
      </div>
    )
  }

  if (challengeToken) {
    return (
      <Shake play={shake} onDone={() => setShake(false)} className="mx-auto w-full max-w-105">
        <div className="flex w-full flex-col gap-6 rounded-lg border border-border bg-card/90 p-8 shadow-2 backdrop-blur-sm">
          <div className="flex flex-col gap-1">
            <h1 className="text-h2 text-foreground">{t('accounts.login2fa.title')}</h1>
            <p className="text-small text-muted-foreground">{t('accounts.login2fa.body')}</p>
          </div>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
            <label className="flex flex-col gap-1.5">
              <span data-shell-label className="text-small text-foreground">
                {t('accounts.login2fa.code')}
              </span>
              <Input
                name="code"
                inputMode="text"
                autoComplete="one-time-code"
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            {failed ? (
              <p role="alert" data-shell-label className="text-small text-destructive">
                {t('accounts.login2fa.error')}
              </p>
            ) : null}
            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={twoFaMutation.isPending}
              disabled={!online}
            >
              {t('accounts.login2fa.submit')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setChallengeToken(null)
                setCode('')
                setFailed(false)
                setShake(false)
              }}
            >
              {t('accounts.login2fa.back')}
            </Button>
          </form>
        </div>
      </Shake>
    )
  }

  return (
    <Shake play={shake} onDone={() => setShake(false)} className="mx-auto w-full max-w-105">
      <div className="flex w-full flex-col gap-6 rounded-lg border border-border bg-card/90 p-8 shadow-2 backdrop-blur-sm">
        <div className="flex flex-col gap-1">
          <h1 className="text-h2 text-foreground">{t('login.title')}</h1>
        </div>

        {signedOut ? (
          <p
            data-shell-label
            role="status"
            className="rounded-sm bg-muted px-3 py-2 text-small text-foreground"
          >
            {t('login.signedOut')}
          </p>
        ) : null}

        <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
          <label className="flex flex-col gap-1.5">
            <span data-shell-label className="text-small text-foreground">
              {t('login.identifier')}
            </span>
            <Input
              name="identifier"
              autoComplete="username"
              autoFocus
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="flex items-center justify-between gap-2">
              <label
                htmlFor={passwordFieldId}
                data-shell-label
                className="text-small text-foreground"
              >
                {t('login.password')}
              </label>
              <button
                type="button"
                data-shell-label
                className="text-small text-primary underline-offset-2 hover:underline"
                onClick={() => setView('forgot')}
              >
                {t('login.forgot.link')}
              </button>
            </span>
            <div className="relative">
              <Input
                id={passwordFieldId}
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-11"
              />
              <IconButton
                type="button"
                aria-label={t(showPassword ? 'login.hidePassword' : 'login.showPassword')}
                className="absolute right-1 top-1/2 -translate-y-1/2"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </IconButton>
            </div>
          </div>

          {failed ? (
            <p role="alert" data-shell-label className="text-small text-destructive">
              {t('login.error')}
            </p>
          ) : null}

          {!online ? (
            <p data-shell-label className="text-small text-muted-foreground">
              {t('login.offline')}
            </p>
          ) : null}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={mutation.isPending}
            disabled={!online}
          >
            {t('login.submit')}
          </Button>

          <p className="text-center text-small text-muted-foreground">
            {t('accounts.login.registerPrompt')}{' '}
            <Link to="/register" className="text-foreground underline underline-offset-2">
              {t('accounts.login.registerLink')}
            </Link>
          </p>
        </form>
      </div>
    </Shake>
  )
}
