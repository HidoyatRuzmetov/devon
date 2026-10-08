// F5 + F10 merged: `catch_up` (v1.1 AI-AUDIT §4, D-1; SPEC §8).
//
// `weekly_summary` and `what_did_i_miss` took the same data and produced the same shape at two time
// windows. They are now one feature with `scope` (person | department | project) and `window`
// (since_last_visit | week). Four surfaces ride on it:
//
//   * `/inbox`   — scope person,     window since_last_visit  ("Juma kunidan beri nima oʻzgardi?")
//   * `/personal`— scope person,     window week              (the weekly personal recap)
//   * `/`        — scope department, window week              (the head's Monday briefing — the
//                                                              single missing head surface v1.0
//                                                              never had, despite TECH-SPEC §8
//                                                              promising it)
//   * `/projects`— scope project,    window since_last_visit  (AI-AUDIT N-4)
//
// The output is four labelled blocks plus an ordered item list, never one wall of prose, and every
// factual claim carries an id the client renders as a link. `validateOutput` drops any id that was
// not in the input and any person who is not in `loadPerPerson` — the citation guard rail every v1.0
// prompt claimed and no caller enforced (AI-AUDIT §0.6).
import { z } from 'zod'
import {
  ANTI_FABRICATION_CONSTRAINT,
  CITATION_CONSTRAINT,
  TONE_CONSTRAINT,
  composePrompt,
  languageConstraint,
} from '../locale-prompt.js'
import { idSchema, isoDateSchema, localeSchema } from '../schemas.js'
import { keepKnownIds } from '../schemas.js'
import { standardUserContent, type FeatureSpec, type ValidateOutcome } from '../feature-spec.js'
import type { Locale } from '../types.js'

const workItemSchema = z.object({
  id: idSchema,
  title: z.string().min(1).max(500),
  assigneeName: z.string().max(200).nullable().default(null),
  dueDate: isoDateSchema.nullable().default(null),
  daysOverdue: z.number().int().min(0).max(10_000).default(0),
  daysSinceUpdate: z.number().int().min(0).max(10_000).default(0),
})

const activitySchema = z.object({
  id: idSchema,
  cardId: idSchema,
  cardTitle: z.string().min(1).max(500),
  author: z.string().max(200),
  excerpt: z.string().max(400),
  mentionsMe: z.boolean().default(false),
})

export const catchUpInputSchema = z.object({
  locale: localeSchema,
  scope: z.enum(['person', 'department', 'project']),
  privateWorkspace: z.boolean().default(false),
  window: z.enum(['since_last_visit', 'week']),
  /** The person, the department or the project this is about. */
  subjectName: z.string().min(1).max(300),
  /** Who is reading. Drives `forViewer`-style phrasing; never invented. */
  viewerName: z.string().min(1).max(200),
  period: z.object({ start: isoDateSchema, end: isoDateSchema }),
  counts: z.object({
    done: z.number().int().min(0),
    doneLastPeriod: z.number().int().min(0),
    created: z.number().int().min(0),
    overdue: z.number().int().min(0),
  }),
  done: z.array(workItemSchema).max(60).default([]),
  overdue: z.array(workItemSchema).max(40).default([]),
  dueThisWeek: z.array(workItemSchema).max(40).default([]),
  assignedToMe: z.array(workItemSchema).max(40).default([]),
  mentions: z.array(activitySchema).max(40).default([]),
  comments: z.array(activitySchema).max(40).default([]),
  loadPerPerson: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        openCount: z.number().int().min(0),
        overdueCount: z.number().int().min(0),
      }),
    )
    .max(100)
    .default([]),
  eventsAhead: z
    .array(
      z.object({
        id: idSchema,
        title: z.string().min(1).max(300),
        startsAt: z.string().max(40),
        myRsvp: z.enum(['yes', 'no', 'maybe']).nullable().default(null),
      }),
    )
    .max(20)
    .default([]),
})
export type CatchUpInput = z.infer<typeof catchUpInputSchema>

const blockSchema = z.object({
  text: z.string().max(400),
  citedIds: z.array(idSchema).max(6),
})

