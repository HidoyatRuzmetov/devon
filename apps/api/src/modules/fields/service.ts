// The rules of the custom-fields module (v1.1 SPEC §5). `repo.ts` is SQL, `index.ts` is HTTP, this is
// the product: what a head may define, what a colleague may answer, who gets asked and what is
// written to the audit trail and the event bus when any of it happens.
//
// Three things are enforced here and nowhere else:
//   1. **I-2.** A definition whose label -- in any of the four locales, either Uzbek script -- names
//      birth data, a passport, a taxpayer id, a home location, pay, ethnicity or religion is refused
//      with `personal_data`, not stored and then hidden. "No HR module" is a product refusal, and this
//      is the line where it survives contact with a real ministry.
//   2. **The caps** (20 card fields, 10 person fields). A table nobody can read is not a table.
//   3. **`selfEditable`.** A person field the head keeps to themselves is not writable by the person
//      it is about, even though RLS would allow the row -- RLS is the coarse boundary, this is the
//      product rule on top of it.
//
// Every write goes through `withContext()` and leaves `tx.audit()` + `tx.emit()` in the *same*
// transaction (I-5, MODULE-GUIDE.md "Domain events"), so a fill request and the notification it causes
// can never disagree about whether it happened.
import { withContext, type RequestContext, type Tx } from '@devon/db'
import {
  FIELD_CAPS,
  blockedLabelLocale,
  isFieldValueMissing,
  validateFieldValue,
  type FieldAppliesTo,
  type FieldDef,
  type FieldOption,
  type FieldValue,
} from '@devon/contracts'
import * as repo from './repo.js'
import { FieldForbiddenError, FieldNotFoundError, FieldRefusedError } from './errors.js'

export type Progress = { filled: number; total: number; openRequests: number }

export type FieldDefDto = FieldDef & {
  reminderDays: number
  progress: Progress | null
}

function toDto(row: repo.DefRow, progress: Progress | null): FieldDefDto {
  return {
    ...repo.toDef(row),
    reminderDays: repo.reminderDaysOf(row),
    progress,
  }
}

// --- reads ------------------------------------------------------------------------------------------

export async function listDefs(
  ctx: RequestContext,
  input: {
    departmentId: string
    appliesTo: FieldAppliesTo | null
    includeArchived: boolean
    withProgress: boolean
  },
): Promise<FieldDefDto[]> {
  return withContext(ctx, async (tx) => {
    const rows = await repo.listDefs(
      tx,
      input.departmentId,
      input.appliesTo,
      input.includeArchived,
    )
    // Progress is a head-only number and only person fields have it -- one batched query for every
    // definition on screen, never one per row (I-14).
    const personIds = rows.filter((r) => r.applies_to === 'person').map((r) => r.id)
    const progress = input.withProgress
      ? await repo.progressFor(tx, input.departmentId, personIds)
      : new Map<string, Progress>()
    return rows.map((row) => toDto(row, progress.get(row.id) ?? null))
  })
}

export async function listValues(
  ctx: RequestContext,
  input: {
    departmentId: string
    subjectType: FieldAppliesTo
    subjectIds: readonly string[]
    userIds: readonly string[]
    /** True when the caller is this department's head: their reads of head-only person answers are
     * recorded on `audit.private_reads` (I-2's other half -- "every head read is audited"). */
    isHead: boolean
    actorUserId: string
  },
): Promise<ReturnType<typeof repo.toValueDto>[]> {
  return withContext(ctx, async (tx) => {
    let subjectIds = [...input.subjectIds]
    if (input.subjectType === 'person' && input.userIds.length > 0) {
      const map = await repo.membershipUserMap(tx, input.departmentId, input.userIds)
      subjectIds = [...subjectIds, ...map.keys()]
    }
    const rows = await repo.listValues(tx, input.departmentId, input.subjectType, subjectIds)

    if (input.subjectType === 'person' && input.isHead) {
      const foreign = rows.filter(
        (r) => r.subject_user_id !== null && r.subject_user_id !== input.actorUserId,
      )
      // One `audit.private_reads` row per colleague whose answers this head just looked at -- a small,
      // bounded set (the department), and the only record that says who read what.
      for (const userId of new Set(foreign.map((r) => r.subject_user_id!))) {
        tx.privateRead({ subjectUserId: userId, fields: ['field_values'] })
      }
    }

    return rows.map(repo.toValueDto)
  })
}

export type MyField = {
  def: FieldDefDto
  value: FieldValue
  updatedAt: string | null
  requested: boolean
  requestedAt: string | null
  editable: boolean
}

