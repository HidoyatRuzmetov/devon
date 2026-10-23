import { sql } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'
import type { AiChatSource } from '@devon/contracts'
import { refreshIndex, searchText } from './search-repo.js'
import { conversationFiles } from './conversation-files.js'

type SnapshotRow = {
  ref: string
  title: string
  href: string
  facts: unknown
  total: number
}
const snapshots = new Map<string, { revision: string; at: number; rows: SnapshotRow[] }>()
export type DepartmentChatContext = {
  generatedAt: string
  recordsTotal: number
  recordsIncluded: number
  limited: boolean
  snapshot: unknown[]
  evidence: unknown[]
  sources: AiChatSource[]
  totals: unknown
}

/** Logistics mutate independently of event documents, so this projection is deliberately fresh.
 * All joins are department-scoped and share one round trip. Voter identities/hashes never leave
 * the database: options expose a tally and the current user's own selection only. */
async function eventLogistics(ctx: RequestContext, priorityRefs: string[]) {
  return withContext(ctx, (tx) =>
    tx.raw<SnapshotRow>(sql`
    with live_events as (
      select id,title,starts_at from app.events where department_id=${ctx.departmentId} and deleted_at is null
    ), rsvp_totals as (
      select r.event_id,count(*)::int as responses,
        count(*) filter(where r.status='yes')::int as yes_responses,
        coalesce(sum(1+r.guests) filter(where r.status='yes'),0)::int as going_people,
        count(*) filter(where r.status='maybe')::int as maybe_responses,
        count(*) filter(where r.status='no')::int as no_responses,
        count(*) filter(where r.status='waitlist')::int as waitlist_responses
      from app.event_rsvps r join live_events e on e.id=r.event_id
      where r.department_id=${ctx.departmentId} group by r.event_id
    ), seat_totals as (
      select s.carpool_id,
        coalesce(sum(s.seats_claimed) filter(where s.status='confirmed'),0)::int as confirmed,
        coalesce(sum(s.seats_claimed) filter(where s.status='waitlist'),0)::int as waitlisted
      from app.carpool_seats s where s.department_id=${ctx.departmentId} group by s.carpool_id
    ), option_tallies as (
      select v.poll_id,v.option_id,count(*)::int as votes,
        bool_or(case when p.anonymous then v.voter_hash=encode(sha256(convert_to(p.id::text||':'||${ctx.userId}::text,'UTF8')),'hex')
          else v.user_id=${ctx.userId} end) as voted_by_me
      from app.poll_votes v join app.polls p on p.id=v.poll_id join live_events e on e.id=p.event_id
      where v.department_id=${ctx.departmentId} and p.department_id=${ctx.departmentId} group by v.poll_id,v.option_id
    ), ranked_options as (
      select o.*,row_number() over(partition by o.poll_id order by o.sort_order,o.id) as position
      from app.poll_options o where o.department_id=${ctx.departmentId}
    ), poll_options as (
      select o.poll_id,count(*)::int as total,
        coalesce(sum(t.votes),0)::int as votes,
        jsonb_agg(jsonb_build_object('id',o.id,'label',o.label,'optionDate',o.option_date,
          'votes',coalesce(t.votes,0),'votedByMe',coalesce(t.voted_by_me,false)) order by o.sort_order,o.id)
          filter(where o.position<=20) as options
      from ranked_options o left join option_tallies t on t.poll_id=o.poll_id and t.option_id=o.id group by o.poll_id
    ), records as (
      select 'event_logistics:'||e.id as ref,e.title||' — RSVP' as title,'/events?event='||e.id as href,e.id as event_id,e.starts_at,
        jsonb_build_object('kind','event_logistics','eventId',e.id,
          'rsvpTotals',jsonb_build_object('responses',coalesce(t.responses,0),'yesResponses',coalesce(t.yes_responses,0),
            'goingPeople',coalesce(t.going_people,0),'maybeResponses',coalesce(t.maybe_responses,0),
            'noResponses',coalesce(t.no_responses,0),'waitlistResponses',coalesce(t.waitlist_responses,0)),
          'myRsvp',case when mine.id is null then null else jsonb_build_object('id',mine.id,'status',mine.status,'guests',mine.guests,'note',mine.note,'changedAt',mine.changed_at) end) as facts
      from live_events e left join rsvp_totals t on t.event_id=e.id
      left join app.event_rsvps mine on mine.event_id=e.id and mine.department_id=${ctx.departmentId} and mine.user_id=${ctx.userId}
      union all
      select 'carpool:'||c.id,e.title||' — '||coalesce(nullif(c.departure_place,''),'Carpool'),'/events?event='||e.id,e.id,e.starts_at,
        jsonb_build_object('kind','carpool','eventId',e.id,'driverId',c.driver_user_id,'seats',c.seats,'status',c.status,
          'departurePlace',c.departure_place,'departureAt',c.departure_at,'note',c.note,
          'confirmedSeats',coalesce(t.confirmed,0),'waitlistedSeats',coalesce(t.waitlisted,0),'availableSeats',greatest(0,c.seats-coalesce(t.confirmed,0)),
          'myReservation',case when mine.id is null then null else jsonb_build_object('id',mine.id,'seats',mine.seats_claimed,'status',mine.status) end)
      from app.carpools c join live_events e on e.id=c.event_id left join seat_totals t on t.carpool_id=c.id
      left join app.carpool_seats mine on mine.carpool_id=c.id and mine.department_id=${ctx.departmentId} and mine.user_id=${ctx.userId}
      where c.department_id=${ctx.departmentId}
      union all
      select 'event_item:'||i.id,i.label,'/events?event='||e.id,e.id,e.starts_at,
        jsonb_build_object('kind','event_item','eventId',e.id,'quantity',i.quantity,'claimedById',i.claimed_by_user_id,
          'claimedByMe',coalesce(i.claimed_by_user_id=${ctx.userId},false),'claimedAt',i.claimed_at)
      from app.event_items i join live_events e on e.id=i.event_id where i.department_id=${ctx.departmentId}
      union all
      select 'poll:'||p.id,p.question,'/events?event='||e.id,e.id,e.starts_at,
        jsonb_build_object('kind','poll','pollKind',p.kind,'eventId',e.id,'anonymous',p.anonymous,'status',p.status,
          'closesAt',p.closes_at,'createdById',p.created_by_user_id,'totalVotes',coalesce(o.votes,0),'optionsTotal',coalesce(o.total,0),
          'options',coalesce(o.options,'[]'::jsonb),'limited',coalesce(o.total,0)>20)
      from app.polls p join live_events e on e.id=p.event_id left join poll_options o on o.poll_id=p.id where p.department_id=${ctx.departmentId}
    ) select ref,title,href,facts,count(*) over()::int as total from records
      order by case when ref=any(${sql.param(priorityRefs)}::text[]) or 'event:'||event_id=any(${sql.param(priorityRefs)}::text[]) then 0 else 1 end,
        starts_at desc,ref limit 1000
  `),
  )
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
/** Child references resolve approval IDs to the same readable labels and parent navigation used
 * in the UI. They are derived only from records actually admitted to the bounded snapshot. */
function childSources(row: SnapshotRow): AiChatSource[] {
  const facts = record(row.facts)
  if (!facts) return []
  const sources: AiChatSource[] = []
  const add = (kind: string, value: unknown, labelKey: string) => {
    const child = record(value)
    if (!child || typeof child['id'] !== 'string') return
    const raw = child[labelKey]
    const label = typeof raw === 'string' ? raw : record(raw)?.['text']
    const name = typeof label === 'string' && label.trim() ? label.trim().slice(0, 180) : row.title
    const prefix = kind === 'milestone' ? `milestone:${row.ref.slice('project:'.length)}` : kind
    sources.push({
      ref: `${prefix}:${child['id']}`,
      title: `${row.title} — ${name}`,
      href: row.href,
    })
  }
  for (const [field, kind, label] of [
    ['checklist', 'checklist', 'text'],
    ['comments', facts['kind'] === 'event' ? 'event_comment' : 'comment', 'body'],
    ['milestones', 'milestone', 'title'],
    ['options', 'poll_option', 'label'],
  ] as const) {
    const values = facts[field]
    if (Array.isArray(values)) for (const value of values) add(kind, value, label)
  }
  add('event_rsvp', facts['myRsvp'], 'status')
  add('carpool_reservation', facts['myReservation'], 'status')
  return sources
}

/** Authorized department records and the current user's private workspace. Other users' private
 * notes, uploads and conversations never enter this context, including for a department head. */
export async function conversationContext(
  ctx: RequestContext,
  question: string,
  priorityRefs: string[] = [],
  conversationId?: string,
  attachmentIds: string[] = [],
): Promise<DepartmentChatContext> {
  const departmentId = ctx.departmentId!
  const revision = await withContext(
    ctx,
    async (tx) =>
      (
        await tx.raw<{ revision: string }>(
          sql`select coalesce(revision,0)::text as revision from app.ai_context_revisions where department_id=${departmentId}`,
        )
      )[0]?.revision ?? '0',
  )
  const cacheKey = `${departmentId}:${ctx.userId}:${ctx.departmentRole}`
  const cached = snapshots.get(cacheKey)
  const cacheHasPriorities = priorityRefs
    .filter((ref) => /^(card|project|page|event|unit):/.test(ref))
    .every((ref) => cached?.rows.some((row) => row.ref === ref))
  const canReuse =
    cached?.revision === revision && Date.now() - cached.at < 60_000 && cacheHasPriorities
  const [rows, retrieved, totals, people, logistics] = await Promise.all([
    canReuse
      ? Promise.resolve(cached.rows)
      : withContext(ctx, (tx) =>
          tx.raw<SnapshotRow>(sql`
      with records as (
        select 'unit:'||id as ref,name as title,'/structure'::text as href,
          jsonb_build_object('kind','unit','parentId',parent_unit_id,'expectedPeople',expected_people) as facts,1 as rank
        from app.units where department_id=${departmentId} and deleted_at is null
        union all
        select 'project:'||p.id,p.title,'/projects/view?id='||p.id,
          jsonb_build_object('kind','project','status',p.status,'ownerId',p.owner_user_id,'members',p.members,
            'targetDate',p.target_on,'milestones',p.milestones,'description',p.description,'version',p.version),3
        from app.projects p where p.department_id=${departmentId} and p.deleted_at is null
        union all
        select 'card:'||c.id,c.title,'/work/card?id='||c.id,
          jsonb_build_object('kind','card','status',c.status,'stage',c.work_stage,'priority',c.priority,
            'assigneeId',c.assignee_user_id,'projectId',c.project_id,'dueAt',c.due_at,
            'updatedAt',c.updated_at,'version',c.version,'description',c.description,'estimateMin',c.estimate_min,
            'checklist',coalesce(i.items,'[]'::jsonb),'checklistDone',coalesce(i.done,0),'checklistTotal',coalesce(i.total,0),
            'comments',coalesce((select jsonb_agg(jsonb_build_object('id',cm.id,'authorId',cm.author_user_id,'body',cm.body,'mentions',cm.mentions,'editedAt',cm.edited_at,'createdAt',cm.created_at)) from app.card_comments cm where cm.card_id=c.id and cm.deleted_at is null),'[]'::jsonb)),
          case when c.status='active' then 4 else 7 end
        from app.cards c left join (
          select card_id,count(*)::int as total,count(*) filter(where done_at is not null)::int as done,
            jsonb_agg(jsonb_build_object('id',id,'text',text,'done',done_at is not null)) as items
          from app.card_checklist_items where department_id=${departmentId} and deleted_at is null group by card_id
        ) i on i.card_id=c.id where c.department_id=${departmentId} and c.deleted_at is null
        union all
        select 'event:'||e.id,e.title,'/events?event='||e.id,
          jsonb_build_object('kind','event','startsAt',e.starts_at,'endsAt',e.ends_at,'status',e.status,'capacity',e.capacity,'rsvpDeadline',e.rsvp_deadline,'organizerId',e.organizer_user_id,'description',e.description,'place',e.place,'version',e.version,
            'comments',coalesce((select jsonb_agg(jsonb_build_object('id',cm.id,'authorId',cm.author_user_id,'body',cm.body,'editedAt',cm.edited_at)) from app.event_comments cm where cm.event_id=e.id and cm.deleted_at is null),'[]'::jsonb)),5
        from app.events e where e.department_id=${departmentId} and e.deleted_at is null
        union all
        select 'page:'||p.id,p.title,'/pages?page='||p.id,
          jsonb_build_object('kind','page','updatedAt',p.updated_at,'version',p.version,'body',p.blocks),6
        from app.pages p where p.department_id=${departmentId} and p.deleted_at is null
      ) select *,count(*) over()::int as total from records order by case when ref=any(${sql.param(priorityRefs)}::text[]) then 0 else rank end,ref limit 2000
    `),
        ),
    withContext(ctx, async (tx) => {
      await refreshIndex(tx, departmentId)
      return searchText(tx, departmentId, question, 12)
    }),
    withContext(ctx, (tx) =>
      tx.raw(sql`select
      (select count(*)::int from app.memberships m join app.users u on u.id=m.user_id where m.department_id=${departmentId} and m.status='active' and m.deleted_at is null and u.deleted_at is null) as people,
      (select count(*)::int from app.units where department_id=${departmentId} and deleted_at is null) as units,
      (select sum(expected_people)::int from app.units where department_id=${departmentId} and deleted_at is null) as planned_positions,
      (select jsonb_object_agg(status,n) from (select status,count(*)::int n from app.projects where department_id=${departmentId} and deleted_at is null group by status) p) as projects_by_status,
      (select jsonb_agg(c) from (select status,work_stage,project_id is not null as project_task,count(*)::int as count from app.cards where department_id=${departmentId} and deleted_at is null group by status,work_stage,project_id is not null) c) as cards_by_status,
      (select count(*)::int from app.cards where department_id=${departmentId} and deleted_at is null and status='active' and due_at<now()) as overdue_cards,
      (select count(*)::int from app.events where department_id=${departmentId} and deleted_at is null and starts_at>=now()) as upcoming_events`),
    ),
    // Account names/status live outside the department revision journal. Keep this cheap roster
    // projection fresh without re-reading document bodies or privileged cross-department triggers.
    withContext(ctx, (tx) =>
      tx.raw<SnapshotRow>(sql`
      select 'person:'||u.id as ref,concat_ws(' ',u.given_name,u.family_name) as title,'/people'::text as href,
        jsonb_build_object('kind','person','units',coalesce(ur.units,'[]'::jsonb),'role',m.role,'status',u.status) as facts,count(*) over()::int as total
      from app.memberships m join app.users u on u.id=m.user_id
      left join (select user_id,jsonb_agg(jsonb_build_object('unitId',unit_id,'role',role) order by unit_id) as units
        from app.unit_roles where department_id=${departmentId} and deleted_at is null group by user_id) ur on ur.user_id=m.user_id
      where m.department_id=${departmentId} and m.status='active' and m.deleted_at is null and u.deleted_at is null
      order by case when 'person:'||u.id=any(${sql.param(priorityRefs)}::text[]) then 0 else 1 end,u.id limit 2000`),
    ),
    eventLogistics(ctx, priorityRefs),
  ])
  if (!canReuse) {
    if (snapshots.size >= 40) snapshots.delete(snapshots.keys().next().value!)
    snapshots.set(cacheKey, { revision, at: Date.now(), rows })
  }
  // Private records are read in the current user's RLS scope and never enter the shared index.
  const personal = await withContext(ctx, (tx) =>
    tx.raw<SnapshotRow>(sql`with records as (
    select 'note:'||id as ref,title,'/personal'::text as href,jsonb_build_object('kind','private_note','body',body,'version',version) as facts,0 as total
    from app.personal_notes where user_id=${ctx.userId} and deleted_at is null
    union all select 'personal_task:'||id,title,'/personal',jsonb_build_object('kind','private_task','doneAt',done_at,'notes',notes,'sprintId',sprint_id,'parentId',parent_id,'version',version),0
    from app.personal_tasks where user_id=${ctx.userId} and deleted_at is null
    union all select 'canvas:'||id,title,'/personal',jsonb_build_object('kind','private_canvas','stickies',stickies,'scene',scene,'version',version),0
    from app.personal_canvases where user_id=${ctx.userId} and deleted_at is null
    union all select 'personal_sprint:'||id,coalesce(nullif(goal,''),kind::text||' sprint'),'/personal',
      jsonb_build_object('kind','private_sprint','sprintKind',kind,'startsAt',starts_at,'endsAt',ends_at,'goal',goal,'status',status,'version',version),0
    from app.personal_sprints where user_id=${ctx.userId} and deleted_at is null
    ) select ref,title,href,facts,count(*) over()::int as total from records
      order by case when ref=any(${sql.param(priorityRefs)}::text[]) then 0 else 1 end,ref limit 1000`),
  )
  const snapshot: unknown[] = []
  const sources: AiChatSource[] = []
  let bytes = 0
  const categoryBytes = new Map<string, number>()
  const categoryLimits: Record<string, number> = {
    unit: 6000,
    person: 10000,
    project: 50000,
    card: 100000,
    event: 30000,
    event_logistics: 20000,
    carpool: 30000,
    event_item: 20000,
    poll: 40000,
    page: 120000,
    note: 80000,
    personal_task: 40000,
    personal_sprint: 20000,
    canvas: 30000,
  }
  const priority = new Set([
    ...priorityRefs,
    ...retrieved.map((hit) => `${hit.subject_type}:${hit.subject_id}`),
  ])
  const prioritized = (row: SnapshotRow) =>
    priority.has(row.ref) ||
    (typeof record(row.facts)?.['eventId'] === 'string' &&
      priority.has(`event:${record(row.facts)!['eventId']}`))
  const ordered = [...people, ...rows, ...personal, ...logistics].sort(
    (a, b) => Number(prioritized(b)) - Number(prioritized(a)),
  )
  let childSourcesLimited = false
  for (const row of ordered) {
    const item = { ref: row.ref, title: row.title, facts: row.facts }
    const length = Buffer.byteLength(JSON.stringify(item), 'utf8')
    const category = row.ref.split(':')[0]!
    if (
      bytes + length > 400_000 ||
      (categoryBytes.get(category) ?? 0) + length > (categoryLimits[category] ?? 4000)
    )
      continue
    bytes += length
    categoryBytes.set(category, (categoryBytes.get(category) ?? 0) + length)
    snapshot.push(item)
    sources.push({ ref: row.ref, title: row.title, href: row.href })
    const children = childSources(row)
    const remaining = Math.max(0, 5000 - sources.length)
    sources.push(...children.slice(0, remaining))
    if (children.length > remaining || record(row.facts)?.['limited'] === true)
      childSourcesLimited = true
  }
  const evidence = retrieved.map((hit) => {
    const ref = `${hit.subject_type}:${hit.subject_id}`
    const href =
      hit.subject_type === 'project'
        ? `/projects/view?id=${hit.subject_id}`
        : hit.subject_type === 'card'
          ? `/work/card?id=${hit.subject_id}`
          : hit.subject_type === 'page'
            ? `/pages?page=${hit.subject_id}`
            : hit.subject_type === 'event'
              ? `/events?event=${hit.subject_id}`
              : '/work/table'
    if (!sources.some((source) => source.ref === ref)) sources.push({ ref, title: hit.title, href })
    return { ref, title: hit.title, excerpt: hit.snippet.slice(0, 1500) }
  })
  const recordsTotal =
    (rows[0]?.total ?? 0) +
    (people[0]?.total ?? 0) +
    (personal[0]?.total ?? 0) +
    (logistics[0]?.total ?? 0)
  const files = await conversationFiles(ctx, conversationId, attachmentIds)
  sources.push(...files.sources)
  sources.push({
    ref: `department:${departmentId}`,
    title: 'Department totals',
    href: '/',
  })
  return {
    generatedAt: new Date().toISOString(),
    recordsTotal,
    recordsIncluded: snapshot.length,
    limited: recordsTotal > snapshot.length || files.limited || childSourcesLimited,
    snapshot,
    evidence: [...evidence, ...files.evidence],
    sources: [...new Map(sources.map((source) => [source.ref, source])).values()],
    totals: { ref: `department:${departmentId}`, ...(totals[0] as object) },
  }
}
