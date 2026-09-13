// The demo department's cast, org units, labels, card material and projects -- the "one week of one
// ministry department" the demo tells (docs/DEMO-SCRIPT.md). Shared by the `work`, `projects`,
// `structure`, `events`, `fields` and `work-plus` seed modules. Not a seed module itself:
// `src/seed/module-loader.ts` only scans files directly under `src/seed/modules/`, so this helper
// lives one level up, the same way `fixtures.ts` does for the core module.
//
// One rule governs every number in this file: the demo has to be *believable at a glance*, not big.
// Sixteen people, three bo'limlar, four projects and ~85 cards is a department a non-technical
// manager can read in one screen; the 250-card dataset this replaced filled every column past the
// fold and made the board look like a stress test rather than a week of work. Volume that cannot be
// seen on screen is volume nobody is persuaded by.
import { demoId } from './ids.js'
import { DEMO_DEPARTMENT, DEMO_USERS } from './fixtures.js'

export type WorkDemoUser = {
  id: string
  login: string
  givenName: string
  familyName: string
  patronymic: string
  title: string
}

// 14 additional members, three-part Uzbek names (given + patronymic + family), realistic ministry
// department job titles -- alongside `fixtures.ts`'s Anvar Aliyev (boshqarma boshligʻi) and Nodira
// Karimova. Two of them (Jasur Qodirov, Dilnoza Rahimova) are boʻlim boshligʻi and hold a `head` unit
// role in `structure.ts`; the last one (Feruza Xolmatova) joined six days ago and is the newcomer the
// onboarding checklist is running for.
export const WORK_DEMO_USERS: readonly WorkDemoUser[] = [
  {
    id: demoId('work.user.bekzod'),
    login: 'bekzod.yusupov',
    givenName: 'Bekzod',
    patronymic: 'Rustamovich',
    familyName: 'Yusupov',
    title: 'Dasturchi',
  },
  {
    id: demoId('work.user.madina'),
    login: 'madina.tosheva',
    givenName: 'Madina',
    patronymic: 'Sodiqovna',
    familyName: 'Tosheva',
    title: 'Tahlilchi',
  },
  {
    id: demoId('work.user.jasur'),
    login: 'jasur.qodirov',
    givenName: 'Jasur',
    patronymic: 'Baxtiyorovich',
    familyName: 'Qodirov',
    title: 'Boʻlim boshligʻi',
  },
  {
    id: demoId('work.user.zarina'),
    login: 'zarina.ergasheva',
    givenName: 'Zarina',
    patronymic: 'Farxodovna',
    familyName: 'Ergasheva',
    title: 'Yurist',
  },
  {
    id: demoId('work.user.otabek'),
    login: 'otabek.norqobilov',
    givenName: 'Otabek',
    patronymic: 'Davronovich',
    familyName: 'Norqobilov',
    title: 'Yetakchi muhandis',
  },
  {
    id: demoId('work.user.kamola'),
    login: 'kamola.yoldasheva',
    givenName: 'Kamola',
    patronymic: 'Shuhratovna',
    familyName: 'Yoldasheva',
    title: 'Kadrlar boʻyicha mutaxassis',
  },
  {
    id: demoId('work.user.sardor'),
    login: 'sardor.mirzayev',
    givenName: 'Sardor',
    patronymic: 'Ilhomovich',
    familyName: 'Mirzayev',
    title: 'Tarmoq muhandisi',
  },
  {
    id: demoId('work.user.dilnoza'),
    login: 'dilnoza.rahimova',
    givenName: 'Dilnoza',
    patronymic: 'Azizovna',
    familyName: 'Rahimova',
    title: 'Boʻlim boshligʻi',
  },
  {
    id: demoId('work.user.farrux'),
    login: 'farrux.saidov',
    givenName: 'Farrux',
    patronymic: 'Anvarovich',
    familyName: 'Saidov',
    title: 'Tizim administratori',
  },
  {
    id: demoId('work.user.gulnoza'),
    login: 'gulnoza.ashurova',
    givenName: 'Gulnoza',
    patronymic: 'Bekmurodovna',
    familyName: 'Ashurova',
    title: 'Iqtisodchi',
  },
  {
    id: demoId('work.user.sanjar'),
    login: 'sanjar.tursunov',
    givenName: 'Sanjar',
    patronymic: 'Toshpoʻlatovich',
    familyName: 'Tursunov',
    title: 'Yetakchi mutaxassis',
  },
  {
    id: demoId('work.user.shahnoza'),
    login: 'shahnoza.nematova',
    givenName: 'Shahnoza',
    patronymic: 'Qahramonovna',
    familyName: 'Neʼmatova',
    title: 'Matbuot kotibi',
  },
  {
    id: demoId('work.user.ulugbek'),
    login: 'ulugbek.ganiyev',
    givenName: 'Ulugʻbek',
    patronymic: 'Sobirovich',
    familyName: 'Gʻaniyev',
    title: 'Devonxona mudiri',
  },
  {
    id: demoId('work.user.feruza'),
    login: 'feruza.xolmatova',
    givenName: 'Feruza',
    patronymic: 'Muradovna',
    familyName: 'Xolmatova',
    title: 'Kichik mutaxassis',
  },
]

