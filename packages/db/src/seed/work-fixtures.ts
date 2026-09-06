// Demo data for the `work` and `projects` seed modules (TECH-SPEC §14, EPIC-004/005). Not a seed
// module itself -- `src/seed/module-loader.ts` only scans files directly under `src/seed/modules/`,
// so this helper lives one level up, the same way `fixtures.ts` does for the core module.
//
// EPIC-001/002/003 (accounts/departments/structure) have not shipped yet in this build, so
// `fixtures.ts` seeds exactly one head and one member. A People board with one column per person is
// not "rich and realistic" with two people -- this file adds the rest of the department's roster so
// EPIC-004/005 have something worth looking at; when EPIC-002/003 land their own richer fixtures,
// these ids stay stable (`demoId('work.user.*')` is a distinct namespace from `demoId('user.*')`) and
// nothing here needs to change.
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
// department job titles -- alongside `fixtures.ts`'s Anvar Aliyev (head) and Nodira Karimova (member).
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
    title: 'Loyiha menejeri',
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
    title: 'IT mutaxassisi',
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
    title: 'Muhandis',
  },
  {
    id: demoId('work.user.dilnoza'),
    login: 'dilnoza.rahimova',
    givenName: 'Dilnoza',
    patronymic: 'Azizovna',
    familyName: 'Rahimova',
    title: 'Bosh mutaxassis',
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
    familyName: "Ne'matova",
    title: 'Matbuot kotibi',
  },
  {
    id: demoId('work.user.ulugbek'),
    login: 'ulugbek.ganiyev',
    givenName: 'Ulugʻbek',
    patronymic: 'Sobirovich',
    familyName: "G'aniyev",
    title: 'Devonxona mudiri',
  },
  {
    id: demoId('work.user.feruza'),
    login: 'feruza.xolmatova',
    givenName: 'Feruza',
    patronymic: 'Muradovna',
    familyName: 'Xolmatova',
    title: 'Mutaxassis',
  },
]

/** Every member the work module's board has to show a column for: the two `fixtures.ts` accounts
 * plus the roster above. */
export const ALL_WORK_MEMBER_IDS: readonly string[] = [
  ...DEMO_USERS.map((u) => u.id),
  ...WORK_DEMO_USERS.map((u) => u.id),
]

export const HEAD_USER_ID = DEMO_USERS.find((u) => u.role === 'head')!.id
export const MEMBER_USER_ID = DEMO_USERS.find((u) => u.role === 'member')!.id

export const DEPARTMENT_ID = DEMO_DEPARTMENT.id

export function labelId(key: string): string {
  return demoId(`work.label.${key}`)
}

export function projectIdFor(key: string): string {
  return demoId(`work.project.${key}`)
}

export const DEMO_LABELS: readonly { key: string; name: string; colour: string }[] = [
  { key: 'urgent', name: 'Muhim', colour: '#ef4444' },
  { key: 'report', name: 'Hisobot', colour: '#3b82f6' },
  { key: 'it', name: 'IT', colour: '#8b5cf6' },
  { key: 'external', name: 'Tashqi', colour: '#f59e0b' },
  { key: 'quick', name: 'Tezkor', colour: '#10b981' },
]

// Believable Uzbek task titles for a digital-services department. Cycled with a bit of contextual
// variety (see `work.ts`'s `titleFor`) rather than each being used verbatim once.
export const CARD_TITLE_POOL: readonly string[] = [
  'Oylik hisobotni tayyorlash',
  'Portal uchun texnik topshiriqni yozish',
  'Server monitoring tizimini sozlash',
  'Fuqarolar murojaatlarini koʻrib chiqish',
  'Yangi xodimlar uchun moslashuv materialini yangilash',
  'E-xizmat interfeysini test qilish',
  'Maʼlumotlar bazasini zaxiralash',
  'Hafta yakuni boʻyicha taqdimot tayyorlash',
  'Vazirlik yigʻilishiga materiallarni tayyorlash',
  'Litsenziyalarni yangilash',
  'Foydalanuvchi qoʻllanmasini tarjima qilish',
  'API hujjatlarini yangilash',
  'Xavfsizlik auditini oʻtkazish',
  'Statistik maʼlumotlarni yigʻish',
  'Server sertifikatini yangilash',
  'Yangi loyiha uchun byudjet hisob-kitobi',
  'Ichki tartib-qoidalarni yangilash',
  'Telegram bot uchun xabarlar shablonini tayyorlash',
  'Fuqarolar bilan uchrashuv oʻtkazish',
  'Bazani migratsiya qilish',
  'Test muhitini sozlash',
  'Kirish tizimidagi xatolikni tuzatish',
  'Yillik reja loyihasini ishlab chiqish',
  'Backup jarayonini tekshirish',
  'Yangi xodim uchun texnika ajratish',
  'Sayt tezligini optimallashtirish',
  'Hujjat aylanishi tizimini yangilash',
  'Vebinar uchun taqdimot tayyorlash',
  'Litsenziya shartnomasini koʻrib chiqish',
  'Statistik hisobotni Vazirlikka yuborish',
  'Ish rejasini boʻlim boshligʻiga topshirish',
  'Yangi dasturiy taʼminotni sinovdan oʻtkazish',
  'Xodimlar bilan bir zumda uchrashuv',
  'Portal xatolarini bartaraf etish',
  'Foydalanuvchilar soʻrovnomasini tahlil qilish',
]

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

