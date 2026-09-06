// `/register` (EPIC-001, TECH-SPEC §2.1). Reuses the `AuthShell`-less `AppShell` chrome every feature
// route gets (`app.tsx`'s `RouteOutlet`) -- unauthenticated visitors see it with no department/avatar,
// same as any other feature route reached while signed out.
import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useT, LOCALES, LOCALE_LABEL, type Locale } from '@devon/i18n'
import { Button, Input } from '@devon/ui'
import { ApiError } from '../../lib/api-client.js'
import { navigate, Link } from '../../lib/router.js'
import { registerAccount } from './api.js'

export default function RegisterScreen() {
  const t = useT()
  const queryClient = useQueryClient()

  const [login, setLogin] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [givenName, setGivenName] = React.useState('')
  const [familyName, setFamilyName] = React.useState('')
  const [patronymic, setPatronymic] = React.useState('')
  const [jobTitle, setJobTitle] = React.useState('')
  const [locale, setLocale] = React.useState<Locale>('uz-Latn')
  const [errorKey, setErrorKey] = React.useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      registerAccount({
        login,
        email: email || undefined,
        password,
        givenName,
        familyName,
        patronymic: patronymic || undefined,
        title: jobTitle || undefined,
        locale,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tashkent',
      }),
    onSuccess: async () => {
      setErrorKey(null)
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      navigate('/departments')
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'conflict') {
        setErrorKey('accounts.register.error.conflict')
      } else {
        setErrorKey('accounts.register.error.generic')
      }
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!mutation.isPending) mutation.mutate()
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 rounded-md border border-border bg-card p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-h2 text-foreground">{t('accounts.register.title')}</h1>
        <p className="text-small text-muted-foreground">{t('accounts.register.subtitle')}</p>
      </div>

      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-small text-foreground">{t('accounts.register.givenName')}</span>
            <Input required value={givenName} onChange={(e) => setGivenName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-small text-foreground">{t('accounts.register.familyName')}</span>
            <Input required value={familyName} onChange={(e) => setFamilyName(e.target.value)} />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-small text-foreground">{t('accounts.register.patronymic')}</span>
          <Input value={patronymic} onChange={(e) => setPatronymic(e.target.value)} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-small text-foreground">{t('accounts.register.jobTitle')}</span>
          <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-small text-foreground">{t('accounts.register.login')}</span>
          <Input
            required
            autoComplete="username"
            value={login}
            onChange={(e) => setLogin(e.target.value.toLowerCase())}
          />
          <span className="text-small text-muted-foreground">
            {t('accounts.register.loginHint')}
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-small text-foreground">{t('accounts.register.email')}</span>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-small text-foreground">{t('accounts.register.password')}</span>
          <Input
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="text-small text-muted-foreground">
            {t('accounts.register.passwordHint')}
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-small text-foreground">{t('accounts.register.locale')}</span>
          <select
            className="h-11 w-full rounded-sm border border-border bg-card px-3 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_LABEL[l]}
              </option>
            ))}
          </select>
        </label>

        {errorKey ? (
          <p role="alert" className="text-small text-destructive">
            {t(errorKey)}
          </p>
        ) : null}

        <Button type="submit" size="lg" className="w-full" loading={mutation.isPending}>
          {t('accounts.register.submit')}
        </Button>

        <p className="text-center text-small text-muted-foreground">
          {t('accounts.register.loginPrompt')}{' '}
          <Link to="/login" className="text-foreground underline underline-offset-2">
            {t('accounts.register.loginLink')}
          </Link>
        </p>
      </form>
    </div>
  )
}
