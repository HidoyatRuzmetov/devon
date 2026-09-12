# v1.1 — Permissions audit: actual vs proposed (member / head / super admin)

Answers BRIEF.md finding 1 ("role leakage"). Read-only audit of `master` at commit `21f8d86`
(another agent is merging hardening branches concurrently; nothing here was edited).

Method:

- **Actual server matrix** — `packages/contracts/src/permissions.ts` (`can()`, the only decision
  function) plus every `config.permission` declaration in `apps/api/src` (216 route registrations,
  extracted mechanically), plus every in-handler / in-repo role assertion found by searching for
  `role === 'head'`, `isHead`, `actorRoleInDept` and `assert*`.
- **Actual client matrix** — `apps/web/src/shell/nav.ts`, all 14 `apps/web/src/features/*/manifest.ts(x)`,
  and every `isHead` / `myRole` / `role ===` / `canManage` site in `apps/web/src`.
- **Proposed matrix** — decided per feature from how a boshqarma actually runs, then reconciled with
  TECH-SPEC §2.3 and the v1.1 BRIEF.

---

## 0. Executive summary

**The server has no missing `can()` calls.** `apps/api/src/plugins/authorize.ts:96-113` throws at boot
for any route registered without `config.permission`, and `PUBLIC_ROUTES` (same file, lines 29-51) is
asserted equal to the actually-registered public set by `apps/api/test/unit/public-routes.test.ts`.
Exactly 11 routes are public and every one of them is justified (health, openapi, public instance
metadata, setup token, login, register, 2FA login-verify, join preview, HMAC-signed ICS feed,
Telegram webhook secret). **This is not a "forgot the check" problem.**

The problem is that **`can()` has no head-vs-member distinction below the department row itself.**
`{kind:'department_child'}` — which is what 168 of the 205 authenticated routes use — grants any
active member of the department *every* action: `read`, `create`, `update`, `archive`, `delete`
(`packages/contracts/src/permissions.ts:140-160`; only `{kind:'department'}` + `update`/`delete`
requires `role === 'head'`). Every head-only rule below the department row is therefore hand-rolled
inside a module (events and structure do it; work, projects, pages, analytics, ai and telegram-read
do not), which is exactly the drift I-7 exists to prevent.

Headline findings:

| # | Finding | Sev |
|---|---|---|
| D1 | The head's `allow_structure_edit` / `allow_self_assign` switches **do nothing** — key-casing mismatch between writer and reader. Members can always restructure the department. | **SEV1** |
| D2 | Department **AI budget, monthly spend and every colleague's AI run trace** (user id, feature, tokens, cost) are readable by any member. | **SEV1** |
| D3 | Department-wide **analytics incl. per-person open/overdue counts** and its CSV export are readable by any member. | **SEV1** |
| D4 | Any member may **delete any page**, restore any version, and create/edit/delete the head's **onboarding checklist templates**. | SEV2 |
| D5 | Any member may **create/edit any project**, set its owner to anyone, and edit milestones. | SEV2 |
| D6 | Any member may **edit / archive / restore / reassign any card**, including cards they neither gave nor own, and create department labels. | SEV2 |
| D7 | Any member may **create / rename / delete / reorder bo'limlar** (see D1: unconditionally). | SEV2 |
| D8 | Connected **Telegram groups are readable over the API by members** although the UI hides the card behind `isHead`. | SEV3 |
| D9 | `who_can_connect_telegram_group` is **stored, editable and never read** — a dead setting. | SEV3 |
| D10 | Department notification settings are readable by members (write is head-only). | SEV3 |
| D11 | The avatar-bytes route's subject is built from the *requester's* id, so the check is effectively "any signed-in user", not what it reads like. | SEV4 |
| D12 | `/departments/requests` and all seven `/admin/*` routes are registered in the client for every role; only the sidebar entry is gated, so a member who types the URL gets an error/blank instead of a no-permission state. | SEV4 |
| D13 | `buildActor` pins `actor.departmentId` to the first membership, so the department switcher is a client-side illusion for every `actor.departmentId`-scoped route. | SEV3 |

Of 15 sidebar entries, **2 carry a role gate** (`admin`, `department-requests`, both `super_admin`).
The remaining 13 — including `/structure`, `/analytics` and `/ai` — are identical for a xodim and a
boshliq. That is the CTO's observation, precisely.

---

## 1. Actual matrix — `can()` itself

`packages/contracts/src/permissions.ts`. Roles: `super_admin | head | member` (I-8b). Actions:
`read | create | update | archive | delete | administer`.

| Subject kind | Who passes | Notes |
|---|---|---|
| `public` | everyone, no session | 11 routes, allow-listed and tested |
| `instance` | `super_admin` **and** `viewAs === null` | all `/api/v1/admin/*`, department request approve/reject, account reset-password |
| `instance_exit_view_as` | `super_admin`, `viewAs` ignored | only `POST /admin/view-as/stop` |
| `audit` | `super_admin`, `viewAs === null` | **no route uses it** — reserved, fail-closed |
| `personal` | owner only (`ownerUserId === actor.userId`) | no head, no super admin, no view-as exception (I-1) |
| `own_account` | self only | |
| `department` | active membership; `update`/`delete` additionally require `membership.role === 'head'`; `super_admin` under a matching `viewAs` may `read` only | **the only head gate in the whole function** |
| `department_child` | **any** active membership, **any** action; `super_admin` under matching `viewAs` may `read` only | 168 routes |

Consequences worth stating plainly:

- `read` on `{kind:'department'}` is *not* head-only — only `update`/`delete` are. Several routes
  exploit this by declaring `action:'update'` on a GET purely to obtain a head check
  (`GET /departments/:id/invite`, `apps/api/src/modules/departments/index.ts:253`). It works, but the
  declared action is a lie and it is the only idiom available today.
- There is **no** subject kind meaning "a department-owned row only the head may touch". Every such
  rule lives in a module.
- `archive` is declared in the `Action` union and used by exactly one route
  (`POST /notifications/archive`); card archiving goes through `PATCH /cards/:id` with
  `status:'archived'`, i.e. under `update`.

---

## 2. Actual matrix — routes, by area

Prefixes from each module's `export const prefix`; everything mounts under `/api/v1`.
"Head?" = does anything actually require head. "Client hides?" = does `apps/web` hide the affordance.

### 2.1 accounts / auth / me — `apps/api/src/modules/{accounts,auth,me}/index.ts`

