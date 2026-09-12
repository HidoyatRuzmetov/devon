// The people-indicator registry (v1.1 SPEC §4.2). One typed list, three readers: the people table's
// column picker (`/people/table`), the person page's KPI tiles (`/people/:userId`) and the head's
// management dashboard. `GET /api/v1/people/indicators?ids=&keys=` computes exactly these keys and
// nothing else, so a column that exists in the picker always has a number behind it.
//
// `headOnly` is the visibility rule from SPEC §2.2: everything with a person axis belongs to the
// boshqarma boshlig'i. The four exceptions (`unit`, `unitRole`, `title`, `joinedAt`) are the plain
// directory facts every colleague already sees on the org chart.
//
// I-1 is a hard edge here: `focusMinutes7d` is an aggregate minute count and never the content of a
// personal note, task, canvas or Pomodoro label. Nothing in this registry may ever carry personal
// workspace *content*, and the indicator service refuses to grow a key that would.

export type IndicatorType = 'count' | 'percent' | 'duration' | 'date' | 'text' | 'enum' | 'list'

/** How the client renders the raw value. `number` prints as-is; `percent` appends `%`; `hours`
 * renders "7 soat 30 daqiqa"-style; `minutes` the same at a finer grain; `relativeDate` prints
 * "3 kun oldin"; `date` prints the app-locale short date; `chips` renders a list as chips. */
export type IndicatorFormat =
  | 'number'
  | 'percent'
  | 'hours'
  | 'minutes'
  | 'date'
  | 'relativeDate'
  | 'text'
  | 'chips'
  | 'boolean'

/** Which batched query computes it. The indicator service runs **one query per source**, never one
 * per person (I-14 "no query in a loop"). */
export type IndicatorSource =
  | 'cards'
  | 'projects'
  | 'events'
  | 'personal_aggregate'
  | 'onboarding'
  | 'activity'
  | 'membership'

export type IndicatorKey =
  | 'openCards'
  | 'overdueCards'
  | 'dueThisWeek'
  | 'doneLast30d'
  | 'onTimeRate90d'
  | 'workloadHours'
  | 'workloadPct'
  | 'projects'
  | 'projectsOwned'
  | 'eventsRsvpRate90d'
  | 'pollsTurnout'
  | 'focusMinutes7d'
  | 'lastActiveAt'
  | 'onboardingPct'
  | 'unit'
  | 'unitRole'
  | 'title'
  | 'joinedAt'
  | 'telegramLinked'
  | 'cardsGivenOpen'

export type IndicatorSpec = {
  readonly id: IndicatorKey
  readonly labelKey: string
  readonly descriptionKey: string
  readonly type: IndicatorType
  readonly format: IndicatorFormat
  /** SPEC §2.2: head-only unless it is a plain directory fact. */
  readonly headOnly: boolean
  readonly source: IndicatorSource
  /** Column footer calculations the people table may offer for this indicator. */
  readonly calculations: readonly ('count' | 'filled' | 'avg' | 'sum' | 'min' | 'max')[]
  /** Shown by default in the people table (SPEC §4.3 default columns). */
  readonly defaultColumn?: boolean
  /** Higher is better -- drives the three-step colour on the table and the person page. `null` for
   * facts that are neither good nor bad. */
  readonly polarity: 'higher_better' | 'lower_better' | null
}

const spec = (s: IndicatorSpec): IndicatorSpec => Object.freeze(s)

