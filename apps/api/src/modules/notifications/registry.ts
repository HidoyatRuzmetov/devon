// SPEC §11 -- the notification registry: one table keyed on the domain events the API actually
// emits, each entry naming the inbox `reason`, the recipients rule, the deep link and the four-locale
// text the inbox row *and* the Telegram message are both built from.
//
// Why this file exists at all: before v1.1 the outbox -> inbox path produced nothing (STATE.md §7.1).
// The old registry was keyed on twelve event names, nine of which nothing emitted, and every handler
// additionally required a `notify` block inside the payload that no module ever wrote. So the inbox
// was fed only by the three pg-boss jobs. This table is keyed on the emitted names instead, and
// `apps/api/test/unit/notifications.registry.test.ts` fails the build in *both* directions: an
// emitted event with no entry here, and an entry here naming an event nothing emits.
//
// Deliberately pure: no database, no `Tx`, no imports from the rest of the module beyond the shared
// `Reason`/`LocalizedText` types. Everything a builder needs arrives as `EventFacts`, resolved by
// `sources.ts`. That keeps the whole table unit-testable without Postgres, exactly like
// `quiet-hours.ts` and `telegram/templates.ts` are.
//
// The four locales are written out in full rather than interpolated from one string, for the same
// reason `telegram/templates.ts` does it: uz-Latn and uz-Cyrl are two scripts of one language and
// Russian declines differently, so a template with a slot is not a translation. `oʻ`/`gʻ` use the
// modifier letter turned comma (U+02BB) and `aʼzo` the modifier apostrophe (U+02BC), never ASCII
// `'` -- DESIGN.md §2.3.
import type { LocalizedText, Reason } from './schemas.js'

/**
 * Who a notification goes to. Every rule is resolved by `sources.ts` against the department the
 * event was emitted in; a rule that resolves to nobody simply produces no notification.
 *
 * | rule | resolves to |
 * |---|---|
 * | `assignee` | the card's current assignee (`cards.assignee_user_id`) |
 * | `giver` | the person who delegated the card (`cards.giver_user_id`) |
 * | `creator` | the row's creator (`cards.created_by`) |
 * | `watchers` | everyone on `cards.watchers` |
 * | `mentioned` | the user ids a comment's `mentions` array names |
 * | `organizer` | the event's organizer |
 * | `rsvped` | everyone with a `yes`/`maybe`/`waitlist` RSVP on the event |
 * | `carpool_driver` | the driver who offered the seats |
 * | `project_members` | `projects.members` plus the project owner |
 * | `target_user` | the person the payload is *about* (`payload.userId`) |
 * | `head` | every active head of the event's department |
 * | `department` | every active member of the event's department |
 * | `super_admins` | every instance super admin (instance-level events only) |
 */
export type RecipientRule =
  | 'assignee'
  | 'giver'
  | 'creator'
  | 'watchers'
  | 'mentioned'
  | 'organizer'
  | 'rsvped'
  | 'carpool_driver'
  | 'project_members'
  | 'target_user'
  | 'head'
  | 'department'
  | 'super_admins'

/** Which loader in `sources.ts` knows how to turn this event's payload into `EventFacts`. */
export type SubjectSource =
  | 'card'
  | 'card_comment'
  | 'event'
  | 'carpool'
  | 'poll'
  | 'project'
  | 'membership'
  | 'department_request'
  | 'unit_role'
  | 'account'
  | 'field_request'

/** Everything a text builder or a deep link may use. Flat on purpose: a builder is a pure function of
 * this record, so every entry in the table below can be exercised in a unit test with a literal. */
export type EventFacts = {
  eventType: string
  departmentId: string | null
  /** The row the notification is about (a card, an event, a membership...). */
  subjectId: string | null
  /** The subject's own human title -- user data, shown verbatim in every locale, never translated. */
  subjectTitle: string
  /** The person whose action caused the event, when the payload names one. Never notified. */
  actorUserId: string | null
  /** That person's display name, already formatted "Ism Familiya". */
  actorName: string
  /** The department's own name, for events where the department *is* the subject. */
  departmentName: string
  /** A date the notification is about (an event's start, a card's due date). Drives the ICS feed. */
  at: Date | null
  /** Free-form, resolved per source: `status`, `place`, `question`, `seats`, ... */
  extra: Readonly<Record<string, string | number | null>>
}

export type NotificationSpec = {
  readonly notify: true
  readonly reason: Reason
  readonly source: SubjectSource
  /** Stored on `app.notifications.subject_type`; groups the inbox and drives its icons. */
  readonly subjectType: string
  readonly recipients: readonly RecipientRule[]
  /** Route the inbox row and the Telegram "Ochish" button open. */
  readonly deepLink: (f: EventFacts) => string | null
  readonly title: (f: EventFacts) => LocalizedText
  readonly body: (f: EventFacts) => LocalizedText | null
  /** Copy `EventFacts.at` onto the notification (ICS feed + "when" line in Telegram). */
  readonly carriesEventAt?: boolean
}

/** An emitted event that deliberately produces no notification. Listed rather than omitted so the
 * registry stays exhaustive and the reason is reviewable -- the lint test treats a missing key and a
 * silent key very differently. */