| Route | Permission | Head? | Verdict |
|---|---|---|---|
| `POST /accounts/register` | public | – | correct |
| `POST /auth/login`, `POST /accounts/2fa/login-verify` | public | – | correct |
| `POST /auth/logout` | `read own_account` | – | correct |
| `GET/PATCH /me` | `read/update own_account` | – | correct |
| `GET /accounts/sessions`, `POST /sessions/:id/revoke`, `POST /sessions/revoke-all` | `own_account` | – | correct |
| `GET /accounts/2fa`, `POST /2fa/totp/enroll|verify`, `POST /2fa/disable` | `update own_account` | – | correct |
| `POST /accounts/password/change` | `update own_account` | – | correct |
| `POST /accounts/:userId/reset-password` | `administer instance` | super admin | correct |
| `POST /accounts/delete`, `/delete/cancel`, `GET /delete/status` | `own_account` | – | correct |
| `POST /accounts/avatar/upload-url`, `POST /accounts/avatar`, `DELETE /accounts/avatar` | `update own_account` | – | correct |
| `GET /accounts/avatar/:userId/:uploadId/:size` | `read own_account(r.actor.userId)` | – | **D11** — subject ignores the path `:userId`, so this is "any authenticated user". Behaviour is right (avatars are team-visible); the declaration is misleading. |

### 2.2 departments — `apps/api/src/modules/departments/index.ts`

| Route | Permission | Head? | Client hides? |
|---|---|---|---|
| `POST /departments/requests`, `GET /requests/mine`, `GET /mine`, `POST /join` | `own_account` | – | – |
| `GET /departments/requests`, `POST /requests/:id/approve|reject` | `administer instance` | super admin | sidebar `visibleWhen: role === 'super_admin'` (`features/departments/manifest.ts:39`); the **route is still registered for everyone** (D12) |
| `GET /departments/join/:key` | public | – | – |
| `GET /departments/:id` | `read department_child` | no | – (returns settings + `myRole` + memberCount; **no** join key/password — checked `deptToView`, `index.ts:72-91`) |
| `GET /departments/:id/members` | `read department_child` | no | – (name/title/avatar/role/status only — no contact details) |
| `PATCH /:id/settings` | `update department` | **yes** | fields `disabled={!isHead}` (`department-detail-screen.tsx:128-158`) |
| `POST /:id/deletion-request` | `update department` | **yes** | Danger tab head-only (`:738`) |
| `GET /:id/invite`, `POST /:id/invite/rotate-key`, `rotate-password`, `password`, `PATCH /:id/invite/approval` | `update department` | **yes** | Invite tab head-only (`:736`), InviteBlock head-only (`departments-hub-screen.tsx:335`) |
| `POST /:id/members/:userId/remove`, `.../transfer-headship` | `update department` | **yes** | row menu `hasMenu = (isHead && !isMe) \|\| (isSuperAdmin && !isMe)` (`:387`) |
| `POST /:id/leave` | `delete department_child` | no | correct (self-service) |

**This module is the one that got it right.** Every head action uses `{kind:'department'}` + a
mutating action, and the client hides exactly those affordances.

### 2.3 structure (bo'limlar, unit roles, roster) — `apps/api/src/modules/structure/index.ts`

| Route | Permission | Extra check | Verdict |
|---|---|---|---|
| `GET /departments/:id/units`, `/unit-roles`, `/roster` | `read department_child` | none | fine (org chart is team knowledge) |
| `POST /units`, `PATCH /units/:unitId`, `POST /units/reorder`, `DELETE /units/:unitId`, `POST /units/:unitId/restore` | `create/update/delete department_child` | `assertCanEditStructure(role, settings)` — `repo.ts:144-155` | **D7 + D1** |
| `POST /unit-roles` (assign) | `create department_child` | head for others; self allowed iff `allowSelfAssign` — `repo.ts:495-507` | head gate for others is correct; the self gate is dead (D1) |
| `DELETE /unit-roles/:id` | `delete department_child` | head for others, self otherwise — `repo.ts:559-561` | correct |

**D1 (SEV1), the mechanism.** `apps/api/src/modules/departments/repo.ts:302-318` defines the settings
JSON with **camelCase** keys and `updateDepartmentSettings` (`:468-494`) persists
`{allowSelfAssign, allowStructureEdit, whoCanConnectTelegramGroup, quietHours}`.
`apps/api/src/modules/structure/repo.ts:78-83` reads it back as:

```ts
allowSelfAssign: settings['allow_self_assign'] !== false,
allowStructureEdit: settings['allow_structure_edit'] !== false,
```

Those snake_case keys are never written by anything (`packages/db/migrations/0004_departments.sql:28`
defaults the column to `'{}'`; nothing in `packages/db` writes them either), so both reads are
`undefined !== false` → **always `true`**. A head who switches "members may edit the structure" off
sees the UI update, the value persists, `GET /departments/:id` reports it off — and members keep
creating and deleting bo'limlar. The client is honest about the setting
(`structure-screen.tsx:221-262` computes `canEditStructure = isHead || settings.allowStructureEdit`)
which makes the mismatch invisible until you try it as a member.

### 2.4 work / cards — `apps/api/src/modules/work/index.ts`

Every one of the 19 routes is `{kind:'department_child'}` with **no role or ownership check
anywhere** in `index.ts` or `repo.ts`, except saved views.

| Route | Permission | Verdict |
|---|---|---|
| `GET /board`, `/cards`, `/cards/:id`, `/cards/:id/activity`, `/labels`, `/archive` | `read department_child` | correct — the team's board is the point |
| `POST /cards` | `create department_child` | correct per TECH-SPEC §2.3 (giver/assignee free choices) |
| `PATCH /cards/:id`, `POST /cards/:id/restore` | `update department_child` | **D6** — any member may retitle, reassign, re-prioritise, re-date, archive or restore **any** card |
| `POST/PATCH/DELETE /cards/:id/checklist[/:itemId]` | `update/delete department_child` | **D6** |
| `POST /cards/:id/comments` | `create department_child` | correct (no delete route exists) |
| `POST /cards/:id/watchers` | `update department_child` | **D6** — a member may add anyone as a watcher on anything |
| `POST /labels` | `create department_child` | **D6** — the department's label vocabulary is head-shaped |
| `GET/POST /views`, `DELETE /views/:id` | `department_child` | **correct**: `repo.listSavedViews` filters `shared = true or owner_user_id = $me` (`repo.ts:589-592`) and `deleteSavedView` filters by owner (`repo.ts:637`) |
| `POST /links/unfurl` | `read department_child` | correct |

