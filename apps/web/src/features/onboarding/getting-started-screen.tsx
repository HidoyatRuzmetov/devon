import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, cn } from '@devon/ui'
import {
  ArrowRight,
  BookOpen,
  Check,
  Circle,
  CalendarDays,
  Clock3,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  Play,
  Users,
  UserRound,
} from 'lucide-react'
import { navigate, useSearchParams } from '../../lib/router.js'
import { useDepartment } from '../../lib/session.js'
import { useOnboarding } from './context.js'
import { DocumentsPanel } from './documents-panel.js'
import { HtmlReader } from './html-reader.js'
import { chapterStarts } from './steps.js'

const icons = [UserRound, LayoutDashboard, ListChecks, FolderKanban, CalendarDays, Users, Clock3]
export default function GettingStartedScreen() {
  const t = useT()
  const { query, start, mutation } = useOnboarding()
  const { departmentId } = useDepartment()
  const search = useSearchParams()
  const materials = search.get('tab') === 'materials'
  const [reading, setReading] = React.useState(false)
  const run = query.data?.run
  const done = {
    reading: run?.htmlDone ?? false,
    tour: run?.tourCompleted ?? false,
    ...query.data?.facts,
  }
  return (
    <div className="mx-auto w-full max-w-5xl space-y-7 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p translate="no" className="mb-2 text-caption uppercase tracking-widest text-primary">
            WorkPortal
          </p>
          <h1 className="font-display text-h2">{t('onboarding.title')}</h1>
          <p className="mt-3 max-w-xl text-body text-muted-foreground">
            {t('onboarding.centerDescription')}
          </p>
        </div>
        <div
          className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1"
          role="group"
          aria-label={t('onboarding.title')}
        >
          <Button
            variant={!materials ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={!materials}
            onClick={() => navigate('/help')}
          >
            {t('onboarding.guide')}
          </Button>
          <Button
            variant={materials ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={materials}
            onClick={() => navigate('/help?tab=materials')}
          >
            {t('onboarding.documents.tab')}
          </Button>
        </div>
      </header>
      {materials ? (
        <DocumentsPanel />
      ) : (
        <>
          {!departmentId ? (
            <p className="rounded-lg border border-border p-5 text-muted-foreground">
              {t('onboarding.joinFirst')}
            </p>
          ) : (
            <>
              <section className="relative overflow-hidden rounded-2xl border border-primary/20 bg-card p-6 md:p-8">
                <div
                  className="pointer-events-none absolute -right-10 -top-12 size-56 rounded-full bg-primary/5"
                  aria-hidden="true"
                />
                <div className="relative max-w-xl">
                  <span className="inline-flex items-center gap-2 text-caption font-medium text-primary">
                    <BookOpen className="size-4" />
                    {t('onboarding.sevenChapters')}
                  </span>
                  <h2 className="mt-4 text-h2">{t('onboarding.centerTitle')}</h2>
                  <p className="mt-3 text-small text-muted-foreground">
                    {t('onboarding.centerHint')}
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Button
                      onClick={() => {
                        if (run && !run.tourCompleted)
                          mutation.mutate(
                            { paused: false },
                            { onSuccess: () => start(run.tourStep, false) },
                          )
                        else start()
                      }}
                      loading={mutation.isPending}
                    >
                      <Play className="size-4" />
                      {t(
                        run && !run.tourCompleted
                          ? 'onboarding.resumeGuide'
                          : 'onboarding.startGuide',
                      )}
                    </Button>
                    {run?.documentId ? (
                      <Button variant="secondary" onClick={() => setReading(true)}>
                        {t('onboarding.openIntroduction')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </section>
              {query.isError || mutation.isError ? (
                <div role="alert" className="text-destructive">
                  {t('onboarding.loadError')}
                  <Button variant="ghost" onClick={() => void query.refetch()}>
                    {t('onboarding.retry')}
                  </Button>
                </div>
              ) : null}
              <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
                <section
                  className="overflow-hidden rounded-xl border border-border bg-card"
                  aria-label={t('onboarding.sevenChapters')}
                >
                  {chapterStarts.map((chapterStep, index) => {
                    const Icon = icons[index]!
                    return (
                      <button
                        type="button"
                        key={index}
                        onClick={() => start(chapterStep)}
                        className="flex min-h-20 w-full items-center gap-4 border-b border-border px-5 py-4 text-left transition-colors last:border-0 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted/70 text-muted-foreground">
                          <Icon className="size-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">
                            <span className="mr-2 text-caption tabular-nums text-muted-foreground">
                              0{index + 1}
                            </span>
                            {t(`onboarding.chapters.${index}`)}
                          </p>
                          <p className="mt-1 text-caption text-muted-foreground">
                            {t(`onboarding.chapterHints.${index}`)}
                          </p>
                        </div>
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    )
                  })}
                </section>
                {run ? (
                  <aside className="rounded-xl border border-border bg-card p-5">
                    <h2 className="text-small font-semibold">{t('onboarding.checklistTitle')}</h2>
                    <ul className="mt-4 space-y-4">
                      {(
                        ['reading', 'tour', 'telegram', 'account', 'resume', 'personnel'] as const
                      ).map((key) => (
                        <li
                          key={key}
                          className={cn(
                            'flex gap-3 text-small',
                            done[key] ? 'text-muted-foreground' : 'text-foreground',
                          )}
                        >
                          {done[key] ? (
                            <Check className="size-4 shrink-0 text-primary" />
                          ) : (
                            <Circle className="size-4 shrink-0 text-muted-foreground" />
                          )}
                          <span>{t(`onboarding.${key}`)}</span>
                        </li>
                      ))}
                    </ul>
                    {run.cardId ? (
                      <Button
                        className="mt-5 w-full"
                        size="sm"
                        variant="secondary"
                        onClick={() => navigate(`/work?card=${run.cardId}`)}
                      >
                        {t('onboarding.openTask')}
                        <ArrowRight className="size-4" />
                      </Button>
                    ) : null}
                  </aside>
                ) : null}
              </div>
            </>
          )}
        </>
      )}
      {reading && run?.documentId ? (
        <HtmlReader id={run.documentId} onClose={() => setReading(false)} />
      ) : null}
    </div>
  )
}