export type SilentSpec = { readonly notify: false; readonly why: string }

export type RegistryEntry = NotificationSpec | SilentSpec

const EMPTY: Readonly<Record<string, string | number | null>> = Object.freeze({})

/** A fact bag with everything blank -- the shape a builder must survive (a deleted subject, a payload
 * missing a field). Exported for the registry's own unit test. */
export function blankFacts(eventType: string): EventFacts {
  return {
    eventType,
    departmentId: null,
    subjectId: null,
    subjectTitle: '',
    actorUserId: null,
    actorName: '',
    departmentName: '',
    at: null,
    extra: EMPTY,
  }
}

// --- small helpers ---------------------------------------------------------------------------------

/** A title is always "<what happened>: <the thing's own name>" -- the localized half changes per
 * locale, the name never does. An empty name degrades to the localized half alone rather than
 * leaving a dangling colon. */
function withName(text: LocalizedText, name: string): LocalizedText {
  const n = name.trim()
  if (!n) return text
  return {
    'uz-Latn': `${text['uz-Latn']}: ${n}`,
    'uz-Cyrl': `${text['uz-Cyrl']}: ${n}`,
    ru: `${text.ru}: ${n}`,
    en: `${text.en}: ${n}`,
  }
}

function plain(uzLatn: string, uzCyrl: string, ru: string, en: string): LocalizedText {
  return { 'uz-Latn': uzLatn, 'uz-Cyrl': uzCyrl, ru, en }
}

/** "Anvar Aliyev" in front of the sentence when the actor is known, nothing when they are not. */
function byActor(f: EventFacts, text: LocalizedText): LocalizedText | null {
  const who = f.actorName.trim()
  if (!who) return text
  return {
    'uz-Latn': `${who} — ${text['uz-Latn']}`,
    'uz-Cyrl': `${who} — ${text['uz-Cyrl']}`,
    ru: `${who} — ${text.ru}`,
    en: `${who} — ${text.en}`,
  }
}

/** A custom field's own label, per locale. Four separate `extra` keys rather than one nested object,
 * because `EventFacts.extra` is flat by design (a builder must stay a pure function of a record a
 * unit test can write as a literal). A head may name a column in their own locale only, so each
 * locale falls back through the others and finally to the machine key -- a half-translated
 * definition still reads as a sentence rather than as an empty gap. */
function fieldLabel(f: EventFacts): LocalizedText {
  const uzLatn = str(f, 'labelUzLatn')
  const uzCyrl = str(f, 'labelUzCyrl')
  const ru = str(f, 'labelRu')
  const en = str(f, 'labelEn')
  const any = uzLatn || uzCyrl || ru || en || str(f, 'key')
  return {
    'uz-Latn': uzLatn || any,
    'uz-Cyrl': uzCyrl || any,
    ru: ru || any,
    en: en || any,
  }
}

/** `withName`, but the name itself differs per locale -- the one place in this table where the
 * subject's own title is translatable, because a custom field's label genuinely is. */
function withLocalizedName(text: LocalizedText, name: LocalizedText): LocalizedText {
  const join = (locale: keyof LocalizedText) =>
    name[locale].trim() ? `${text[locale]}: ${name[locale].trim()}` : text[locale]
  return {
    'uz-Latn': join('uz-Latn'),
    'uz-Cyrl': join('uz-Cyrl'),
    ru: join('ru'),
    en: join('en'),
  }
}

