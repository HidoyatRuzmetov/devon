// `/join` (optionally `?key=<key>`) -- join by link or by form (TECH-SPEC §2.2). A logged-out visitor
// following `/join?key=...` is intercepted by the shell's own auth check today (feature routes always
// render inside `AppShell`, `app.tsx`'s `RouteOutlet`) -- signing in first, then returning here with
// the same query string, satisfies "if logged out, register/login first, then the password prompt"
// without this screen needing its own redirect logic. `/join` is one of `app.tsx`'s `AUTH_ROUTES`, so
// this renders inside `AuthShell` -- the ambient gradient and the centred-card treatment
// (UI-OVERHAUL.md's Jakob row "Auth: Linear, Vercel, Notion") already come from there; this file only
// supplies the card itself, styled to match (`bg-card/90` + blur so the wash still reads through it).
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import { BlurFade, Button, Input, StateView } from '@devon/ui'
import { ApiError } from '../../lib/api-client.js'
import { useMeQuery, useSession } from '../../lib/session.js'
import { navigate, useSearchParams } from '../../lib/router.js'
import { fetchJoinPreview, joinDepartment } from './api.js'
import { JoinDepartmentIllustration } from './components/illustrations.js'

export default function JoinScreen() {
  const t = useT()
  const session = useSession()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const params = useSearchParams()
  const [key, setKey] = React.useState(params.get('key') ?? '')
  const [password, setPassword] = React.useState('')
  const [outcome, setOutcome] = React.useState<'success' | 'pending' | null>(null)

  const keyFromLink = params.get('key')
  const previewQuery = useQuery({
    queryKey: ['departments', 'join-preview', keyFromLink],
    queryFn: () => fetchJoinPreview(keyFromLink!),
    enabled: Boolean(keyFromLink),
  })

  const mutation = useMutation({
    mutationFn: () => joinDepartment(key, password, meQuery.data?.csrfToken ?? ''),
    onSuccess: (result) => {
      setOutcome(result.status === 'active' ? 'success' : 'pending')
      void queryClient.invalidateQueries({ queryKey: ['departments', 'mine'] })
      void queryClient.invalidateQueries({ queryKey: ['me'] })
    },
  })

  if (session.isLoading) return <StateView kind="loading" titleKey="state.loading" />

  if (outcome) {
    return (
      <BlurFade className="mx-auto flex w-full max-w-105 flex-col items-center gap-4 rounded-lg border border-border bg-card/90 p-8 text-center shadow-2 backdrop-blur-sm">
        <JoinDepartmentIllustration className="w-28" />
        <h1 className="font-display text-h2 text-foreground">
          {t(
            outcome === 'success' ? 'departments.join.success' : 'departments.join.pendingApproval',
          )}
        </h1>
        <Button onClick={() => navigate('/departments')}>{t('departments.title')}</Button>
      </BlurFade>
    )
  }

  const errorKey =
    mutation.error instanceof ApiError
      ? mutation.error.code === 'rate_limited'
        ? 'departments.join.rateLimited'
        : 'departments.join.invalidKeyOrPassword'
      : null

  return (
    <BlurFade className="mx-auto flex w-full max-w-105 flex-col gap-6 rounded-lg border border-border bg-card/90 p-8 shadow-2 backdrop-blur-sm">
      {keyFromLink ? (
        <div className="flex flex-col gap-1">
          <h1 className="text-h2 text-foreground">{t('departments.join.byLink.title')}</h1>
          {previewQuery.data ? (
            <p className="text-small text-muted-foreground">
              {t('departments.join.byLink.body', { name: previewQuery.data.name })}
            </p>
          ) : null}
        </div>
      ) : (
        <h1 className="text-h2 text-foreground">{t('departments.join.byForm.title')}</h1>
      )}

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!mutation.isPending && session.isAuthenticated) mutation.mutate()
        }}
        noValidate
      >
        {!keyFromLink ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-small text-foreground">
              {t('departments.join.byForm.keyLabel')}
            </span>
            <Input
              required
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              className="font-mono uppercase"
            />
          </label>
        ) : null}

        <label className="flex flex-col gap-1.5">
          <span className="text-small text-foreground">
            {t('departments.join.byForm.passwordLabel')}
          </span>
          <Input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {errorKey ? (
          <p role="alert" className="text-small text-destructive">
            {t(errorKey)}
          </p>
        ) : null}

        {!session.isAuthenticated ? (
          <p className="text-small text-muted-foreground">
            {t('accounts.login.registerPrompt')}{' '}
            <a href={`/login`} className="text-foreground underline underline-offset-2">
              {t('accounts.register.loginLink')}
            </a>
          </p>
        ) : (
          <Button type="submit" size="lg" loading={mutation.isPending}>
            {t('departments.join.submit')}
          </Button>
        )}
      </form>
    </BlurFade>
  )
}
