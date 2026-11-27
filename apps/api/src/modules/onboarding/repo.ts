import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { withContext, type RequestContext, type Tx } from '@devon/db'
import {
  onboardingFacts,
  onboardingKeys,
  type OnboardingDocument,
  type OnboardingSession,
} from '@devon/contracts'
import { createCardInTx } from '../work/repo.js'

type Run = NonNullable<OnboardingSession['run']>
const runSelect = sql`select department_id as "departmentId", card_id as "cardId", document_id as "documentId",
  html_done as "htmlDone", tour_step as "tourStep", tour_completed as "tourCompleted",
  paused, setup_completed as "setupCompleted" from app.portal_onboarding`

const taskCopy = {
  en: [
    'Get started with WorkPortal',
    'Read your department introduction, learn the portal, and complete your profile.',
    'Read the department introduction',
    'Learn the portal',
    'Connect Telegram',
    'Complete account details',
    'Complete your résumé',
    'Complete your personnel record',
  ],
  ru: [
    'Начните работу в WorkPortal',
    'Изучите материалы отдела и портал, затем заполните профиль.',
    'Изучить материалы отдела',
    'Познакомиться с порталом',
    'Подключить Telegram',
    'Заполнить данные аккаунта',
    'Заполнить резюме',
    'Заполнить справку-объективку',
  ],
  uzCyrl: [
    'WorkPortal билан ишни бошлаш',
    'Бошқарма материаллари ва портал билан танишинг, сўнг профилингизни тўлдиринг.',
    'Бошқарма материалларини ўқиш',
    'Портал билан танишиш',
    'Telegramни улаш',
    'Ҳисоб маълумотларини тўлдириш',
    'Резюмени тўлдириш',
    'Маълумотномани тўлдириш',
  ],
  uz: [
    'WorkPortal bilan ishni boshlash',
    'Boshqarma materiallari va portal bilan tanishing, soʻng profilingizni toʻldiring.',
    'Boshqarma materiallarini oʻqish',
    'Portal bilan tanishish',
    'Telegramni ulash',
    'Hisob maʼlumotlarini toʻldirish',
    'Rezyumeni toʻldirish',
    'Maʼlumotnomani toʻldirish',
  ],
} as const

async function factsInTx(tx: Tx, ctx: RequestContext) {
  const [row] = await tx.raw<Parameters<typeof onboardingFacts>[0]>(sql`
    select u.given_name as "givenName", u.family_name as "familyName", u.title,
      b.birth_date::text as "dateOfBirth", u.work_start_date::text as "workStartDate", u.professional_profile as professional, p.data as personnel,
      exists(select 1 from app.telegram_links t where t.user_id=u.id and t.unlinked_at is null and t.chat_id>0) as telegram
    from app.users u
    left join app.account_birthdays b on b.owner_user_id=u.id
    left join app.personnel_records p on p.owner_user_id=u.id and p.department_id=${ctx.departmentId}
    where u.id=${ctx.userId} and u.deleted_at is null`)
  return onboardingFacts(
    row ?? {
      telegram: false,
      givenName: '',
      familyName: '',
      title: null,
      dateOfBirth: null,
      professional: null,
      personnel: null,
    },
  )
}

