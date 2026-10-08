import { Bell, Send, UserCog } from 'lucide-react'
import { useT } from '@devon/i18n'
import { cn } from '@devon/ui'
import { RouterLink, useRoutePath } from '../../lib/router.js'

const SETTINGS_PAGES = [
  { path: '/account', labelKey: 'accounts.settings.title', icon: UserCog },
  { path: '/account/telegram', labelKey: 'telegram.title', icon: Send },
  { path: '/account/notifications', labelKey: 'inbox.preferences.title', icon: Bell },
] as const

/** One visible settings home, including when a notification links directly to a subpage. */
export function SettingsNavigation() {
  const t = useT()
  const path = useRoutePath()
  return (
    <nav aria-label={t('accounts.settings.subnavAria')}>
      <ul className="flex flex-wrap gap-2">
        {SETTINGS_PAGES.map((item) => (
          <li key={item.path}>
            <RouterLink
              href={item.path}
              aria-current={path === item.path ? 'page' : undefined}
              className={cn(
                'inline-flex items-center gap-2 rounded-sm border border-border px-3 py-2 text-small transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                path === item.path ? 'bg-accent text-foreground' : 'text-muted-foreground',
              )}
            >
              <item.icon className="size-4 shrink-0" aria-hidden="true" />
              {t(item.labelKey)}
            </RouterLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
