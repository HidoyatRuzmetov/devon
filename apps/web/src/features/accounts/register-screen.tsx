// `/register` (EPIC-001, TECH-SPEC §2.1). Renders inside `AuthShell` -- `app.tsx`'s `AUTH_ROUTES`
// lists it alongside `/login`, `/setup` and `/join`, because a visitor creating an account has no
// session and a sidebar full of destinations they cannot reach is not chrome, it is noise.
//
// The optional photo is chosen here but uploaded only *after* the account exists: the presigned-URL
// endpoint needs a session (an anonymous presign would be an open upload slot for anyone), so the
// order is register -> session -> presign -> PUT -> finalise, and a photo that fails at any of those
// steps never blocks the registration that already succeeded -- the account lands on `/departments`
// with a toast pointing at Account settings instead.
import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useT, LOCALES, LOCALE_LABEL, type Locale } from '@devon/i18n'
import { Button, Collapsible, initialsFromName, Input, Shake, toast } from '@devon/ui'
import { ApiError } from '../../lib/api-client.js'
import { navigate, Link, useSearchParams } from '../../lib/router.js'
import { authEntryPath, authReturnPath } from '../../lib/auth-return.js'
import { AVATAR_MAX_BYTES, isAvatarContentType, registerAccount, uploadAvatar } from './api.js'
import { AvatarPicker } from './avatar-picker.js'
import { PasswordStrengthMeter } from './password-strength.js'

export default function RegisterScreen() {
  const t = useT()
  const queryClient = useQueryClient()
  const params = useSearchParams()
  const returnTo = authReturnPath(params.get('returnTo'), '/departments')

  const [login, setLogin] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [givenName, setGivenName] = React.useState('')
  const [familyName, setFamilyName] = React.useState('')
  const [patronymic, setPatronymic] = React.useState('')
  const [jobTitle, setJobTitle] = React.useState('')
  const [locale, setLocale] = React.useState<Locale>('uz-Latn')
  const [photo, setPhoto] = React.useState<File | null>(null)
  const [photoErrorKey, setPhotoErrorKey] = React.useState<string | null>(null)
  const [errorKey, setErrorKey] = React.useState<string | null>(null)
  const [shake, setShake] = React.useState(false)
  // Fires on every new rejection, including a second attempt that fails the same way.
  const previousError = React.useRef<string | null>(null)
  React.useEffect(() => {
    const had = previousError.current
    previousError.current = errorKey
    if (errorKey && errorKey !== had) {
      setShake(false)
      const raf = requestAnimationFrame(() => setShake(true))
      return () => cancelAnimationFrame(raf)
    }
    return undefined
  }, [errorKey])

  function selectPhoto(file: File) {
    if (!isAvatarContentType(file.type)) {
      setPhotoErrorKey('accounts.photo.error.type')
      return
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setPhotoErrorKey('accounts.photo.error.tooLarge')
      return
    }
    setPhotoErrorKey(null)
    setPhoto(file)
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const result = await registerAccount({
        login,
        email: email || undefined,
        password,
        givenName,
        familyName,
        patronymic: patronymic || undefined,
        title: jobTitle || undefined,
        locale,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tashkent',
      })
      if (photo) {
        try {
          await uploadAvatar(photo, result.csrfToken)
        } catch {
          // The account exists and the session is live; only the optional photo failed.
          toast(t('accounts.photo.registerFailedToast'))
        }
      }
      return result
    },
    onSuccess: async () => {
      setErrorKey(null)
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      navigate(returnTo)
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
    <div className="mx-auto flex w-full max-w-125 flex-col gap-6 rounded-lg border border-border bg-card/90 p-8 shadow-2 backdrop-blur-sm">
      <div className="flex flex-col gap-1">
        <h1 className="text-h2 text-foreground">{t('accounts.register.title')}</h1>
        <p className="text-small text-muted-foreground">{t('accounts.register.subtitle')}</p>
      </div>

      <Shake play={shake} onDone={() => setShake(false)}>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-small text-foreground">{t('accounts.register.givenName')}</span>
              <Input required value={givenName} onChange={(e) => setGivenName(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-small text-foreground">
                {t('accounts.register.familyName')}
              </span>
              <Input required value={familyName} onChange={(e) => setFamilyName(e.target.value)} />
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-small text-foreground">{t('accounts.register.patronymic')}</span>
            <Input value={patronymic} onChange={(e) => setPatronymic(e.target.value)} />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-small text-foreground">{t('accounts.photo.optional')}</span>
            <AvatarPicker
              currentSrc={null}
              file={photo}
              alt={t('accounts.photo.alt')}
              initials={initialsFromName(givenName, familyName)}
              hueSeed={login || 'new-account'}
              onSelect={selectPhoto}
              onRemove={() => {
                setPhoto(null)
                setPhotoErrorKey(null)
              }}
              errorKey={photoErrorKey}
              disabled={mutation.isPending}
            />
          </div>

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
              minLength={12}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <span className="text-small text-muted-foreground">
              {t('accounts.register.passwordHint')}
            </span>
            <PasswordStrengthMeter password={password} />
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

          {/* The message arrives with a height animation and the form answers with the product's one
            refusal gesture, so a rejected submission is a thing that happened rather than a line of
            red text that was suddenly there. Both reduce per DESIGN.md §2.5 -- the collapse becomes
            instant, the shake becomes a destructive ring. */}
          <Collapsible open={Boolean(errorKey)}>
            <p role="alert" className="text-small text-destructive">
              {errorKey ? t(errorKey) : null}
            </p>
          </Collapsible>

          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={mutation.isPending}
            loadingLabel={t('state.loading')}
          >
            {t('accounts.register.submit')}
          </Button>

          <p className="text-center text-small text-muted-foreground">
            {t('accounts.register.loginPrompt')}{' '}
            <Link
              to={returnTo === '/departments' ? '/login' : authEntryPath('/login', returnTo)}
              className="text-foreground underline underline-offset-2"
            >
              {t('accounts.register.loginLink')}
            </Link>
          </p>
        </form>
      </Shake>
    </div>
  )
}