/** Locks serialize first-join events, browser tabs and retries. The card and its receipt commit together. */
export async function session(
  ctx: RequestContext,
  update?: {
    htmlDone?: boolean | undefined
    completeSetup?: boolean | undefined
    tourStep?: number | undefined
    tourCompleted?: boolean | undefined
    paused?: boolean | undefined
  },
): Promise<OnboardingSession> {
  return withContext(ctx, async (tx) => {
    await tx.raw(
      sql`select pg_advisory_xact_lock(hashtextextended('onboarding:' || ${ctx.userId}::text,0))`,
    )
    const [user] = await tx.raw<{
      required: boolean
      locale: string
      role: string
    }>(sql`
      select onboarding_required as required, locale, role from app.users where id=${ctx.userId} and deleted_at is null`)
    const [membership] = await tx.raw<{
      role: 'head' | 'member'
    }>(sql`select role from app.memberships
      where user_id=${ctx.userId} and department_id=${ctx.departmentId} and status='active' and deleted_at is null for share`)
    const eligible = Boolean(membership && user && user.role !== 'super_admin' && !ctx.viewAs)
    if (!eligible)
      return {
        eligible: false,
        required: false,
        run: null,
        facts: {
          telegram: false,
          account: false,
          resume: false,
          personnel: false,
        },
      }
    let [run] = await tx.raw<Run>(sql`${runSelect} where user_id=${ctx.userId}`)
    // If the original department was left, a pending account resumes in its current active department.
    if (run && run.departmentId !== ctx.departmentId && user!.required) {
      const [previous] = await tx.raw(sql`select 1 from app.memberships where user_id=${ctx.userId}
        and department_id=${run.departmentId} and status='active' and deleted_at is null`)
      if (!previous) {
        await tx.raw(sql`delete from app.portal_onboarding where user_id=${ctx.userId}`)
        run = undefined
      }
    }
    if (!run && user!.required) {
      const [publication] = await tx.raw<{ documentId: string }>(
        sql`select document_id as "documentId" from app.onboarding_publications where department_id=${ctx.departmentId}`,
      )
      const copy =
        user!.locale === 'ru'
          ? taskCopy.ru
          : user!.locale === 'en'
            ? taskCopy.en
            : user!.locale === 'uz-Cyrl'
              ? taskCopy.uzCyrl
              : taskCopy.uz
      const card = await createCardInTx({ ...ctx, departmentRole: membership!.role }, tx, {
        departmentId: ctx.departmentId!,
        title: copy[0],
        description: copy[1],
        kind: 'task',
        assigneeUserId: ctx.userId,
        giverUserId: ctx.userId,
        priority: 'none',
        startAt: undefined,
        dueAt: undefined,
        labels: [],
        links: [],
        projectId: undefined,
        projectScope: undefined,
        orderKey: undefined,
        createdByUserId: ctx.userId!,
        source: 'template',
      })
      await tx.raw(sql`insert into app.portal_onboarding(user_id,department_id,card_id,document_id,html_done)
        values(${ctx.userId},${ctx.departmentId},${card.id},${publication?.documentId ?? null},${!publication})`)
      await tx.raw(sql`insert into app.card_checklist_items(id,department_id,card_id,text,assignee_user_id,order_key,onboarding_key)
        values ${sql.join(
          onboardingKeys.map(
            (key, i) =>
              sql`(${randomUUID()}::uuid,${ctx.departmentId}::uuid,${card.id}::uuid,${copy[i + 2]},${ctx.userId}::uuid,${`a${i}`},${key})`,
          ),
          sql`, `,
        )}`)
      tx.audit({
        action: 'onboarding.started',
        subjectType: 'card',
        subjectId: card.id,
        departmentId: ctx.departmentId,
      })
      ;[run] = await tx.raw<Run>(sql`${runSelect} where user_id=${ctx.userId}`)
    }
    const facts = await factsInTx(tx, ctx)
    if (!run || run.departmentId !== ctx.departmentId)
      return {
        eligible,
        required: Boolean(user!.required),
        facts,
        run: null,
        ...(run && user!.required ? { resumeDepartmentId: run.departmentId } : {}),
      }
    const htmlDone = run.htmlDone || update?.htmlDone === true
    const setupCompleted =
      run.setupCompleted ||
      (update?.completeSetup === true && htmlDone && Object.values(facts).every(Boolean))
    // A tour cannot be signed off through the API before the compulsory setup is complete.
    const tourCompleted = run.tourCompleted || (setupCompleted && update?.tourCompleted === true)
    if (update?.tourStep !== undefined && update.tourStep !== run.tourStep)
      tx.audit({
        action: 'onboarding.step_viewed',
        subjectType: 'user',
        subjectId: ctx.userId,
        before: { step: run.tourStep },
        after: { step: update.tourStep },
      })
    if (update?.paused !== undefined && update.paused !== run.paused)
      tx.audit({
        action: update.paused ? 'onboarding.guide_paused' : 'onboarding.guide_resumed',
        subjectType: 'user',
        subjectId: ctx.userId,
      })
    await tx.raw(sql`update app.portal_onboarding set html_done=${htmlDone}, setup_completed=${setupCompleted},
      tour_completed=${tourCompleted}, tour_step=${update?.tourStep ?? run.tourStep}, paused=${update?.paused ?? run.paused}, updated_at=now()
      where user_id=${ctx.userId}`)
    if (setupCompleted && user!.required) {
      await tx.raw(sql`update app.users set onboarding_required=false where id=${ctx.userId}`)
      tx.audit({
        action: 'onboarding.setup_completed',
        subjectType: 'user',
        subjectId: ctx.userId,
        departmentId: ctx.departmentId,
      })
    }
    if (update?.htmlDone && !run.htmlDone)
      tx.audit({
        action: 'onboarding.document_read',
        subjectType: 'onboarding_document',
        subjectId: run.documentId,
        departmentId: ctx.departmentId,
      })
    if (tourCompleted && !run.tourCompleted)
      tx.audit({
        action: 'onboarding.tour_completed',
        subjectType: 'user',
        subjectId: ctx.userId,
        departmentId: ctx.departmentId,
      })
    const done = { reading: htmlDone, tour: tourCompleted, ...facts }
    const changed =
      await tx.raw(sql`update app.card_checklist_items i set done_at=case when v.done then coalesce(i.done_at,now()) else null end,updated_at=now(),version=version+1
      from (values ${sql.join(
        onboardingKeys.map((key) => sql`(${key}::text,${done[key]}::boolean)`),
        sql`, `,
      )}) as v(key,done)
      where i.card_id=${run.cardId} and i.onboarding_key=v.key and (i.done_at is not null) is distinct from v.done returning i.id`)
    if (changed.length)
      tx.emit({
        type: 'work.checklist.updated',
        departmentId: ctx.departmentId,
        payload: { cardId: run.cardId, actorUserId: ctx.userId },
      })
    return {
      eligible,
      required: Boolean(user!.required && !setupCompleted),
      facts,
      run: {
        ...run,
        htmlDone,
        setupCompleted,
        tourCompleted,
        tourStep: update?.tourStep ?? run.tourStep,
        paused: update?.paused ?? run.paused,
      },
    }
  })
}