/** "Mening maʼlumotlarim": every live person field of the department, this person's own answer, and
 * whether the head is still waiting for it. */
export async function myFields(
  ctx: RequestContext,
  input: { departmentId: string; userId: string },
): Promise<{
  membershipId: string | null
  fields: MyField[]
  missingRequired: number
  openRequests: number
}> {
  return withContext(ctx, async (tx) => {
    const membershipId = await repo.membershipOf(tx, input.departmentId, input.userId)
    const defs = await repo.listDefs(tx, input.departmentId, 'person', false)
    const [values, requests] = await Promise.all([
      membershipId
        ? repo.listValues(tx, input.departmentId, 'person', [membershipId])
        : Promise.resolve([]),
      repo.openRequestsFor(tx, input.departmentId, input.userId),
    ])
    const byDef = new Map(values.map((v) => [v.def_id, v]))

    const fields: MyField[] = defs.map((row) => {
      const def = toDto(row, null)
      const stored = byDef.get(row.id)
      const value = stored?.value ?? null
      const requestedAt = requests.get(row.id) ?? null
      return {
        def,
        value,
        updatedAt: stored ? repo.toValueDto(stored).updatedAt : null,
        requested: requestedAt !== null,
        requestedAt,
        editable: def.selfEditable && def.type !== 'derived',
      }
    })

    return {
      membershipId,
      fields,
      missingRequired: fields.filter((f) => f.def.required && isFieldValueMissing(f.def, f.value))
        .length,
      openRequests: fields.filter((f) => f.requested).length,
    }
  })
}

// --- definition writes -------------------------------------------------------------------------------

export type CreateDefInput = {
  departmentId: string
  actorUserId: string
  appliesTo: FieldAppliesTo
  key: string
  label: Record<string, string>
  description: Record<string, string> | null
  type: FieldDef['type']
  options: readonly FieldOption[]
  required: boolean
  defaultValue: FieldValue
  showInTable: boolean
  showOnCardTile: boolean
  selfEditable: boolean
  visibleTo: 'everyone' | 'head_only'
  reminderDays: number
}

function assertAllowedLabel(label: Record<string, string>, key: string): void {
  const locale = blockedLabelLocale(label, key)
  if (locale !== null) throw new FieldRefusedError('personal_data', 'label')
}

export async function createDef(ctx: RequestContext, input: CreateDefInput): Promise<FieldDefDto> {
  assertAllowedLabel(input.label, input.key)

  return withContext(ctx, async (tx) => {
    const live = await repo.countLiveDefs(tx, input.departmentId, input.appliesTo)
    if (live >= FIELD_CAPS[input.appliesTo]) throw new FieldRefusedError('cap_reached', 'key')

    const existing = await repo.listDefs(tx, input.departmentId, input.appliesTo, false)
    if (existing.some((d) => d.key === input.key)) {
      throw new FieldRefusedError('duplicate_key', 'key')
    }

    const row = await repo.insertDef(tx, {
      departmentId: input.departmentId,
      appliesTo: input.appliesTo,
      key: input.key,
      label: input.label,
      description: input.description,
      type: input.type,
      options: input.options,
      required: input.required,
      defaultValue: input.defaultValue,
      showInTable: input.showInTable,
      showOnCardTile: input.showOnCardTile,
      selfEditable: input.selfEditable,
      visibleTo: input.visibleTo,
      sort: existing.length,
      reminderDays: input.reminderDays,
      createdByUserId: input.actorUserId,
    })

    tx.audit({
      action: 'fields.definition_created',
      subjectType: 'field_def',
      subjectId: row.id,
      after: { key: row.key, appliesTo: row.applies_to, type: row.type, visibleTo: row.visible_to },
    })
    tx.emit({
      type: 'fields.definition.created',
      departmentId: input.departmentId,
      payload: { defId: row.id, actorUserId: input.actorUserId, appliesTo: row.applies_to },
    })

    return toDto(row, null)
  })
}

export type UpdateDefInput = Partial<Omit<CreateDefInput, 'departmentId' | 'actorUserId' | 'appliesTo' | 'key'>>

