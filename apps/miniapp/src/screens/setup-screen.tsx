// "Telegram sozlamalari" -- the head's setup checklist (SPEC §9: "the department settings show the
// bot username and a setup checklist for the head").
//
// The same `GET /api/v1/telegram/departments/:id/setup-checklist` feeds the web department settings
// (see `apps/web/src/miniapp/telegram-setup-card.tsx`, which the merge mounts on the Telegram tab).
// It lives here too because the person who has to act on it -- add the bot, set the menu button, chase
// the six people who have not linked yet -- is holding their phone when they find out.
//
// Head-only, twice: the route's subject is `{kind:'department_managed'}` on the server, and this
// screen is only reachable from a row that `useIsHead()` renders. The client only hides; the server
// decides (I-6), which is why a 403 here still renders the designed no-permission state.
import * as React from 'react'
import { Check, Copy, X } from 'lucide-react'
import { useT } from '@devon/i18n'
import { Badge, Button, cn, toast } from '@devon/ui'
import { getSetupChecklist } from '../lib/api.js'
import { useQuery } from '../lib/use-query.js'
import { useSession } from '../lib/session.js'
import { ListSkeleton, QueryState, ScreenBody, ScreenHeader } from '../components/screen.js'
import { SectionLabel } from '../components/bits.js'

export function SetupScreen(): React.ReactElement {
  const t = useT()
  const session = useSession()
  const departmentId = session.department?.id ?? null
  const query = useQuery(
    () =>
      departmentId
        ? getSetupChecklist(departmentId)
        : Promise.reject(new Error('no department in context')),
    [departmentId],
  )

  const data = query.data
  const copy = (value: string): void => {
    navigator.clipboard
      ?.writeText(value)
      .then(() => toast.success(t('miniapp.setup.copied')))
      .catch(() => toast.error(t('miniapp.setup.copyFailed')))
  }

  return (
    <>
      <ScreenHeader
        title={t('miniapp.setup.title')}
        eyebrow={session.department?.name ?? t('miniapp.noDepartment')}
        onBack="history"
      />
      <ScreenBody>
        {query.status === 'loading' && data === null ? (
          <ListSkeleton rows={4} />
        ) : data === null ? (
          <QueryState error={query.error} onRetry={query.refetch} />
        ) : (
          <>
            <section className="border-border bg-card shadow-1 mb-3 flex flex-col gap-2 rounded-md border p-3">
              <p className="text-muted-foreground text-[11px] tracking-[0.08em] uppercase">
                {t('miniapp.setup.bot')}
              </p>
              {data.botUsername ? (
                <div className="flex items-center gap-2">
                  <span className="font-mono flex-1 text-[14px] leading-5">
                    @{data.botUsername}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => copy(`@${data.botUsername ?? ''}`)}
                  >
                    <Copy className="size-4" aria-hidden />
                    <span className="sr-only">{t('miniapp.setup.copy')}</span>
                  </Button>
                </div>
              ) : (
                <p className="text-muted-foreground text-[13px] leading-5">
                  {t('miniapp.setup.noBot')}
                </p>
              )}
              <p className="text-muted-foreground text-[11px] tracking-[0.08em] uppercase">
                {t('miniapp.setup.appUrl')}
              </p>
              <div className="flex items-center gap-2">
                <span className="font-mono min-w-0 flex-1 truncate text-[13px] leading-5">
                  {data.miniappUrl}
                </span>
                <Button size="sm" variant="secondary" onClick={() => copy(data.miniappUrl)}>
                  <Copy className="size-4" aria-hidden />
                  <span className="sr-only">{t('miniapp.setup.copy')}</span>
                </Button>
              </div>
            </section>

            {/* The total, not the done count -- every other `SectionLabel` in this app counts the
                rows under it, and each row already says "Tayyor" or "Qoldi" for itself. */}
            <SectionLabel count={data.steps.length}>{t('miniapp.setup.checklist')}</SectionLabel>
            <ol className="flex flex-col gap-2">
              {data.steps.map((step) => (
                <li
                  key={step.id}
                  className={cn(
                    'border-border bg-card flex items-start gap-3 rounded-md border px-3 py-3',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
                      step.done
                        ? 'bg-success text-success-foreground'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {step.done ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] leading-5 font-medium">
                      {t(`miniapp.setup.step.${step.id}.title`)}
                    </span>
                    <span className="text-muted-foreground block text-[12px] leading-4">
                      {t(`miniapp.setup.step.${step.id}.body`)}
                    </span>
                  </span>
                  {step.progress ? (
                    <Badge tone={step.done ? 'success' : 'neutral'}>
                      {step.progress.done} / {step.progress.total}
                    </Badge>
                  ) : (
                    <Badge tone={step.done ? 'success' : 'neutral'}>
                      {t(step.done ? 'miniapp.setup.done' : 'miniapp.setup.todo')}
                    </Badge>
                  )}
                </li>
              ))}
            </ol>

            <p className="text-muted-foreground mt-3 text-[12px] leading-5">
              {t('miniapp.setup.linkedSummary', {
                linked: data.linkedMemberCount,
                total: data.memberCount,
                groups: data.groupCount,
              })}
            </p>
          </>
        )}
      </ScreenBody>
    </>
  )
}
