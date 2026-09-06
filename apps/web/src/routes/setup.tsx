// `/setup` (design.md §6.3, AC-12). The frontend route is fixed (`/setup`, per the item handoff's
// route list); the API's single-use token travels as a `?token=` query param on the URL the API
// prints at first boot. There is no `GET` to pre-check the token (design.md §1.7 lists only `POST
// /api/v1/setup/{token}`) -- "consumed / invalid / already-bootstrapped" is therefore rendered
// identically (design.md: "one identical screen, ... so nothing about existence leaks") whenever the
// token is missing, `GET /api/v1/instance` already reports `setupRequired: false`, or the `POST`
// itself comes back 410.
import * as React from 'react'
import { useMutation } from '@tanstack/react-query'
import { Check, Copy, Eye, EyeOff } from 'lucide-react'
import { useT } from '@devon/i18n'
import { Button, IconButton, Input, StateView, toast } from '@devon/ui'
import { submitSetup, type SetupInput } from '../lib/api-client.js'
import type { PublicUser } from '../lib/api-schemas.js'
import { useForcedState } from '../lib/forced-state.js'
import { useInstanceQuery } from '../lib/session.js'
import { navigate, useSearchParams } from '../lib/router.js'
import { ForcedStateBlock } from '../shell/forced-state-block.js'

function UsedScreen() {
  return (
    <StateView
      kind="forbidden"
      titleKey="setup.used.title"
      bodyKey="setup.used.body"
      action={{ labelKey: 'setup.used.action', onAction: () => navigate('/login') }}
    />
  )
}

function DoneScreen({ user }: { user: PublicUser }) {
  const t = useT()
  const [copied, setCopied] = React.useState(false)

  async function copyLogin(): Promise<void> {
    try {
      await navigator.clipboard.writeText(user.login)
      setCopied(true)
      toast(t('toast.copied'))
    } catch {
      // Clipboard API unavailable/denied -- the login is still selectable text below.
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 rounded-md border border-border bg-card p-8 text-center">
      <h1 className="text-h2 text-foreground">{t('setup.done.title')}</h1>
      <div className="flex items-center gap-2 rounded-sm bg-muted px-3 py-2">
        <span className="select-text font-mono text-body text-foreground">{user.login}</span>
        <IconButton aria-label={t('setup.copyAction')} onClick={copyLogin}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </IconButton>
      </div>
      <Button size="lg" className="w-full" onClick={() => navigate('/login')}>
        {t('setup.done.action')}
      </Button>
    </div>
  )
}

export function SetupRoute() {
  const t = useT()
  const forced = useForcedState()
  const params = useSearchParams()
  const token = params.get('token')
  const instanceQuery = useInstanceQuery()

  const [givenName, setGivenName] = React.useState('')
  const [familyName, setFamilyName] = React.useState('')
  const [patronymic, setPatronymic] = React.useState('')
  const [identifier, setIdentifier] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)

  const mutation = useMutation({
    mutationFn: () => {
      const input: SetupInput = {
        login: identifier,
        password,
        givenName,
        familyName,
        locale: 'uz-Latn',
        ...(patronymic ? { patronymic } : {}),
      }
      return submitSetup(token ?? '', input)
    },
  })

  if (forced) {
    return <ForcedStateBlock kind={forced} />
  }

  if (!token) {
    return <UsedScreen />
  }

  if (instanceQuery.isPending) {
    return <StateView kind="loading" titleKey="state.loading" />
  }

  if (instanceQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => instanceQuery.refetch() }}
      />
    )
  }

  if (mutation.isSuccess) {
    return <DoneScreen user={mutation.data.user} />
  }
  if (mutation.isError || instanceQuery.data.setupRequired === false) {
    return <UsedScreen />
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (mutation.isPending) return
    mutation.mutate()
  }

  return (
    <div className="flex flex-col gap-6 rounded-md border border-border bg-card p-8">
      <div className="flex flex-col gap-1">
        <p className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
          {t('setup.eyebrow')}
        </p>
        <h1 className="text-h2 text-foreground">{t('setup.title')}</h1>
        <p className="text-body text-muted-foreground">{t('setup.body')}</p>
      </div>

      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <label className="flex flex-col gap-1.5">
          <span data-shell-label className="text-small text-foreground">
            {t('setup.family')}
          </span>
          <Input
            required
            autoFocus
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span data-shell-label className="text-small text-foreground">
            {t('setup.given')}
          </span>
          <Input required value={givenName} onChange={(e) => setGivenName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span data-shell-label className="text-small text-foreground">
            {t('setup.patronymic')}
          </span>
          <Input value={patronymic} onChange={(e) => setPatronymic(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span data-shell-label className="text-small text-foreground">
            {t('login.identifier')}
          </span>
          <Input
            required
            autoComplete="username"
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
              required
              minLength={12}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
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
          <span data-shell-label className="text-caption text-muted-foreground">
            {t('setup.passwordHint')}
          </span>
        </label>

        <Button type="submit" size="lg" className="w-full" loading={mutation.isPending}>
          {t('setup.submit')}
        </Button>
      </form>
    </div>
  )
}
