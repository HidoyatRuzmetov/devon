import type { ComponentProps, ReactNode } from 'react'
import { SectionCard, cn } from '@devon/ui'

/** One settings rhythm across account forms and embedded connection panes. Controls retain their
 * normal touch targets; density comes from quieter headings and less repeated panel padding. */
export function SettingsSection({ className, ...props }: ComponentProps<typeof SectionCard>) {
  return (
    <SectionCard
      {...props}
      className={cn(
        'shadow-none [&>header]:px-4 [&>header]:pt-4 [&>header_h3]:text-lead [&>header_h3]:font-semibold [&>div]:px-4 [&>div]:py-3 [&>footer]:px-4',
        className,
      )}
    />
  )
}

export function SettingsPaneHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="flex min-w-0 flex-col gap-3">
      <h2 className="text-lead font-semibold leading-snug text-foreground">{title}</h2>
      {children}
    </header>
  )
}
