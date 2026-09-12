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

export type FieldValue = string | number | boolean | readonly string[] | null

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

// ---------------------------------------------------------------------------------------------
// The rules the `fields` module, the API's Zod schemas and the web forms all share.
//
// Everything below is pure and dependency-free, exactly like `can()` and the filter grammar: a value
// that the browser refuses must be the same value the server refuses, with the same reason code, or
// the two halves of one form disagree about what a number is.
// ---------------------------------------------------------------------------------------------

export const FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'date',
  'select',
  'multi_select',
  'person',
  'url',
  'checkbox',
  'derived',
] as const

export function isFieldType(value: string): value is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(value)
}

/** Types whose value is chosen from `FieldDef.options` rather than typed. */
export function isOptionType(type: FieldType): boolean {
  return type === 'select' || type === 'multi_select'
}

/** A key is what `field:<key>:<value>` types into a filter bar, so it is ASCII, lower case and has no
 * spaces -- the label carries the language, the key carries the machine. */
export const FIELD_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/

export function isValidFieldKey(key: string): boolean {
  return FIELD_KEY_RE.test(key)
}

/** Derives a usable key from a label typed in any of the four locales ("Taʼlim" -> `talim`). Returns
 * an empty string when nothing survives, and the caller asks the person to type one. */
export function suggestFieldKey(label: string): string {
  const map: Readonly<Record<string, string>> = {
    ʻ: '',
    ʼ: '',
    '‘': '',
    '’': '',
    "'": '',
    ç: 'ch',
    ş: 'sh',
    ğ: 'g',
    ö: 'o',
    ü: 'u',
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    ғ: 'g',
    д: 'd',
    е: 'e',
    ё: 'yo',
    ж: 'j',
    з: 'z',
    и: 'i',
    й: 'y',
    к: 'k',
    қ: 'q',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    ў: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'x',
    ҳ: 'h',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'sch',
    ъ: '',
    ы: 'i',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  }
  const ascii = [...label.toLowerCase()]
    .map((ch) => map[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return /^[a-z]/.test(ascii) ? ascii : ascii ? `f_${ascii}`.slice(0, 40) : ''
}

// --- I-2: the personal-data blocklist -------------------------------------------------------------
//
// "No HR module" is a product refusal, and a head who cannot add a `Passport raqami` column is how
// that refusal survives contact with a real ministry. The list below is the same one
// `packages/db/test/checks/migration-lint.ts` enforces on column names, restated for *labels typed by
// a person* -- so it has to cover four locales and both Uzbek scripts, not just English identifiers.
//
// Matching is token-exact for short words (so `inn` never flags `innovatsiya`) and substring for
// multi-word phrases (so `дата рождения` is caught however it is spaced).

const BLOCKED_TOKENS: readonly string[] = [
  // en
  'birth',
  'birthday',
  'birthdate',
  'birthplace',
  'dob',
  'passport',
  'pinfl',
  'inn',
  'salary',
  'wage',
  'wages',
  'nationality',
  'ethnicity',
  'religion',
  'creed',
  // uz-Latn (both the modifier-letter and the ASCII spellings people actually type)
  'tugilgan',
  'tugʻilgan',
  "tug'ilgan",
  'tavallud',
  'pasport',
  'jshshir',
  'stir',
  'maosh',
  'oylik',
  'millati',
  'millat',
  'milliy',
  'din',
  'diniy',
  'eʼtiqod',
  "e'tiqod",
  'etiqod',
  // uz-Cyrl
  'туғилган',
  'тугилган',
  'таваллуд',
  'паспорт',
  'жшшир',
  'стир',
  'маош',
  'ойлик',
  'миллат',
  'миллати',
  'дин',
  'диний',
  'эътиқод',
  // ru
  'рождения',
  'рождение',
  'паспорт',
  'пинфл',
  'инн',
  'зарплата',
  'оклад',
  'национальность',
  'вероисповедание',
  'религия',
]

const BLOCKED_PHRASES: readonly string[] = [
  'date of birth',
  'place of birth',
  'home address',
  'ish haqi',
  'yashash joyi',
  'doimiy manzil',
  'иш ҳақи',
  'яшаш жойи',
  'доимий манзил',
  'дата рождения',
  'место рождения',
  'домашний адрес',
  'место жительства',
  'manzili',
  'манзили',
  'address',
  'адрес',
]

/** Lower-cases, folds the Uzbek modifier letters onto ASCII apostrophes and turns punctuation into
 * spaces, so `Tugʻilgan sana`, `tug'ilgan sana` and `TUGILGAN-SANA` all normalise the same way. */
export function normalizeFieldLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[ʻʼ‘’`]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim()
}

/**
 * I-2. True when this label names data the product refuses to hold, in any of the four locales.
 * The caller answers with the translated refusal (`fields.error.personalData`), never a silent store.
 */
export function isBlockedFieldLabel(label: string): boolean {
  const normalized = normalizeFieldLabel(label)
  if (!normalized) return false
  for (const phrase of BLOCKED_PHRASES) {
    if (normalized.includes(normalizeFieldLabel(phrase))) return true
  }
  const tokens = new Set(normalized.split(' ').filter(Boolean))
  for (const token of BLOCKED_TOKENS) {
    if (tokens.has(normalizeFieldLabel(token))) return true
  }
  return false
}

/** Every locale's label plus the key, checked together -- a head who cannot type `Passport` in Uzbek
 * must not get through by typing it in Russian. */
export function blockedLabelLocale(
  label: Readonly<Record<string, string>>,
  key: string,
): string | null {
  if (isBlockedFieldLabel(key)) return 'key'
  for (const [locale, text] of Object.entries(label)) {
    if (text && isBlockedFieldLabel(text)) return locale
  }
  return null
}

// --- value validation ------------------------------------------------------------------------------

export type FieldValueError =
  | 'required'
  | 'not_a_number'
  | 'not_a_date'
  | 'not_a_url'
  | 'unknown_option'
  | 'too_long'
  | 'not_editable'

export type FieldValueCheck =
  | { readonly ok: true; readonly value: FieldValue }
  | { readonly ok: false; readonly error: FieldValueError }

export const FIELD_TEXT_MAX = 500
export const FIELD_LONG_TEXT_MAX = 4000

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isEmpty(value: FieldValue): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

/**
 * Coerces and checks one value against its definition. Returns the value the server should store
 * (trimmed text, a real number, a normalised option-id list) or the single reason it refused.
 * `checkbox` is the one type where `false` is a real answer, so it never reads as empty.
 */
export function validateFieldValue(def: FieldDef, raw: FieldValue): FieldValueCheck {
  if (def.type === 'checkbox') {
    const value = raw === true || raw === 'true'
    return { ok: true, value }
  }

  if (isEmpty(raw)) {
    if (def.required) return { ok: false, error: 'required' }
    return { ok: true, value: null }
  }

  switch (def.type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'))
      if (!Number.isFinite(n)) return { ok: false, error: 'not_a_number' }
      return { ok: true, value: n }
    }
    case 'date': {
      const s = String(raw).slice(0, 10)
      if (!ISO_DATE.test(s) || Number.isNaN(new Date(s).getTime())) {
        return { ok: false, error: 'not_a_date' }
      }
      return { ok: true, value: s }
    }
    case 'url': {
      const s = String(raw).trim()
      if (s.length > FIELD_TEXT_MAX) return { ok: false, error: 'too_long' }
      if (!/^https?:\/\/[^\s]+\.[^\s]+$/i.test(s)) return { ok: false, error: 'not_a_url' }
      return { ok: true, value: s }
    }
    case 'select':
    case 'person': {
      const s = String(raw).trim()
      if (def.type === 'select' && !def.options.some((o) => o.id === s)) {
        return { ok: false, error: 'unknown_option' }
      }
      return { ok: true, value: s }
    }
    case 'multi_select': {
      const list = (Array.isArray(raw) ? raw : [String(raw)]).map((v) => String(v).trim())
      const known = new Set(def.options.map((o) => o.id))
      if (list.some((v) => !known.has(v))) return { ok: false, error: 'unknown_option' }
      return { ok: true, value: [...new Set(list)] }
    }
    case 'long_text': {
      const s = String(raw).trim()
      if (s.length > FIELD_LONG_TEXT_MAX) return { ok: false, error: 'too_long' }
      return { ok: true, value: s }
    }
    case 'derived':
      // Computed elsewhere; a write is simply ignored rather than refused, so a client that echoes a
      // whole form back cannot fail on a column it never edited.
      return { ok: true, value: null }
    case 'text':
    default: {
      const s = String(raw).trim()
      if (s.length > FIELD_TEXT_MAX) return { ok: false, error: 'too_long' }
      return { ok: true, value: s }
    }
  }
}

/** True when this definition still has no answer -- what the progress bar counts and what
 * "required-missing" highlights. */
export function isFieldValueMissing(def: FieldDef, value: FieldValue): boolean {
  if (def.type === 'checkbox') return value === null || value === undefined
  return isEmpty(value)
}

/** SPEC §5: a reminder goes out N days after the request, default 3, configurable per definition. */
export const FIELD_REMINDER_DEFAULT_DAYS = 3
export const FIELD_REMINDER_MIN_DAYS = 1
export const FIELD_REMINDER_MAX_DAYS = 30

/** The filter-grammar spelling of "this field has no value", per locale. `field:education:boʻsh`. */
export const FIELD_EMPTY_WORDS: readonly string[] = [
  'bosh',
  "bo'sh",
  'boʻsh',
  'бўш',
  'буш',
  'пусто',
  'empty',
  'none',
]

export function isFieldEmptyWord(value: string): boolean {
  const v = value.trim().toLowerCase().replace(/[ʻʼ‘’]/g, "'")
  return FIELD_EMPTY_WORDS.some((w) => w.toLowerCase().replace(/[ʻʼ]/g, "'") === v)
}