export async function documents(
  ctx: RequestContext,
  view: 'published' | 'mine' | 'review' = 'published',
) {
  return withContext(ctx, async (tx) => {
    const [publication] = await tx.raw<{ revision: number }>(
      sql`select revision from app.onboarding_publications where department_id=${ctx.departmentId}`,
    )
    const items =
      await tx.raw<OnboardingDocument>(sql`select d.id,d.title,d.filename,d.uploaded_by as "uploadedBy",
      concat_ws(' ',u.given_name,u.family_name) as "uploaderName", d.created_at::text as "createdAt",
      d.rejected_at is not null as rejected, coalesce(p.document_id=d.id,false) as published,
      (d.approved_at is not null and d.rejected_at is null and coalesce(p.document_id<>d.id,true)) as superseded
      from app.onboarding_documents d join app.users u on u.id=d.uploaded_by
      left join app.onboarding_publications p on p.department_id=d.department_id
      where d.department_id=${ctx.departmentId}
      and ${
        view === 'published'
          ? sql`p.document_id=d.id and d.rejected_at is null`
          : view === 'mine'
            ? sql`d.uploaded_by=${ctx.userId} and not app.is_view_as()`
            : sql`d.approved_at is null and d.rejected_at is null and not app.is_view_as()
          and exists(select 1 from app.memberships m where m.department_id=d.department_id and m.user_id=${ctx.userId}
            and m.role='head' and m.status='active' and m.deleted_at is null)`
      }
      order by d.created_at desc limit 100`)
    return { revision: publication?.revision ?? 0, items }
  })
}

