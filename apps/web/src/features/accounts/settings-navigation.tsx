import {
  Bell,
  Building2,
  CalendarDays,
  Fingerprint,
  Send,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react'
import { useT } from '@devon/i18n'
import { cn } from '@devon/ui'
import { navigate, RouterLink } from '../../lib/router.js'

export const SETTINGS_GROUPS = [
  {
    labelKey: 'accounts.settings.profile',
    items: [
      { path: '/account', labelKey: 'settings.accountProfile', icon: UserRound },
      { path: '/account/professional', labelKey: 'portal.profile.title', icon: Fingerprint },
    ],
  },
  {
    labelKey: 'settings.workspace',
    items: [
      { path: '/account/notifications', labelKey: 'inbox.preferences.title', icon: Bell },
      { path: '/account/telegram', labelKey: 'telegram.title', icon: Send },
      { path: '/account/calendar', labelKey: 'calendar.title', icon: CalendarDays },
      { path: '/account/department', labelKey: 'settings.department', icon: Building2 },
    ],
  },
  {
    labelKey: 'accounts.settings.security',
    items: [
      { path: '/account/security', labelKey: 'settings.signInSecurity', icon: ShieldCheck },
      { path: '/account/delete', labelKey: 'accounts.delete.title', icon: Trash2 },
    ],
  },
] as const

/** Routed sections retain back/forward and deep links. Mobile gets a native grouped picker. */
export function SettingsNavigation({ path }: { path: string }) {
  const t = useT()
  return (
    <>
      <label className="flex flex-col gap-2 text-small lg:hidden">
        <span className="font-medium">{t('accounts.settings.subnavAria')}</span>
        <select
          value={path}
          onChange={(event) => navigate(event.target.value)}
          className="min-h-11 w-full rounded-md border border-border bg-card px-3 text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {SETTINGS_GROUPS.map((group) => (
            <optgroup key={group.labelKey} label={t(group.labelKey)}>
              {group.items.map((item) => (
                <option key={item.path} value={item.path}>
                  {t(item.labelKey)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <nav
        aria-label={t('accounts.settings.subnavAria')}
        className="sticky top-4 hidden w-56 shrink-0 flex-col gap-6 lg:flex"
      >
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.labelKey} className="flex flex-col gap-1.5">
            <p className="px-3 text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
              {t(group.labelKey)}
            </p>
            <ul className="flex flex-col gap-1">
              {group.items.map((item) => (
                <li key={item.path}>
                  <RouterLink
                    href={item.path}
                    aria-current={path === item.path ? 'page' : undefined}
                    className={cn(
                      'flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-small transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      path === item.path
                        ? 'bg-accent font-medium text-primary'
                        : 'text-muted-foreground',
                    )}
                  >
                    <item.icon className="size-4 shrink-0" aria-hidden="true" />
                    <span>{t(item.labelKey)}</span>
                  </RouterLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </>
  )
}
