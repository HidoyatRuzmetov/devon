const translatedCodes = new Set([
  'required',
  'not_a_number',
  'not_a_date',
  'not_a_url',
  'unknown_option',
  'too_long',
  'not_editable',
  'not_self_editable',
  'personal_data',
  'cap_reached',
  'duplicate_key',
  'duplicate_option',
  'invalid_key',
  'needs_options',
  'archived',
  'unknown_subject',
  'invalid_value',
])

/** Wire/schema errors are not necessarily translated domain refusals. Preserve the caller's
 * readable operation fallback rather than asking the catalogue for a nonexistent message. */
export function fieldErrorKey(code: string): string | null {
  return translatedCodes.has(code) ? `fields.error.${code}` : null
}
