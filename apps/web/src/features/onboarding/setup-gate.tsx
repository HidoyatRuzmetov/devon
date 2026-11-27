import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, cn } from '@devon/ui'
import { Check, ChevronRight, FileUser, Fingerprint, Send, UserRound } from 'lucide-react'
import { navigate, useRoutePath } from '../../lib/router.js'
import { useLogoutMutation, useMeQuery, useDepartment } from '../../lib/session.js'
import { useOnboarding } from './context.js'
import { HtmlReader } from './html-reader.js'
import './onboarding.css'

const Profile = React.lazy(() =>
  import('../accounts/profile-section.js').then((m) => ({
    default: m.ProfileSection,
  })),
)
const Resume = React.lazy(() =>
  import('../accounts/professional-profile-section.js').then((m) => ({
    default: m.ProfessionalProfileSection,
  })),
)
const Personnel = React.lazy(() =>
  import('../accounts/personnel-record-section.js').then((m) => ({
    default: m.PersonnelRecordSection,
  })),
)
const Telegram = React.lazy(() => import('../inbox/telegram-screen.js'))
export const setupItems = [
  { key: 'telegram', path: '/account/telegram', icon: Send },
  { key: 'account', path: '/account', icon: UserRound },
  { key: 'resume', path: '/account/professional', icon: Fingerprint },
  { key: 'personnel', path: '/account/personnel', icon: FileUser },
] as const

