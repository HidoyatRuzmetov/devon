// "Add to calendar" for one event (v1.1 SPEC §10, EPIC-019).
//
// SHARED PRIMITIVE (see this package's notes): built here because the calendar feature owns the link
// shapes and the copy, but its only consumer today is `features/events`' detail dialog. The merge
// should promote it to `packages/ui` -- or leave it here and let events import it, which is what it
// does now.
//
// The four service URLs are built by the API, not the browser: Google, Outlook and Yahoo disagree
// about date formats in ways that are invisible until somebody's meeting lands an hour out, so the
// building is done once, server-side, with tests (`apps/api/src/modules/calendar/links.ts`).
//
// The `.ics` entry is a *navigation*, not an `<a download>`: the API answers
// `/calendar/items/<id>.ics` with `Content-Disposition: attachment`, which is what makes Apple
// Calendar open it on iOS and what makes every desktop browser save it. A blob URL with a `download`
// attribute would work on desktop and do nothing useful on a phone.
import * as React from 'react'
import { useT, useLocale } from '@devon/i18n'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
} from '@devon/ui'
import { CalendarPlus, Download, ExternalLink } from 'lucide-react'
import { useAddToCalendarLinks } from '../hooks.js'

export type AddToCalendarMenuProps = {
  eventId: string
  /** Rendered as the trigger; defaults to a secondary button with the standard label. */
  trigger?: React.ReactNode
  align?: 'start' | 'center' | 'end'
}

const SERVICES = [
  { key: 'google', labelKey: 'calendar.addTo.google' },
  { key: 'office365', labelKey: 'calendar.addTo.office365' },
  { key: 'outlook', labelKey: 'calendar.addTo.outlook' },
  { key: 'yahoo', labelKey: 'calendar.addTo.yahoo' },
] as const

export function AddToCalendarMenu({
  eventId,
  trigger,
  align = 'end',
}: AddToCalendarMenuProps): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  // The four URLs are fetched only once the menu is actually opened -- nobody needs them for an
  // event they are merely looking at.
  const [open, setOpen] = React.useState(false)
  const query = useAddToCalendarLinks(eventId, locale, open)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <Button variant="secondary">
            <CalendarPlus aria-hidden="true" className="size-4" />
            {t('calendar.addTo.label')}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-56">
        <DropdownMenuLabel>{t('calendar.addTo.hint')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {query.isPending ? (
          <div className="flex flex-col gap-1.5 p-2" aria-busy="true">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
          </div>
        ) : query.isError ? (
          <DropdownMenuItem disabled>{t('calendar.addTo.error')}</DropdownMenuItem>
        ) : (
          <>
            {SERVICES.map(({ key, labelKey }) => (
              <DropdownMenuItem
                key={key}
                onSelect={() => window.open(query.data[key], '_blank', 'noopener,noreferrer')}
              >
                <ExternalLink aria-hidden="true" className="size-4" />
                {t(labelKey)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                window.location.href = query.data.ics
              }}
            >
              <Download aria-hidden="true" className="size-4" />
              {t('calendar.addTo.ics')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default AddToCalendarMenu
