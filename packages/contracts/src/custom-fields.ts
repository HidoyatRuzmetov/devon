// The custom-fields model (v1.1 SPEC §5), declared here as the interface the `fields` module
// implements, so the people table, the card detail, the person page, the filter grammar and the
// notify-to-fill flow all agree on one shape before that module exists.
//
// Nothing in this file touches the database. `packages/db` owns `app.field_defs` / `app.field_values`
// (department-scoped, RLS, unique `(def, subject)`, GIN on `value`); these types are what crosses the
// wire and what `@devon/web` renders.
//
// I-2 stays binding: a definition whose normalised name matches the blocklist (birth/dob/passport/
// pinfl/inn/address/salary/nationality/religion, in all four locales and both scripts) is refused
// with the translated refusal, not silently stored.

export type FieldAppliesTo = 'card' | 'person'

export type FieldType =
  | 'text'
  | 'long_text'
  | 'number'
  | 'date'
  | 'select'
  | 'multi_select'
  | 'person'
  | 'url'
  | 'checkbox'
  /** Computed from other fields or indicators; never written by a person. */
  | 'derived'

/** SPEC §5: person fields may be head-only. Card fields are always department-visible. */
export type FieldVisibility = 'everyone' | 'head_only'

export type FieldOption = {
  id: string
  /** i18n label per locale; the AI-translate offer fills the missing ones on create. */
  label: Readonly<Record<string, string>>
  /** A token name from DESIGN.md's label palette -- never a raw hex value. */
  colorToken: string
  order: number
}

export type FieldDef = {
  id: string
  departmentId: string
  appliesTo: FieldAppliesTo
  /** Stable machine key used by the filter grammar (`field:<key>:<value>`). */
  key: string
  label: Readonly<Record<string, string>>
  description: Readonly<Record<string, string>> | null
  type: FieldType
  options: readonly FieldOption[]
  required: boolean
  defaultValue: FieldValue
  showInTable: boolean
  showOnCardTile: boolean
  /** Person fields only: may the person edit their own value? */
  selfEditable: boolean
  visibleTo: FieldVisibility
  order: number
  archivedAt: string | null
}

export type FieldValue =
  | string
  | number
  | boolean
  | readonly string[]
  | null

export type FieldValueRecord = {
  defId: string
  subjectType: FieldAppliesTo
  /** Card id, or the *membership* id for a person field (SPEC §5: person values are
   * department-scoped, stored against the membership, never against the global user row). */
  subjectId: string
  value: FieldValue
  updatedByUserId: string | null
  updatedAt: string | null
}

/** SPEC §5 caps, with the reason in the copy ("a table nobody can read is not a table"). */
export const FIELD_CAPS = Object.freeze({ card: 20, person: 10 })

/** A head's "notify to fill" request, one row per member without a value. */
export type FieldRequest = {
  id: string
  defId: string
  departmentId: string
  /** The member being asked. */
  userId: string
  requestedByUserId: string
  requestedAt: string
  remindedAt: string | null
  resolvedAt: string | null
}

export type FieldRequestProgress = {
  defId: string
  filled: number
  total: number
}

/** The contract the `fields` module implements. Declared here so the people table, the card detail
 * panel and the person page can be built against it before the module lands, and so a second
 * implementation (the Telegram Mini App's "Maydonlar" screen) cannot drift from it. */
export interface CustomFieldsPort {
  listDefs(departmentId: string, appliesTo: FieldAppliesTo): Promise<readonly FieldDef[]>
  createDef(
    departmentId: string,
    def: Omit<FieldDef, 'id' | 'departmentId' | 'archivedAt'>,
  ): Promise<FieldDef>
  updateDef(defId: string, patch: Partial<FieldDef>): Promise<FieldDef>
  archiveDef(defId: string): Promise<void>
  /** Batched by subject -- never one query per row (I-14). */
  listValues(
    departmentId: string,
    appliesTo: FieldAppliesTo,
    subjectIds: readonly string[],
  ): Promise<readonly FieldValueRecord[]>
  setValue(
    departmentId: string,
    defId: string,
    subjectId: string,
    value: FieldValue,
  ): Promise<FieldValueRecord>
  /** Creates one `FieldRequest` per active member without a value, deduped on an open request. */
  requestFill(departmentId: string, defId: string): Promise<FieldRequestProgress>
  progress(departmentId: string, defId: string): Promise<FieldRequestProgress>
}