/** Every member the work module's board has to show a column for: the two `fixtures.ts` accounts
 * plus the roster above. Index 0 is the boshqarma boshligʻi, index 1 is `demo.xodim`. */
export const ALL_WORK_MEMBER_IDS: readonly string[] = [
  ...DEMO_USERS.map((u) => u.id),
  ...WORK_DEMO_USERS.map((u) => u.id),
]

export const HEAD_USER_ID = DEMO_USERS.find((u) => u.role === 'head')!.id
export const MEMBER_USER_ID = DEMO_USERS.find((u) => u.role === 'member')!.id

/**
 * The newcomer. Feruza Xolmatova joined on 2026-08-31 (six days before the demo's "today"), so the
 * onboarding checklist `pages.ts` enables is genuinely mid-run for her: some items done, some not,
 * her board column deliberately thin, and her two person custom fields still unanswered -- which is
 * what gives the head's "Toʻldirishni soʻrash" button somebody real to ask (SPEC §5).
 */
export const NEWCOMER_INDEX = 15
export const NEWCOMER_JOINED_AT = new Date('2026-08-31T04:00:00.000Z')

export const DEPARTMENT_ID = DEMO_DEPARTMENT.id

export function labelId(key: string): string {
  return demoId(`work.label.${key}`)
}

export function projectIdFor(key: string): string {
  return demoId(`work.project.${key}`)
}

export function unitIdFor(key: string): string {
  return demoId(`work.unit.${key}`)
}

// --- the org chart -----------------------------------------------------------------------------
//
// Three flat bo'limlar (TECH-SPEC §3.2: units are one or two levels, never a tree nobody maintains).
// Two carry a `head` unit role and one deliberately carries none -- a headless bo'lim is the normal
// state of a real department between appointments, and the org chart has to look finished anyway
// (design.md §2.3). The boshqarma boshligʻi himself belongs to no bo'lim, which is what puts somebody
// in the People page's "unassigned" bucket.
export type DemoUnitFixture = {
  key: string
  name: string
  colour: number
  /** Index into `ALL_WORK_MEMBER_IDS`, or `null` for the deliberately headless bo'lim. */
  headIndex: number | null
  deputyIndex?: number
  memberIndexes: number[]
}

export const DEMO_UNITS: readonly DemoUnitFixture[] = [
  {
    key: 'elektron-xizmatlar',
    name: 'Elektron xizmatlar boʻlimi',
    colour: 4,
    headIndex: 4, // Jasur Qodirov
    deputyIndex: 6, // Otabek Norqobilov
    memberIndexes: [2, 8, 10],
  },
  {
    key: 'tahlil-hisobot',
    name: 'Tahlil va hisobot boʻlimi',
    colour: 6,
    headIndex: 9, // Dilnoza Rahimova
    memberIndexes: [3, 11, 12],
  },
  {
    key: 'devonxona-huquq',
    name: 'Devonxona va huquq boʻlimi',
    colour: 1,
    headIndex: null, // between appointments -- on purpose
    memberIndexes: [1, 5, 7, 13, 14, 15],
  },
]

