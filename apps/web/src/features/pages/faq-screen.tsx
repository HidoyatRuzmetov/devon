import * as React from 'react'
import { useT, normalizeUz } from '@devon/i18n'
import { Input, PageHeader } from '@devon/ui'
import { RouterLink } from '../../lib/router.js'

const GROUPS = [
  { id: 'daily', items: ['start', 'head', 'admin', 'find'] },
  { id: 'work', items: ['projects', 'delete', 'files'] },
  { id: 'account', items: ['profile', 'telegram', 'ai'] },
] as const

const NEXT_STEPS = {
  start: { href: '/work/mine', label: 'work.view.mine' },
  head: { href: '/work/workload', label: 'work.workload.title' },
  admin: { href: '/admin', label: 'admin.console.title' },
  find: { href: '/work', label: 'work.title' },
  projects: { href: '/projects', label: 'projects.title' },
  delete: { href: '/work/archive', label: 'work.view.archive' },
  files: { href: '/work', label: 'work.title' },
  profile: { href: '/account', label: 'accounts.settings.title' },
  telegram: { href: '/account/telegram', label: 'telegram.title' },
  ai: { href: '/ai', label: 'ai.title' },
} as const

/** Bundled help stays available even when the department has no pages yet. */
export default function FaqScreen() {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const needle = normalizeUz(query).toLocaleLowerCase().trim()
  const groups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((id) =>
      normalizeUz(
        `${t(`help.groups.${group.id}`)} ${t(`help.items.${id}.q`)} ${t(`help.items.${id}.a`)}`,
      )
        .toLocaleLowerCase()
        .includes(needle),
    ),
  })).filter((group) => group.items.length > 0)
  return (
    <div className="mx-auto flex w-full max-w-200 flex-col gap-6 pb-8">
      <PageHeader title={t('help.title')} description={t('help.description')} />
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label={t('help.search')}
        placeholder={t('help.search')}
      />
      {groups.length === 0 ? (
        <p role="status" className="text-small text-muted-foreground">
          {t('help.noResults')}
        </p>
      ) : null}
      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`help-${group.id}`}>
          <h2 id={`help-${group.id}`} className="mb-2 font-display text-h3">
            {t(`help.groups.${group.id}`)}
          </h2>
          <div className="divide-y divide-border rounded-md border border-border bg-card">
            {group.items.map((id) => (
              <details
                key={`${id}-${Boolean(needle)}`}
                open={needle ? true : undefined}
                className="p-4"
              >
                <summary className="cursor-pointer font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                  {t(`help.items.${id}.q`)}
                </summary>
                <p className="mt-3 whitespace-pre-line text-small leading-relaxed text-muted-foreground">
                  {t(`help.items.${id}.a`)}
                </p>
                <RouterLink
                  href={NEXT_STEPS[id].href}
                  className="mt-3 inline-block text-small text-primary underline underline-offset-2"
                >
                  {t(NEXT_STEPS[id].label)}
                </RouterLink>
              </details>
            ))}
          </div>
        </section>
      ))}
      <RouterLink href="/pages" className="text-small text-primary underline">
        {t('pages.title')}
      </RouterLink>
    </div>
  )
}
