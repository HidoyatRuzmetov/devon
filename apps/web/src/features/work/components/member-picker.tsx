// Shared assignee/giver picker (TECH-SPEC §5's "giver -> assignee (member pickers)"). One dropdown of
// the department's roster, an optional "unassigned" entry, and a live filter for departments large
// enough that scrolling a flat list stops being fast -- the same list `useMembers()` already gives
// every other part of this feature, so a picker never issues its own request.
import * as React from 'react'
import { ChevronDown, UserRound, X } from 'lucide-react'
import { useT } from '@devon/i18n'
import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  initialsFromName,
} from '@devon/ui'
import type { MemberSummary } from '../api.js'
import { fullName } from '../lib/format.js'

export interface MemberPickerProps {
  members: readonly MemberSummary[]
  value: string | null
  onChange: (userId: string | null) => void
  /** i18n key for the "nobody selected" trigger label, e.g. `'work.field.assignee'`. */
  placeholderKey: string
  allowClear?: boolean
  disabled?: boolean
}

export function MemberPicker({
  members,
  value,
  onChange,
  placeholderKey,
  allowClear = true,
  disabled,
}: MemberPickerProps) {
  const t = useT()
  const selected = members.find((m) => m.userId === value) ?? null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" disabled={disabled} className="justify-between gap-2">
          {selected ? (
            <span className="flex items-center gap-2">
              <Avatar
                size="sm"
                src={null}
                alt={fullName(selected)}
                initials={initialsFromName(selected.givenName, selected.familyName)}
                hueSeed={selected.userId}
              />
              {fullName(selected)}
            </span>
          ) : (
            <span className="flex items-center gap-2 text-muted-foreground">
              <UserRound className="size-4" aria-hidden="true" />
              {t(placeholderKey)}
            </span>
          )}
          <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-80 overflow-y-auto" align="start">
        {allowClear ? (
          <DropdownMenuItem onSelect={() => onChange(null)}>
            <X className="size-4 text-muted-foreground" aria-hidden="true" />
            {t('work.field.unassigned')}
          </DropdownMenuItem>
        ) : null}
        {members.map((m) => (
          <DropdownMenuItem key={m.userId} onSelect={() => onChange(m.userId)}>
            <Avatar
              size="sm"
              src={null}
              alt={fullName(m)}
              initials={initialsFromName(m.givenName, m.familyName)}
              hueSeed={m.userId}
            />
            {fullName(m)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