export const catchUpOutputSchema = z.object({
  headline: z.string().min(1).max(220),
  wins: blockSchema,
  risks: z
    .array(
      z.object({
        cardId: idSchema,
        text: z.string().min(1).max(300),
        severity: z.enum(['high', 'medium']),
      }),
    )
    .max(3),
  overloaded: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        openCount: z.number().int().min(0),
        text: z.string().max(200),
      }),
    )
    .max(2),
  lookingAhead: blockSchema,
  /** The ordered "what needs you" list -- what the `/inbox` surface renders as rows. Empty for a
   * department briefing, which has no single viewer to act. */
  items: z
    .array(
      z.object({
        kind: z.enum(['overdue', 'assigned', 'mention', 'comment', 'event', 'done']),
        refId: idSchema,
        text: z.string().min(1).max(220),
        needsAction: z.boolean(),
      }),
    )
    .max(8),
  moreCount: z.number().int().min(0),
  needsActionCount: z.number().int().min(0),
})
export type CatchUpOutput = z.infer<typeof catchUpOutputSchema>

const FEW_SHOT = `in : scope "department", window "week", subjectName "Raqamli xizmatlar boshqarmasi", locale uz-Latn,
     counts {done 14, doneLastPeriod 11, created 9, overdue 3}, done [{c3,"Choraklik hisobot",null,null,0,1}],
     overdue [{c9,"EGDI paketi","Nodira",2026-09-05,5,9}],
     loadPerPerson [{"Anvar",9,2},{"Nodira",4,1},{"Dilnoza",3,0}],
     dueThisWeek [{c21,"Sayt matni","Anvar",2026-09-16}]
out: {"headline":"Oʻtgan hafta 14 ta vazifa yopildi — oldingi haftaga nisbatan uchtaga koʻp.",
 "wins":{"text":"Davrda 14 ta vazifa yopildi, jumladan choraklik hisobot.","citedIds":["c3"]},
 "risks":[{"cardId":"c9","severity":"high","text":"EGDI paketi 5 kun kechikdi va 9 kundan beri oʻzgarmagan."}],
 "overloaded":[{"name":"Anvar","openCount":9,"text":"Anvarda 9 ta ochiq vazifa bor — boʻlim oʻrtachasidan ikki baravar koʻp."}],
 "lookingAhead":{"text":"Shu hafta bitta muddat tugaydi: sayt matni, 16-sentabr.","citedIds":["c21"]},
 "items":[],"moreCount":0,"needsActionCount":0}

in : scope "person", window "since_last_visit", viewerName "Anvar Aliyev", locale uz-Latn,
     overdue [{c1,"Sayt matni",null,2026-09-05,3,3}], assignedToMe [{c2,"EGDI jadvali","Nodira",2026-09-09}],
     mentions [{k7,c4,"Byudjet","Dilnoza","Anvar, raqamlarni tasdiqlaysizmi?",true}],
     eventsAhead [{e1,"Kuzgi sayr","2026-09-19T09:00:00+05:00",null}]
out: {"headline":"Juma kunidan beri: 1 ta kechikkan vazifa, 1 ta yangi topshiriq, 1 ta murojaat.",
 "wins":{"text":"","citedIds":[]},"risks":[],"overloaded":[],
 "lookingAhead":{"text":"Payshanba kuni kuzgi sayr bor.","citedIds":["e1"]},
 "items":[{"kind":"overdue","refId":"c1","text":"Sayt matni 3 kun kechikdi.","needsAction":true},
          {"kind":"assigned","refId":"c2","text":"Nodira sizga EGDI jadvalini topshirdi — muddat ertaga.","needsAction":true},
          {"kind":"mention","refId":"c4","text":"Dilnoza byudjet raqamlarini tasdiqlashingizni soʻradi.","needsAction":true},
          {"kind":"event","refId":"e1","text":"Kuzgi sayr 19-sentabrda — javob bermagansiz.","needsAction":false}],
 "moreCount":0,"needsActionCount":3}`

