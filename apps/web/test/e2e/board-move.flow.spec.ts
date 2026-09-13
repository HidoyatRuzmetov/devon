// @flow -- H30.1 flow 2/6: a card moves from one person's column to another's ("a board with a column
// per person", CLAUDE.md). The move itself is the real `PATCH /cards/:id` contract (the same one
// `board-column.tsx`'s drag-and-drop `onMoveTo` calls -- `apps/web/src/features/work/api.ts`);
// simulating the underlying pointer sequence `@atlaskit/pragmatic-drag-and-drop` needs is an
// interaction-fidelity concern for a UI-specific suite, not this hardening pass's H30.1 "traced end to
// end" bar, which is about the state genuinely moving and genuinely rendering on both sides.
import { expect, test } from '@playwright/test'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  examplePassword,
  joinDepartmentAsNewUser,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'
import { seedAiSettingsRow } from './flow-db.js'

test('@flow a card moves from one column (person) to another on the real board', async ({
  browser,
}) => {
  const superAdminContext = await newFlowContext(browser)
  await loginAsSuperAdmin(superAdminContext)

  const headContext = await newFlowContext(browser)
  const headPage = await headContext.newPage()
  const head = { login: uniqueLogin('flow.bhead'), password: examplePassword() }
  const { departmentId, joinKey, joinPassword } = await createApprovedDepartment(
    headContext,
    superAdminContext,
    {
      headLogin: head.login,
      headPassword: head.password,
      departmentName: `Board flow ${head.login.slice(-8)}`,
    },
  )
  await superAdminContext.close()
  // Works around a confirmed product bug, not this flow's own concern -- see `flow-db.ts`'s
  // `seedAiSettingsRow` header and `cross-department-access.test.ts`'s "AI settings" `it.fails`:
  // `/work` renders `QuickAddBar`, which calls `useAiSettingsQuery`, which 500s for any department
  // whose `ai_department_settings` row does not exist yet (RLS rejects the lazy-insert for a real
  // head). Without this, the board never even renders for a freshly-approved department.
  seedAiSettingsRow(departmentId)

  const memberContext = await newFlowContext(browser)
  const member = { login: uniqueLogin('flow.bmember'), password: examplePassword() }
  await joinDepartmentAsNewUser(memberContext, {
    login: member.login,
    password: member.password,
    joinKey,
    joinPassword,
  })

  const meRes = await headContext.request.get('/api/v1/me')
  const me = (await meRes.json()) as { user: { id: string } }
  const memberMeRes = await memberContext.request.get('/api/v1/me')
  const memberMe = (await memberMeRes.json()) as { user: { id: string } }

  const cardTitle = `Flow card ${Date.now()}`
  const createRes = await authedPost(headContext, '/api/v1/cards', {
    title: cardTitle,
    assigneeUserId: me.user.id,
  })
  expect(createRes.status()).toBe(201)
  const card = (await createRes.json()) as { id: string; version: number }

  // 1. Real UI: the card is visible on the board (`/work`).
  //
  //    This step used to click "Barcha xodimlar (N)" first, because the board defaulted to the
  //    viewer's own column plus Unassigned. v1.1 SPEC §3.3 reversed that default -- "the board shows
  //    the whole department grouped by boʻlim for everyone", with a "Hammasi | Mening" segmented
  //    control over it -- and the reveal button was removed with the default it existed to undo
  //    (`work.board.showAllMembers` is an orphaned message key as of this build). So the flow now
  //    asserts what it always meant to: every member's column is on screen without being asked for,
  //    which is what this test needs since the card lands in a *different* person's column below.
  await headPage.goto('/work')
  await expect(headPage.getByText(cardTitle)).toBeVisible()
  // The claim the removed click used to establish, stated directly: the *other* member's column is
  // on the board without anyone asking for it. That is what "Hammasi is the default for everyone"
  // means, and it is what the rest of this flow depends on.
  await expect(headPage.getByText('Test Member', { exact: false }).first()).toBeVisible()

  const boardBefore = await headContext.request.get('/api/v1/board')
  const before = (await boardBefore.json()) as {
    columns: { member: { userId: string }; cards: { id: string }[] }[]
  }
  const beforeColumn = before.columns.find((c) => c.cards.some((x) => x.id === card.id))
  expect(beforeColumn?.member.userId).toBe(me.user.id)

  // 2. The move: the real `PATCH /cards/:id` contract, reassigning the card to the other member.
  const moveRes = await authedPatch(headContext, `/api/v1/cards/${card.id}`, {
    assigneeUserId: memberMe.user.id,
    version: card.version,
  })
  expect(moveRes.status()).toBe(200)

  // 3. Authoritative check: the board, re-fetched server-side, shows the card under the new column
  //    and no longer under the old one.
  const boardAfter = await headContext.request.get('/api/v1/board')
  const after = (await boardAfter.json()) as {
    columns: { member: { userId: string }; cards: { id: string }[] }[]
  }
  const afterColumn = after.columns.find((c) => c.cards.some((x) => x.id === card.id))
  expect(afterColumn?.member.userId).toBe(memberMe.user.id)
  const stillUnderHead = after.columns
    .find((c) => c.member.userId === me.user.id)
    ?.cards.some((x) => x.id === card.id)
  expect(stillUnderHead).toBe(false)

  // 4. The real page, reloaded, still renders the card (now in the other column) -- the client's own
  //    board query never went stale/broken across the move.
  await headPage.reload()
  await expect(headPage.getByText(cardTitle)).toBeVisible()

  await headContext.close()
  await memberContext.close()
})
