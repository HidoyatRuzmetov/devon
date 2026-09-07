// EPIC-001 demo seed: ~38 additional users (Uzbek three-part names) beyond `fixtures.ts`'s two
// (`demo.boshliq`/`demo.xodim`, order 0), so `departments.ts` (order 20, below this module's order 10)
// has enough people to spread across three departments. `order: 10` -- after `core.ts` (0), before
// `departments.ts` (20), per MODULE-GUIDE.md "DB: seeds".
import { inArray } from 'drizzle-orm'
import * as schema from '../../schema/index.js'
import { demoId } from '../ids.js'
import { demoPasswordHash } from '../fixtures.js'
import type { SeedModuleContext } from '../module-loader.js'

export const order = 10

type ExtraUser = {
  key: string
  login: string
  givenName: string
  familyName: string
  patronymic?: string
  title: string
  locale: 'uz-Latn' | 'uz-Cyrl' | 'ru' | 'en'
}

const GIVEN_M = [
  'Bekzod',
  'Sardor',
  'Otabek',
  'Farrux',
  'Rustam',
  'Aziz',
  'Bahodir',
  'Sherzod',
  'Umid',
  'Davron',
  'Ilhom',
  'Alisher',
  'Jamshid',
  'Sanjar',
  'Timur',
  'Shavkat',
  'Farhod',
  'Akmal',
  'Botir',
  'Jasur',
]
const GIVEN_F = [
  'Dilnoza',
  'Malika',
  'Zarina',
  'Gulnora',
  'Shahnoza',
  'Nigora',
  'Feruza',
  'Madina',
  'Yulduz',
  'Nilufar',
  'Sevara',
  'Kamola',
  'Zilola',
  'Muxlisa',
  'Lola',
  'Gulbahor',
  'Mohira',
  'Diyora',
  'Nargiza',
]
const FAMILY = [
  'Yusupov',
  'Rashidov',
  'Nazarov',
  'Islomov',
  'Toshpulatov',
  'Ergashev',
  'Xolmatov',
  'Mirzayev',
  'Abdullayev',
  'Qodirov',
  'Saidov',
  'Rahimov',
  'Yoldashev',
  'Nematov',
  'Sultonov',
  'Xasanov',
  'Ibragimov',
  'Turgunov',
  'Norqulov',
  'Shodiyev',
]
const PATRONYMIC_STEM = [
  'Baxtiyor',
  'Anvar',
  'Sobir',
  'Karim',
  'Ravshan',
  'Tohir',
  'Yusuf',
  'Farhod',
  'Olim',
  'Sodiq',
]
const TITLES = [
  'Bosh mutaxassis',
  'Yetakchi mutaxassis',
  'Mutaxassis',
  'Kichik mutaxassis',
  'Dasturchi',
  'Tahlilchi',
  'Boʻlim boshligʻi oʻrinbosari',
]

function buildExtraUsers(): ExtraUser[] {
  const users: ExtraUser[] = []
  const count = 38
  for (let i = 0; i < count; i += 1) {
    const isMale = i % 2 === 0
    const given = isMale ? GIVEN_M[i % GIVEN_M.length]! : GIVEN_F[i % GIVEN_F.length]!
    const family = FAMILY[i % FAMILY.length]!
    const familyName = isMale ? family : `${family}a`
    const hasPatronymic = i % 3 !== 0
    const patronymicStem = PATRONYMIC_STEM[i % PATRONYMIC_STEM.length]!
    const patronymic = hasPatronymic
      ? isMale
        ? `${patronymicStem}ovich`
        : `${patronymicStem}ovna`
      : undefined
    const login = `${given.toLowerCase()}.${family.toLowerCase()}${i}`
    users.push({
      key: `user.extra.${i}`,
      login,
      givenName: given,
      familyName,
      ...(patronymic ? { patronymic } : {}),
      title: TITLES[i % TITLES.length]!,
      locale: 'uz-Latn',
    })
  }
  return users
}

/** Exported so `seed/modules/departments.ts` (order 20) can assign these users to memberships without
 * recomputing the same deterministic list. */
export const EXTRA_USERS: readonly ExtraUser[] = buildExtraUsers()
export const extraUserId = (u: ExtraUser): string => demoId(u.key)

export async function seed(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  const passwordHash = await demoPasswordHash()

  const inserted = await tx.drizzle
    .insert(schema.users)
    .values(
      EXTRA_USERS.map((u) => ({
        id: extraUserId(u),
        login: u.login,
        passwordHash,
        givenName: u.givenName,
        familyName: u.familyName,
        patronymic: u.patronymic ?? null,
        title: u.title,
        locale: u.locale,
        role: 'member' as const,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: schema.users.id })

  return inserted.length
}

/** Deletes the 38 extra users. Every demo account shares `DEMO_PASSWORD`, so any of them may have been
 * logged into (and used to join a department, or create one, entirely outside any seed module) since
 * the seed -- their sessions go first, for exactly the reason `demo.ts` deletes the core accounts'
 * sessions (`sessions_user_id_fkey`).
 *
 * Blitz integration fix: the comment here used to claim "their memberships (departments.ts, order 20)
 * are already gone by the time this runs" -- true only for the specific departments/membership ids
 * `departments.ts`'s own `reset()` knows about. `memberships_user_id_fkey` still blocked this delete
 * (found running `seed:reset --demo` against a demo tenant real usage had touched since seeding): one
 * of these 38 users had a real membership in a department no seed module tracks (created through the
 * app's own register/join flow during testing, the same class of gap `events.ts`'s `reset()` had for
 * comments/RSVPs/etc. on its own events). Deleting every remaining `app.memberships` row for exactly
 * these user ids -- regardless of which department it points at -- before the users themselves is safe
 * (the user is about to be gone either way) and closes that gap the same way the session delete below
 * already does for `app.sessions`. */
export async function reset(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  const userIds = EXTRA_USERS.map(extraUserId)

  await tx.drizzle.delete(schema.sessions).where(inArray(schema.sessions.userId, userIds))
  await tx.drizzle.delete(schema.memberships).where(inArray(schema.memberships.userId, userIds))

  const deleted = await tx.drizzle
    .delete(schema.users)
    .where(inArray(schema.users.id, userIds))
    .returning({ id: schema.users.id })

  return deleted.length
}
