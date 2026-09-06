// Shared page header for both screens: title/subtitle plus a department switcher, shown only when
// the signed-in person belongs to more than one department (the common case -- one -- never shows a
// picker for a choice of one).
import type { ReactNode } from 'react'
import { useT } from '@devon/i18n'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@devon/ui'
import { ChevronDown } from 'lucide-react'
import type { MyDepartmentsState } from './use-my-departments.js'

export function DepartmentHeader({
  titleKey,
  subtitleKey,
  departments,
  children,
}: {
  titleKey: string
  subtitleKey: string
  departments: MyDepartmentsState
  children?: ReactNode
}) {
  const t = useT()
  const activeName = departments.active?.name ?? ''

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-h2 text-foreground">{t(titleKey)}</h1>
        <p className="text-body text-muted-foreground">
          {t(subtitleKey, { departmentName: activeName })}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {departments.departments.length > 1 ? (
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
        ) : null}
        {children}
      </div>
    </div>
  )
}