Client: `apps/web/src/features/work/**` contains **zero** role checks.

### 2.5 projects — `apps/api/src/modules/projects/index.ts`

All 8 routes `{kind:'department_child'}`, **no owner or head check at all** (`repo.patchProject`,
`repo.addMilestone`, `repo.patchMilestone` take no actor role).

| Route | Permission | Verdict |
|---|---|---|
| `GET /projects`, `/projects/templates`, `/projects/:id` | `read department_child` | correct |
| `POST /projects`, `POST /projects/from-template` | `create department_child` | **D5** — and `ownerUserId` / `members` come straight from the body, so a member appoints anyone project owner |
| `PATCH /projects/:id`, `POST /:id/milestones`, `PATCH /:id/milestones/:milestoneId` | `update department_child` | **D5** |

Client: `apps/web/src/features/projects/**` has zero role checks.

### 2.6 events — `apps/api/src/modules/events/index.ts`

The **good pattern in the codebase.** The module computes `isHead` from the actor's membership
(`index.ts:73-78`), passes it into `service.ts`, and `assertCanManage` (`service.ts:49`) is
`organizer === actor || isHead`. Every DTO carries a server-computed `canManage`
(`service.ts:135,159,454,571,827`) that the client obeys (`event-detail-dialog.tsx:253`).

| Route group | Permission | Extra check |
|---|---|---|
| `GET /events`, `/:id`, `/:id/ics`, `/:id/rsvps`, `/comments`, `/carpools`, `/items`, `/polls`, `/photos`, `/feedback` | `read department_child` | – |
| `POST /events` | `create department_child` | – (any member may organise — correct) |
| `PATCH /events/:id`, `POST /:id/cancel` | `update department_child` | **organizer or head** ✓ |
| `DELETE /:id/comments/:commentId` | `delete department_child` | **author or head** (`service.ts:534`) ✓ |
| `DELETE /:id/photos/:photoId` | `delete department_child` | **owner or head** (`service.ts:984`) ✓ |
| carpools / items / polls / rsvp / feedback | member actions | `canManage` = creator or head ✓ |
| `GET /events/ics/me` | `read own_account` | ✓ |

### 2.7 personal workspace — `apps/api/src/modules/personal/index.ts`

All 24 routes `{kind:'personal', ownerUserId: actor.userId}`. `can()` grants `personal` to the owner
and nobody else — no head exception, no super-admin exception, no view-as exception
(`permissions.ts:128-133`). **Correct and airtight.** Same for `POST /ai/features/plan_sprint/run`
(`ai/index.ts:68-75`).

### 2.8 inbox / notifications / telegram

| Route | Permission | Verdict |
|---|---|---|
| `GET /notifications`, `read`, `read-all`, `archive`, `:id/snooze`, `prefs`, `quiet-hours`, `ics-token` | `personal` (owner) | correct |
| `GET /notifications/ics/:userId/:token` | public + HMAC token | correct |
| `GET /notifications/departments/:id/settings` | `read department_child` | **D10** — members read the department notification policy |
| `PUT /notifications/departments/:id/settings` | `update department` | head ✓ |
| `GET /telegram/status`, `POST /link-code`, `POST /unlink`, `POST /mute` | `personal` | correct |
| `GET /telegram/departments/:id/groups` | `read department_child` | **D8** — server open, client hides (`telegram-screen.tsx:426,434`) |
| `POST /telegram/departments/:id/connect-code`, `PATCH`/`DELETE .../groups/:groupId` | `update/delete department` | head — but **D9**: the `whoCanConnectTelegramGroup` setting (default `'everyone'`) is never read by this module, so the head's choice is inert and the behaviour is always the strict one |
| `POST /telegram/webhook/:secret` | public + path secret | correct |

### 2.9 analytics — `apps/api/src/modules/analytics/index.ts`

| Route | Permission | Verdict |
|---|---|---|
| `GET /analytics/summary` | `read department_child` | **D3** — returns `loadPerPerson[{userId, name, openCount, overdueCount}]`, `loadPerUnit`, `onTimeRate`, `throughput`, `projectProgress`, `eventsParticipation`, `pollTurnout` (`schemas.ts:95-110`) |
| `GET /analytics/export.csv` | `read department_child` | **D3** — the same data as a downloadable file |
| `GET /analytics/personal` | `read department_child` | correct (scoped to `actor.userId` in the repo) |
| saved filters (`GET/POST/PATCH/DELETE /saved-filters[/:id]`) | `department_child` | correct — owner-scoped in `repo.ts` |
| pins (`GET/POST/DELETE /pins[/:id]`, `POST /pins/reorder`) | `department_child` | correct — owner-scoped in `repo.ts` |