/** Which bo'lim a member index belongs to, or `null` for the boshqarma boshligʻi. */
export function unitKeyForMember(memberIndex: number): string | null {
  for (const unit of DEMO_UNITS) {
    if (unit.headIndex === memberIndex) return unit.key
    if (unit.deputyIndex === memberIndex) return unit.key
    if (unit.memberIndexes.includes(memberIndex)) return unit.key
  }
  return null
}

export const DEMO_LABELS: readonly { key: string; name: string; colour: string }[] = [
  { key: 'urgent', name: 'Muhim', colour: '#ef4444' },
  { key: 'report', name: 'Hisobot', colour: '#3b82f6' },
  { key: 'it', name: 'IT', colour: '#8b5cf6' },
  { key: 'external', name: 'Tashqi', colour: '#f59e0b' },
  { key: 'quick', name: 'Tezkor', colour: '#10b981' },
]

// --- what people actually work on ---------------------------------------------------------------
//
// One themed pool per bo'lim, rather than one shared pool cycled by index: a board where the yurist
// and the dasturchi are both assigned "Server monitoringini sozlash" is the tell that the data is
// generated. A manager reads three columns and has to believe each person does their own job.
const TITLES_ELEKTRON: readonly string[] = [
  'Yagona portalda «Ariza berish» qadamini soddalashtirish',
  'Mobil ilova uchun API versiyasini chiqarish',
  'Test muhitini yangi relizga tayyorlash',
  'Kirish tizimidagi 500-xatolikni bartaraf etish',
  'Sayt ochilish tezligini 2 soniyagacha tushirish',
  'E-imzo modulini yangi sertifikatga moslashtirish',
  'Xizmat sahifalarining mobil koʻrinishini tuzatish',
  'Yuklama sinovini oʻtkazish (1 000 foydalanuvchi)',
  'Zaxira nusxadan tiklashni sinab koʻrish',
  'Monitoring ogohlantirishlarini qayta sozlash',
  'Maʼlumotlar bazasi indekslarini optimallashtirish',
  'API hujjatlarini yangilash',
]

const TITLES_TAHLIL: readonly string[] = [
  'Avgust oyi boʻyicha xizmatlar statistikasini yigʻish',
  'Fuqarolar murojaatlari tahlilini tayyorlash',
  'Vazirlik yigʻilishiga taqdimot slaydlarini tayyorlash',
  'Choraklik hisobot jadvallarini yangilash',
  'Xizmatlardan foydalanish dinamikasini vizuallashtirish',
  'Soʻrovnoma natijalarini qayta ishlash',
  'Byudjet sarfi boʻyicha maʼlumotnoma tayyorlash',
  'Hududlar kesimida koʻrsatkichlarni solishtirish',
  'Hisobotni Vazirlikka yuborish',
  'Maʼlumotlar sifatini tekshirish',
]

const TITLES_DEVONXONA: readonly string[] = [
  'Kiruvchi hujjatlarni roʻyxatdan oʻtkazish',
  'Shartnoma loyihasini huquqiy ekspertizadan oʻtkazish',
  'Boshqarma buyrugʻi loyihasini tayyorlash',
  'Matbuot uchun xabar matnini kelishish',
  'Yangi xodim uchun hujjatlarni rasmiylashtirish',
  'Arxivga topshiriladigan ishlarni saralash',
  'Ijro intizomi boʻyicha eslatma yuborish',
  'Litsenziya shartnomasini koʻrib chiqish',
  'Ichki tartib-qoidalar loyihasini tahrirlash',
  'Telegram kanali uchun eʼlon tayyorlash',
]

