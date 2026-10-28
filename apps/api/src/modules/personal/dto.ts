// Row (snake_case, `Date` timestamps -- `pg`'s default type parsing) -> wire DTO (camelCase, ISO
// string timestamps) mapping. Kept separate from `repo.ts` (data access) and `index.ts` (routing) so
// each file has one job.
import type { PomodoroSessionRow, PomodoroSettingsRow, TaskRow } from './repo.js'
import type { PomodoroSessionDto, PomodoroSettingsDto, TaskDto } from './schemas.js'

export function taskToDto(row: TaskRow): TaskDto {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    doneAt: row.done_at ? row.done_at.toISOString() : null,
    notes: row.notes,
    sort: row.sort,
    estimateMin: row.estimate_min,
    linkedCardId: row.linked_card_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  }
}

export function pomodoroSettingsToDto(row: PomodoroSettingsRow): PomodoroSettingsDto {
  return {
    focusMin: row.focus_min,
    shortBreakMin: row.short_break_min,
    longBreakMin: row.long_break_min,
    cyclesBeforeLong: row.cycles_before_long,
    sound: row.sound as PomodoroSettingsDto['sound'],
    notifications: row.notifications,
    autoStart: row.auto_start,
  }
}

export function pomodoroSessionToDto(row: PomodoroSessionRow): PomodoroSessionDto {
  return {
    id: row.id,

    kind: row.kind,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
    completed: row.completed,
    createdAt: row.created_at.toISOString(),
  }
}