export const INDICATORS: readonly IndicatorSpec[] = Object.freeze([
  spec({
    id: 'openCards',
    labelKey: 'people.indicator.openCards.label',
    descriptionKey: 'people.indicator.openCards.description',
    type: 'count',
    format: 'number',
    headOnly: true,
    source: 'cards',
    calculations: ['sum', 'avg', 'max'],
    defaultColumn: true,
    polarity: null,
  }),
  spec({
    id: 'overdueCards',
    labelKey: 'people.indicator.overdueCards.label',
    descriptionKey: 'people.indicator.overdueCards.description',
    type: 'count',
    format: 'number',
    headOnly: true,
    source: 'cards',
    calculations: ['sum', 'avg', 'max'],
    polarity: 'lower_better',
  }),
  spec({
    id: 'dueThisWeek',
    labelKey: 'people.indicator.dueThisWeek.label',
    descriptionKey: 'people.indicator.dueThisWeek.description',
    type: 'count',
    format: 'number',
    headOnly: true,
    source: 'cards',
    calculations: ['sum', 'avg'],
    polarity: null,
  }),
  spec({
    id: 'doneLast30d',
    labelKey: 'people.indicator.doneLast30d.label',
    descriptionKey: 'people.indicator.doneLast30d.description',
    type: 'count',
    format: 'number',
    headOnly: true,
    source: 'cards',
    calculations: ['sum', 'avg', 'max'],
    polarity: 'higher_better',
  }),
  spec({
    id: 'onTimeRate90d',
    labelKey: 'people.indicator.onTimeRate90d.label',
    descriptionKey: 'people.indicator.onTimeRate90d.description',
    type: 'percent',
    format: 'percent',
    headOnly: true,
    source: 'cards',
    calculations: ['avg', 'min', 'max'],
    polarity: 'higher_better',
  }),
  spec({
    id: 'workloadHours',
    labelKey: 'people.indicator.workloadHours.label',
    descriptionKey: 'people.indicator.workloadHours.description',
    type: 'duration',
    format: 'hours',
    headOnly: true,
    source: 'cards',
    calculations: ['sum', 'avg', 'max'],
    polarity: null,
  }),
  spec({
    id: 'workloadPct',
    labelKey: 'people.indicator.workloadPct.label',
    descriptionKey: 'people.indicator.workloadPct.description',
    type: 'percent',
    format: 'percent',
    headOnly: true,
    source: 'cards',
    calculations: ['avg', 'max'],
    defaultColumn: true,
    polarity: null,
  }),
  spec({
    id: 'cardsGivenOpen',
    labelKey: 'people.indicator.cardsGivenOpen.label',
    descriptionKey: 'people.indicator.cardsGivenOpen.description',
    type: 'count',
    format: 'number',
    headOnly: true,
    source: 'cards',
    calculations: ['sum', 'avg'],
    polarity: null,
  }),
  spec({
    id: 'projects',
    labelKey: 'people.indicator.projects.label',
    descriptionKey: 'people.indicator.projects.description',
    type: 'count',
    format: 'number',
    headOnly: true,
    source: 'projects',
    calculations: ['sum', 'avg'],
    polarity: null,
  }),
  spec({
    id: 'projectsOwned',
    labelKey: 'people.indicator.projectsOwned.label',
    descriptionKey: 'people.indicator.projectsOwned.description',
    type: 'count',
    format: 'number',
    headOnly: true,
    source: 'projects',
    calculations: ['sum'],
    polarity: null,
  }),
  spec({
    id: 'eventsRsvpRate90d',
    labelKey: 'people.indicator.eventsRsvpRate90d.label',
    descriptionKey: 'people.indicator.eventsRsvpRate90d.description',
    type: 'percent',
    format: 'percent',
    headOnly: true,
    source: 'events',
    calculations: ['avg', 'min'],
    polarity: 'higher_better',
  }),
  spec({
    id: 'pollsTurnout',
    labelKey: 'people.indicator.pollsTurnout.label',
    descriptionKey: 'people.indicator.pollsTurnout.description',
    type: 'percent',
    format: 'percent',
    headOnly: true,
    source: 'events',
    calculations: ['avg'],
    polarity: 'higher_better',
  }),
  spec({
    id: 'focusMinutes7d',
    labelKey: 'people.indicator.focusMinutes7d.label',
    descriptionKey: 'people.indicator.focusMinutes7d.description',
    type: 'duration',
    format: 'minutes',
    headOnly: true,
    source: 'personal_aggregate',
    calculations: ['sum', 'avg'],
    polarity: null,
  }),
  spec({
    id: 'lastActiveAt',
    labelKey: 'people.indicator.lastActiveAt.label',
    descriptionKey: 'people.indicator.lastActiveAt.description',
    type: 'date',
    format: 'relativeDate',
    headOnly: true,
    source: 'activity',
    calculations: ['filled', 'min', 'max'],
    polarity: null,
  }),
  spec({
    id: 'onboardingPct',
    labelKey: 'people.indicator.onboardingPct.label',
    descriptionKey: 'people.indicator.onboardingPct.description',
    type: 'percent',
    format: 'percent',
    headOnly: true,
    source: 'onboarding',
    calculations: ['avg', 'min'],
    polarity: 'higher_better',
  }),
  spec({
    id: 'telegramLinked',
    labelKey: 'people.indicator.telegramLinked.label',
    descriptionKey: 'people.indicator.telegramLinked.description',
    type: 'enum',
    format: 'boolean',
    headOnly: true,
    source: 'membership',
    calculations: ['filled', 'count'],
    polarity: null,
  }),
  // --- the four directory facts every colleague may see (SPEC §4.2) -------------------------------
  spec({
    id: 'unit',
    labelKey: 'people.indicator.unit.label',
    descriptionKey: 'people.indicator.unit.description',
    type: 'text',
    format: 'text',
    headOnly: false,
    source: 'membership',
    calculations: ['count', 'filled'],
    defaultColumn: true,
    polarity: null,
  }),
  spec({
    id: 'unitRole',
    labelKey: 'people.indicator.unitRole.label',
    descriptionKey: 'people.indicator.unitRole.description',
    type: 'text',
    format: 'text',
    headOnly: false,
    source: 'membership',
    calculations: ['count', 'filled'],
    polarity: null,
  }),
  spec({
    id: 'title',
    labelKey: 'people.indicator.title.label',
    descriptionKey: 'people.indicator.title.description',
    type: 'text',
    format: 'text',
    headOnly: false,
    source: 'membership',
    calculations: ['filled'],
    polarity: null,
  }),
  spec({
    id: 'joinedAt',
    labelKey: 'people.indicator.joinedAt.label',
    descriptionKey: 'people.indicator.joinedAt.description',
    type: 'date',
    format: 'date',
    headOnly: false,
    source: 'membership',
    calculations: ['min', 'max'],
    polarity: null,
  }),
])

