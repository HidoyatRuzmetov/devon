export const TOMATO_ACTIVITIES = [
  'focus',
  'read',
  'write',
  'tea',
  'garden',
  'plane',
  'puzzle',
  'juggle',
  'dance',
  'balance',
  'bubble',
  'peek',
  'nap',
  'break',
  'complete',
] as const
export type TomatoActivity = (typeof TOMATO_ACTIVITIES)[number]
export type TomatoContext = 'focus' | 'break'

export const TOMATO_POOLS: Record<TomatoContext, readonly TomatoActivity[]> = {
  focus: [
    'focus',
    'read',
    'write',
    'tea',
    'garden',
    'plane',
    'puzzle',
    'juggle',
    'balance',
    'bubble',
    'peek',
  ],
  break: [
    'break',
    'tea',
    'garden',
    'plane',
    'puzzle',
    'juggle',
    'dance',
    'balance',
    'bubble',
    'peek',
    'nap',
    'read',
  ],
}

/** A shuffled repertoire, not independently random clips: every available activity gets a turn.
 * Recent history also survives phase changes, so a tea break cannot immediately repeat itself. */
export class TomatoDirector {
  private bags = new Map<TomatoContext, TomatoActivity[]>()
  private recent: TomatoActivity[] = ['focus']
  private unavailable = new Set<TomatoActivity>()

  constructor(private random: () => number = Math.random) {
    this.bags.set('focus', this.shuffle(TOMATO_POOLS.focus.filter((clip) => clip !== 'focus')))
  }

  private shuffle(pool: readonly TomatoActivity[]): TomatoActivity[] {
    const bag = [...pool]
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1))
      ;[bag[i], bag[j]] = [bag[j]!, bag[i]!]
    }
    return bag
  }

  private queue(context: TomatoContext): TomatoActivity[] {
    let bag = (this.bags.get(context) ?? []).filter((clip) => !this.unavailable.has(clip))
    if (!bag.length)
      bag = this.shuffle(TOMATO_POOLS[context].filter((clip) => !this.unavailable.has(clip)))
    // Prefer an unseen recent activity without dropping the others from this round.
    const index = bag.findIndex((clip) => !this.recent.includes(clip))
    if (index > 0) bag.unshift(...bag.splice(index, 1))
    else if (index < 0 && bag.length > 1 && bag[0] === this.recent.at(-1)) bag.push(bag.shift()!)
    // Switching phases can leave exactly the story that just played in the other phase.
    // Insert a different activity before finishing that round rather than replaying it immediately.
    if (bag.length === 1 && bag[0] === this.recent.at(-1)) {
      const alternatives = TOMATO_POOLS[context].filter(
        (clip) => !this.recent.includes(clip) && !this.unavailable.has(clip),
      )
      if (alternatives.length)
        bag.unshift(alternatives[Math.floor(this.random() * alternatives.length)]!)
    }
    this.bags.set(context, bag)
    return bag
  }

  peek(context: TomatoContext): TomatoActivity {
    return this.queue(context)[0] ?? 'focus'
  }

  next(context: TomatoContext): TomatoActivity {
    const clip = this.queue(context).shift() ?? 'focus'
    this.recent = [...this.recent, clip].slice(-4)
    return clip
  }

  exclude(clip: TomatoActivity): void {
    this.unavailable.add(clip)
  }
}
