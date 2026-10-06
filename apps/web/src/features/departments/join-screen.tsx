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
import {
  BlurFade,
  Button,
  Collapsible,
  Input,
  JoinDepartmentIllustration,
  Shake,
  StateView,
} from '@devon/ui'
import { ApiError } from '../../lib/api-client.js'
import { useMeQuery, useSession } from '../../lib/session.js'
import { navigate, useSearchParams } from '../../lib/router.js'
import { fetchJoinPreview, joinDepartment } from './api.js'

export default function JoinScreen() {
  const t = useT()
  const session = useSession()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const params = useSearchParams()
  const [key, setKey] = React.useState(params.get('key') ?? '')
  const [password, setPassword] = React.useState('')
  const [outcome, setOutcome] = React.useState<'success' | 'pending' | null>(null)
  const [shake, setShake] = React.useState(false)

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

  // Declared before the early returns below, because a hook may not be called conditionally. Keyed
  // on `failureCount` rather than on the message, so a second attempt that fails the same way is
  // still answered -- two refusals are two refusals.
  const failureCount = mutation.failureCount
  React.useEffect(() => {
    if (failureCount > 0) {
      setShake(false)
      const raf = requestAnimationFrame(() => setShake(true))
      return () => cancelAnimationFrame(raf)
    }
    return undefined
  }, [failureCount])

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
        {/* v1.1 SPEC §2.2: "pending" used to be a bare heading, which reads as a dead end. Say what
            actually happens next -- the head has an inbox item (and a Telegram message) about this
            request right now, and the joiner will be told either way. */}
        <p className="text-small text-muted-foreground">
          {t(
            outcome === 'success'
              ? 'departments.join.successBody'
              : 'departments.join.pendingApprovalBody',
          )}
        </p>
        <Button onClick={() => navigate('/departments')}>{t('departments.title')}</Button>
      </BlurFade>
    )
  }

  const errorKey: string | null =
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
              {t('departments.join.byLink.body', {
                name: previewQuery.data.name,
              })}
            </p>
          ) : null}
          {/* Told before the password is typed, not after: "you are in" and "you are in a queue"
              are different enough outcomes that nobody should discover which one applies by
              submitting. */}
          {previewQuery.data?.joinRequiresApproval ? (
            <p className="text-small text-attention-foreground">
              {t('departments.join.approvalNotice')}
            </p>
          ) : null}
        </div>
      ) : (
        <h1 className="text-h2 text-foreground">{t('departments.join.byForm.title')}</h1>
      )}

      <Shake play={shake} onDone={() => setShake(false)}>
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

          {/* Same two beats as `/login` and `/register`: the message opens rather than appears, and
            the form answers with the product's one refusal gesture. */}
          <Collapsible open={Boolean(errorKey)}>
            <p role="alert" className="text-small text-destructive">
              {errorKey ? t(errorKey) : null}
            </p>
          </Collapsible>

          {!session.isAuthenticated ? (
            <p className="text-small text-muted-foreground">
              {t('accounts.login.registerPrompt')}{' '}
              <a href={`/login`} className="text-foreground underline underline-offset-2">
                {t('accounts.register.loginLink')}
              </a>
            </p>
          ) : (
            <Button
              type="submit"
              size="lg"
              loading={mutation.isPending}
              loadingLabel={t('state.loading')}
            >
              {t('departments.join.submit')}
            </Button>
          )}
        </form>
      </Shake>
    </BlurFade>
  )
}