/** The newcomer's first week. Both of these come out of the onboarding checklist `pages.ts` enables,
 * which is why her `onboarding_runs` row says two tasks were created for her. */
const TITLES_NEWCOMER: readonly string[] = [
  'Ish hisoblarini faollashtirish (pochta, tizimlar)',
  '«Biz qanday ishlaymiz» sahifasini oʻqib chiqish',
]

const TITLES_BOSHLIQ: readonly string[] = [
  'Hafta yakunini boʻlim boshliqlari bilan koʻrib chiqish',
  'Vazirlikdagi kengashga materiallarni tasdiqlash',
  'Yillik reja loyihasini koʻrib chiqish',
  'Yangi xodimni ishga qabul qilishni kelishish',
]

export function titlePoolForMember(memberIndex: number): readonly string[] {
  if (memberIndex === 0) return TITLES_BOSHLIQ
  if (memberIndex === NEWCOMER_INDEX) return TITLES_NEWCOMER
  switch (unitKeyForMember(memberIndex)) {
    case 'elektron-xizmatlar':
      return TITLES_ELEKTRON
    case 'tahlil-hisobot':
      return TITLES_TAHLIL
    default:
      return TITLES_DEVONXONA
  }
}

/**
 * How many standalone cards each member's column carries. Deliberately uneven -- a real board is not
 * a rectangle -- and deliberately small: 4-7 cards fit a column without scrolling, which is what lets
 * the whole department be read in one screenshot. Index 1 (`demo.xodim`, the member persona the demo
 * signs in as) gets the most, because every "open a card" moment in the script happens in her column;
 * index 15 (the newcomer) gets two, because she joined six days ago.
 *
 * `work-plus.ts` derives its estimate/focus/dependency card ids from the same function, so the two
 * modules can never disagree about which `(member, n)` pairs exist.
 */
const STANDALONE_CARD_COUNTS: readonly number[] = [4, 7, 5, 4, 5, 3, 5, 4, 4, 5, 4, 3, 4, 3, 3, 2]

export function standaloneCardCount(memberIndex: number): number {
  return STANDALONE_CARD_COUNTS[memberIndex] ?? 3
}

/** The id and the title of one standalone card, named here rather than inside `work.ts` so that any
 * module wanting to *point at* a real card (an inbox row, a Telegram message, an AI trace) gets the
 * same id and the same words the board shows. The demo used to hold invented card ids in its
 * notifications, so every "open it" button in the inbox led to a card that did not exist. */
export function standaloneCardId(memberIndex: number, n: number): string {
  return demoId(`work.card.standalone.${memberIndex}.${n}`)
}

/**
 * The few cards whose words are chosen rather than cycled, because another module points at them and
 * the *relationship* has to read correctly:
 *   - `1.0 → 1.2 → 1.3` is `work-plus.ts`'s dependency chain. Draft the contract, have it reviewed,
 *     send it for signature: a blocked chip only teaches anything when the thing it is blocked on is
 *     visibly the thing that has to happen first.
 *   - `1.4` is the recurring card. "Every Monday" has to be written on something that plausibly
 *     happens every Monday.
 */
const STANDALONE_TITLE_OVERRIDES: Readonly<Record<string, string>> = {
  '1.0': 'Shartnoma loyihasi matnini tayyorlash',
  '1.2': 'Shartnomani huquqiy ekspertizadan oʻtkazish',
  '1.3': 'Shartnomani imzolashga topshirish',
  '1.4': 'Haftalik ijro intizomi hisobotini topshirish',
}

export function standaloneCardTitle(memberIndex: number, n: number): string {
  const override = STANDALONE_TITLE_OVERRIDES[`${memberIndex}.${n}`]
  if (override) return override
  const pool = titlePoolForMember(memberIndex)
  return pool[(memberIndex * 5 + n * 3) % pool.length]!
}