export const COMMENT_POOL: readonly string[] = [
  'Yaxshi, boshlayapman.',
  'Muddatni bir kunga koʻchirsak boʻladimi?',
  'Tayyor, tekshirib chiqing.',
  'Bu boʻyicha savolim bor edi.',
  'Rahmat, qabul qildim.',
  'Kechroq javob beraman, band edim.',
]

// `ownerIndex`/`memberIndexes` index into `ALL_WORK_MEMBER_IDS` (0 = head Anvar, 1 = member Nodira,
// 2..15 = `WORK_DEMO_USERS` in the order listed above: bekzod, madina, jasur, zarina, otabek, kamola,
// sardor, dilnoza, farrux, gulnoza, sanjar, shahnoza, ulugʻbek, feruza).
export const PROJECT_FIXTURES: ReadonlyArray<{
  key: string
  title: string
  description: string
  colour: string
  status: 'planning' | 'active' | 'on_hold' | 'done' | 'archived'
  ownerIndex: number
  memberIndexes: number[]
  milestones: { title: string; dueOn: string; done: boolean }[]
}> = [
  {
    key: 'egov-portal',
    title: 'Yagona portal 2.0',
    description: 'Davlat xizmatlari portalining yangi versiyasini ishga tushirish.',
    colour: '#3b82f6',
    status: 'active',
    ownerIndex: 4, // Jasur (loyiha menejeri)
    memberIndexes: [0, 2, 4, 6, 8, 10],
    milestones: [
      { title: 'Texnik topshiriq tasdiqlandi', dueOn: '2026-09-10', done: true },
      { title: 'Beta versiya', dueOn: '2026-10-15', done: false },
      { title: 'Ishga tushirish', dueOn: '2026-12-01', done: false },
    ],
  },
  {
    key: 'data-migration',
    title: 'Maʼlumotlar bazasi migratsiyasi',
    description: 'Eski tizimdan yangi klasterga xavfsiz koʻchirish.',
    colour: '#8b5cf6',
    status: 'active',
    ownerIndex: 6, // Otabek (IT mutaxassisi)
    memberIndexes: [6, 8, 10, 12],
    milestones: [
      { title: 'Test muhitida sinov', dueOn: '2026-09-20', done: false },
      { title: 'Ishlab chiqarishga koʻchirish', dueOn: '2026-10-05', done: false },
    ],
  },
  {
    key: 'onboarding',
    title: 'Yangi xodimlar dasturi',
    description: 'Yangi xodimlarni ishga moslashtirish jarayonini yaxshilash.',
    colour: '#10b981',
    status: 'planning',
    ownerIndex: 7, // Kamola (kadrlar boʻyicha mutaxassis)
    memberIndexes: [7, 5, 15],
    milestones: [{ title: 'Dastur loyihasi tayyor', dueOn: '2026-09-25', done: false }],
  },
  {
    key: 'annual-report',
    title: 'Yillik hisobot 2026',
    description: 'Boshqarmaning yillik faoliyat hisobotini tayyorlash.',
    colour: '#f59e0b',
    status: 'active',
    ownerIndex: 0, // head Anvar
    memberIndexes: [0, 1, 11, 13],
    milestones: [
      { title: 'Boʻlimlardan maʼlumot yigʻildi', dueOn: '2026-11-01', done: false },
      { title: 'Hisobot Vazirlikka topshirildi', dueOn: '2026-12-15', done: false },
    ],
  },
  {
    key: 'security-audit',
    title: 'Axborot xavfsizligi auditi',
    description: 'Tizimlarning xavfsizlik holatini tekshirish va mustahkamlash.',
    colour: '#ef4444',
    status: 'on_hold',
    ownerIndex: 10, // Farrux (tizim administratori)
    memberIndexes: [10, 6, 8],
    milestones: [{ title: 'Audit rejasi tasdiqlandi', dueOn: '2026-09-30', done: false }],
  },
  {
    key: 'citizen-survey',
    title: 'Fuqarolar soʻrovnomasi',
    description: 'Xizmatlar sifati boʻyicha fuqarolar fikrini oʻrganish.',
    colour: '#06b6d4',
    status: 'done',
    ownerIndex: 1, // Nodira
    memberIndexes: [1, 12, 3],
    milestones: [
      { title: 'Soʻrovnoma oʻtkazildi', dueOn: '2026-08-20', done: true },
      { title: 'Tahlil yakunlandi', dueOn: '2026-09-05', done: true },
    ],
  },
]