Note: the module header claims this is deliberate, citing TECH-SPEC §9 ("Analytics — for everyone in
the department"). It is faithful to the spec as written. §9 is what the CTO is asking to re-decide.

### 2.10 pages — `apps/api/src/modules/pages/index.ts`

All 12 routes `{kind:'department_child'}`, no author or head check anywhere.

| Route | Permission | Verdict |
|---|---|---|
| `GET /pages`, `/:id`, `/:id/versions`, `/:id/versions/:versionId` | `read department_child` | correct |
| `POST /pages`, `PATCH /pages/:id` | `create/update department_child` | correct (a wiki is collaborative) |
| `DELETE /pages/:id` | `delete department_child` | **D4** |
| `POST /pages/:id/versions/restore` | `update department_child` | **D4** — any member may roll back anyone's page |
| `GET/POST/PATCH/DELETE /pages/onboarding/templates[/:id]` | `department_child` | **D4** — the head's onboarding checklist is member-editable; the client panel (`features/pages/onboarding-templates.tsx`) shows Add/Save/Trash to everyone |

### 2.11 ai — `apps/api/src/modules/ai/index.ts`

| Route | Permission | Verdict |
|---|---|---|
| `GET /ai/settings` | `read department_child` | **D2** — returns `budgetUzsPerMonth`, `spentUzsThisMonth`, `usedPct`, `budgetStatus`, per-feature flags |
| `PATCH /ai/settings` | `update department` | head ✓ (and the client disables the switches + budget box for members, `ai-settings-screen.tsx:192,245`) |
| `GET /ai/usage` | `read department_child` | **D2** — `traces[{userId, feature, model, promptTokens, completionTokens, costUzs, latencyMs, status, createdAt}]` (`schemas.ts:78-98`): who ran what, how often, at what cost |
| `POST /ai/features/:feature/run` | `personal` for `plan_sprint`, else `create department_child` | correct |

### 2.12 admin — `apps/api/src/modules/admin/index.ts`

All 28 routes `{action:'administer', subject:{kind:'instance'}}`, plus `POST /admin/view-as/stop` on
`instance_exit_view_as`. Scoped 404 handler re-uses `denyForSubject` so a matched and an unmatched
`/api/v1/admin/*` path return byte-identical 403s. Client: sidebar `visibleWhen role === 'super_admin'`
(`shell/nav.ts:12-16`), plus `admin-screen.tsx:18,33` re-checks. **Correct.** Only D12 applies.

---

## 3. Actual matrix — UI surfaces

### 3.1 Sidebar (`apps/web/src/shell/nav.ts` + feature manifests)

| Entry | Route | Gate today | Server enforces? |
|---|---|---|---|
| Home | `/` | none | n/a |
| Inbox | `/inbox` | none | yes (personal) |
| Vazifalar | `/work` | `hasDepartment` only | membership only |
| Loyihalar | `/projects` | `hasDepartment` only | membership only |
| Shaxsiy | `/personal` | `hasDepartment` only | **yes, owner-only** |
| Tadbirlar | `/events` | `hasDepartment` only | membership + organizer/head per action |
| Xodimlar | `/people` | `hasDepartment` only | membership only |
| Tuzilma | `/structure` | `hasDepartment` only | membership + a dead setting (D1) |
| Sahifalar | `/pages` | `hasDepartment` only | membership only |
| Tahlil | `/analytics` | `hasDepartment` only | membership only (D3) |
| AI | `/ai` | `hasDepartment` only | membership for read (D2), head for write |
| Bo'limlar | `/departments` | none | per-route |
| So'rovlar | `/departments/requests` | **`role === 'super_admin'`** | yes |
| Hisob | `/account` | none | own_account |
| Boshqaruv | `/admin` | **`role === 'super_admin'`** | yes |

`navCtx.role` is `me.user.role` — the **instance** role (`app-shell.tsx:105,111`). The per-department
authority is `membership.role`, available as `useDepartment().department.role`. Any new head gate in
the nav must use the latter; `NavContext` (`packages/ui/src/shell/nav-registry.ts:18-27`) currently
has no field for it.

### 3.2 Non-sidebar routes

`/department` (Sozlamalar: tabs General / Invite / Members / Danger), `/departments/new`, `/join`,
`/work/{table,timeline,calendar,mine,archive,card}`, `/projects/view`, `/inbox/preferences`,
`/inbox/telegram`, `/register`, `/login`, `/setup`, `/admin/{departments,accounts,analytics,audit,health,settings}`.

### 3.3 Every in-screen role gate that exists today

| File:line | Gate | Server-enforced? |
|---|---|---|
| `features/departments/department-detail-screen.tsx:711,736,738` | Invite + Danger tabs head-only | ✓ |
| `…:128,138,153,158` | settings fields `disabled={!isHead}` | ✓ |
| `…:387,414` | member row menu (remove / transfer) head or super admin | ✓ |
| `features/departments/departments-hub-screen.tsx:335` | InviteBlock head-only | ✓ |
| `features/ai/ai-settings-screen.tsx:192` | budget editor head-only | ✓ |
| `…:245,251` | feature flag switches disabled + "head only" note | ✓ |
| `features/inbox/telegram-screen.tsx:426,434` | GroupsCard head-only | ✗ **D8** (GET is open) |
| `features/structure/structure-screen.tsx:221,224,260,261` | `canEditStructure = isHead \|\| settings.allowStructureEdit` | ✗ **D1** (setting is dead) |
| `features/admin/admin-screen.tsx:18,33` | whole console super-admin-only | ✓ |
| `features/admin/view-as-banner.tsx:26` | banner super-admin-only | ✓ |
| `features/departments/manifest.ts:39` | So'rovlar sidebar entry super-admin-only | ✓ (route not gated — D12) |
| `shell/nav.ts:12-16` | Boshqaruv sidebar entry super-admin-only | ✓ |
| events DTO `canManage` (`features/events/schemas.ts:69,116,148`) | per-object, server-computed | ✓ |

Screens with **no** role gating whatsoever: work (7 routes), projects (2), pages (1 + onboarding
panel), analytics (1), people, home, inbox.

---

## 4. PROPOSED matrix

Legend: **allow** · **own-only** (your own rows / rows you gave or were assigned) · **deny**.
Rationale is the department-reality test: a xodim runs their own work and can see the team's board; a
boshqarma boshlig'i runs people, structure, assignments, settings, analytics-for-everyone, custom
fields and invitations; a super admin runs the instance.

### 4.1 Accounts

| Feature | member | head | super admin | Rationale |
|---|---|---|---|---|
| Register / login / logout | allow | allow | allow | anyone may join the platform |
| View & edit own profile, locale, photo, title | own-only | own-only | own-only | a profile is the person's own |
| Own sessions, 2FA, password | own-only | own-only | own-only | credentials are never another person's business |
| Delete own account | own-only | own-only | own-only | self-service, 30-day soft delete |
| See another member's name/photo/title/unit role | allow | allow | allow (view-as) | a colleague directory is what a department is |
| See another member's **stats page** (cards, workload, on-time, focus minutes) | deny | allow | deny (read-only via view-as) | BRIEF: person page is head-only; members see only their own |
| Reset another user's password, lock/unlock, force-2FA-reset, anonymise | deny | deny | allow | instance-level identity administration |

### 4.2 Departments

| Feature | member | head | super admin | Rationale |
|---|---|---|---|---|
| Request a new department | allow | allow | allow | any account may propose one |
| Approve / reject a request | deny | deny | allow | the instance owner decides who gets a workspace |
| Read department profile (name, emoji, member count, my role) | allow | allow | allow (view-as) | basic orientation |
| Read department **settings values** | allow | allow | allow | members must know whether self-assign is on; it explains what they can do |
| Change settings (self-assign, structure edit, join approval, telegram policy, quiet hours, locale, colours) | deny | allow | deny | settings are the head's instrument of governance |
| Invite sheet: join key, join password, QR, rotate | deny | allow | deny | the key admits people to the department; it is the head's signature |
| Member list | allow | allow | allow (view-as) | – |
| Remove a member, transfer headship | deny | allow | deny | staffing is the head's |
| Leave the department | own-only | own-only | n/a | anyone may leave; a head must transfer first |
| Request department deletion | deny | allow | n/a | – |
| Pause / archive / restore / delete a department | deny | deny | allow | instance-level |

### 4.3 Structure (bo'limlar, unit roles, org chart)

| Feature | member | head | super admin | Rationale |
|---|---|---|---|---|
| View units, unit roles, roster, org chart | allow | allow | allow (view-as) | knowing who sits where is everyday knowledge |
| Create / rename / recolour / reorder a bo'lim | deny *(allow iff `allow_structure_edit`)* | allow | deny | the org chart is the department's constitution; the switch stays, but it must actually work, and default should flip to **off** |
| **Delete / archive a bo'lim** | **deny (always)** | allow | deny | deleting a unit rewrites everyone's home; no setting should open this |
| Assign **self** to a unit / unit role | own-only *(iff `allow_self_assign`)* | allow | deny | self-service is convenient, and the switch must work |
| Assign **another person** to a unit / unit role | deny | allow | deny | already correct in code |
| Remove **own** unit role | own-only | allow | deny | already correct |

### 4.4 Work / cards

| Feature | member | head | super admin | Rationale |
|---|---|---|---|---|
| See the board, table, timeline, calendar, archive for the whole department | allow | allow | allow (view-as) | the column-per-person board is the product; transparency is the point |
| Create a card, choose assignee and giver | allow | allow | deny | TECH-SPEC §2.3; a xodim assigning a colleague a task is normal ministry life |
| Edit title/description/dates/priority/labels of a card | own-only *(giver, assignee or creator)* | allow | deny | **change from today** — rewriting a colleague's task you have nothing to do with is the leak the CTO felt |
| Reassign a card to a different person | own-only *(giver or creator)* | allow | deny | the person who gave the work decides who does it |
| Move a card's status / drag on the board | own-only *(assignee, giver, creator)* | allow | deny | – |
| Archive / restore a card | own-only *(giver or creator)* | allow | deny | archiving hides work from the board |
| Checklist items on a card | own-only *(assignee, giver, creator)* | allow | deny | – |
| Comment on any card | allow | allow | deny | discussion stays open |
| Add a watcher to a card | own-only *(self, always; others only on own cards)* | allow | deny | "watch" is a subscription, not a lever on someone else |
| Create / edit / delete **labels** | deny | allow | deny | a shared vocabulary is a head decision |
| Saved views (personal / shared) | own-only | own-only + allow to share | deny | already correct in code |

### 4.5 Projects

| Feature | member | head | super admin | Rationale |
|---|---|---|---|---|
| See all department projects and their progress | allow | allow | allow (view-as) | – |
| Create a project | allow | allow | deny | a xodim may start a piece of work |
| Set / change the project **owner** | own-only *(owner only if creating and owner = self)* | allow | deny | appointing someone to lead is a management act |
| Edit a project (title, status, dates, description, colour) | own-only *(project owner or member of the project)* | allow | deny | **change from today** |
| Add / edit milestones | own-only *(project owner)* | allow | deny | **change from today** |
| Add / remove project members | own-only *(project owner)* | allow | deny | – |
| Archive / delete a project | deny | allow | deny | – |
| Project templates | allow (use) | allow (use + manage) | deny | – |

### 4.6 Events, carpooling, polls

| Feature | member | head | super admin | Rationale |
|---|---|---|---|---|
| See events, RSVPs, comments, items, polls, photos | allow | allow | allow (view-as) | – |
| Create an event | allow | allow | deny | anyone may organise a subbotnik or a seminar |
| Edit / cancel an event | own-only *(organizer)* | allow | deny | **already correct** |
| RSVP, claim an item, offer/claim a carpool seat, vote, add a photo, leave feedback | allow | allow | deny | – |
| Delete a comment / photo / carpool / poll | own-only *(author)* | allow | deny | **already correct** |
| See who has not RSVP'd (chase list) | allow | allow | deny | RSVP state is already visible to everyone; no change |

### 4.7 Personal workspace (sprints, tasks, notes, canvas, Pomodoro)

| Feature | member | head | super admin | Rationale |
|---|---|---|---|---|
| Everything | own-only | own-only | **deny** | I-1. A private workspace with a head exception is not a private workspace. **Already correct — keep it exactly as is, including the absence of a super-admin escape hatch.** |
| Aggregate focus minutes / sprint completion appearing on the head's person page | n/a | allow *(aggregate only, never content)* | deny | the head may see "4 h focused this week", never the note text |

### 4.8 Inbox / notifications / Telegram

| Feature | member | head | super admin | Rationale |
|---|---|---|---|---|
| Own inbox, read/snooze/archive, preferences, quiet hours, ICS token | own-only | own-only | own-only | – |
| Link / unlink own Telegram, mute | own-only | own-only | own-only | – |
| **Read** department notification settings | allow *(read-only, so people understand the rules)* | allow | deny | keep, but make read explicit rather than incidental |
| **Change** department notification settings / quiet hours | deny | allow | deny | already correct |
| See connected Telegram **groups** | deny | allow | deny | a group chat id is an operational credential — **server must match the UI (D8)** |
| Connect / rename / disconnect a Telegram group | deny *(allow iff `who_can_connect_telegram_group === 'everyone'`)* | allow | deny | honour the setting (D9), default `everyone` per TECH-SPEC §2.3 |
| Broadcast to the department group | deny | allow | deny | – |

### 4.9 Analytics

The decision the CTO asked for. A ministry department head needs comparative load and on-time data to
run the team. A xodim needs their own numbers and the team's shape, not a ranking of colleagues.

| Feature | member | head | super admin | Rationale |
|---|---|---|---|---|
| Own numbers: my throughput, my on-time rate, my open/overdue, my focus minutes | own-only | own-only | deny | – |
| Department **aggregates** with no person axis: total throughput, department on-time rate, open-vs-overdue trend, project progress, event participation, poll turnout | allow | allow | allow (view-as) | shared goals need shared scoreboards; nobody is singled out |
| **Load per person** (`loadPerPerson`: who has how many open / overdue) | deny | allow | deny | **SEV1 change** — this is a performance comparison; in a ministry it reads as a public reprimand |
| Load per **unit** (bo'lim) | allow | allow | allow (view-as) | a unit is a team, not a person |
| Cycle time, overdue ranking by person | deny | allow | deny | same reasoning as load-per-person |
| CSV / PNG export of a chart | own-only *(only charts they may see)* | allow | allow | export must inherit the chart's own gate |
| Saved filters, pinned charts | own-only (+ shared) | own-only (+ shared) | deny | already correct |
| **Department health narrative** (AI) | deny | allow | deny | TECH-SPEC §8 already calls it "for the head" |

### 4.10 Pages (wiki, onboarding)

| Feature | member | head | super admin | Rationale |
|---|---|---|---|---|
| Read any page, read version history | allow | allow | allow (view-as) | a department wiki is for the department |
| Create a page, edit any page | allow | allow | deny | wikis work because editing is open; version history is the safety net |
| **Delete** a page | own-only *(author)* | allow | deny | deletion is not editing |
| **Restore** an older version | own-only *(author)* | allow | deny | rolling back someone's work is a management act |
| Onboarding checklist templates (create / edit / delete / enable) | deny | allow | deny | onboarding is how the head introduces a newcomer to the department |
| Complete **own** onboarding checklist items | own-only | own-only | deny | – |

### 4.11 AI

| Feature | member | head | super admin | Rationale |
|---|---|---|---|---|
| Run an enabled AI feature on department content | allow | allow | deny | the tools are for working |
| Run `plan_sprint` (personal workspace) | own-only | own-only | deny | already correct (I-1) |
| See **which features are enabled** | allow | allow | deny | you must know what you can use |
| See **budget, monthly spend, % used, budget status** | deny | allow | deny | **SEV1 change** — a money figure for the department is the head's |
| Change budget, toggle feature flags | deny | allow | deny | already correct |
| See usage traces (**own** runs: feature, tokens, cost, status) | own-only | own-only | deny | useful self-awareness |
| See usage traces of **everyone** | deny | allow | deny | **SEV1 change** — who asked the AI what, how often, is surveillance-grade |
| Department health narrative / summaries about people | deny | allow | deny | – |

### 4.12 Admin (instance)

| Feature | member | head | super admin | Rationale |
|---|---|---|---|---|
| Everything under `/admin` (requests, departments, accounts, global analytics, audit, health, maintenance, registration, sentinel, wipe) | deny | deny | allow | already correct |
| View-as a department | deny | deny | allow, **read-only** | already correct (`read_only_view_as`) |
| See a department's personal-workspace rows while viewing-as | deny | deny | **deny** | already correct and must stay (I-1) |

### 4.13 New v1.1 surfaces (decide now, before they are built)

| Feature (BRIEF) | member | head | super admin | Rationale |
|---|---|---|---|---|
| Person page (profile, cards, workload, on-time, focus minutes, events, onboarding, activity) | own-only *(their own page)* | allow | deny | BRIEF states head-only explicitly |
| People table with dynamic indicator columns | deny *(members see a plain directory: name, bo'lim, unit role)* | allow | deny | a column of everyone's overdue count is a management view |
| Choose which indicator columns to show | deny | allow | deny | – |
| Create a **custom field** (typed) | deny | allow | deny | fields are department metadata |
| "Notify to fill" broadcast | deny | allow | deny | it messages every member individually |
| Fill in **own** custom field values | own-only | own-only | deny | – |
| See another person's custom field values | deny | allow | deny | "where they studied" is HR-shaped data |
| Assign a task from a people-table row | own-only *(may still create a card for a colleague)* | allow | deny | consistent with 4.4 |

---

## 5. Differences: actual vs proposed, with severity

SEV1 = head-only data or a head-only control reachable by a member. SEV2 = a member can alter or
destroy department-wide state that only a head (or the owner) should. SEV3 = the check is weaker than
the UI implies, or a head control is inert. SEV4 = client-only inconsistency, server already correct.

| ID | Area | Actual | Proposed | Sev | Where |
|---|---|---|---|---|---|
| D1 | structure | `allow_structure_edit` / `allow_self_assign` never take effect; members always may restructure | setting honoured; default flips to off for structure edit; unit **delete** head-only regardless | **SEV1** | `apps/api/src/modules/structure/repo.ts:78-83` vs `apps/api/src/modules/departments/repo.ts:302-318,468-494`; `packages/db/migrations/0004_departments.sql:28` |
| D2a | ai | members read `budgetUzsPerMonth`, `spentUzsThisMonth`, `usedPct` | head-only | **SEV1** | `apps/api/src/modules/ai/index.ts:78`; `service.getSettingsWithUsage` |
| D2b | ai | members read every colleague's AI traces | own traces only; head sees all | **SEV1** | `apps/api/src/modules/ai/index.ts:102`; `service.listUsage` |
| D3a | analytics | members read `loadPerPerson` (per-colleague open/overdue) | head-only | **SEV1** | `apps/api/src/modules/analytics/index.ts:113`; `repo.getSummary`; `schemas.ts:104` |
| D3b | analytics | members export the same data as CSV | export inherits the chart's gate | **SEV1** | `apps/api/src/modules/analytics/index.ts:146` |
| D4a | pages | any member deletes any page | author or head | SEV2 | `apps/api/src/modules/pages/index.ts:175` |
| D4b | pages | any member restores any version | author or head | SEV2 | `apps/api/src/modules/pages/index.ts:226` |
| D4c | pages | any member CRUDs onboarding templates | head-only | SEV2 | `apps/api/src/modules/pages/index.ts:253,265,286,310` + `features/pages/onboarding-templates.tsx` |
| D5a | projects | any member edits any project | project owner or head | SEV2 | `apps/api/src/modules/projects/index.ts:171` |
| D5b | projects | any member sets `ownerUserId` to anyone | owner = self on create; head may reassign | SEV2 | `apps/api/src/modules/projects/index.ts:84,122` |
| D5c | projects | any member adds/edits milestones | project owner or head | SEV2 | `apps/api/src/modules/projects/index.ts:203,232` |
| D6a | work | any member edits/reassigns/re-dates any card | giver, assignee, creator, or head | SEV2 | `apps/api/src/modules/work/index.ts:224` |
| D6b | work | any member archives/restores any card | giver, creator, or head | SEV2 | `apps/api/src/modules/work/index.ts:224 (status), :264` |
| D6c | work | any member edits any card's checklist | assignee, giver, creator, or head | SEV2 | `apps/api/src/modules/work/index.ts:289,317,346` |
| D6d | work | any member creates department labels | head-only | SEV2 | `apps/api/src/modules/work/index.ts:433` |
| D6e | work | any member adds any watcher to any card | self always; others on own cards; head anywhere | SEV3 | `apps/api/src/modules/work/index.ts:579` |
| D7 | structure | member creates/renames/deletes/reorders bo'limlar (unconditionally, via D1) | per 4.3 | SEV2 | `apps/api/src/modules/structure/index.ts:100,130,159,186,210` |
| D8 | telegram | `GET …/groups` open to members; UI hides it | head-only server-side | SEV3 | `apps/api/src/modules/telegram/index.ts:133` vs `features/inbox/telegram-screen.tsx:426` |
| D9 | telegram | `who_can_connect_telegram_group` never read | honoured; `'everyone'` really means everyone | SEV3 | setting written at `departments/repo.ts:480`, no reader in `modules/telegram/**` |
| D10 | notifications | department settings readable by members incidentally | keep readable, but declare it | SEV3 | `apps/api/src/modules/notifications/index.ts:325` |
| D11 | accounts | avatar route's subject ignores path `:userId` | explicit "any authenticated member" subject | SEV4 | `apps/api/src/modules/accounts/index.ts:452` |
| D12 | shell | `/departments/requests` and `/admin/*` routes registered for every role | route-level gate + a real no-permission state | SEV4 | `features/departments/manifest.ts`, `features/admin/manifest.ts`, `apps/web/src/app.tsx` |
| D13 | shell/api | `actor.departmentId` = first membership; switcher ignored server-side | resolve the active department per request | SEV3 | `apps/api/src/lib/actor.ts:28`; consumed by work/projects/analytics/ai/pages/events |
| D14 | nav | 13 of 15 sidebar entries have no role gate | `/structure` and `/ai` (and the new people-table / person-page routes) gate on the **department** role | SEV2 | `apps/web/src/shell/nav.ts`, feature manifests |
| D15 | contracts | no subject kind expresses "department row, head only" | add one; remove hand-rolled checks | SEV2 (structural) | `packages/contracts/src/permissions.ts:43-57,140-160` |

Nothing in this audit is a *missing* `can()` call, and nothing crosses a department boundary. The
personal workspace is airtight. The department module and the events module are already correct and
should be the templates for everything else.

---

## 6. Code changes required — server first, client second

### Step 1 — extend `can()` (do this before anything else)

`packages/contracts/src/permissions.ts`

1. Add to `Subject`:
   ```ts
   | { kind: 'department_managed'; departmentId: string }   // head-only department row
   ```
   and handle it in `can()`'s switch next to `department`/`department_child`: allowed iff a matching
   membership has `role === 'head'`; `super_admin` with a matching `viewAs` may `read` only, every
   other action denies `read_only_view_as`; otherwise `not_head` / `not_a_member`. `DenyReason`
   already has `'not_head'`.
2. Add to `Actor`/`can()` nothing else — ownership ("giver, assignee or creator") stays a repository
   predicate, because `can()` must not query.
3. `apps/api/test/unit/permissions.test.ts` — one assertion per new rule (member denies, head allows,
   non-member denies, super-admin read under matching `viewAs`, super-admin write denies).

`apps/api/src/plugins/authorize.ts`

4. In the `onRoute` hook (line 96), also push routes whose subject kind is `department_managed` into a
   new `app.headOnlyRoutes`, and add `apps/api/test/unit/head-only-routes.test.ts` holding a checked-in
   allow-list — the same "a change here is a visible diff" mechanism `PUBLIC_ROUTES` already gives.

### Step 2 — fix the dead settings (D1, D9)

- `apps/api/src/modules/structure/repo.ts:78-83` — `readSettings` must read `allowSelfAssign` /
  `allowStructureEdit` (camelCase, matching the writer), keeping the snake_case names as a fallback.
  Add a unit test that writes through `departments/repo.updateDepartmentSettings` and reads through
  `structure/repo.readSettings`.
- Same file, `assertCanEditStructure` (`:144-155`) — change the default: `allowStructureEdit` should
  default to **false** when the key is absent (TECH-SPEC §2.3 says default-on; the CTO's finding
  overrides it — record the decision in TECH-SPEC §19).
- `apps/api/src/modules/structure/index.ts:186` (`DELETE …/units/:unitId`) and `:210` (restore) —
  subject becomes `department_managed`, so no setting can open unit deletion.
- `apps/api/src/modules/telegram/repo.ts` — add `assertCanConnectGroup(settings, actorRoleInDept)`
  mirroring `assertCanEditStructure`, and call it from `POST /telegram/departments/:id/connect-code`
  (`apps/api/src/modules/telegram/index.ts:165`), whose subject relaxes to `department_child` so the
  setting — not `can()` — decides. `PATCH`/`DELETE` on a group stay `department`.

### Step 3 — move head-only reads and writes onto `department_managed`

Pure subject swaps, no handler logic:

| File:line | Route | New subject |
|---|---|---|
| `apps/api/src/modules/telegram/index.ts:133` | `GET /telegram/departments/:id/groups` | `read department_managed` (D8) |
| `apps/api/src/modules/pages/index.ts:253,265,286,310` | onboarding templates (all four) | `department_managed` (D4c) |
| `apps/api/src/modules/work/index.ts:433` | `POST /labels` | `create department_managed` (D6d) |
| `apps/api/src/modules/structure/index.ts:186,210` | unit delete / restore | `department_managed` (D7) |

### Step 4 — split head-shaped payloads (D2, D3)

- `apps/api/src/modules/ai/service.ts` — `getSettingsWithUsage(ctx, departmentId, isHead)`: omit
  `budgetUzsPerMonth`, `spentUzsThisMonth`, `usedPct`, `budgetStatus` for a member. Make them
  `.optional()` in `apps/api/src/modules/ai/schemas.ts` (`aiSettingsSchema`) and in
  `apps/web/src/features/ai/api.ts`. Compute `isHead` the way `events/index.ts:73-78` does — lift that
  helper into `apps/api/src/lib/actor.ts` as `isHeadOf(req, departmentId)` and use it everywhere.
- `apps/api/src/modules/ai/service.ts` — `listUsage(ctx, departmentId, limit, { onlyUserId })`: pass
  `req.actor.userId` for a member, `undefined` for a head; filter in `apps/api/src/modules/ai/repo.ts`.
- `apps/api/src/modules/analytics/repo.ts` — `getSummary(departmentId, userId, ctx, query, viewerRole)`:
  for a member, return `loadPerPerson` containing the viewer's own row only (keeps the chart rendering
  with an honest "you" bar rather than an empty state), and keep `loadPerUnit` intact.
  `apps/api/src/modules/analytics/schemas.ts` needs no change.
- `apps/api/src/modules/analytics/index.ts:146` — `GET /export.csv` must reject
  `chart=load_per_person` (and any other head-only chart key) for a member with `forbidden`; the chart
  key allow-list belongs next to `summaryChartToCsv` in `apps/api/src/modules/analytics/csv.ts`.

### Step 5 — ownership predicates (D4a/b, D5, D6)

Model all of these on `apps/api/src/modules/events/service.ts:49` (`assertCanManage`) and its
`canManage` DTO field — the pattern already proven in this codebase.

- `apps/api/src/modules/work/repo.ts` — add
  `canEditCard(card, actorUserId, isHead): boolean` = `isHead || card.createdByUserId === a ||
  card.giverUserId === a || card.assigneeUserId === a`, and an `assertCanEditCard` that throws a
  `WorkForbiddenError` (add `apps/api/src/modules/work/errors.ts`, mirroring
  `apps/api/src/modules/structure/errors.ts`). Call it at the top of `patchCard`, `restoreCard`,
  `addChecklistItem`, `patchChecklistItem`, `deleteChecklistItem`, `addWatcher`. Each route in
  `apps/api/src/modules/work/index.ts` (lines 224, 264, 289, 317, 346, 579) passes
  `isHeadOf(req, departmentId)` through the existing `contextFromRequest(req)` context object
  (`apps/api/src/modules/work/context.ts`) so no signature churn reaches the handlers.
- Add `canEdit: boolean` to `cardDetailSchema` / the board and list DTOs
  (`apps/api/src/modules/work/schemas.ts`) so the client never guesses.
- `apps/api/src/modules/projects/repo.ts` — `assertCanManageProject(tx, project, actorUserId, isHead)`
  = `isHead || project.ownerUserId === a`. Call from `patchProject`, `addMilestone`, `patchMilestone`.
  In `createProject` / `createFromTemplate`, force `ownerUserId = actor.userId` unless `isHead`.
  Add `canManage` to `projectSchema`.
- `apps/api/src/modules/pages/repo.ts` — `assertCanDeletePage` / `assertCanRestoreVersion` =
  `isHead || page.createdByUserId === a`. Call from `deletePage` and `restoreVersion`
  (`apps/api/src/modules/pages/index.ts:175,226`). Add `canDelete` to `pageSchema`.

### Step 6 — the two declaration cleanups (D10, D11)

- `apps/api/src/modules/notifications/index.ts:325` — keep member-readable, but add a comment saying so
  deliberately (it is now an audited decision, not an accident).
- `apps/api/src/modules/accounts/index.ts:452` — either add
  `| { kind: 'authenticated' }` to `Subject` (allowed for any non-null actor) and use it, or scope the
  subject to `{kind:'department_child', departmentId: <the avatar owner's department>}`. The first is
  honest and cheaper; the second is stricter. Recommend the first plus a one-line comment.

### Step 7 — the active-department fix (D13)

`apps/api/src/lib/actor.ts:28` and `apps/api/src/plugins/session.ts` — read the active department from
the existing `ACTIVE_DEPARTMENT_STORAGE_KEY` equivalent on the server (a cookie or an
`x-devon-department` header validated against `actor.memberships`), falling back to the first
membership. Without this, every head-vs-member decision for a multi-department user is made against
the wrong department. Not itself a leak, but it makes the rest of this matrix unverifiable.

### Step 8 — client, after the server is green

1. `packages/ui/src/shell/nav-registry.ts` — add `departmentRole?: 'head' | 'member'` to `NavContext`
   (do **not** overload `ctx.role`, which is the instance role).
2. `apps/web/src/shell/app-shell.tsx:111` — populate it from `useDepartment().department?.role`.
3. `apps/web/src/features/structure/manifest.tsx:19` and `apps/web/src/features/ai/manifest.ts` —
   `visibleWhen: (ctx) => ctx.role === 'super_admin' || ctx.departmentRole === 'head'` for the
   Tuzilma-edit surface and the AI console. (Keep a read-only org chart reachable from `/people` for
   members — the chart itself is not head-only, only the editing is; simplest is to keep `/structure`
   visible and hide the edit affordances, which `structure-screen.tsx` already does once D1 is fixed.
   Gate `/ai` outright: with budget and traces removed, a member has nothing left on that screen.)
4. `apps/web/src/features/analytics/**` — hide the "Load per person" chart and its CSV button unless
   `departmentRole === 'head'`; the server already refuses.
5. `apps/web/src/features/pages/onboarding-templates.tsx` — render the panel only for a head.
6. `apps/web/src/features/work/**` — respect the new `canEdit` on every card action (edit, drag,
   archive, restore, checklist, watcher); disable rather than hide inside an open card, hide on the
   board.
7. `apps/web/src/features/projects/**` — respect `canManage` on project edit, owner picker and
   milestone editor.
8. `apps/web/src/features/inbox/telegram-screen.tsx:426` — unchanged; it was already right.
9. `apps/web/src/app.tsx` — for `/admin/*` and `/departments/requests`, render the shared
   no-permission state (DESIGN.md's five required screen states) instead of letting the screen fetch
   and fail (D12).
10. `e2e/` — one spec per SEV1/SEV2 finding, signed in as `demo.xodim`, asserting the API returns 403
    **and** the affordance is absent; the head (`demo.boshliq`) sees both.

### Step 9 — spec and invariants

- TECH-SPEC §2.3 — rewrite the `member` row of the roles table from section 4 of this document.
  §9's title "(for everyone in the department)" becomes "(aggregates for everyone; per-person for the
  head)". §19 — record two decisions: `allow_structure_edit` defaults off; per-person analytics are
  head-only.
- `agentic/INVARIANTS.md` — add I-9: "A department-owned row that only the head may change declares
  `{kind:'department_managed'}`; ownership rules ('giver, assignee, creator, organizer, author') are
  repository predicates that also surface as a `canEdit`/`canManage` field on the DTO, never as a
  client-side guess."

---

## 7. What is already correct (do not regress it)

- Boot-time guard: a route with no `config.permission` crashes the server (`plugins/authorize.ts:96`).
- `PUBLIC_ROUTES` is an allow-list asserted by a test against the real registrations.
- Personal workspace: owner-only with no head, super-admin or view-as exception.
- The admin console: `{kind:'instance'}` with `viewAs === null`, plus the byte-identical 403 for
  matched and unmatched `/api/v1/admin/*`.
- View-as is read-only and cannot reach personal rows.
- Departments module: every head action on `{kind:'department'}`, client hides exactly those.
- Events module: `canManage` computed on the server, obeyed by the client. This is the pattern the
  rest of the product should copy.
- Saved views, saved filters and pinned charts: owner-scoped in the repository despite living on
  `department_child`.