function str(f: EventFacts, key: string): string {
  const v = f.extra[key]
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

// --- the table -------------------------------------------------------------------------------------

/**
 * Every event name `apps/api/src/**` passes to `tx.emit()`, exactly once. The unit test enumerates
 * the emit sites statically and asserts this key set equals that name set.
 */
export const NOTIFICATION_REGISTRY: Readonly<Record<string, RegistryEntry>> = Object.freeze({
  'automations.run.recorded': {
    notify: false,
    why: 'Run log invalidation uses realtime without adding inbox noise.',
  },
  'accounts.profile.updated': {
    notify: false,
    why: 'Self-service identity edits update the directory without notifying every colleague.',
  },
  'projects.project.updated': {
    notify: false,
    why: 'Project settings and milestone edits refresh the project without creating inbox noise.',
  },
  // --- accounts -----------------------------------------------------------------------------------
  'accounts.user.registered': {
    notify: false,
    why: 'A fresh account has no department and nobody to tell -- the first thing it sees is the create-or-join screen.',
  },

  'accounts.user.avatar_updated': {
    notify: false,
    why: 'Changing your own photo is not news for anyone else, and telling a department every time somebody crops their avatar is how an inbox gets muted.',
  },

  'accounts.password_reset.requested': {
    notify: true,
    reason: 'system',
    source: 'account',
    subjectType: 'account',
    recipients: ['head'],
    deepLink: (f) => (f.departmentId ? `/department?id=${f.departmentId}&tab=members` : '/people'),
    title: (f) =>
      withName(
        plain(
          'Parolni tiklash soʻrovi',
          'Паролни тиклаш сўрови',
          'Запрос на сброс пароля',
          'Password reset request',
        ),
        f.subjectTitle,
      ),
    body: () =>
      plain(
        'Xodim parolini unutdi. Aʼzolar roʻyxatidan vaqtinchalik parol berishingiz mumkin.',
        'Ходим паролини унутди. Аъзолар рўйхатидан вақтинчалик парол беришингиз мумкин.',
        'Сотрудник забыл пароль. Вы можете выдать временный пароль в списке участников.',
        'This person forgot their password. You can issue a temporary one from the members list.',
      ),
  },

  'accounts.password.reset_by_head': {
    notify: true,
    reason: 'system',
    source: 'account',
    subjectType: 'account',
    recipients: ['target_user'],
    deepLink: () => '/account',
    title: () =>
      plain(
        'Parolingiz yangilandi',
        'Паролингиз янгиланди',
        'Ваш пароль обновлён',
        'Your password was reset',
      ),
    body: (f) =>
      byActor(
        f,
        plain(
          'sizga vaqtinchalik parol berdi. Kirganingizdan soʻng darhol yangi parol oʻrnating.',
          'сизга вақтинчалик парол берди. Кирганингиздан сўнг дарҳол янги парол ўрнатинг.',
          'выдал вам временный пароль. Сразу после входа задайте новый.',
          'issued you a temporary password. Set a new one as soon as you sign in.',
        ),
      ),
  },

  // --- departments --------------------------------------------------------------------------------
  'departments.department.created': {
    notify: true,
    reason: 'system',
    source: 'membership',
    subjectType: 'department',
    recipients: ['target_user'],
    deepLink: (f) => (f.departmentId ? `/department?id=${f.departmentId}` : '/departments'),
    title: (f) =>
      withName(
        plain(
          'Boshqarmangiz tasdiqlandi',
          'Бошқармангиз тасдиқланди',
          'Ваше управление одобрено',
          'Your department was approved',
        ),
        f.departmentName,
      ),
    body: () =>
      plain(
        'Endi xodimlarni taklif qilishingiz va ishni boshlashingiz mumkin.',
        'Энди ходимларни таклиф қилишингиз ва ишни бошлашингиз мумкин.',
        'Теперь можно приглашать сотрудников и начинать работу.',
        'You can invite colleagues and start work now.',
      ),
  },

  'departments.request.created': {
    notify: true,
    reason: 'system',
    source: 'department_request',
    subjectType: 'department_request',
    recipients: ['super_admins'],
    deepLink: () => '/departments/requests',
    title: (f) =>
      withName(
        plain(
          'Yangi boshqarma soʻrovi',
          'Янги бошқарма сўрови',
          'Новая заявка на управление',
          'New department request',
        ),
        f.subjectTitle,
      ),
    body: (f) =>
      byActor(
        f,
        plain(
          'yangi boshqarma ochishni soʻradi.',
          'янги бошқарма очишни сўради.',
          'просит открыть новое управление.',
          'asked to open a new department.',
        ),
      ),
  },

  'departments.member.joined': {
    notify: true,
    reason: 'system',
    source: 'membership',
    subjectType: 'membership',
    recipients: ['head'],
    deepLink: (f) => (f.departmentId ? `/department?id=${f.departmentId}&tab=members` : '/people'),
    title: (f) =>
      withName(
        str(f, 'status') === 'pending_approval'
          ? plain('Qoʻshilish soʻrovi', 'Қўшилиш сўрови', 'Заявка на вступление', 'Join request')
          : plain('Yangi xodim', 'Янги ходим', 'Новый сотрудник', 'New colleague'),
        f.subjectTitle,
      ),
    body: (f) =>
      str(f, 'status') === 'pending_approval'
        ? plain(
            'Tasdiqlashingizni kutmoqda. Aʼzolar boʻlimida qabul qiling yoki rad eting.',
            'Тасдиқлашингизни кутмоқда. Аъзолар бўлимида қабул қилинг ёки рад этинг.',
            'Ожидает вашего решения. Примите или отклоните во вкладке «Участники».',
            'Waiting for your decision. Approve or reject on the Members tab.',
          )
        : plain(
            'Boshqarmaga qoʻshildi.',
            'Бошқармага қўшилди.',
            'Присоединился к управлению.',
            'Joined the department.',
          ),
  },

  'departments.join_request.decided': {
    notify: true,
    reason: 'system',
    source: 'membership',
    subjectType: 'membership',
    recipients: ['target_user'],
    deepLink: (f) =>
      str(f, 'decision') === 'approved' && f.departmentId
        ? `/department?id=${f.departmentId}`
        : '/departments',
    title: (f) =>
      withName(
        str(f, 'decision') === 'approved'
          ? plain(
              'Soʻrovingiz tasdiqlandi',
              'Сўровингиз тасдиқланди',
              'Заявка одобрена',
              'Your request was approved',
            )
          : plain(
              'Soʻrovingiz rad etildi',
              'Сўровингиз рад этилди',
              'Заявка отклонена',
              'Your request was declined',
            ),
        f.departmentName,
      ),
    body: (f) =>
      str(f, 'decision') === 'approved'
        ? plain(
            'Endi boshqarma ishlariga kirishingiz mumkin.',
            'Энди бошқарма ишларига киришингиз мумкин.',
            'Теперь вам доступна работа управления.',
            'The department’s work is open to you now.',
          )
        : plain(
            'Batafsil maʼlumot uchun boshqarma boshligʻiga murojaat qiling.',
            'Батафсил маълумот учун бошқарма бошлиғига мурожаат қилинг.',
            'За разъяснениями обратитесь к начальнику управления.',
            'Ask the department head if you need more detail.',
          ),
  },

  // --- structure ----------------------------------------------------------------------------------
  'structure.unit.created': {
    notify: false,
    why: 'Org-chart edits are audit material, not inbox material -- the structure screen shows them live and a department reorganising itself would otherwise notify everyone dozens of times in a row.',
  },
  'structure.unit.updated': { notify: false, why: 'See structure.unit.created.' },
  'structure.unit.deleted': { notify: false, why: 'See structure.unit.created.' },
  'structure.unit.restored': { notify: false, why: 'See structure.unit.created.' },
  'structure.unit.reordered': { notify: false, why: 'See structure.unit.created.' },
  'structure.unit_role.unassigned': {
    notify: false,
    why: 'Losing a unit role is told in person; an inbox row for it reads as a reprimand. The assignment half is notified.',
  },

  'structure.unit_role.assigned': {
    notify: true,
    reason: 'system',
    source: 'unit_role',
    subjectType: 'unit',
    recipients: ['target_user'],
    deepLink: () => '/structure',
    title: (f) =>
      withName(
        plain('Boʻlimda yangi rol', 'Бўлимда янги рол', 'Новая роль', 'New unit role'),
        f.subjectTitle,
      ),
    body: (f) =>
      plain(
        `Sizga «${str(f, 'role')}» roli berildi.`,
        `Сизга «${str(f, 'role')}» роли берилди.`,
        `Вам назначена роль «${str(f, 'role')}».`,
        `You were given the “${str(f, 'role')}” role.`,
      ),
  },

  // --- person fields ------------------------------------------------------------------------------
  // SPEC §11: "the head is notified of ... field-fill completions (batched)". `digest` is the reason
  // that batching rides on -- a boshqarma of thirty filling a requested field on the same afternoon
  // must reach the head as one daily line, not thirty interruptions. The Mini App's "Mening
  // maʼlumotlarim" screen (SPEC §9) and the web person page both emit this same event.
  'fields.value.filled': {
    notify: true,
    reason: 'digest',
    // `membership` resolves `payload.userId` into the person the value is about, which is exactly
    // who the head wants named; the field itself is deliberately not in the text (a requested field
    // can be a private detail -- I-1).
    source: 'membership',
    subjectType: 'person',
    recipients: ['head'],
    deepLink: (f) => (f.subjectId ? `/people/${f.subjectId}` : '/people/table'),
    title: (f) =>
      withName(
        plain(
          'Maydon toʻldirildi',
          'Майдон тўлдирилди',
          'Поле заполнено',
          'A requested field was filled in',
        ),
        f.subjectTitle,
      ),
    body: () =>
      plain(
        'Soʻralgan maʼlumot kiritildi. Xodimlar jadvalida koʻrishingiz mumkin.',
        'Сўралган маълумот киритилди. Ходимлар жадвалида кўришингиз мумкин.',
        'Запрошенные данные внесены. Их видно в таблице сотрудников.',
        'The details you asked for are in. You can see them in the people table.',
      ),
  },

  // --- people (v1.1 SPEC §4.3) ----------------------------------------------------------------------
  'people.view.created': {
    notify: false,
    why: 'Arranging your own copy of the people table is a preference, not news. The other heads discover a shared view in the tab strip, where it belongs.',
  },
  'people.table.exported': {
    notify: false,
    why: 'The export is deliberately audited rather than notified: the department needs an accountable record of a staff spreadsheet leaving the product, and the head who pressed the button does not need an inbox row telling them they pressed it.',
  },

  // --- work ---------------------------------------------------------------------------------------
  'work.checklist.updated': {
    notify: false,
    why: 'Checklist edits refresh live task views without producing an inbox notification per checkbox.',
  },
  'work.card.deleted': {
    notify: false,
    why: 'Refresh live views without sending links to deleted work; the audit retains the deletion.',
  },
  'work.card.restored': {
    notify: false,
    why: 'Undo restores visibility; no second notification for an immediately corrected action.',
  },
  'work.card.created': {
    notify: true,
    reason: 'assigned',
    source: 'card',
    subjectType: 'card',
    recipients: ['assignee'],
    carriesEventAt: true,
    deepLink: (f) => (f.subjectId ? `/work/card?id=${f.subjectId}` : '/work'),
    title: (f) =>
      withName(
        plain('Sizga yangi vazifa', 'Сизга янги вазифа', 'Вам поставлена задача', 'A task for you'),
        f.subjectTitle,
      ),
    body: (f) =>
      byActor(
        f,
        plain(
          'sizga vazifa topshirdi.',
          'сизга вазифа топширди.',
          'поставил вам задачу.',
          'assigned you a task.',
        ),
      ),
  },

  'work.card.assigned': {
    notify: true,
    reason: 'assigned',
    source: 'card',
    subjectType: 'card',
    recipients: ['assignee'],
    carriesEventAt: true,
    deepLink: (f) => (f.subjectId ? `/work/card?id=${f.subjectId}` : '/work'),
    title: (f) =>
      withName(
        plain(
          'Vazifa sizga oʻtkazildi',
          'Вазифа сизга ўтказилди',
          'Задача передана вам',
          'A task was reassigned to you',
        ),
        f.subjectTitle,
      ),
    body: (f) =>
      byActor(
        f,
        plain(
          'bu vazifani sizga biriktirdi.',
          'бу вазифани сизга бириктирди.',
          'назначил эту задачу на вас.',
          'made you the assignee.',
        ),
      ),
  },

  'work.card.updated': {
    notify: true,
    reason: 'updated',
    source: 'card',
    subjectType: 'card',
    recipients: ['assignee', 'giver', 'watchers'],
    carriesEventAt: true,
    deepLink: (f) => (f.subjectId ? `/work/card?id=${f.subjectId}` : '/work'),
    title: (f) =>
      withName(
        plain('Vazifa yangilandi', 'Вазифа янгиланди', 'Задача обновлена', 'Task updated'),
        f.subjectTitle,
      ),
    body: (f) => byActor(f, changeSummary(f)),
  },

  'work.card.commented': {
    notify: true,
    reason: 'mentioned',
    source: 'card_comment',
    subjectType: 'card',
    recipients: ['mentioned', 'assignee', 'giver', 'watchers'],
    deepLink: (f) => (f.subjectId ? `/work/card?id=${f.subjectId}` : '/work'),
    title: (f) =>
      withName(
        plain('Yangi izoh', 'Янги изоҳ', 'Новый комментарий', 'New comment'),
        f.subjectTitle,
      ),
    body: (f) => {
      const excerpt = str(f, 'excerpt')
      if (!excerpt) {
        return byActor(
          f,
          plain('izoh qoldirdi.', 'изоҳ қолдирди.', 'оставил комментарий.', 'left a comment.'),
        )
      }
      return byActor(f, plain(excerpt, excerpt, excerpt, excerpt))
    },
  },

  // --- projects -----------------------------------------------------------------------------------
  'projects.project.created': {
    notify: true,
    reason: 'system',
    source: 'project',
    subjectType: 'project',
    recipients: ['project_members'],
    deepLink: (f) => (f.subjectId ? `/projects/view?id=${f.subjectId}` : '/projects'),
    title: (f) =>
      withName(
        plain('Yangi guruh loyihasi', 'Янги гуруҳ лойиҳаси', 'Новый проект', 'New group project'),
        f.subjectTitle,
      ),
    body: (f) =>
      byActor(
        f,
        plain(
          'sizni loyihaga qoʻshdi.',
          'сизни лойиҳага қўшди.',
          'добавил вас в проект.',
          'added you to a project.',
        ),
      ),
  },

  // --- events -------------------------------------------------------------------------------------
  'events.event.created': {
    notify: true,
    reason: 'rsvp',
    source: 'event',
    subjectType: 'event',
    recipients: ['department'],
    carriesEventAt: true,
    deepLink: (f) => (f.subjectId ? `/events?event=${f.subjectId}` : '/events'),
    title: (f) =>
      withName(
        plain('Yangi tadbir', 'Янги тадбир', 'Новое мероприятие', 'New event'),
        f.subjectTitle,
      ),
    body: () =>
      plain(
        'Ishtirok etasizmi? Javobingizni belgilang.',
        'Иштирок этасизми? Жавобингизни белгиланг.',
        'Придёте? Отметьте свой ответ.',
        'Are you coming? Mark your answer.',
      ),
  },

  'events.event.updated': {
    notify: true,
    reason: 'updated',
    source: 'event',
    subjectType: 'event',
    recipients: ['rsvped', 'organizer'],
    carriesEventAt: true,
    deepLink: (f) => (f.subjectId ? `/events?event=${f.subjectId}` : '/events'),
    title: (f) =>
      withName(
        plain('Tadbir oʻzgardi', 'Тадбир ўзгарди', 'Мероприятие изменено', 'Event changed'),
        f.subjectTitle,
      ),
    body: (f) => {
      const summary = str(f, 'changes')
      return summary
        ? plain(summary, summary, summary, summary)
        : plain(
            'Tafsilotlar yangilandi — tekshirib chiqing.',
            'Тафсилотлар янгиланди — текшириб чиқинг.',
            'Детали обновлены — проверьте их.',
            'The details changed — take a look.',
          )
    },
  },

  'events.event.cancelled': {
    notify: true,
    reason: 'updated',
    source: 'event',
    subjectType: 'event',
    recipients: ['rsvped', 'organizer'],
    deepLink: (f) => (f.subjectId ? `/events?event=${f.subjectId}` : '/events'),
    title: (f) =>
      withName(
        plain(
          'Tadbir bekor qilindi',
          'Тадбир бекор қилинди',
          'Мероприятие отменено',
          'Event cancelled',
        ),
        f.subjectTitle,
      ),
    body: (f) => {
      const reason = str(f, 'reason')
      return reason
        ? plain(reason, reason, reason, reason)
        : plain(
            'Sabab koʻrsatilmadi.',
            'Сабаб кўрсатилмади.',
            'Причина не указана.',
            'No reason was given.',
          )
    },
  },

  'events.event.reminder_due': {
    notify: true,
    reason: 'rsvp',
    source: 'event',
    subjectType: 'event',
    recipients: ['rsvped'],
    carriesEventAt: true,
    deepLink: (f) => (f.subjectId ? `/events?event=${f.subjectId}` : '/events'),
    title: (f) =>
      withName(
        plain('Tadbir eslatmasi', 'Тадбир эслатмаси', 'Напоминание', 'Event reminder'),
        f.subjectTitle,
      ),
    body: (f) => {
      const place = str(f, 'place')
      return place
        ? plain(`Joyi: ${place}`, `Жойи: ${place}`, `Место: ${place}`, `Where: ${place}`)
        : plain('Tez orada boshlanadi.', 'Тез орада бошланади.', 'Скоро начало.', 'Starting soon.')
    },
  },

  'events.rsvp.changed': {
    notify: true,
    reason: 'rsvp',
    source: 'event',
    subjectType: 'event',
    recipients: ['organizer'],
    carriesEventAt: true,
    deepLink: (f) => (f.subjectId ? `/events?event=${f.subjectId}` : '/events'),
    title: (f) =>
      withName(
        plain('Ishtirok javobi', 'Иштирок жавоби', 'Ответ об участии', 'RSVP answer'),
        f.subjectTitle,
      ),
    body: (f) => byActor(f, rsvpAnswer(str(f, 'status'))),
  },

  'events.comment.created': {
    notify: true,
    reason: 'updated',
    source: 'event',
    subjectType: 'event',
    recipients: ['organizer'],
    deepLink: (f) => (f.subjectId ? `/events?event=${f.subjectId}` : '/events'),
    title: (f) =>
      withName(
        plain(
          'Tadbir muhokamasi',
          'Тадбир муҳокамаси',
          'Обсуждение мероприятия',
          'Event discussion',
        ),
        f.subjectTitle,
      ),
    body: (f) =>
      byActor(
        f,
        plain(
          'muhokamaga yozdi.',
          'муҳокамага ёзди.',
          'написал в обсуждении.',
          'wrote in the discussion.',
        ),
      ),
  },

  'events.poll.created': {
    notify: true,
    reason: 'poll',
    source: 'poll',
    subjectType: 'poll',
    recipients: ['rsvped', 'organizer'],
    deepLink: (f) => (f.subjectId ? `/events?event=${f.subjectId}` : '/events'),
    title: (f) =>
      withName(
        plain('Yangi soʻrovnoma', 'Янги сўровнома', 'Новый опрос', 'New poll'),
        str(f, 'question') || f.subjectTitle,
      ),
    body: () =>
      plain(
        'Ovoz bering — fikringiz muhim.',
        'Овоз беринг — фикрингиз муҳим.',
        'Проголосуйте — ваше мнение важно.',
        'Cast your vote — your answer counts.',
      ),
  },

  'events.carpool.created': {
    notify: true,
    reason: 'updated',
    source: 'carpool',
    subjectType: 'carpool',
    recipients: ['rsvped'],
    deepLink: (f) => (f.subjectId ? `/events?event=${f.subjectId}` : '/events'),
    title: (f) =>
      withName(
        plain(
          'Mashinada joy bor',
          'Машинада жой бор',
          'Предложены места в машине',
          'Seats offered',
        ),
        f.subjectTitle,
      ),
    body: (f) =>
      byActor(
        f,
        plain(
          `mashinasida ${str(f, 'seats')} ta joy taklif qildi.`,
          `машинасида ${str(f, 'seats')} та жой таклиф қилди.`,
          `предлагает ${str(f, 'seats')} мест(а) в машине.`,
          `is offering ${str(f, 'seats')} seat(s).`,
        ),
      ),
  },

  'events.carpool.seat_claimed': {
    notify: true,
    reason: 'updated',
    source: 'carpool',
    subjectType: 'carpool',
    recipients: ['carpool_driver'],
    deepLink: (f) => (f.subjectId ? `/events?event=${f.subjectId}` : '/events'),
    title: (f) =>
      withName(
        plain('Joy band qilindi', 'Жой банд қилинди', 'Место занято', 'A seat was claimed'),
        f.subjectTitle,
      ),
    body: (f) =>
      byActor(
        f,
        str(f, 'status') === 'confirmed'
          ? plain(
              'mashinangizda joy oldi.',
              'машинангизда жой олди.',
              'занял место в вашей машине.',
              'took a seat in your car.',
            )
          : plain(
              'navbatga yozildi — joy boʻshasa, oʻtadi.',
              'навбатга ёзилди — жой бўшаса, ўтади.',
              'встал в очередь — займёт место, когда освободится.',
              'is on the waitlist for your car.',
            ),
      ),
  },

  // --- custom fields (v1.1 SPEC §5) -----------------------------------------------------------------
  'fields.definition.created': {
    notify: false,
    why: 'A new column on the people table is the head arranging their own management view; telling the whole boshqarma about it is noise. The moment it becomes news for a colleague is when they are asked to fill it -- `fields.request.created`.',
  },
  'fields.definition.updated': { notify: false, why: 'See fields.definition.created.' },
  'fields.definition.archived': { notify: false, why: 'See fields.definition.created.' },
  'fields.definition.reordered': { notify: false, why: 'See fields.definition.created.' },
  'fields.value.set': {
    notify: false,
    why: 'SPEC §5: filling a field resolves the request and, when the head asked to hear about it, is reported in the daily digest -- "a daily batch, not per fill". One inbox row per colleague per answer would make the head mute the inbox on the first day.',
  },

  'fields.request.created': {
    notify: true,
    reason: 'field_request',
    source: 'field_request',
    subjectType: 'field_def',
    recipients: ['target_user'],
    // The deep link is the member's own profile, anchored at the fields section -- never the head's
    // manager screen, which a xodim may not open at all.
    deepLink: () => '/account#fields',
    title: (f) =>
      withLocalizedName(
        str(f, 'reminder') === 'true'
          ? plain(
              'Eslatma: maʼlumot toʻldirilmagan',
              'Эслатма: маълумот тўлдирилмаган',
              'Напоминание: поле не заполнено',
              'Reminder: a field is still empty',
            )
          : plain(
              'Maʼlumotingizni toʻldiring',
              'Маълумотингизни тўлдиринг',
              'Заполните данные о себе',
              'Please fill in your details',
            ),
        fieldLabel(f),
      ),
    body: (f) =>
      byActor(
        f,
        plain(
          'bu maydonni toʻldirishingizni soʻradi. Bir daqiqalik ish.',
          'бу майдонни тўлдиришингизни сўради. Бир дақиқалик иш.',
          'просит заполнить это поле. Это займёт минуту.',
          'asked you to fill this in. It takes a minute.',
        ),
      ),
  },

  // --- notifications (this module's own bookkeeping) ------------------------------------------------
  'notifications.notification.created': {
    notify: false,
    why: 'Emitted by `insertNotification` itself. Notifying on it would notify on the notification, forever.',
  },
  'notifications.action.requested': {
    notify: false,
    why: 'A Telegram inline button (done / snooze / RSVP) already answered the person in the chat they pressed it in; it exists for the audit trail and for the module that owns the subject to react to.',
  },

  // --- realtime + calendar + push (EPIC-018/EPIC-019, v1.1 SPEC §10) ---------------------------------
  // Every one of these is a *live* or *personal* event. The realtime module subscribes to the same
  // outbox rows and turns them into a publication on the right Centrifugo channel, which is where
  // the person is already looking; an inbox row on top of that would be the notification-about-a-
  // notification this table already refuses one line above.
  'realtime.canvas.shared': {
    notify: false,
    why: 'The canvas appears on the project or event page the moment it is shared, live, for everyone already looking at it -- and the owner shares it *while talking to* those people. An inbox row would arrive after the conversation it belongs to.',
  },
  'realtime.canvas.share_revoked': {
    notify: false,
    why: 'Watchers are told on the channel itself (`realtime.channel.closed`) and the board simply closes; telling them again in the inbox would make taking a canvas back feel like an accusation.',
  },
  'calendar.feed.created': {
    notify: false,
    why: 'A person creating their own calendar subscription is looking at the screen that confirms it; it is audited, and the inbox is for what other people did.',
  },
  'calendar.feed.rotated': {
    notify: false,
    why: 'Same: the person pressed the button. (Audited, because a rotated feed URL is a revoked credential and that belongs in the trail.)',
  },
  'calendar.feed.revoked': {
    notify: false,
    why: 'Same as `calendar.feed.rotated`.',
  },
  'push.subscription.created': {
    notify: false,
    why: 'The browser just asked this person for permission and they granted it; the confirmation is the toast on that screen, not an inbox row.',
  },
  'push.subscription.removed': {
    notify: false,
    why: 'Same: a person turning notifications off on one device does not need a notification about it.',
  },
})

// --- builders used by more than one entry -----------------------------------------------------------

function rsvpAnswer(status: string): LocalizedText {
  if (status === 'yes') {
    return plain(
      'ishtirok etaman dedi.',
      'иштирок этаман деди.',
      'ответил «приду».',
      'answered “going”.',
    )
  }
  if (status === 'maybe') {
    return plain('«balki» dedi.', '«балки» деди.', 'ответил «возможно».', 'answered “maybe”.')
  }
  if (status === 'waitlist') {
    return plain(
      'navbatga yozildi.',
      'навбатга ёзилди.',
      'встал в лист ожидания.',
      'joined the waitlist.',
    )
  }
  return plain(
    'ishtirok etmayman dedi.',
    'иштирок этмайман деди.',
    'ответил «не приду».',
    'answered “not going”.',
  )
}

/** `work.card.updated` carries a `changes` list so the inbox row says what actually moved rather than
 * the useless "a card changed". Each key is rendered in all four locales; an empty list degrades to a
 * neutral sentence. */
function changeSummary(f: EventFacts): LocalizedText {
  const raw = str(f, 'changes')
  const keys = raw ? raw.split(',').filter(Boolean) : []
  if (keys.length === 0) {
    return plain(
      'vazifa tafsilotlarini yangiladi.',
      'вазифа тафсилотларини янгилади.',
      'обновил детали задачи.',
      'updated the task details.',
    )
  }
  const label: Record<string, LocalizedText> = {
    status: plain('holat', 'ҳолат', 'статус', 'status'),
    assignee: plain('masʼul', 'масъул', 'исполнитель', 'assignee'),
    giver: plain('topshiriq beruvchi', 'топшириқ берувчи', 'постановщик', 'delegator'),
    dueAt: plain('muddat', 'муддат', 'срок', 'due date'),
    priority: plain('muhimlik', 'муҳимлик', 'приоритет', 'priority'),
    title: plain('sarlavha', 'сарлавҳа', 'название', 'title'),
    description: plain('tavsif', 'тавсиф', 'описание', 'description'),
    labels: plain('yorliqlar', 'ёрлиқлар', 'метки', 'labels'),
  }
  const join = (locale: keyof LocalizedText) => keys.map((k) => label[k]?.[locale] ?? k).join(', ')
  return {
    'uz-Latn': `${join('uz-Latn')} oʻzgardi.`,
    'uz-Cyrl': `${join('uz-Cyrl')} ўзгарди.`,
    ru: `изменено: ${join('ru')}.`,
    en: `changed: ${join('en')}.`,
  }
}

// --- digest copy ------------------------------------------------------------------------------------
//
// SPEC §11: "fix the personal and department digest jobs to use the registry's builders". The two
// pg-boss digests are not domain events, so they have no registry row -- but their copy is the same
// kind of four-locale notification text, and it used to live in `jobs.ts` with its own private
// `REASON_LABEL` table, an English `update(s)` plural hack in the title, and a department digest sent
// as one hard-coded bilingual string. All of that now lives here, next to the rest of the copy, and
// `jobs.ts` calls these.

export const REASON_LABEL: Readonly<Record<Reason, LocalizedText>> = Object.freeze({
  assigned: plain('topshiriq', 'топшириқ', 'задачи', 'assigned'),
  mentioned: plain('belgilash', 'белгилаш', 'упоминания', 'mentions'),
  due: plain('muddat', 'муддат', 'сроки', 'due'),
  updated: plain('yangilanish', 'янгиланиш', 'обновления', 'updates'),
  rsvp: plain('ishtirok', 'иштирок', 'участие', 'RSVP'),
  poll: plain('soʻrovnoma', 'сўровнома', 'опросы', 'polls'),
  decision: plain('qaror', 'қарор', 'решения', 'decisions'),
  digest: plain('xulosa', 'хулоса', 'сводка', 'digest'),
  system: plain('tizim', 'тизим', 'система', 'system'),
  field_request: plain('maʼlumot', 'маълумот', 'анкета', 'profile'),
})

type Counts = Partial<Record<Reason, number>>

/** "topshiriq: 3, muddat: 1" in one locale. Reasons with nothing behind them are left out entirely
 * rather than shown as a zero -- a digest is what happened, not a report card. */
export function summarizeCounts(counts: Counts, locale: keyof LocalizedText): string {
  return Object.entries(counts)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([reason, n]) => `${REASON_LABEL[reason as Reason]?.[locale] ?? reason}: ${n}`)
    .join(', ')
}