function systemPrompt(input: CatchUpInput): string {
  const isDepartment = input.scope === 'department'
  return composePrompt({
    role: isDepartment
      ? "You write the Monday briefing for the head of a ministry department in Uzbekistan, from last week's work data. You are factual and short. You name risks plainly and you name who carries too much. You never praise or criticise a person's character — only the state of the work."
      : 'You write the catch-up a person reads when they open the product after being away. You are ruthless about ordering: what needs action today comes first, what is merely informational comes last.',
    inputs:
      'The user JSON contains scope, window, subjectName, viewerName, period, counts and the relevant activity lists. Use only these facts; examples are illustrative, never evidence.',
    instructions: [
      'Structure your answer into the separate fields the schema names. Never write one wall of prose.',
      `headline: one sentence. ${isDepartment ? 'It must carry the closed count and the trend against doneLastPeriod ("uchtaga koʻp", "ikkitaga kam", "oʻzgarishsiz").' : 'It must carry the totals of what is waiting for the reader.'}`,
      'risks: at most three, ranked by daysOverdue and then daysSinceUpdate. Each names exactly one cardId from the overdue list.',
      isDepartment
        ? 'overloaded: at most two people from loadPerPerson whose openCount is at least 1.5 times the median. Phrase it as workload ("Anvarda 9 ta ochiq vazifa bor"), never as performance. Copy openCount exactly.'
        : 'overloaded: always an empty array for a person or a project.',
      'lookingAhead: the deadlines and events in the next seven days, at most four, with their ids in citedIds.',
      isDepartment
        ? 'items: an empty array — a department briefing has no single reader to act on rows.'
        : 'items: at most 8, ordered — overdue of mine, then a new assignment due within two days, then direct mentions, then unanswered comments on my items, then events with no RSVP, then everything else. Each has kind, refId (the CARD id for a comment or mention, not the comment id), one sentence, and needsAction.',
      'moreCount: how many relevant things you had to leave out of items. needsActionCount: how many of items require the reader to do something today.',
      'Every block with nothing real to say gets an empty text and an empty citedIds. Never pad. If every list is empty, say plainly that nothing happened and leave everything else empty.',
      'Never compute a percentage that is not derivable from counts.',
      input.privateWorkspace
        ? 'This is the viewer’s PRIVATE workspace. assignedToMe contains newly created personal tasks, not assignments from colleagues. Describe them as new tasks, never claim somebody else assigned them, and never mention coworkers or department activity.'
        : 'Use only this supplied scope. A project recap describes the project; never say all of its tasks are assigned to the viewer.',
    ],
    constraints: [
      languageConstraint(input.locale),
      ANTI_FABRICATION_CONSTRAINT,
      CITATION_CONSTRAINT,
      TONE_CONSTRAINT,
      'PEOPLE. Never mention a person who does not appear in loadPerPerson or as an assigneeName/author on one of the items you were given.',
    ],
    examples: isDepartment ? FEW_SHOT.split('\n\nin : scope "person"')[0]! : '',
    toolName: 'emit_catch_up',
  })
}

// -- Offline simulator ------------------------------------------------------------------------

type Phrases = {
  headlineDept: (done: number, delta: number) => string
  headlinePerson: (overdue: number, assigned: number, mentions: number) => string
  nothing: string
  win: (count: number) => string
  risk: (title: string, days: number, stale: number) => string
  overload: (name: string, open: number) => string
  ahead: (count: number) => string
  itemOverdue: (title: string, days: number) => string
  itemAssigned: (title: string, from: string) => string
  itemMention: (author: string, title: string) => string
  itemComment: (author: string, title: string) => string
  itemEvent: (title: string) => string
}

