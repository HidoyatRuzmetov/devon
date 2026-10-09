import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mergeInventoryEvidence } from './merge-inventory-evidence.mjs'

const root = resolve(import.meta.dirname, '../..')
const run = 'artifacts/qa/2026-10/results/platform/fields-card-calendar-wrapped'
const load = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const report = load(`${run}/summary.json`)
const collect = (suite, file) => [
  ...(suite.specs ?? []).filter((spec) => spec.file === file).flatMap((spec) => spec.tests),
  ...(suite.suites ?? []).flatMap((child) => collect(child, file)),
]
for (const [file, count] of [
  ['platform-fields-deep.qa.spec.ts', 18],
  ['platform-card-fields.qa.spec.ts', 15],
]) {
  const tests = report.suites.flatMap((suite) => collect(suite, file))
  if (
    tests.length !== count ||
    report.errors.length ||
    tests.some(
      (test) =>
        test.status !== 'expected' ||
        test.expectedStatus !== 'passed' ||
        test.results.length !== 1 ||
        test.results[0].status !== 'passed' ||
        test.results[0].retry,
    )
  )
    throw new Error(`The named ${file} slice must pass without retries or skips`)
}

const value = 'apps/web/src/features/fields/components/field-value-input.tsx'
const form = 'apps/web/src/features/fields/components/field-form-dialog.tsx'
const screen = 'apps/web/src/features/fields/fields-screen.tsx'
const inline = 'apps/web/src/features/fields/components/card-custom-fields.tsx'
const profile = 'apps/web/src/features/fields/components/my-fields-section.tsx'
const state = (evidenceId) => ({ status: 'verified', evidenceId, pixelReviewed: false })
const record = (source, component, kind, selector, states, note) => ({
  match: { source, component, kind, ...selector },
  expectedMatches: 1,
  states: Object.fromEntries(Object.entries(states).map(([name, id]) => [name, state(id)])),
  scopeNote: `${note} EN/light/1280x720/synthetic local head/all three engines only. Other roles, states, modalities and environments remain pending.`,
})
const evidence = (file, scenario) => ({
  test: `apps/web/test/e2e/${file}`,
  report: `${run}/summary.json`,
  scenario,
  production: 'not exercised',
  externalCalls: 'blocked',
})
const overlay = {
  schemaVersion: 1,
  owner: 'root-fields-current',
  provenance:
    'Exact named real-service browser journeys with independent reads/reload; API negative-only journeys remain workflow entries rather than claiming UI controls.',
  policy:
    'Bound only the listed states in their actual scope. No whole-parent or whole-platform pass. Pixel review is documented separately and is not inferred by this generator.',
  boundaries: { db: 'devon_flow_e2e_root', apiPort: 48952, webPort: 48951 },
  evidence: {
    values: evidence(
      'platform-fields-deep.qa.spec.ts',
      'Nine editable types created in actual dialog; English name/type/options/default submission; profile text Unicode/apostrophes, multiline, zero, chosen date, select, multiselect toggle, person, URL and checkbox true/false; real204, independently read exact values and reload. Three engines.',
    ),
    options: evidence(
      'platform-fields-deep.qa.spec.ts',
      'C++ and C# via actual option addition/label and create action; independent distinct IDs; choose and save C# answer and reload. Three engines.',
    ),
    reorder: evidence(
      'platform-fields-deep.qa.spec.ts',
      'Archive middle definition, actual Show archived switch, move last active upward past archived row; exact request IDs204, independent order and reload, firstUp/lastDowndisabled. Three engines.',
    ),
    lateCreate: evidence(
      'platform-fields-deep.qa.spec.ts',
      'Real create201 committed then held; Escape/reopen/later English draft, release callback, toast and native frames then actual data-state=open and retained value. Three engines.',
    ),
    inline: evidence(
      'platform-card-fields.qa.spec.ts',
      'Real row edit, controlledPUT503 leaves editor/value intact and stored null; actual retry204 independently persists and reloads. Exact accessible input name from visible label. Held committed204 then Cancel/reopen/later draft, old callback preserves editor and actual second204 persists later value. Three engines.',
    ),
    readRecovery: evidence(
      'platform-card-fields.qa.spec.ts',
      'Actual definition GET503 and value GET503 recover through the visible Try again action; the corresponding real GET200 and editable row return. Stored value remains null. Three engines. Other calendar matrix failures in this report are separate and deferred by the user.',
    ),
    apiRefusals: evidence(
      'platform-fields-deep.qa.spec.ts',
      'API-only duplicate option IDs on create/edit refused422 with stored definition/options unchanged. Impossible calendar date refused422/invalid_value with value null; valid leap date204 independently persisted. These checks do not establish UI validation interactions.',
    ),
  },
  records: [
    record(
      screen,
      'FieldsScreen',
      'Button',
      { childSummaryIncludes: 'fields.manager.create' },
      { default: 'values' },
      'Actual New field actions.',
    ),
    record(
      screen,
      'FieldsScreen',
      'Switch',
      { labelIncludes: 'fields.manager.showArchived' },
      { selected: 'reorder' },
      'Actual Show archived selection.',
    ),
    record(
      screen,
      'FieldsScreen',
      'IconButton',
      { labelIncludes: 'fields.manager.moveUp' },
      { active: 'reorder', disabled: 'reorder' },
      'Actual upward reorder and first-active disabled boundary.',
    ),
    record(
      screen,
      'FieldsScreen',
      'IconButton',
      { labelIncludes: 'fields.manager.moveDown' },
      { disabled: 'reorder' },
      'Last-active disabled boundary only; no downward-click claim.',
    ),
    record(
      screen,
      'FieldsScreen',
      'IconButton',
      { labelIncludes: 'fields.manager.archive' },
      { success: 'reorder' },
      'Actual archival and independent archivedAt read.',
    ),
    record(
      form,
      'FieldFormDialog',
      'Input',
      { childSummaryIncludes: 'id={`field-label-' },
      { populated: 'values' },
      'English label input only; repeated locale inputs are not inferred covered.',
    ),
    record(
      form,
      'FieldFormDialog',
      'Select',
      { childSummaryIncludes: 'id="field-type"' },
      { selected: 'values' },
      'Actual nine editable type selections.',
    ),
    record(
      form,
      'FieldFormDialog',
      'Input',
      { labelIncludes: 'fields.form.optionLabelAria' },
      { populated: 'options' },
      'Actual distinct punctuation-heavy option labels.',
    ),
    record(
      form,
      'FieldFormDialog',
      'Button',
      { childSummaryIncludes: 'fields.form.optionAdd' },
      { active: 'options' },
      'Actual Add an option actions.',
    ),
    record(
      form,
      'FieldFormDialog',
      'Button',
      { labelIncludes: 'type="submit"' },
      { success: 'values' },
      'Actual create submission and independently persisted definitions; edit-save semantics remain separate.',
    ),
    record(
      form,
      'FieldFormDialog',
      'DialogContent',
      {},
      { populated: 'lateCreate' },
      'Held prior create receipt must leave current later dialog open; no whole-dialog coverage claim.',
    ),
    record(
      value,
      'FieldValueInput',
      'Input',
      { labelIncludes: 'fields.input.textPlaceholder' },
      { populated: 'values' },
      'Actual profile text/person values; card accessible naming separately checked by inline journey.',
    ),
    record(
      value,
      'FieldValueInput',
      'Input',
      { labelIncludes: 'type="number"' },
      { populated: 'values' },
      'Actual zero boundary.',
    ),
    record(
      value,
      'FieldValueInput',
      'Input',
      { labelIncludes: 'type="url"' },
      { populated: 'values' },
      'Actual synthetic HTTPS URL.',
    ),
    record(
      value,
      'FieldValueInput',
      'Textarea',
      {},
      { populated: 'values' },
      'Actual multiline value.',
    ),
    record(
      value,
      'FieldValueInput',
      'DatePicker',
      {},
      { selected: 'values' },
      'Actual current-month day selection; API impossible dates do not establish picker validation.',
    ),
    record(
      value,
      'FieldValueInput',
      'Select',
      {},
      { selected: 'options' },
      'Actual separately identified C# selection.',
    ),
    record(
      value,
      'FieldValueInput',
      'button',
      {},
      { selected: 'values' },
      'Actual multi-select alpha/beta toggle and persisted beta.',
    ),
    record(
      value,
      'FieldValueInput',
      'Checkbox',
      {},
      { selected: 'values' },
      'Actual true then false and exact single accessible/visible label.',
    ),
    record(
      profile,
      'MyFieldsSection',
      'Button',
      { labelIncludes: 'type="submit"' },
      { success: 'values' },
      'Actual batch204, independent read and reload.',
    ),
    record(
      inline,
      'CardCustomFields',
      'FieldValueInput',
      {},
      { populated: 'inline' },
      'Actual single text field, visible label association and retained refused/later drafts.',
    ),
    record(
      inline,
      'CardCustomFields',
      'button',
      { childSummaryIncludes: 'fields.card.apply' },
      { error: 'inline', success: 'inline' },
      'Actual refusal and subsequent real save.',
    ),
    record(
      inline,
      'CardCustomFields',
      'button',
      { childSummaryIncludes: 'fields.card.cancel' },
      { active: 'inline' },
      'Actual Cancel during held receipt then reopen.',
    ),
    record(
      inline,
      'CardCustomFields',
      'button',
      { labelIncludes: 'fields.card.editAria' },
      { active: 'inline', populated: 'inline' },
      'Actual row edit and persisted value after reload.',
    ),
  ],
  entries: [
    {
      surface: 'Card custom field definition and value read recovery',
      evidenceId: 'readRecovery',
      surfaceBinding: 'not inferred',
    },
    {
      surface: 'Field definition/value API refusal integrity',
      evidenceId: 'apiRefusals',
      surfaceBinding: 'not inferred',
    },
  ],
}
const { report: reconciliation } = mergeInventoryEvidence(
  load('docs/qa/2026-10/inventory.json'),
  [overlay],
  (path) => existsSync(resolve(root, path)),
)
if (reconciliation.issues.length) throw new Error(JSON.stringify(reconciliation.issues))
writeFileSync(
  resolve(root, 'docs/qa/2026-10/fields-current-evidence.json'),
  JSON.stringify(overlay, null, 2) + '\n',
)
console.log(
  JSON.stringify({
    records: reconciliation.exactRecordsApplied,
    bindings: reconciliation.stateBindingsApplied,
    noBlanketPass: true,
  }),
)
