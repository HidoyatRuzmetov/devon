// This writes a bounded evidence overlay, never the shared inventory. Regeneration/reconciliation
// belongs to the parent QA run. Unlisted controls and states remain pending.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const web = 'apps/web/src/features/'
const tests = 'apps/web/test/e2e/'
const artifacts = 'artifacts/qa/2026-10/visual-controls/'
const browsers = ['chromium', 'firefox', 'webkit']
const locales = ['uz-Latn', 'uz-Cyrl', 'ru', 'en']
const themes = ['light', 'dark']
const evidence = {
  board: {
    test: `${tests}visual-controls.flow.spec.ts`,
    scenario: 'calendar alignment and separated selection/movement targets',
    roles: ['head'],
    browsers,
    visualLocales: locales,
    visualThemes: themes,
    widths: [1440, 1024, 768, 390, 320],
    transitionScope: 'selection/unselection and menu keyboard open/Escape: English, dark, 320px',
  },
  milestone: {
    test: `${tests}visual-controls.flow.spec.ts`,
    scenario: 'title completion/reload; pencil keyboard/tooltip/focus; pending 503/draft/retry',
    roles: ['head'],
    browsers,
    visualLocales: locales,
    visualThemes: themes,
    widths: [1440, 1024, 768, 390, 320],
    transitionScope:
      'completion and refused/retried edit: Uzbek Latin; localization captures do not prove every transition in every locale',
  },
  conversion: {
    test: `${tests}project-capabilities.flow.spec.ts`,
    additionalTest: `${tests}visual-controls.flow.spec.ts`,
    scenario:
      'select member, freeze pending/Escape, atomic conversion, original card/checklist; cancel/reset',
    roles: ['head'],
    browsers,
    visualLocales: locales,
    visualThemes: themes,
    widths: [390, 320],
    transitionScope:
      'functional writes/cancel in English; localized dialog captures in all four locales',
  },
  projectEdit: {
    test: `${tests}project-capabilities.flow.spec.ts`,
    scenario:
      'title/description/status/dates/colour/member removal; pending freeze/Escape/503 retained draft/retry/focus/server read',
    roles: ['head'],
    browsers,
    visualLocales: locales,
    visualThemes: themes,
    widths: [1440, 320],
    textTokensPercent: [100, 200],
    transitionScope:
      'functional save/refusal/retry in English; populated visual reflow in all four locales/both themes',
  },
  gallery: {
    test: `${tests}project-gallery.flow.spec.ts`,
    scenario:
      'gallery choice, pending duplicate prevention, 503 leaves no project, retained draft/retry creates two ordered cards',
    roles: ['head', 'member'],
    browsers,
    locales: ['en'],
    transitionScope:
      'head creates gallery project; member uses shared card template through real API/count proof; not a full member UI claim',
  },
  lifecycle: {
    test: `${tests}group-project.flow.spec.ts`,
    scenario:
      'chosen milestone add/edit/delete/undo; project delete/undo after page unmount; rendered progress 0/25/50/100',
    roles: ['head'],
    browsers,
    locales: ['uz-Latn'],
    transitionScope:
      'progress task/checklist changes were made through actual API, not by clicking the project TaskRow checkbox',
  },
  peopleTable: {
    test: `${tests}people-controls.flow.spec.ts`,
    scenario:
      'horizontal keyboard scrolling, task target sizes, actual column resize/arrow keys/End/Home and reload',
    roles: ['head'],
    browsers,
    visualLocales: locales,
    visualThemes: themes,
    widths: [1440, 1024, 768, 390, 320],
    transitionScope: 'column resizing/persistence in English; no sort/filter/bulk-write claim',
  },
  peopleLarge: {
    test: `${tests}people-large.flow.spec.ts`,
    scenario:
      'all 65 people reachable, variable-height virtual rows, valid mobile definitions, actual last-name viewport hit, zero lifecycle/observer errors',
    roles: ['head'],
    browsers,
    locales,
    themes,
    widths: [1440, 768, 320],
    textTokensPercent: [100, 200],
  },
  savedView: {
    test: `${tests}people-large.flow.spec.ts`,
    scenario:
      'name/share selection, pending disabled fields, 503 error/draft retained, retry and independent reload',
    roles: ['head'],
    browsers,
    locales: ['en'],
    widths: [1440],
    transitionScope:
      'save-as only; overwrite/share-menu/default/delete/revert transitions remain pending',
  },
  labels: {
    test: `${tests}card-readability.flow.spec.ts`,
    scenario:
      'full-opacity label contrast/name/target; label toggle/server read; add label pending/refusal/draft/Enter retry; reader applied tags',
    roles: ['head', 'member'],
    browsers,
    locales: ['en'],
    themes,
    widths: [1440, 768, 390, 320],
    transitionScope:
      'member sees applied tags with edit controls absent; not a member editing claim',
  },
  title: {
    test: `${tests}card-readability.flow.spec.ts`,
    additionalTest: `${tests}visual-controls.flow.spec.ts`,
    scenario:
      'long title autosize, font-only 200% fitting, repeated width changes without observer errors; edit/persistence/reload',
    roles: ['head'],
    browsers,
    locales: ['en'],
    themes,
    widths: [1440, 768, 390, 320],
    textTokensPercent: [100, 200],
  },
  org: {
    test: `${tests}structure-readability.flow.spec.ts`,
    additionalTest: `${tests}structure.flow.spec.ts`,
    scenario:
      'three-level SVG; arrows/Enter/close/focus return; complete department/unit/head names; enlarged labels with no overlap; independent PNG',
    roles: ['head'],
    browsers,
    locales,
    themes,
    widths: [1440, 390, 320],
    textTokensPercent: [100, 200],
    transitionScope:
      'zoom controls and pan rendered but their gestures were not exercised by this slice',
  },
  dialog: {
    test: `${tests}dialog-scroll.flow.spec.ts`,
    scenario:
      '320×480 tall form, start/footer reachable, keyboard menu/date portal focus/selection, Save/result, Escape/focus return',
    roles: ['public fixture'],
    browsers,
    locales,
    themes,
    widths: [320],
    height: 480,
    transitionScope:
      'isolated actual shared-component fixture; does not blanket-pass all application dialogs',
  },
}
const records = []
function add(source, component, kind, signature, states, evidenceId, note = '') {
  records.push({
    match: { source: web + source, component, kind, ...signature },
    expectedMatches: 1,
    scopeNote: note,
    states: Object.fromEntries(
      states.map((state) => [
        state,
        {
          status: 'verified',
          evidenceId,
          pixelReviewedArtifacts: [],
          pixelReviewed: false,
        },
      ]),
    ),
  })
}
const label = (labelIncludes) => ({ labelIncludes })
const child = (childSummaryIncludes) => ({ childSummaryIncludes })
add(
  'work/components/card-tile.tsx',
  'CardTile',
  'Checkbox',
  label('work.bulk.selectCard'),
  ['default', 'selected', 'focus'],
  'board',
)
add(
  'work/components/card-tile.tsx',
  'MoveToMenu',
  'IconButton',
  label('work.card.moveTo'),
  ['default', 'focus', 'active'],
  'board',
  'Menu opens/closes with keyboard; assignment selection itself is not verified here.',
)
add(
  'work/components/card-tile.tsx',
  'CardTile',
  'Chip',
  child('formatDate(new Date(card.dueAt)'),
  ['populated'],
  'board',
)
add(
  'work/components/card-detail.tsx',
  'CardTitleField',
  'textarea',
  {},
  ['populated', 'focus', 'success'],
  'title',
)
add(
  'work/components/card-detail.tsx',
  'CardDetailContent',
  'button',
  child('{label.name}'),
  ['default', 'selected', 'success'],
  'labels',
)
add(
  'work/components/card-detail.tsx',
  'CardDetailContent',
  'Input',
  label('work.card.newLabel'),
  ['populated', 'disabled', 'error', 'success'],
  'labels',
)
add(
  'work/components/card-detail.tsx',
  'CardDetailContent',
  'IconButton',
  label('work.card.newLabel'),
  ['default', 'active', 'disabled', 'loading', 'error', 'success'],
  'labels',
)
add(
  'projects/components/milestone-actions.tsx',
  'MilestoneActions',
  'IconButton',
  label('projectLifecycle.editMilestoneLabel'),
  ['default', 'focus', 'active'],
  'milestone',
)
add(
  'projects/components/milestone-actions.tsx',
  'MilestoneActions',
  'Input',
  child('projectLifecycle.milestoneTitle'),
  ['populated', 'disabled', 'error', 'success'],
  'milestone',
)
add(
  'projects/components/milestone-actions.tsx',
  'MilestoneActions',
  'Input',
  label('type="date"'),
  ['populated', 'success'],
  'lifecycle',
)
add(
  'projects/components/milestone-actions.tsx',
  'MilestoneActions',
  'Button',
  child('projectLifecycle.deleteMilestone'),
  ['active', 'success'],
  'lifecycle',
)
add(
  'projects/components/milestone-actions.tsx',
  'MilestoneActions',
  'Button',
  label('type="submit"'),
  ['disabled', 'loading', 'error', 'success'],
  'milestone',
)
add(
  'projects/components/project-page-screen.tsx',
  'ProjectPageScreen',
  'Checkbox',
  label('aria-label={m.title}'),
  ['default', 'selected', 'success'],
  'milestone',
)
add(
  'projects/components/project-page-screen.tsx',
  'ProjectPageScreen',
  'Input',
  label('projects.milestone.addPlaceholder'),
  ['populated', 'success'],
  'lifecycle',
)
add(
  'projects/components/project-page-screen.tsx',
  'ProjectPageScreen',
  'Button',
  child('projectLifecycle.delete'),
  ['active', 'success'],
  'lifecycle',
)
add(
  'projects/components/convert-project-dialog.tsx',
  'ConvertProjectDialog',
  'Dialog',
  {},
  ['default', 'populated', 'loading', 'success'],
  'conversion',
)
add(
  'projects/components/convert-project-dialog.tsx',
  'ConvertProjectDialog',
  'Checkbox',
  {},
  ['default', 'selected', 'disabled'],
  'conversion',
)
add(
  'projects/components/edit-project-dialog.tsx',
  'EditProjectDialog',
  'Button',
  child('projectEdit.edit'),
  ['default', 'focus', 'active'],
  'projectEdit',
)
add(
  'projects/components/edit-project-dialog.tsx',
  'EditProjectDialog',
  'Dialog',
  {},
  ['populated', 'loading', 'error', 'success'],
  'projectEdit',
)
add(
  'projects/components/edit-project-dialog.tsx',
  'ProjectForm',
  'Input',
  child('projects.field.title'),
  ['populated', 'focus', 'disabled', 'error', 'success'],
  'projectEdit',
)
add(
  'projects/components/edit-project-dialog.tsx',
  'ProjectForm',
  'Textarea',
  {},
  ['populated', 'success'],
  'projectEdit',
)
add(
  'projects/components/edit-project-dialog.tsx',
  'ProjectForm',
  'select',
  child('projectStatusSchema.options'),
  ['populated', 'selected', 'success'],
  'projectEdit',
)
add(
  'projects/components/edit-project-dialog.tsx',
  'ProjectForm',
  'Input',
  child('projectEdit.start'),
  ['populated', 'success'],
  'projectEdit',
)
add(
  'projects/components/edit-project-dialog.tsx',
  'ProjectForm',
  'Input',
  child('projectEdit.target'),
  ['populated', 'success'],
  'projectEdit',
)
add(
  'projects/components/edit-project-dialog.tsx',
  'ProjectForm',
  'Input',
  label('type="color"'),
  ['populated', 'success'],
  'projectEdit',
)
add(
  'projects/components/edit-project-dialog.tsx',
  'ProjectForm',
  'Checkbox',
  {},
  ['default', 'selected', 'disabled', 'success'],
  'projectEdit',
)
add(
  'projects/components/edit-project-dialog.tsx',
  'ProjectForm',
  'Button',
  label('type="submit"'),
  ['disabled', 'loading', 'error', 'success'],
  'projectEdit',
)
add(
  'projects/components/create-project-dialog.tsx',
  'CreateProjectDialog',
  'Button',
  child('projects.create.fromGallery'),
  ['default', 'active'],
  'gallery',
)
add(
  'projects/components/create-project-dialog.tsx',
  'CreateProjectDialog',
  'select',
  child('galleryTemplates.map'),
  ['populated', 'selected'],
  'gallery',
)
add(
  'projects/components/create-project-dialog.tsx',
  'CreateProjectDialog',
  'Input',
  label('projects.field.titlePlaceholder'),
  ['populated', 'disabled', 'error', 'success'],
  'gallery',
)
add(
  'projects/components/create-project-dialog.tsx',
  'CreateProjectDialog',
  'Button',
  child('projects.create.submit'),
  ['disabled', 'loading', 'error', 'success'],
  'gallery',
)
add(
  'people/people-table-screen.tsx',
  'PeopleTable',
  'div',
  label('role="region"'),
  ['populated', 'focus', 'active'],
  'peopleTable',
)
add(
  'people/people-table-screen.tsx',
  'ColumnResizer',
  'button',
  label('role="slider"'),
  ['default', 'focus', 'active', 'success'],
  'peopleTable',
)
add(
  'people/people-table-screen.tsx',
  'TaskChips',
  'a',
  label('title={card.title}'),
  ['populated'],
  'peopleTable',
  'Target size/readability only; link navigation is not a verified transition in this slice.',
)
add(
  'people/people-table-screen.tsx',
  'PersonCell',
  'a',
  {},
  ['populated'],
  'peopleLarge',
  'All 65 names are reached by real scrolling; profile navigation is not verified here.',
)
add(
  'people/components/view-tabs.tsx',
  'ViewTabs',
  'Input',
  label('people.table.views.namePlaceholder'),
  ['populated', 'disabled', 'error', 'success'],
  'savedView',
)
add(
  'people/components/view-tabs.tsx',
  'ViewTabs',
  'Switch',
  child('people.table.views.shareLabel'),
  ['selected', 'disabled', 'success'],
  'savedView',
)
add(
  'people/components/view-tabs.tsx',
  'ViewTabs',
  'Button',
  child('people.table.views.saveAsSubmit'),
  ['disabled', 'loading', 'error', 'success'],
  'savedView',
)
add('structure/org-chart.tsx', 'OrgChart', 'svg', label('role="tree"'), ['populated'], 'org')
add(
  'structure/org-chart.tsx',
  'OrgChart',
  'g',
  label('role="treeitem"'),
  ['populated', 'focus', 'selected', 'active'],
  'org',
)
add(
  'structure/org-chart.tsx',
  'OrgChart',
  'Button',
  child('structure.units.chart.exportPng'),
  ['active', 'success'],
  'org',
)
add('structure/org-chart.tsx', 'OrgChart', 'Sheet', {}, ['populated', 'active', 'success'], 'org')
add(
  'structure/org-chart.tsx',
  'OrgChart',
  'IconButton',
  label('structure.units.chart.closePanel'),
  ['active', 'success'],
  'org',
)

