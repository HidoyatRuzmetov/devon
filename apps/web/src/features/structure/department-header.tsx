// Shared page header for both screens (UI-OVERHAUL.md §9.1's recipe): title/description plus a
// department switcher, shown only when the signed-in person belongs to more than one department (the
// common case -- one -- never shows a picker for a choice of one).
import type { ReactNode } from 'react'
import { useT } from '@devon/i18n'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  PageHeader,
  Reveal,
} from '@devon/ui'
import { ChevronDown } from 'lucide-react'
import type { MyDepartmentsState } from './use-my-departments.js'

export function DepartmentHeader({
  eyebrowKey,
  titleKey,
  subtitleKey,
  departments,
  tabs,
  children,
}: {
  eyebrowKey?: string
  titleKey: string
  subtitleKey: string
  departments: MyDepartmentsState
  tabs?: ReactNode
  children?: ReactNode
}) {
  const t = useT()
  const activeName = departments.active?.name ?? ''

  const switcher =
    departments.departments.length > 1 ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm">
            {activeName}
            <ChevronDown className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {departments.departments.map((d) => (
            <DropdownMenuItem
              key={d.departmentId}
              onSelect={() => departments.setActiveDepartmentId(d.departmentId)}
            >
              {d.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null

  return (
    <Reveal>
      <PageHeader
        eyebrow={eyebrowKey ? t(eyebrowKey) : activeName}
        title={t(titleKey)}
        description={t(subtitleKey, { departmentName: activeName })}
        actions={
          switcher || children ? (
            <>
              {switcher}
              {children}
            </>
          ) : undefined
        }
        {...(tabs ? { tabs } : {})}
      />
    </Reveal>
  )
}