export async function updateDef(
  ctx: RequestContext,
  input: {
    departmentId: string
    actorUserId: string
    defId: string
    patch: UpdateDefInput
  },
): Promise<FieldDefDto> {
  return withContext(ctx, async (tx) => {
    const before = await repo.getDef(tx, input.departmentId, input.defId)
    if (!before) throw new FieldNotFoundError()

    const label = input.patch.label ?? before.label ?? {}
    assertAllowedLabel(label, before.key)

    // `exactOptionalPropertyTypes` is on, so an absent key and a key set to `undefined` are different
    // things here -- the patch is built from the keys the caller actually sent.
    const row = await repo.updateDef(tx, input.departmentId, input.defId, {
      ...input.patch,
    })
    if (!row) throw new FieldNotFoundError()

    // The denormalised copy on every value row, updated in the same transaction as the definition, so
    // a column that just became head-only is head-only for the very next SELECT (see the migration).
    if (row.visible_to !== before.visible_to) {
      await repo.syncValueVisibility(
        tx,
        input.departmentId,
        input.defId,
        row.visible_to === 'head_only',
      )
    }

    tx.audit({
      action: 'fields.definition_updated',
      subjectType: 'field_def',
      subjectId: row.id,
      before: { visibleTo: before.visible_to, required: before.required, sort: before.sort },
      after: { visibleTo: row.visible_to, required: row.required, sort: row.sort },
    })
    tx.emit({
      type: 'fields.definition.updated',
      departmentId: input.departmentId,
      payload: { defId: row.id, actorUserId: input.actorUserId },
    })

    return toDto(row, null)
  })
}

export async function setArchived(
  ctx: RequestContext,
  input: {
    departmentId: string
    actorUserId: string
    defId: string
    archived: boolean
  },
): Promise<FieldDefDto> {
  return withContext(ctx, async (tx) => {
    const row = await repo.setArchived(tx, input.departmentId, input.defId, input.archived)
    if (!row) throw new FieldNotFoundError()

    tx.audit({
      action: input.archived ? 'fields.definition_archived' : 'fields.definition_restored',
      subjectType: 'field_def',
      subjectId: row.id,
      after: { key: row.key, archived: input.archived },
    })
    tx.emit({
      type: 'fields.definition.archived',
      departmentId: input.departmentId,
      payload: { defId: row.id, actorUserId: input.actorUserId, archived: input.archived },
    })

    return toDto(row, null)
  })
}

export async function reorder(
  ctx: RequestContext,
  input: { departmentId: string; actorUserId: string; ids: readonly string[] },
): Promise<void> {
  return withContext(ctx, async (tx) => {
    await repo.reorderDefs(tx, input.departmentId, input.ids)
    tx.audit({
      action: 'fields.definitions_reordered',
      subjectType: 'field_def',
      subjectId: input.ids[0] ?? null,
      after: { count: input.ids.length },
    })
    tx.emit({
      type: 'fields.definition.reordered',
      departmentId: input.departmentId,
      payload: { actorUserId: input.actorUserId, count: input.ids.length },
    })
  })
}

// --- value writes --------------------------------------------------------------------------------------

export type SetValueInput = {
  departmentId: string
  actorUserId: string
  isHead: boolean
  defId: string
  subjectId?: string | undefined
  subjectUserId?: string | undefined
  value: FieldValue
}

export async function setValue(
  ctx: RequestContext,
  input: SetValueInput,
): Promise<{ defId: string; subjectId: string; value: FieldValue }> {
  return withContext(ctx, async (tx) => {
    const row = await repo.getDef(tx, input.departmentId, input.defId)
    if (!row) throw new FieldNotFoundError()
    if (row.archived_at !== null) throw new FieldRefusedError('archived', 'defId')
    const def = repo.toDef(row)

    let subjectId = input.subjectId ?? null
    let subjectUserId: string | null = null

    if (def.appliesTo === 'person') {
      // A person value hangs off the *membership*, so whichever id the caller knows is resolved to
      // one here rather than at three different call sites.
      const targetUserId = input.subjectUserId ?? input.actorUserId
      subjectUserId = targetUserId
      subjectId = subjectId ?? (await repo.membershipOf(tx, input.departmentId, targetUserId))
      if (!subjectId) throw new FieldRefusedError('unknown_subject', 'subjectId')
      if (targetUserId !== input.actorUserId && !input.isHead) throw new FieldForbiddenError()
      if (targetUserId === input.actorUserId && !input.isHead && !def.selfEditable) {
        throw new FieldRefusedError('not_self_editable', 'defId')
      }
    } else if (!subjectId) {
      throw new FieldRefusedError('unknown_subject', 'subjectId')
    }

    const checked = validateFieldValue(def, input.value)
    if (!checked.ok) throw new FieldRefusedError('invalid_value', 'value')

    const before = await repo.previousValue(tx, input.departmentId, def.id, subjectId)
    await repo.upsertValue(tx, {
      departmentId: input.departmentId,
      defId: def.id,
      subjectType: def.appliesTo,
      subjectId,
      subjectUserId,
      headOnly: def.visibleTo === 'head_only',
      value: checked.value,
      updatedByUserId: input.actorUserId,
    })

    // Answering closes the head's request -- filling is the resolution, never a second click.
    let resolved = false
    if (def.appliesTo === 'person' && subjectUserId && !isFieldValueMissing(def, checked.value)) {
      resolved = await repo.resolveRequest(tx, input.departmentId, def.id, subjectUserId)
    }

    tx.audit({
      action: 'fields.value_set',
      subjectType: def.appliesTo === 'person' ? 'membership' : 'card',
      subjectId,
      before: { key: def.key, value: before },
      after: { key: def.key, value: checked.value },
    })
    tx.emit({
      type: 'fields.value.set',
      departmentId: input.departmentId,
      payload: {
        defId: def.id,
        key: def.key,
        appliesTo: def.appliesTo,
        subjectId,
        userId: subjectUserId,
        actorUserId: input.actorUserId,
        resolvedRequest: resolved,
      },
    })

    return { defId: def.id, subjectId, value: checked.value }
  })
}