const PHRASES: Record<Locale, Phrases> = {
  'uz-Latn': {
    headlineDept: (done, delta) =>
      delta === 0
        ? `Oʻtgan davrda ${done} ta vazifa yopildi — oldingi davr bilan bir xil.`
        : delta > 0
          ? `Oʻtgan davrda ${done} ta vazifa yopildi — oldingi davrga nisbatan ${delta} taga koʻp.`
          : `Oʻtgan davrda ${done} ta vazifa yopildi — oldingi davrga nisbatan ${-delta} taga kam.`,
    headlinePerson: (o, a, m) =>
      `Sizni kutmoqda: ${o} ta kechikkan vazifa, ${a} ta yangi topshiriq, ${m} ta murojaat.`,
    nothing: 'Bu davrda hech qanday oʻzgarish boʻlmadi.',
    win: (count) => `${count} ta vazifa yopildi.`,
    risk: (title, days, stale) =>
      `${title} ${days} kun kechikdi va ${stale} kundan beri oʻzgarmagan.`,
    overload: (name, open) => `${name}da ${open} ta ochiq vazifa bor — boʻlimdagi eng katta yuk.`,
    ahead: (count) => `Yaqin kunlarda ${count} ta muddat va tadbir bor.`,
    itemOverdue: (title, days) => `${title} ${days} kun kechikdi.`,
    itemAssigned: (title, from) => `${from} sizga "${title}" topshirigʻini berdi.`,
    itemMention: (author, title) => `${author} "${title}" boʻyicha sizga murojaat qildi.`,
    itemComment: (author, title) => `${author} "${title}" vazifasiga izoh yozdi.`,
    itemEvent: (title) => `${title} tadbiriga hali javob bermagansiz.`,
  },
  'uz-Cyrl': {
    headlineDept: (done, delta) =>
      delta === 0
        ? `Ўтган даврда ${done} та вазифа ёпилди — олдинги давр билан бир хил.`
        : delta > 0
          ? `Ўтган даврда ${done} та вазифа ёпилди — олдинги даврга нисбатан ${delta} тага кўп.`
          : `Ўтган даврда ${done} та вазифа ёпилди — олдинги даврга нисбатан ${-delta} тага кам.`,
    headlinePerson: (o, a, m) =>
      `Сизни кутмоқда: ${o} та кечиккан вазифа, ${a} та янги топшириқ, ${m} та мурожаат.`,
    nothing: 'Бу даврда ҳеч қандай ўзгариш бўлмади.',
    win: (count) => `${count} та вазифа ёпилди.`,
    risk: (title, days, stale) =>
      `${title} ${days} кун кечикди ва ${stale} кундан бери ўзгармаган.`,
    overload: (name, open) => `${name}да ${open} та очиқ вазифа бор — бўлимдаги энг катта юк.`,
    ahead: (count) => `Яқин кунларда ${count} та муддат ва тадбир бор.`,
    itemOverdue: (title, days) => `${title} ${days} кун кечикди.`,
    itemAssigned: (title, from) => `${from} сизга "${title}" топшириғини берди.`,
    itemMention: (author, title) => `${author} "${title}" бўйича сизга мурожаат қилди.`,
    itemComment: (author, title) => `${author} "${title}" вазифасига изоҳ ёзди.`,
    itemEvent: (title) => `${title} тадбирига ҳали жавоб бермагансиз.`,
  },
  ru: {
    headlineDept: (done, delta) =>
      delta === 0
        ? `За период закрыто ${done} задач — столько же, сколько в прошлом.`
        : delta > 0
          ? `За период закрыто ${done} задач — на ${delta} больше, чем в прошлом.`
          : `За период закрыто ${done} задач — на ${-delta} меньше, чем в прошлом.`,
    headlinePerson: (o, a, m) =>
      `Вас ждут: ${o} просроченных задач, ${a} новых поручений, ${m} обращений.`,
    nothing: 'За этот период ничего не изменилось.',
    win: (count) => `${count} задач(и) закрыты.`,
    risk: (title, days, stale) => `«${title}» просрочена на ${days} дн. и не менялась ${stale} дн.`,
    overload: (name, open) => `У ${name} ${open} открытых задач — самая большая нагрузка в отделе.`,
    ahead: (count) => `В ближайшие дни ${count} срок(ов) и мероприятий.`,
    itemOverdue: (title, days) => `«${title}» просрочена на ${days} дн.`,
    itemAssigned: (title, from) => `${from} поручил(а) вам «${title}».`,
    itemMention: (author, title) => `${author} обратился(ась) к вам по «${title}».`,
    itemComment: (author, title) => `${author} оставил(а) комментарий к «${title}».`,
    itemEvent: (title) => `Вы ещё не ответили на приглашение «${title}».`,
  },
  en: {
    headlineDept: (done, delta) =>
      delta === 0
        ? `${done} items closed this period — the same as last.`
        : delta > 0
          ? `${done} items closed this period — ${delta} more than last.`
          : `${done} items closed this period — ${-delta} fewer than last.`,
    headlinePerson: (o, a, m) =>
      `Waiting for you: ${o} overdue, ${a} new assignments, ${m} mentions.`,
    nothing: 'Nothing changed in this period.',
    win: (count) => `${count} item(s) were closed.`,
    risk: (title, days, stale) =>
      `"${title}" is ${days} days late and unchanged for ${stale} days.`,
    overload: (name, open) => `${name} carries ${open} open items — the heaviest load in the unit.`,
    ahead: (count) => `${count} deadline(s) and event(s) are coming up.`,
    itemOverdue: (title, days) => `"${title}" is ${days} days late.`,
    itemAssigned: (title, from) => `${from} assigned you "${title}".`,
    itemMention: (author, title) => `${author} asked you about "${title}".`,
    itemComment: (author, title) => `${author} commented on "${title}".`,
    itemEvent: (title) => `You have not answered the invitation to "${title}".`,
  },
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function simulate(input: CatchUpInput): CatchUpOutput {
  const p = PHRASES[input.locale]
  const empty =
    input.counts.done === 0 &&
    input.counts.overdue === 0 &&
    input.counts.created === 0 &&
    input.overdue.length === 0 &&
    input.assignedToMe.length === 0 &&
    input.mentions.length === 0 &&
    input.comments.length === 0 &&
    input.eventsAhead.length === 0

  if (empty) {
    return {
      headline: p.nothing,
      wins: { text: '', citedIds: [] },
      risks: [],
      overloaded: [],
      lookingAhead: { text: '', citedIds: [] },
      items: [],
      moreCount: 0,
      needsActionCount: 0,
    }
  }

  const isDepartment = input.scope === 'department'
  const risks = [...input.overdue]
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.daysSinceUpdate - a.daysSinceUpdate)
    .slice(0, 3)
    .map((item) => ({
      cardId: item.id,
      text: p.risk(item.title, item.daysOverdue, item.daysSinceUpdate),
      severity: (item.daysOverdue >= 3 ? 'high' : 'medium') as 'high' | 'medium',
    }))

  const medianLoad = median(input.loadPerPerson.map((person) => person.openCount))
  const overloaded = isDepartment
    ? [...input.loadPerPerson]
        .filter((person) => person.openCount >= Math.max(1, medianLoad * 1.5))
        .sort((a, b) => b.openCount - a.openCount)
        .slice(0, 2)
        .map((person) => ({
          name: person.name,
          openCount: person.openCount,
          text: p.overload(person.name, person.openCount),
        }))
    : []

  const aheadIds = [
    ...input.dueThisWeek.map((item) => item.id),
    ...input.eventsAhead.map((event) => event.id),
  ].slice(0, 6)

  const items: CatchUpOutput['items'] = []
  if (!isDepartment) {
    for (const item of input.overdue.slice(0, 3)) {
      items.push({
        kind: 'overdue',
        refId: item.id,
        text: p.itemOverdue(item.title, item.daysOverdue),
        needsAction: true,
      })
    }
    for (const item of input.assignedToMe.slice(0, 3)) {
      items.push({
        kind: 'assigned',
        refId: item.id,
        text: input.privateWorkspace
          ? item.title
          : p.itemAssigned(item.title, item.assigneeName ?? input.subjectName),
        needsAction: true,
      })
    }
    for (const mention of input.mentions.slice(0, 3)) {
      items.push({
        kind: 'mention',
        refId: mention.cardId,
        text: p.itemMention(mention.author, mention.cardTitle),
        needsAction: true,
      })
    }
    for (const comment of input.comments.slice(0, 2)) {
      items.push({
        kind: 'comment',
        refId: comment.cardId,
        text: p.itemComment(comment.author, comment.cardTitle),
        needsAction: false,
      })
    }
    for (const event of input.eventsAhead.filter((e) => e.myRsvp === null).slice(0, 2)) {
      items.push({
        kind: 'event',
        refId: event.id,
        text: p.itemEvent(event.title),
        needsAction: false,
      })
    }
  }

  const capped = items.slice(0, 8)
  return {
    headline: isDepartment
      ? p.headlineDept(input.counts.done, input.counts.done - input.counts.doneLastPeriod)
      : input.privateWorkspace
        ? p.headlineDept(input.counts.done, input.counts.done - input.counts.doneLastPeriod)
        : p.headlinePerson(input.overdue.length, input.assignedToMe.length, input.mentions.length),
    wins:
      input.done.length > 0
        ? {
            text: p.win(input.counts.done),
            citedIds: input.done.slice(0, 6).map((item) => item.id),
          }
        : { text: '', citedIds: [] },
    risks,
    overloaded,
    lookingAhead:
      aheadIds.length > 0
        ? { text: p.ahead(aheadIds.length), citedIds: aheadIds }
        : { text: '', citedIds: [] },
    items: capped,
    moreCount: Math.max(0, items.length - capped.length),
    needsActionCount: capped.filter((item) => item.needsAction).length,
  }
}