export function SetupGate({ children }: { children: React.ReactNode }) {
  const t = useT()
  const me = useMeQuery().data
  const { query, mutation, enabled } = useOnboarding()
  const path = useRoutePath()
  const { setDepartmentId, isSwitching } = useDepartment()
  const refetch = query.refetch
  const resumeDepartmentId = query.data?.resumeDepartmentId
  const logout = useLogoutMutation()
  const [reading, setReading] = React.useState(true)
  const [celebrate, setCelebrate] = React.useState(false)
  const [checked, setChecked] = React.useState(false)
  const blocked = enabled && (query.data?.required ?? me?.onboardingRequired)
  const firstMissing = setupItems.find((item) => !query.data?.facts[item.key]) ?? setupItems[0]
  const active = setupItems.find((item) => item.path === path)
  const run = query.data?.run
  const needsReading = Boolean(run?.documentId && !run.htmlDone)
  React.useEffect(() => {
    if (!blocked) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !mutation.isPending) void refetch()
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [blocked, mutation.isPending, refetch])
  React.useEffect(() => {
    if (query.data && me?.onboardingRequired && !query.data.required)
      navigate('/', { replace: true })
  }, [query.data, me?.onboardingRequired])
  if (!blocked) return children
  const complete = Object.values(query.data?.facts ?? {}).filter(Boolean).length
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 md:px-10">
        <span className="font-display text-h3">
          <span translate="no">WorkPortal</span>
          <span className="ml-3 text-small font-normal text-muted-foreground">
            {t('onboarding.title')}
          </span>
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => logout.mutate(undefined, { onSettled: () => navigate('/login') })}
        >
          {t('shell.account.signout')}
        </Button>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-12">
        <div className="mb-8">
          <p className="mb-2 text-caption font-medium uppercase tracking-widest text-primary">
            {t('onboarding.chapter', { current: 1, total: 7 })}
          </p>
          <h1 className="font-display text-h2">
            {t(needsReading ? 'onboarding.welcome' : 'onboarding.setupTitle')}
          </h1>
          <p className="mt-3 text-small text-muted-foreground" data-testid="setup-description">
            {t(needsReading ? 'onboarding.readFirst' : 'onboarding.setupDescription')}
          </p>
        </div>
        {query.isError ? (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-card p-5">
            <p>{t('onboarding.loadError')}</p>
            <Button onClick={() => void query.refetch()}>{t('onboarding.retry')}</Button>
          </div>
        ) : resumeDepartmentId ? (
          <Button loading={isSwitching} onClick={() => setDepartmentId(resumeDepartmentId)}>
            {t('onboarding.resumeDepartment')}
          </Button>
        ) : !query.data ? (
          <p role="status">{t('onboarding.loading')}</p>
        ) : needsReading ? (
          <Button onClick={() => setReading(true)}>
            {t('onboarding.openIntroduction')}
            <ChevronRight className="size-4" />
          </Button>
        ) : (
          <div className="grid items-start gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
            <nav aria-label={t('onboarding.setupTitle')} className="space-y-2 lg:sticky lg:top-5">
              <p className="mb-4 text-small text-muted-foreground">
                {t('onboarding.setupProgress', { complete, total: 4 })}
              </p>
              {setupItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setChecked(false)
                    navigate(item.path)
                  }}
                  aria-current={active?.key === item.key ? 'step' : undefined}
                  className={cn(
                    'flex min-h-14 w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-small transition-colors',
                    active?.key === item.key
                      ? 'border-primary/40 bg-primary/5 text-primary'
                      : 'border-border bg-card hover:bg-accent',
                  )}
                >
                  {query.data!.facts[item.key] ? (
                    <Check className="size-5 shrink-0 text-primary" />
                  ) : (
                    <item.icon className="size-5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="flex-1">{t(`onboarding.${item.key}`)}</span>
                  {query.data!.facts[item.key] ? (
                    <span className="sr-only">{t('onboarding.complete')}</span>
                  ) : (
                    <ChevronRight className="size-4" />
                  )}
                </button>
              ))}
            </nav>
            <section className="min-w-0 rounded-xl border border-border bg-card p-5 md:p-7">
              <h2 className="mb-2 text-h3">{t(`onboarding.${(active ?? firstMissing).key}`)}</h2>
              <p className="mb-6 text-small text-muted-foreground">
                {t(`onboarding.${(active ?? firstMissing).key}Requirement`)}
              </p>
              <React.Suspense fallback={<p role="status">{t('onboarding.loading')}</p>}>
                {(active ?? firstMissing).key === 'telegram' ? (
                  <Telegram embedded setupOnly />
                ) : (active ?? firstMissing).key === 'account' ? (
                  <Profile setupRequired />
                ) : (active ?? firstMissing).key === 'resume' ? (
                  <Resume setupRequired />
                ) : (
                  <Personnel />
                )}
              </React.Suspense>
              <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-5">
                <Button
                  variant="secondary"
                  loading={mutation.isPending}
                  onClick={() => {
                    setChecked(true)
                    mutation.mutate(
                      { completeSetup: true },
                      {
                        onSuccess: (data) => {
                          const next = setupItems.find((item) => !data.facts[item.key])
                          if (next && data.facts[(active ?? firstMissing).key]) {
                            setChecked(false)
                            navigate(next.path)
                          }
                        },
                      },
                    )
                  }}
                >
                  {t('onboarding.checkProgress')}
                  <ChevronRight className="size-4" />
                </Button>
                {checked && !query.data.facts[(active ?? firstMissing).key] ? (
                  <p role="alert" className="text-small text-destructive">
                    {t('onboarding.finishSection')}{' '}
                    {t(`onboarding.${(active ?? firstMissing).key}Requirement`)}
                  </p>
                ) : null}
              </div>
            </section>
          </div>
        )}
        {mutation.isError ? (
          <p role="alert" className="mt-4 text-destructive">
            {t('onboarding.saveError')}
          </p>
        ) : null}
      </main>
      {needsReading && reading && run?.documentId ? (
        <HtmlReader
          id={run.documentId}
          onClose={() => setReading(false)}
          pending={mutation.isPending}
          onFinish={() =>
            mutation.mutate(
              { htmlDone: true },
              {
                onSuccess: (data) => {
                  if (!data.run?.htmlDone) {
                    setReading(true)
                    return
                  }
                  setCelebrate(true)
                  setReading(false)
                  navigate(firstMissing.path)
                  window.setTimeout(() => setCelebrate(false), 900)
                },
              },
            )
          }
        />
      ) : null}
      {celebrate ? (
        <div className="onboarding-reading-complete fixed inset-0 z-[100] grid place-content-center bg-background/95 text-center">
          <Check className="mx-auto mb-4 size-14 text-primary" />
          <p className="text-h3">{t('onboarding.readingComplete')}</p>
        </div>
      ) : null}
    </div>
  )
}
