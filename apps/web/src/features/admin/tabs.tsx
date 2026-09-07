import * as React from 'react'
import { useT } from '@devon/i18n'
import { cn } from '@devon/ui'
import { Link } from '../../lib/router.js'

export type AdminTabId =
  | 'dashboard'
  | 'departments'
  | 'accounts'
  | 'analytics'
  | 'audit'
  | 'health'
  | 'settings'

const TABS: { id: AdminTabId; path: string; labelKey: string }[] = [
  { id: 'dashboard', path: '/admin', labelKey: 'admin.console.tabs.dashboard' },
  { id: 'departments', path: '/admin/departments', labelKey: 'admin.console.tabs.departments' },
  { id: 'accounts', path: '/admin/accounts', labelKey: 'admin.console.tabs.accounts' },
  { id: 'analytics', path: '/admin/analytics', labelKey: 'admin.console.tabs.analytics' },
  { id: 'audit', path: '/admin/audit', labelKey: 'admin.console.tabs.audit' },
  { id: 'health', path: '/admin/health', labelKey: 'admin.console.tabs.health' },
  { id: 'settings', path: '/admin/settings', labelKey: 'admin.console.tabs.settings' },
]

export function AdminTabs({ active }: { active: AdminTabId }) {
  const t = useT()
  return (
    <nav aria-label={t('admin.console.tabs.label')} className="border-b border-border">
      <ul className="flex flex-wrap gap-1">
        {TABS.map((tab) => (
          <li key={tab.id}>
            <Link
              to={tab.path}
              aria-current={tab.id === active ? 'page' : undefined}
              className={cn(
                'inline-flex h-10 items-center rounded-t-sm px-3 text-small font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                tab.id === active
                  ? 'border-b-2 border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(tab.labelKey)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
