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

/** DESIGN.md §9.2: a status badge is a tinted, low-chroma fill, not a solid one -- solid fill is
 * reserved for a single "blocked" state. A dense list where most cards are overdue (the demo seed
 * skews this way, but any real backlog eventually does) turns solid `Badge tone="destructive"` into
 * a wall of saturated red, which reads as alarming rather than scannable. Passed as `Badge`'s own
 * `className` (twMerge keeps it over the tone variant's solid bg/text) at exactly the two multi-row
 * list call sites this matters for (table, mine) -- the single-card detail view keeps the plain tone,
 * where one badge among many other controls is not the same "wall of red" problem. */
export const RISK_BADGE_CLASSNAME: Record<CardRisk, string> = {
  overdue: 'bg-destructive/10 text-destructive',
  at_risk: 'bg-warning/10 text-warning',
  none: '',
}

/** Icon name for `RISK_BADGE_CLASSNAME`'s leading glyph -- colour is never the only signal even
 *  once it is a subtle tint rather than a solid fill. `null` for `none` (no badge renders at all). */
export const RISK_ICON_NAME: Record<CardRisk, 'AlertCircle' | 'Clock3' | null> = {
  overdue: 'AlertCircle',
  at_risk: 'Clock3',
  none: null,
}

/** The due chip's `Chip` tone (board card, table row): risk is the one thing a due date needs to say
 * at a glance, so the chip itself carries the colour rather than pairing a neutral chip with a
 * separate risk badge (DESIGN.md's "colour is never the only signal" is still satisfied -- the date
 * text and, on the card, the risk word in a tooltip are always there too). */
export const DUE_CHIP_TONE: Record<CardRisk, 'destructive' | 'attention' | 'neutral'> = {
  overdue: 'destructive',
  at_risk: 'attention',
  none: 'neutral',
}

/** Priority glyph (DESIGN.md "cards with ... priority glyph"): one small shape per level so priority
 * reads before the label does, the way Linear's priority icon does. Kept as a lookup of icon *names*
 * (not JSX) so this file -- shared by every card-rendering surface -- never imports `lucide-react`
 * just to describe which icon a level gets; each component maps the name to its own icon import. */
export const PRIORITY_ICON_NAME: Record<
  CardPriority,
  'ChevronsUp' | 'ChevronUp' | 'Minus' | 'ChevronDown' | null
> = {
  urgent: 'ChevronsUp',
  high: 'ChevronUp',
  medium: 'Minus',
  low: 'ChevronDown',
  none: null,
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
