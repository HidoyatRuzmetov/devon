import { withContext, type RequestContext, type Tx } from '@devon/db'
import { sql } from 'drizzle-orm'
import { birthdayClock, birthdayInYear } from './calendar.js'
import { birthdayMessage, familyContext, publicBirthdayContext } from './message.js'

export async function getBirthDate(ctx: RequestContext) {
  if (!ctx.userId || ctx.viewAs) return null
  return withContext(ctx, async (tx) => {
    const [row] = await tx.raw<{ date: string }>(
      sql`select birth_date::text as date from app.account_birthdays where owner_user_id=${ctx.userId}`,
    )
    return row?.date ?? null
  })
}

export async function writeBirthDate(tx: Tx, ownerUserId: string, date: string | null) {
  if (date === null)
    await tx.raw(sql`delete from app.account_birthdays where owner_user_id=${ownerUserId}`)
  else
    await tx.raw(sql`insert into app.account_birthdays(owner_user_id,birth_date) values(${ownerUserId},${date}::date)
    on conflict(owner_user_id) do update set birth_date=excluded.birth_date,updated_at=now()`)
}

export async function ensureGreeting(ctx: RequestContext, ownerUserId: string, date: string) {
  const year = Number(date.slice(0, 4))
  const existing = await withContext(ctx, async (tx) => {
    const [row] = await tx.raw<{ message: string; source: string; canRetry: boolean }>(
      sql`select message,source,(celebrated_at is null and (claim_until is null or claim_until<now()) and generation_retry_at<=now()) as "canRetry" from app.birthday_greetings where owner_user_id=${ownerUserId} and birthday_year=${year}`,
    )
    return row
  })
  if (existing && (existing.source === 'ai' || !existing.canRetry)) return existing.message
  if (existing) {
    // A temporary outage must not replace the personal AI letter permanently. Reserve a bounded
    // retry before presentation; never rewrite a letter already visible or celebrated. In the rare
    // case of an earlier fallback Telegram delivery, a recovered AI letter can improve the portal.
    const reserved = await withContext(ctx, (tx) =>
      tx.raw(sql`update app.birthday_greetings set generation_retry_at=now()+interval '5 minutes'
      where owner_user_id=${ownerUserId} and birthday_year=${year} and source='fallback' and celebrated_at is null
        and (claim_until is null or claim_until<now()) and generation_retry_at<=now() returning owner_user_id`),
    )
    if (!reserved.length) return existing.message
  }
  const context = await withContext(ctx, async (tx) => {
    // Private HR data is projected down to relationship/status before it enters application memory.
    // Public profile projection intentionally excludes biography, identities, contacts and dates.
    const [record] = await tx.raw<{
      data: unknown
    }>(sql`select jsonb_build_object('relatives',coalesce(jsonb_agg(jsonb_build_object('rel',r->>'rel','status',r->>'status')),'[]'::jsonb)) as data
      from app.personnel_records p cross join lateral jsonb_array_elements(p.data->'relatives') r
      where p.department_id=${ctx.departmentId} and p.owner_user_id=${ownerUserId}`)
    const [published] = await tx.raw<{ data: unknown }>(sql`select jsonb_build_object(
      'position',u.title,'headline',u.professional_profile->'headline',
      'skills',u.professional_profile->'skills','hobbies',u.professional_profile->'hobbies',
      'fields',(select jsonb_agg(e->'field') from jsonb_array_elements(coalesce(u.professional_profile->'education','[]'::jsonb)) e),
      'currentRoles',(select jsonb_agg(e->'role') from jsonb_array_elements(coalesce(u.professional_profile->'experience','[]'::jsonb)) e where e->>'current'='true')) as data
      from app.users u where u.id=${ownerUserId} and u.status='active' and u.deleted_at is null`)
    return {
      family: familyContext(record?.data),
      interests: publicBirthdayContext(published?.data),
    }
  })
  const greeting = await birthdayMessage(ctx, context)
  return withContext(ctx, async (tx) => {
    await tx.raw(sql`insert into app.birthday_greetings(owner_user_id,birthday_year,celebration_date,message,source)
      values(${ownerUserId},${year},${date}::date,${greeting.message},${greeting.source})
      on conflict(owner_user_id,birthday_year) do update set message=excluded.message,source=excluded.source
        where app.birthday_greetings.source='fallback' and excluded.source='ai' and app.birthday_greetings.celebrated_at is null
          and (app.birthday_greetings.claim_until is null or app.birthday_greetings.claim_until<now())`)
    const [row] = await tx.raw<{ message: string }>(
      sql`select message from app.birthday_greetings where owner_user_id=${ownerUserId} and birthday_year=${year}`,
    )
    return row!.message
  })
}

export async function claimCelebration(
  ctx: RequestContext,
  token: string,
  now = new Date(),
  prepare = ensureGreeting,
) {
  if (!ctx.userId || !ctx.departmentId || ctx.viewAs) return null
  const date = birthdayClock(now).date
  const birthDate = await getBirthDate(ctx)
  if (!birthDate || birthdayInYear(birthDate, Number(date.slice(0, 4))) !== date) return null
  await prepare(ctx, ctx.userId, date)
  return withContext(ctx, async (tx) => {
    const [greeting] = await tx.raw<{
      date: string
      message: string
    }>(sql`update app.birthday_greetings set celebration_date=${date}::date,claim_token=${token},claim_until=${now.toISOString()}::timestamptz+interval '2 minutes'
      where owner_user_id=${ctx.userId} and birthday_year=${Number(date.slice(0, 4))} and celebrated_at is null
        and (claim_token=${token} or claim_until is null or claim_until<${now.toISOString()}::timestamptz)
        and exists(select 1 from app.account_birthdays b
          join app.users u on u.id=b.owner_user_id and u.status='active' and u.deleted_at is null
          join app.memberships m on m.user_id=b.owner_user_id and m.department_id=${ctx.departmentId} and m.status='active' and m.deleted_at is null
          where b.owner_user_id=${ctx.userId} and (to_char(b.birth_date,'MM-DD')=${date.slice(5)}
            or (to_char(b.birth_date,'MM-DD')='02-29' and ${date.slice(5)}='02-28'
              and extract(day from(date_trunc('month',${date}::date)+interval '1 month - 1 day'))=28)))
      returning celebration_date::text as date,message`)
    return greeting ? { ...greeting, claimToken: token } : null
  })
}

export async function acknowledgeCelebration(ctx: RequestContext, token: string, date: string) {
  if (!ctx.userId || ctx.viewAs) return
  await withContext(ctx, async (tx) => {
    await tx.raw(sql`update app.birthday_greetings set celebrated_at=coalesce(celebrated_at,now()),claim_until=null
      where owner_user_id=${ctx.userId} and celebration_date=${date}::date and claim_token=${token}`)
  })
}
