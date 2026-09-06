// `/login` (design.md §6.2, AC-13). "Pristine form is the empty state" -- there is no separate
// `<StateView kind="empty">` for the unforced default render, the two-field form already has exactly
// one primary action (design.md: "nothing to teach beyond the two fields").
import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff } from 'lucide-react'
import { useT } from '@devon/i18n'
import { Button, IconButton, Input } from '@devon/ui'
import { login as apiLogin, verifyTwoFactorLogin } from '../lib/api-client.js'
import { useForcedState } from '../lib/forced-state.js'
import { useOnline } from '../lib/use-online.js'
import { Link, navigate, useSearchParams } from '../lib/router.js'
import { ForcedStateBlock } from '../shell/forced-state-block.js'

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
    onError: () => setFailed(true),
  })

  const twoFaMutation = useMutation({
    mutationFn: () => verifyTwoFactorLogin({ challengeToken: challengeToken ?? '', code }),
    onSuccess: async () => {
      setFailed(false)
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      navigate('/')
    },
    onError: () => setFailed(true),
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

  if (challengeToken) {
    return (
      <div className="flex flex-col gap-6 rounded-md border border-border bg-card p-8">
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
          <Button type="submit" size="lg" className="w-full" loading={twoFaMutation.isPending} disabled={!online}>
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
            }}
          >
            {t('accounts.login2fa.back')}
          </Button>
        </form>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 rounded-md border border-border bg-card p-8">
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

        <label className="flex flex-col gap-1.5">
          <span data-shell-label className="text-small text-foreground">
            {t('login.password')}
          </span>
          <div className="relative">
            <Input
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
        </label>

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
  )
}