function inFourLocales(build: (locale: keyof LocalizedText) => string): LocalizedText {
  return {
    'uz-Latn': build('uz-Latn'),
    'uz-Cyrl': build('uz-Cyrl'),
    ru: build('ru'),
    en: build('en'),
  }
}

/** The daily personal digest (08:30 Asia/Tashkent). */
export function personalDigestText(counts: Counts): {
  title: LocalizedText
  body: LocalizedText
} {
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0)
  return {
    title: plain(
      `Kunlik xulosa — ${total} ta yangilik`,
      `Кунлик хулоса — ${total} та янгилик`,
      `Сводка за день — ${total}`,
      `Daily summary — ${total}`,
    ),
    body: inFourLocales((locale) => summarizeCounts(counts, locale)),
  }
}

/** The weekly department digest (Friday 18:00), sent into a connected Telegram group as plain text
 * in that department's own default locale. */
export function departmentDigestText(counts: Counts, locale: keyof LocalizedText): string {
  const summary = summarizeCounts(counts, locale)
  const header = plain('Haftalik xulosa', 'Ҳафталик хулоса', 'Сводка за неделю', 'Weekly summary')[
    locale
  ]
  return `${header}: ${summary}`
}

// --- lookups ---------------------------------------------------------------------------------------

export function specFor(eventType: string): NotificationSpec | null {
  const entry = NOTIFICATION_REGISTRY[eventType]
  if (!entry || entry.notify === false) return null
  return entry
}

/** Every event name the registry knows, silent ones included -- the lint test's left-hand side. */
export const REGISTERED_EVENT_NAMES: readonly string[] = Object.freeze(
  Object.keys(NOTIFICATION_REGISTRY).sort(),
)