/** The citation guard rail, finally enforced (AI-AUDIT §5 fix 6). Repairs rather than rejects:
 * a briefing whose only flaw is one invented id is still worth reading once the id is gone. */
function validateOutput(
  input: CatchUpInput,
  output: CatchUpOutput,
): ValidateOutcome<CatchUpOutput> {
  const known = new Set<string>()
  for (const list of [input.done, input.overdue, input.dueThisWeek, input.assignedToMe]) {
    for (const item of list) known.add(item.id)
  }
  for (const activity of [...input.mentions, ...input.comments]) {
    known.add(activity.id)
    known.add(activity.cardId)
  }
  for (const event of input.eventsAhead) known.add(event.id)

  const knownPeople = new Set<string>(input.loadPerPerson.map((person) => person.name))
  const byName = new Map(input.loadPerPerson.map((person) => [person.name, person]))

  const overdueIds = new Set(input.overdue.map((item) => item.id))

  return {
    ok: true,
    output: {
      ...output,
      wins: { ...output.wins, citedIds: keepKnownIds(output.wins.citedIds, known) },
      lookingAhead: {
        ...output.lookingAhead,
        citedIds: keepKnownIds(output.lookingAhead.citedIds, known),
      },
      risks: output.risks.filter((risk) => overdueIds.has(risk.cardId)).slice(0, 3),
      overloaded:
        input.scope === 'department'
          ? output.overloaded
              .filter((person) => knownPeople.has(person.name))
              // The count is a fact from the database, not something the model gets to restate
              // slightly wrong -- a head reading "9" next to a person's name must be reading the 9
              // that analytics computed.
              .map((person) => ({ ...person, openCount: byName.get(person.name)!.openCount }))
              .slice(0, 2)
          : [],
      items: output.items.filter((item) => known.has(item.refId)).slice(0, 8),
      needsActionCount: output.items.filter((item) => known.has(item.refId) && item.needsAction)
        .length,
    },
  }
}

