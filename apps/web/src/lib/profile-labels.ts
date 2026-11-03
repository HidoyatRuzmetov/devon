import { POSITION_CODES, EDUCATION_CODES } from '@devon/contracts'
export function positionLabel(
  value: string | null | undefined,
  t: (key: string) => string,
): string {
  return value && (POSITION_CODES as readonly string[]).includes(value)
    ? t(`profileChoices.position.${value}`)
    : (value ?? '')
}
export function educationLabel(
  value: string | null | undefined,
  t: (key: string) => string,
): string {
  return value && (EDUCATION_CODES as readonly string[]).includes(value)
    ? t(`profileChoices.education.${value}`)
    : (value ?? '')
}
