// Small, presentation-only lookups shared by every card-rendering component in this feature (board
// tile, table row, timeline bar, calendar chip, card detail). Kept separate from the components
// themselves so a screen never repeats "which badge variant for 'urgent'" logic.
import type { CardPriority, CardRisk, CardStatus } from '../api.js'

export const PRIORITY_ORDER: readonly CardPriority[] = ['urgent', 'high', 'medium', 'low', 'none']

export const PRIORITY_BADGE_TONE: Record<
  CardPriority,
  'neutral' | 'attention' | 'warning' | 'destructive'
> = {
  urgent: 'destructive',
  high: 'attention',
  medium: 'warning',
  low: 'neutral',
  none: 'neutral',
}

export const PRIORITY_LABEL_KEY: Record<CardPriority, string> = {
  urgent: 'work.priority.urgent',
  high: 'work.priority.high',
  medium: 'work.priority.medium',
  low: 'work.priority.low',
  none: 'work.priority.none',
}

export const RISK_LABEL_KEY: Record<CardRisk, string> = {
  overdue: 'work.risk.overdue',
  at_risk: 'work.risk.atRisk',
  none: '',
}

export const RISK_BADGE_TONE: Record<CardRisk, 'destructive' | 'warning' | 'neutral'> = {
  overdue: 'destructive',
  at_risk: 'warning',
  none: 'neutral',
}

export const STATUS_LABEL_KEY: Record<CardStatus, string> = {
  active: 'work.status.active',
  done: 'work.status.done',
  archived: 'work.status.archived',
}

/** `"Aliyev A."` -- family name plus given-name initial, DESIGN.md's compact person label for a
 * board tile / table cell (a full three-part name is reserved for the card detail's own header). */
export function shortName(m: { givenName: string; familyName: string }): string {
  const initial = m.givenName.trim().charAt(0).toUpperCase()
  return `${m.familyName} ${initial}.`
}

export function fullName(m: { givenName: string; familyName: string }): string {
  return `${m.givenName} ${m.familyName}`
}