export async function upload(
  ctx: RequestContext,
  input: { title: string; filename: string; html: string },
) {
  return withContext(ctx, async (tx) => {
    const id = randomUUID()
    await tx.raw(sql`insert into app.onboarding_documents(id,department_id,uploaded_by,title,filename,html)
      values(${id},${ctx.departmentId},${ctx.userId},${input.title},${input.filename},${input.html})`)
    tx.audit({
      action: 'onboarding.document_uploaded',
      subjectType: 'onboarding_document',
      subjectId: id,
      departmentId: ctx.departmentId,
      after: { title: input.title, bytes: Buffer.byteLength(input.html) },
    })
    return { id }
  })
}

export async function document(ctx: RequestContext, id: string) {
  return withContext(ctx, async (tx) => {
    const [row] = await tx.raw<{ title: string; html: string }>(
      sql`select d.title,d.html from app.onboarding_documents d
      where d.id=${id} and d.department_id=${ctx.departmentId} and (
        exists(select 1 from app.onboarding_publications p where p.department_id=d.department_id and p.document_id=d.id)
        or (not app.is_view_as() and d.uploaded_by=${ctx.userId})
        or (not app.is_view_as() and d.approved_at is null and d.rejected_at is null
          and exists(select 1 from app.memberships m where m.department_id=d.department_id and m.user_id=${ctx.userId}
            and m.role='head' and m.status='active' and m.deleted_at is null))
        or (not app.is_view_as() and d.approved_at is not null and d.rejected_at is null
          and exists(select 1 from app.portal_onboarding r where r.user_id=${ctx.userId} and r.document_id=d.id))
      )`,
    )
    return row
  })
}

export async function decide(
  ctx: RequestContext,
  id: string,
  input: { action: 'publish' | 'reject'; revision: number },
) {
  return withContext(ctx, async (tx) => {
    // Recheck the live membership under lock: a concurrent demotion cannot approve a publication.
    const [head] =
      await tx.raw(sql`select 1 from app.memberships where department_id=${ctx.departmentId} and user_id=${ctx.userId}
      and role='head' and status='active' and deleted_at is null for share`)
    if (!head || ctx.viewAs) return false
    await tx.raw(sql`select id from app.departments where id=${ctx.departmentId} for update`)
    const [published] = await tx.raw<{ revision: number; documentId: string }>(
      sql`select revision,document_id as "documentId" from app.onboarding_publications where department_id=${ctx.departmentId}`,
    )
    if ((published?.revision ?? 0) !== input.revision) return false
    const [doc] = await tx.raw(
      sql`select id from app.onboarding_documents where id=${id} and department_id=${ctx.departmentId} and rejected_at is null and approved_at is null for update`,
    )
    if (!doc || (input.action === 'reject' && published?.documentId === id)) return false
    if (input.action === 'publish') {
      await tx.raw(sql`update app.onboarding_documents set approved_at=now() where id=${id}`)
      await tx.raw(sql`insert into app.onboarding_publications(department_id,document_id,published_by)
        values(${ctx.departmentId},${id},${ctx.userId}) on conflict(department_id) do update
        set document_id=excluded.document_id,published_by=excluded.published_by,published_at=now(),revision=app.onboarding_publications.revision+1`)
    } else
      await tx.raw(
        sql`update app.onboarding_documents set rejected_at=now(),rejected_by=${ctx.userId} where id=${id}`,
      )
    tx.audit({
      action: `onboarding.document_${input.action === 'publish' ? 'published' : 'rejected'}`,
      subjectType: 'onboarding_document',
      subjectId: id,
      departmentId: ctx.departmentId,
      before: { documentId: published?.documentId ?? null },
      after: { documentId: id, action: input.action },
    })
    return true
  })
}