// --- notify to fill ----------------------------------------------------------------------------------

export type NotifyResult = Progress & { asked: number; reminded: number }

/**
 * SPEC §5's "Notify to fill". One request row per active member who has no answer yet (deduped on an
 * open request), one `fields.request.created` event per person -- which is what the notification
 * registry turns into an inbox row and an individual Telegram message in that person's own locale.
 *
 * A second call on the same definition does not create duplicates: everyone still open is *nudged*
 * instead (`reminded_at` moves), which is exactly "the head can nudge once more".
 */
export async function notifyToFill(
  ctx: RequestContext,
  input: { departmentId: string; actorUserId: string; defId: string },
): Promise<NotifyResult> {
  return withContext(ctx, async (tx) => {
    const row = await repo.getDef(tx, input.departmentId, input.defId)
    if (!row) throw new FieldNotFoundError()
    if (row.applies_to !== 'person') throw new FieldRefusedError('unknown_subject', 'defId')
    if (row.archived_at !== null) throw new FieldRefusedError('archived', 'defId')

    const asked = await repo.createRequests(tx, input.departmentId, input.defId, input.actorUserId)
    // Nobody new to ask -> this is the nudge. `reminder_days` is the head's own window, and `0` here
    // would re-ping everyone on every click, so the nudge respects it too.
    const reminded =
      asked.length === 0
        ? await repo.markReminded(tx, input.departmentId, input.defId, 0)
        : []

    for (const userId of [...asked, ...reminded]) {
      tx.emit({
        type: 'fields.request.created',
        departmentId: input.departmentId,
        payload: {
          defId: row.id,
          key: row.key,
          userId,
          actorUserId: input.actorUserId,
          reminder: asked.length === 0,
        },
      })
    }

    tx.audit({
      action: 'fields.fill_requested',
      subjectType: 'field_def',
      subjectId: row.id,
      after: { key: row.key, asked: asked.length, reminded: reminded.length },
    })

    const progress = await repo.progressFor(tx, input.departmentId, [row.id])
    const p = progress.get(row.id) ?? { filled: 0, total: 0, openRequests: 0 }
    return { ...p, asked: asked.length, reminded: reminded.length }
  })
}

/** The reminder sweep's per-department half (see `reminders.ts`): nudge every open request older than
 * its definition's own window and emit one event per person. */
export async function sweepReminders(
  ctx: RequestContext,
  input: { departmentId: string; defId: string; reminderDays: number },
): Promise<number> {
  return withContext(ctx, async (tx) => {
    const row = await repo.getDef(tx, input.departmentId, input.defId)
    if (!row) return 0
    const reminded = await repo.markReminded(
      tx,
      input.departmentId,
      input.defId,
      input.reminderDays,
    )
    for (const userId of reminded) {
      tx.emit({
        type: 'fields.request.created',
        departmentId: input.departmentId,
        payload: { defId: row.id, key: row.key, userId, actorUserId: null, reminder: true },
      })
    }
    if (reminded.length > 0) {
      tx.audit({
        action: 'fields.fill_reminded',
        subjectType: 'field_def',
        subjectId: row.id,
        after: { key: row.key, reminded: reminded.length },
      })
    }
    return reminded.length
  })
}

/** Used by `index.ts` to decide whether a definition list should carry progress at all. */
export async function progressFor(
  tx: Tx,
  departmentId: string,
  defIds: readonly string[],
): Promise<Map<string, Progress>> {
  return repo.progressFor(tx, departmentId, defIds)
}
