// Row (snake_case, `Date` timestamps -- `pg`'s default type parsing) -> wire DTO (camelCase, ISO
// string timestamps) mapping. Kept separate from `repo.ts` (data access) and `index.ts` (routing) so
// each file has one job.
import type {
  CanvasRow,
  CanvasSummaryRow,
  NoteRow,
  PomodoroSessionRow,
  PomodoroSettingsRow,
  PomodoroStatsRow,
  SprintRow,
  TaskRow,
} from './repo.js'
import type {
  CanvasDto,
  NoteDto,
  PomodoroSessionDto,
  PomodoroSettingsDto,
  PomodoroStatsDto,
  SprintDto,
  TaskDto,
} from './schemas.js'

export function sprintToDto(row: SprintRow): SprintDto {
  return {
    id: row.id,
    kind: row.kind,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    goal: row.goal,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  }
}

export function taskToDto(row: TaskRow): TaskDto {
  return {
    id: row.id,
    sprintId: row.sprint_id,
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

export function noteToDto(row: NoteRow): NoteDto {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    pinned: row.pinned,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  }
}

export function canvasSummaryToDto(row: CanvasSummaryRow) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  }
}

export function canvasToDto(row: CanvasRow): CanvasDto {
  return {
    ...canvasSummaryToDto(row),
    scene: row.scene as CanvasDto['scene'],
    stickies: row.stickies as CanvasDto['stickies'],
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
    taskId: row.task_id,
    kind: row.kind,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
    completed: row.completed,
    createdAt: row.created_at.toISOString(),
  }
}

export function pomodoroStatsToDto(row: PomodoroStatsRow): PomodoroStatsDto {
  return {
    today: {
      focusMinutes: Math.round(row.today_focus_minutes),
      focusSessions: row.today_focus_sessions,
      completedSessions: row.today_completed,
    },
    week: {
      focusMinutes: Math.round(row.week_focus_minutes),
      focusSessions: row.week_focus_sessions,
      completedSessions: row.week_completed,
    },
  }
}