export const CHECKLIST_ITEM_POOL: readonly string[] = [
  'Maʼlumotlarni yigʻish',
  'Loyihani koʻrib chiqish',
  'Boʻlim boshligʻi bilan kelishish',
  'Hujjatni imzolash',
  'Natijani yuborish',
  'Test qilish',
  'Xatoliklarni tuzatish',
  'Nazorat roʻyxatini yangilash',
]

/** Comment bodies that read like a colleague wrote them -- half of them carry an @mention, which is
 * what puts a row in somebody's inbox and makes the notification demo self-explanatory. */
export const COMMENT_POOL: readonly string[] = [
  'Yaxshi, boshladim. Payshanbagacha yetkazaman.',
  'Muddatni bir kunga surib boʻladimi? Vazirlikdan javob kutyapmiz.',
  'Tayyor, tekshirib chiqing.',
  'Bu boʻyicha savolim bor edi — qaysi shakl boʻyicha topshiramiz?',
  'Rahmat, qabul qildim.',
  'Kechroq javob beraman, hozir yigʻilishdaman.',
  'Raqamlarni yangiladim, endi oʻtgan oy bilan mos tushyapti.',
  'Huquqiy xulosa tayyor, ilova qildim.',
]

// --- the quarter's projects ---------------------------------------------------------------------
//
// Exactly four, and each one is a different *shape* of project, because "what does this tool tell me
// about my department?" is the question the demo exists to answer:
//   - `egov-portal`     on track     -- a milestone behind it, the next one comfortably ahead
//   - `data-migration`  slipping     -- a milestone whose date has passed and is still not ticked
//   - `citizen-survey`  finished     -- every milestone done, the project closed out
//   - `onboarding`      just started -- opened this week, nothing done yet
// A fifth and sixth project used to exist and said nothing the first four do not.
//
// `ownerIndex`/`memberIndexes` index into `ALL_WORK_MEMBER_IDS` (0 = Anvar, 1 = Nodira, 2..15 =
// `WORK_DEMO_USERS` in the order listed above).
export const PROJECT_FIXTURES: ReadonlyArray<{
  key: string
  title: string
  description: string
  colour: string
  status: 'planning' | 'active' | 'on_hold' | 'done' | 'archived'
  ownerIndex: number
  memberIndexes: number[]
  startOn: string
  targetOn: string
  objectiveCount: number
  milestones: { title: string; dueOn: string; doneOn: string | null }[]
}> = [
  {
    key: 'egov-portal',
    title: 'Yagona portal 2.0',
    description:
      'Davlat xizmatlari portalining yangi versiyasi: ariza berish qadamlari soddalashtiriladi, mobil koʻrinish qayta ishlanadi.',
    colour: '#3b82f6',
    status: 'active',
    ownerIndex: 4, // Jasur Qodirov, Elektron xizmatlar boʻlimi boshligʻi
    memberIndexes: [4, 2, 6, 8, 10, 0],
    startOn: '2026-07-01',
    targetOn: '2026-11-30',
    objectiveCount: 2,
    milestones: [
      { title: 'Texnik topshiriq tasdiqlandi', dueOn: '2026-07-20', doneOn: '2026-07-18' },
      { title: 'Beta versiya ichki sinovda', dueOn: '2026-09-25', doneOn: null },
      { title: 'Ishga tushirish', dueOn: '2026-11-30', doneOn: null },
    ],
  },
  {
    key: 'data-migration',
    title: 'Maʼlumotlar bazasi migratsiyasi',
    description:
      'Eski tizimdagi 12 yillik maʼlumotni yangi klasterga toʻxtashsiz koʻchirish. Sinov muhitidagi tekshiruv kechikdi.',
    colour: '#8b5cf6',
    status: 'active',
    ownerIndex: 6, // Otabek Norqobilov
    memberIndexes: [6, 8, 10, 12],
    startOn: '2026-07-14',
    targetOn: '2026-10-05',
    objectiveCount: 2,
    milestones: [
      { title: 'Maʼlumot tuzilmasi solishtirildi', dueOn: '2026-08-05', doneOn: '2026-08-12' },
      // The one that makes this project read as "slipping": the date has passed, the tick has not.
      { title: 'Sinov muhitida toʻliq koʻchirish', dueOn: '2026-08-28', doneOn: null },
      { title: 'Ishlab chiqarishga koʻchirish', dueOn: '2026-10-05', doneOn: null },
    ],
  },
  {
    key: 'citizen-survey',
    title: 'Fuqarolar soʻrovnomasi',
    description:
      'Xizmatlar sifati boʻyicha fuqarolar fikrini oʻrganish: 2 400 ta javob yigʻildi, tahlil Vazirlikka topshirildi.',
    colour: '#06b6d4',
    status: 'done',
    ownerIndex: 1, // Nodira Karimova
    memberIndexes: [1, 13, 3],
    startOn: '2026-06-22',
    targetOn: '2026-09-05',
    objectiveCount: 2,
    milestones: [
      { title: 'Soʻrovnoma oʻtkazildi', dueOn: '2026-08-20', doneOn: '2026-08-19' },
      { title: 'Tahlil yakunlandi', dueOn: '2026-09-05', doneOn: '2026-09-04' },
    ],
  },
  {
    key: 'onboarding',
    title: 'Yangi xodimlar dasturi',
    description:
      'Yangi xodimni birinchi ikki haftada ishga moslashtirish tartibini yozib chiqish va sinovdan oʻtkazish.',
    colour: '#10b981',
    status: 'planning',
    ownerIndex: 7, // Kamola Yoldasheva
    memberIndexes: [7, 1, 15],
    startOn: '2026-09-02',
    targetOn: '2026-10-30',
    objectiveCount: 2,
    milestones: [{ title: 'Dastur loyihasi tayyor', dueOn: '2026-09-30', doneOn: null }],
  },
]