export const INDICATOR_KEYS: readonly IndicatorKey[] = Object.freeze(
  INDICATORS.map((i) => i.id),
) as readonly IndicatorKey[]

const BY_ID = new Map<string, IndicatorSpec>(INDICATORS.map((i) => [i.id, i]))

export function getIndicator(key: string): IndicatorSpec | undefined {
  return BY_ID.get(key)
}

export function isIndicatorKey(key: string): key is IndicatorKey {
  return BY_ID.has(key)
}

/** The keys a viewer is allowed to ask for. A member asking for the full registry silently gets the
 * four directory facts rather than a 403 -- the server still refuses the *endpoint* to a member
 * (`people.indicators.read` is head-only), so this is the belt to that braces, used by the person
 * page a member opens about themselves. */
export function indicatorsVisibleTo(isHead: boolean): readonly IndicatorSpec[] {
  return isHead ? INDICATORS : INDICATORS.filter((i) => !i.headOnly)
}

/** One person's values, keyed by indicator id. `null` means "computed, and there is nothing" --
 * distinct from an absent key, which means "not requested". */
export type IndicatorValue = number | string | boolean | readonly string[] | null

export type PersonIndicators = {
  userId: string
  values: Readonly<Partial<Record<IndicatorKey, IndicatorValue>>>
}
