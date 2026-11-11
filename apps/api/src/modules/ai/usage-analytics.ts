import type { AdminAiUsage, AdminAiUsageHours, DepartmentAiUsageSummary } from '@devon/contracts'
import { withContext, type RequestContext, type Tx } from '@devon/db'
import { sql } from 'drizzle-orm'

const localDate = sql`(now() at time zone 'Asia/Tashkent')::date`
const totals = sql`sum(total_tokens)::float8 as tokens, sum(cost_uzs)::float8 as "costUzs", count(*)::float8 as runs`

export async function instanceUsageHistory(tx: Tx): Promise<AdminAiUsage> {
  const [history] = await tx.raw<AdminAiUsage>(sql`with days as (
    select department_id as "departmentId",to_char(created_at at time zone 'Asia/Tashkent','YYYY-MM-DD') as day,${totals}
    from app.ai_traces group by department_id,day
  ), departments as (
    select id,name from app.departments d where d.deleted_at is null
      or exists(select 1 from days where days."departmentId"=d.id)
  ) select to_char(${localDate},'YYYY-MM-DD') as today,
    coalesce((select json_agg(d order by d.name,d.id) from departments d),'[]') as departments,
    coalesce((select json_agg(d order by d.day,d."departmentId") from days d),'[]') as days`)
  return history!
}

export async function instanceUsageHours(tx: Tx, day: string): Promise<AdminAiUsageHours> {
  const hours = await tx.raw<AdminAiUsageHours['hours'][number]>(sql`
    select department_id as "departmentId",extract(hour from created_at at time zone 'Asia/Tashkent')::int as hour,${totals}
    from app.ai_traces where created_at >= (${day}::date::timestamp at time zone 'Asia/Tashkent')
      and created_at < ((${day}::date+1)::timestamp at time zone 'Asia/Tashkent')
    group by department_id,hour order by hour,department_id`)
  return { day, hours }
}

export function departmentUsageSummary(
  ctx: RequestContext,
  month?: string,
): Promise<DepartmentAiUsageSummary> {
  return withContext(ctx, async (tx) => {
    // Compute both totals from one ledger snapshot. A local midnight belongs to the new
    // month, including when it is still the previous UTC day.
    const [result] = await tx.raw<DepartmentAiUsageSummary>(sql`with calendar as (
      select ${localDate} as today,
        coalesce(${month ? month + '-01' : null}::date,date_trunc('month',${localDate})::date) as start
    ), spend as (
      select total_tokens,cost_uzs,created_at,
        created_at >= (calendar.start::timestamp at time zone 'Asia/Tashkent')
        and created_at < ((calendar.start+interval '1 month') at time zone 'Asia/Tashkent') as selected
      from app.ai_traces cross join calendar where department_id=${ctx.departmentId}
    ) select (select to_char(today,'YYYY-MM-DD') from calendar) as today,
      (select to_char(start,'YYYY-MM') from calendar) as month,
      to_char(min(created_at) at time zone 'Asia/Tashkent','YYYY-MM') as "firstMonth",
      json_build_object('tokens',coalesce(sum(total_tokens) filter(where selected),0),
        'costUzs',coalesce(sum(cost_uzs) filter(where selected),0),'runs',count(*) filter(where selected)) as monthly,
      json_build_object('tokens',coalesce(sum(total_tokens),0),'costUzs',coalesce(sum(cost_uzs),0),'runs',count(*)) as "allTime"
      from spend`)
    return result!
  })
}
