// Typed domain errors for the custom-fields module. `index.ts` maps each one to the exact RFC 9457
// Problem the rest of the API already uses; `service.ts` never touches Fastify's `reply`, so every
// rule below stays testable with a plain function call.
//
// `FieldRefusedError` deliberately carries a *machine* code (`personal_data`, `cap_reached`,
// `duplicate_key`, ...) and never a sentence: the Problem body may not contain domain data
// (`packages/contracts/src/problem.ts`), and the translated sentence belongs in the four locale files
// under `fields.error.<code>`, not on the wire.
export class FieldNotFoundError extends Error {
  constructor(message = 'Field not found') {
    super(message)
    this.name = 'FieldNotFoundError'
  }
}

export class FieldForbiddenError extends Error {
  constructor(message = 'Not allowed to change this field') {
    super(message)
    this.name = 'FieldForbiddenError'
  }
}

export type FieldRefusalCode =
  /** I-2: the label names data this product refuses to hold. */
  | 'personal_data'
  /** SPEC §5 caps: 20 card fields, 10 person fields. */
  | 'cap_reached'
  | 'duplicate_key'
  | 'duplicate_option'
  | 'archived'
  | 'not_self_editable'
  | 'unknown_subject'
  | 'invalid_value'

export class FieldRefusedError extends Error {
  readonly code: FieldRefusalCode
  readonly path: string

  constructor(code: FieldRefusalCode, path = 'field') {
    super(code)
    this.name = 'FieldRefusedError'
    this.code = code
    this.path = path
  }
}