// Only these exact images were opened and reviewed. A test capture is not itself pixel review,
// and a default image does not prove an error/loading/focus state was inspected.
const reviewed = [
  {
    source: 'work/components/card-tile.tsx',
    component: 'CardTile',
    states: ['default', 'populated'],
    files: [
      'chromium/inspection-card-matrix-light-en.png',
      'chromium/inspection-card-matrix-dark-uz-Cyrl.png',
    ],
  },
  {
    source: 'projects/components/edit-project-dialog.tsx',
    component: 'ProjectForm',
    excludeKinds: ['Checkbox', 'Button'],
    excludeLabel: 'type="color"',
    states: ['populated'],
    files: [
      'chromium/nested/project-edit-ru-light-320-text200.png',
      'firefox/nested/project-edit-uz-Cyrl-dark-320-text200.png',
      'webkit/nested/project-edit-ru-dark-320-text200.png',
    ],
  },
  {
    source: 'structure/org-chart.tsx',
    component: 'OrgChart',
    kinds: ['svg', 'g'],
    states: ['populated'],
    files: [
      'chromium/nested/org-export-ru-light-text200.png',
      'chromium/nested/org-export-uz-Cyrl-dark-text200.png',
      'firefox/nested/org-export-en-dark-text200.png',
      'webkit/nested/org-export-uz-Latn-light-text200.png',
      'webkit/nested/org-export-ru-dark-text200.png',
    ],
  },
  {
    source: 'people/people-table-screen.tsx',
    component: 'PersonCell',
    states: ['populated'],
    files: [
      'chromium/nested/large-people-en-light-320-text200-end.png',
      'firefox/nested/large-people-uz-Latn-dark-320-text200-end.png',
    ],
  },
]
for (const item of reviewed) {
  for (const record of records.filter(
    (record) =>
      record.match.source === web + item.source &&
      record.match.component === item.component &&
      (!item.kinds || item.kinds.includes(record.match.kind)) &&
      !item.excludeKinds?.includes(record.match.kind) &&
      (!item.excludeLabel || record.match.labelIncludes !== item.excludeLabel),
  )) {
    for (const state of item.states) {
      if (!record.states[state]) continue
      record.states[state].pixelReviewed = true
      record.states[state].pixelReviewedArtifacts = item.files.map((file) => artifacts + file)
    }
  }
}
const componentFixtures = [
  {
    source: 'packages/ui/src/primitives/avatar.tsx',
    states: ['default', 'populated'],
    test: `${tests}avatar-readability.flow.spec.ts`,
    scope:
      'four sizes, eight palette colours, light/dark, normal/200% token text, 1440/320px in all three engines; no AvatarMenu action claim',
  },
  {
    source: 'packages/ui/src/primitives/badge.tsx',
    states: ['default'],
    test: `${tests}badge-contrast.flow.spec.ts`,
    scope:
      'all seven subtle tones on both real surfaces, light/dark, all three engines; measured text contrast only',
  },
  {
    source: 'packages/ui/src/primitives/dialog.tsx',
    states: ['populated', 'focus', 'active', 'success'],
    evidenceId: 'dialog',
    scope:
      'actual isolated short-height fixture and bounded project heading/form/footer cases; shared implementation, not every application dialog',
  },
  {
    source: 'packages/ui/src/primitives/button.tsx',
    states: ['disabled', 'loading'],
    test: 'packages/ui/src/primitives/button.test.tsx',
    scope:
      'unit loading prevents activation including explicit disabled=false and asChild; browser proof limited to the recorded application Save actions',
  },
  {
    source: 'packages/ui/src/primitives/checkbox.tsx',
    states: ['default', 'selected'],
    test: 'packages/ui/src/primitives/checkbox.test.tsx',
    scope:
      'controlled/uncontrolled check glyph plus bounded card/project/browser targets; do not infer all callers',
  },
]
writeFileSync(
  resolve(root, 'docs/qa/2026-10/visual-controls-evidence.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      owner: 'visual_controls',
      provenance:
        'Actual isolated local browser/API/DB regressions and explicit pixel review. Source matches are stable signatures for parent reconciliation after inventory regeneration.',
      policy:
        'Only listed states gain evidence. Unlisted states/controls, hover variations, validation boundaries and unexercised role permutations stay pending. No whole-component blanket pass.',
      completedGates: {
        core: '18/18 across three engines; 15.9m',
        nested: '21/21 assertions across three engines; 9.9m, followed by strengthened defects',
        finalAffected: '9/9 across three engines; 6.3m',
        api: '19/19; migration lint 10/10',
      },
      evidence,
      records,
      componentFixtures,
    },
    null,
    2,
  ) + '\n',
)
console.log(
  `Wrote ${records.length} bounded surface records and ${componentFixtures.length} shared fixture records; shared inventory untouched.`,
)