export const catchUpSpec: FeatureSpec<CatchUpInput, CatchUpOutput> = {
  feature: 'catch_up',
  inputSchema: catchUpInputSchema,
  outputSchema: catchUpOutputSchema,
  toolName: 'emit_catch_up',
  toolDescription:
    'Emit a structured catch-up: a headline, what was won, the ranked risks, who is carrying too much, what is coming, and the ordered list of things that need the reader — each claim citing ids from the input.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: [
      'headline',
      'wins',
      'risks',
      'overloaded',
      'lookingAhead',
      'items',
      'moreCount',
      'needsActionCount',
    ],
    properties: {
      headline: { type: 'string', minLength: 1, maxLength: 220 },
      wins: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'citedIds'],
        properties: {
          text: { type: 'string', maxLength: 400 },
          citedIds: { type: 'array', maxItems: 6, items: { type: 'string' } },
        },
      },
      risks: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['cardId', 'text', 'severity'],
          properties: {
            cardId: { type: 'string' },
            text: { type: 'string', minLength: 1, maxLength: 300 },
            severity: { type: 'string', enum: ['high', 'medium'] },
          },
        },
      },
      overloaded: {
        type: 'array',
        maxItems: 2,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'openCount', 'text'],
          properties: {
            name: { type: 'string' },
            openCount: { type: 'integer' },
            text: { type: 'string', maxLength: 200 },
          },
        },
      },
      lookingAhead: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'citedIds'],
        properties: {
          text: { type: 'string', maxLength: 400 },
          citedIds: { type: 'array', maxItems: 6, items: { type: 'string' } },
        },
      },
      items: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'refId', 'text', 'needsAction'],
          properties: {
            kind: {
              type: 'string',
              enum: ['overdue', 'assigned', 'mention', 'comment', 'event', 'done'],
            },
            refId: { type: 'string' },
            text: { type: 'string', minLength: 1, maxLength: 220 },
            needsAction: { type: 'boolean' },
          },
        },
      },
      moreCount: { type: 'integer', minimum: 0 },
      needsActionCount: { type: 'integer', minimum: 0 },
    },
  },
  // v1.1 integration, measured: this feature's tool call is the largest in the product, and
  // `glm-5.2` spends its reasoning out of the same completion budget -- at 1792 the model finished
  // with `finish_reason: "length"`, zero tool calls and 6 000 characters of reasoning, so the answer
  // never existed. 4096 leaves room for both; the gateway's own doubling loop is the safety net
  // above it, not the plan.
  defaultMaxTokens: 4096,
  temperature: 0.2,
  systemPrompt,
  buildUserContent: standardUserContent,
  validateOutput,
  simulate,
}
