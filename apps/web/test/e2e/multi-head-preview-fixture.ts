// Browser-only UI evidence with synthetic API responses. This deliberately does not claim to
// replace multi-head-workflow.flow.spec.ts or the real PostgreSQL concurrency integration suite.
import type { Page } from '@playwright/test'

export const previewDepartmentId = 'acdd6ac8-c13f-4f89-82c4-1c267c30fa8e'
export const previewUnitId = 'f6ed4df7-a6f3-41da-a395-41647ab40cf6'
export const previewIds = [
  'ea6f0dfb-1f8c-46b1-8b66-c51d19165401',
  'ea6f0dfb-1f8c-46b1-8b66-c51d19165402',
  'ea6f0dfb-1f8c-46b1-8b66-c51d19165403',
]

export async function installHeadPreview(
  page: Page,
  locale = 'en',
  heads = 2,
  viewer = 0,
  admin = false,
) {
  const members = [
    { givenName: 'Anvar', familyName: 'Aliyev' },
    { givenName: 'Nodira', familyName: 'Karimova' },
    { givenName: 'Aziza', familyName: 'Rahimova' },
  ].map((person, index) => ({
    ...person,
    userId: previewIds[index]!,
    version: 1,
    accountStatus: 'active',
    patronymic: null,
    title: null,
    avatarKey: null,
    role: index < heads ? 'head' : 'member',
    status: 'active',
    joinedAt: '2026-10-01T09:00:00Z',
  }))
  const settings = {
    allowSelfAssign: true,
    allowStructureEdit: true,
    joinRequiresApproval: true,
    whoCanConnectTelegramGroup: 'head',
    quietHours: null,
    features: {
      estimates: false,
      dependencies: false,
      recurring: false,
      templates: false,
      reminders: false,
    },
  }
  const department = () => ({
    id: previewDepartmentId,
    name: 'Raqamli rivojlanish boshqarmasi',
    slug: 'leadership-preview',
    description: null,
    emoji: null,
    colour: null,
    localeDefault: locale,
    status: 'active',
    settings,
    myRole: members[viewer]!.role,
    memberCount: members.length,
  })
  const requests: { path: string; method: string; body: unknown }[] = []
  const missing = new Set<string>()
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname.replace('/api/v1', '')
    const method = request.method()
    const body: Record<string, unknown> = request.postData() ? request.postDataJSON() : {}
    requests.push({ path, method, body })
    const json = (value: unknown, status = 200) => route.fulfill({ status, json: value })
    if (path === '/me')
      return json({
        user: {
          id: members[viewer]!.userId,
          login: 'preview.only',
          ...members[viewer],
          role: admin ? 'super_admin' : 'member',
          locale,
          timezone: 'Asia/Tashkent',
          mustChangePassword: false,
        },
        memberships: [
          {
            departmentId: previewDepartmentId,
            name: department().name,
            role: members[viewer]!.role,
          },
        ],
        membershipCount: 1,
        activeDepartmentId: previewDepartmentId,
        actingForUserId: null,
        instance: { isDemo: true, maintenance: false },
        csrfToken: 'PreviewExampleOnly',
      })
    if (path === '/instance')
      return json({
        isDemo: true,
        maintenance: { enabled: false, message: null },
        registrationOpen: true,
        locales: ['en', 'ru', 'uz-Latn', 'uz-Cyrl'],
        defaultLocale: 'uz-Latn',
        setupRequired: false,
      })
    if (path === '/realtime/config')
      return json({
        enabled: false,
        url: '',
        ttlSeconds: 300,
        channels: { personal: '', department: '', board: '' },
      })
    if (path === '/notifications') return json({ items: [], unreadCount: 0, nextCursor: null })
    if (path === '/admin/accounts')
      return json({
        users: members.map((member) => ({
          ...member,
          id: member.userId,
          login: `preview.${member.givenName.toLowerCase()}`,
          createdAt: '2026-10-01T09:00:00Z',
          lastLoginAt: null,
        })),
        nextCursor: null,
      })
    if (path.startsWith('/admin/accounts/') && path.endsWith('/lock'))
      return json(
        {
          type: 'https://devon.local/problems/conflict',
          title: 'Conflict',
          status: 409,
          code: 'conflict',
          errors: [{ path: 'membership', code: 'last_department_head' }],
        },
        409,
      )
    if (path === '/accounts/birthday/open') return json({ celebration: null })
    if (path === '/personal/pomodoro/settings')
      return json({
        focusMin: 25,
        shortBreakMin: 5,
        longBreakMin: 15,
        cyclesBeforeLong: 4,
        sound: 'chime',
        notifications: false,
        autoStart: false,
      })
    if (path.startsWith('/admin/departments')) {
      const row = {
        ...department(),
        createdAt: '2026-10-01T09:00:00Z',
        headName: members
          .filter((member) => member.role === 'head')
          .map((member) => `${member.givenName} ${member.familyName}`)
          .join(', '),
      }
      return json(path === '/admin/departments' ? { departments: [row], nextCursor: null } : row)
    }
    if (path === '/departments/mine') return json({ departments: [department()] })
    if (path === '/departments/requests/mine') return json({ requests: [] })
    if (path === `/departments/${previewDepartmentId}`) return json(department())
    if (path === `/departments/${previewDepartmentId}/members`) return json({ members })
    if (path.endsWith('/join-requests')) return json({ requests: [] })
    if (path.endsWith('/invite'))
      return json({
        joinKey: 'PREVIEW2026',
        joinUrl: `${new URL(request.url()).origin}/join?key=PREVIEW2026`,
        hasPassword: true,
        joinRequiresApproval: true,
      })
    if (path.endsWith('/settings') && method === 'PATCH') {
      Object.assign(settings, body)
      return route.fulfill({ status: 204 })
    }
    if (path.endsWith('/role') && method === 'PATCH') {
      const targetId = path.split('/').at(-2),
        target = members.find((member) => member.userId === targetId)
      if (target) {
        target.role = String(body['role'])
        target.version++
      }
      return route.fulfill({ status: 204 })
    }
    if (path.endsWith('/units'))
      return json({
        units: [
          {
            id: previewUnitId,
            parentUnitId: null,
            name: 'Raqamli xizmatlar boʻlimi',
            colour: 1,
            sort: 0,
            path: 'digital',
            version: 1,
          },
        ],
        settings: { allowSelfAssign: true, allowStructureEdit: true },
        myRole: members[viewer]!.role,
      })
    if (path.endsWith('/unit-roles')) return json([])
    if (path.endsWith('/roster'))
      return json(
        members.map((member, index) => ({
          ...member,
          membershipRole: member.role,
          dateOfBirth: null,
          unitId: index === 2 ? previewUnitId : null,
          unitRole: null,
        })),
      )
    if (path === '/departments')
      return json([
        { departmentId: previewDepartmentId, name: department().name, role: members[viewer]!.role },
      ])
    missing.add(`${method} ${path}`)
    return json({ code: 'preview_fixture_missing' }, 501)
  })
  return { members, requests, missing }
}