/**
 * What a project's cards are actually called. `objective` cards are the shared deliverables the whole
 * project owes (SPEC §3.4: everybody sees them, the owner carries them); `subjective` cards are one
 * person's slice of the same project. Written out per project rather than cycled from one pool,
 * because "Yagona portal 2.0" and "Fuqarolar soʻrovnomasi" do not contain the same work and a manager
 * notices immediately when they appear to.
 */
export const PROJECT_CARD_TITLES: Readonly<
  Record<string, { objective: readonly string[]; subjective: readonly string[] }>
> = {
  'egov-portal': {
    objective: [
      'Beta versiyani ichki sinovga chiqarish',
      'Ariza berish oqimini uchta qadamga qisqartirish',
    ],
    subjective: [
      'Frontend komponentlarini yangi dizaynga koʻchirish',
      'Yuklama sinovi natijalarini tayyorlash',
      'E-imzo integratsiyasini yangilash',
      'Reliz uchun zaxira rejasini yozish',
      'Sinov stsenariylarini kelishish',
    ],
  },
  'data-migration': {
    objective: [
      'Sinov muhitida toʻliq koʻchirishni yakunlash',
      'Koʻchirishdan keyingi tekshiruv skriptlarini yozish',
    ],
    subjective: [
      'Eski jadval tuzilmasini xaritalash',
      'Koʻchirish oynasini rejalashtirish',
      'Zaxira nusxa tartibini qayta koʻrib chiqish',
    ],
  },
  'citizen-survey': {
    objective: ['Soʻrovnoma natijalarini tahlil qilish', 'Yakuniy hisobotni Vazirlikka topshirish'],
    subjective: [
      'Javoblarni hududlar kesimida guruhlash',
      'Matbuot uchun qisqacha xulosa tayyorlash',
    ],
  },
  onboarding: {
    objective: [
      'Moslashuv tartibi loyihasini yozish',
      'Birinchi hafta uchun nazorat roʻyxatini tuzish',
    ],
    subjective: [
      'Yangi xodim uchun kirish materiallarini yigʻish',
      'Yordamchi hamkasb (buddy) tartibini kelishish',
    ],
  },
}
