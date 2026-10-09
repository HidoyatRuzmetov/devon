import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeInventoryEvidence } from '../merge-inventory-evidence.mjs'

const surface = (id) => ({
  id,
  source: 'feature.tsx',
  component: 'Screen',
  kind: 'Button',
  labels: ['Save'],
  childSummary: 'Save',
  status: 'pending',
  evidence: [],
  states: {
    default: { status: 'pending', evidence: [] },
    error: { status: 'pending', evidence: [] },
  },
})
const overlay = (record = {}) => ({
  owner: 'owner',
  entries: [{ source: 'feature.tsx', controls: ['all buttons'] }],
  evidence: { save: { roles: ['head'], browsers: ['chromium'], locale: 'en', width: 320 } },
  records: [
    {
      match: { source: 'feature.tsx', component: 'Screen', kind: 'Button', labelIncludes: 'Save' },
      expectedMatches: 1,
      states: { default: { status: 'verified', evidenceId: 'save', pixelReviewed: false } },
      ...record,
    },
  ],
})

test('a named state retains exact fixture scope and leaves all other states pending', () => {
  const input = { surfaces: [surface('one')] }
  const { inventory, report } = mergeInventoryEvidence(input, [overlay()])
  assert.equal(report.exactRecordsApplied, 1)
  assert.equal(inventory.surfaces[0].status, 'partial-bounded-evidence')
  assert.equal(inventory.surfaces[0].states.error.status, 'pending')
  assert.deepEqual(inventory.surfaces[0].states.default.boundedBindings[0].scope.roles, ['head'])
  assert.equal(input.surfaces[0].status, 'pending')
})

test('ambiguous selectors and unsupported attributes cannot turn a component into a pass', () => {
  for (const record of [
    {},
    { match: { source: 'feature.tsx', component: 'Screen', kind: 'Button', wildcard: true } },
  ]) {
    const { inventory, report } = mergeInventoryEvidence(
      { surfaces: [surface('one'), surface('two')] },
      [overlay(record)],
    )
    assert.equal(report.exactRecordsApplied, 0)
    assert.equal(report.issues.length, 1)
    assert.ok(inventory.surfaces.every((item) => item.status === 'pending'))
  }
})

test('a changed selector or removed record clears only its author’s prior scoped evidence', () => {
  const first = mergeInventoryEvidence({ surfaces: [surface('one')] }, [overlay()]).inventory
  const other = { ...overlay(), owner: 'other-owner' }
  const layered = mergeInventoryEvidence(first, [other]).inventory
  const changed = overlay({ match: { source: 'renamed.tsx', component: 'Screen', kind: 'Button' } })
  const { inventory, report } = mergeInventoryEvidence(layered, [changed])
  assert.equal(report.exactRecordsApplied, 0)
  assert.deepEqual(inventory.surfaces[0].states.default.evidence, ['other-owner:save'])
  assert.equal(inventory.surfaces[0].states.default.boundedBindings.length, 1)
  const cleared = mergeInventoryEvidence(inventory, [{ ...other, records: [] }]).inventory
  assert.equal(cleared.surfaces[0].states.default.status, 'pending')
  assert.equal(cleared.surfaces[0].status, 'pending')
  assert.deepEqual(cleared.surfaces[0].evidence, [])
})

test('invalid state evidence refuses the entire record rather than half applying it', () => {
  const record = {
    states: {
      default: { status: 'verified', evidenceId: 'save' },
      error: { status: 'verified', evidenceId: 'missing' },
    },
  }
  const { inventory, report } = mergeInventoryEvidence({ surfaces: [surface('one')] }, [
    overlay(record),
  ])
  assert.equal(report.exactRecordsApplied, 0)
  assert.equal(inventory.surfaces[0].states.default.status, 'pending')
})

test('two scoped documents from one author retain both proofs without clearing or key collisions', () => {
  const second = overlay()
  second.evidence = { second: { roles: ['member'], browsers: ['firefox'], locale: 'ru' } }
  second.records[0].states.default.evidenceId = 'second'
  const first = mergeInventoryEvidence({ surfaces: [surface('one')] }, [overlay(), second])
  assert.equal(first.report.exactRecordsApplied, 2)
  const state = first.inventory.surfaces[0].states.default
  assert.deepEqual(state.evidence, ['owner:save', 'owner:second'])
  assert.equal(state.boundedBindings.length, 2)
  assert.notEqual(state.boundedBindings[0].key, state.boundedBindings[1].key)
  const again = mergeInventoryEvidence(first.inventory, [overlay(), second])
  assert.equal(again.inventory.surfaces[0].states.default.boundedBindings.length, 2)
})

test('workflow-only overlays are retained without inferred surface bindings', () => {
  const broad = overlay()
  broad.records = []
  const { inventory, report } = mergeInventoryEvidence({ surfaces: [surface('one')] }, [broad])
  assert.equal(report.workflowEntries.length, 1)
  assert.equal(inventory.surfaces[0].status, 'pending')
})

test('long child text is matched exactly beyond the display excerpt without altering source IDs', () => {
  const item = {
    ...surface('same-id'),
    childSummary: 'long icon expression',
    childText: 'long icon expression then {label.name}',
  }
  const bounded = overlay({
    match: {
      source: 'feature.tsx',
      component: 'Screen',
      kind: 'Button',
      childSummaryIncludes: '{label.name}',
    },
  })
  const { inventory, report } = mergeInventoryEvidence({ surfaces: [item] }, [bounded])
  assert.equal(report.exactRecordsApplied, 1)
  assert.equal(inventory.surfaces[0].id, 'same-id')
})

test('reruns are idempotent and missing pixels never acquire a review claim', () => {
  const marked = overlay({
    states: {
      default: {
        status: 'tested',
        evidenceId: 'save',
        pixelReviewed: true,
        pixelReviewedArtifacts: ['missing.png'],
      },
    },
  })
  const once = mergeInventoryEvidence({ surfaces: [surface('one')] }, [marked], () => false)
  const twice = mergeInventoryEvidence(once.inventory, [marked], () => false)
  assert.equal(twice.inventory.surfaces[0].states.default.boundedBindings.length, 1)
  assert.equal(twice.inventory.surfaces[0].states.default.boundedBindings[0].pixelReviewed, false)
  assert.deepEqual(twice.inventory.surfaces[0].states.default.evidence, ['owner:save'])
  assert.equal(twice.report.issues.length, 1)
})
