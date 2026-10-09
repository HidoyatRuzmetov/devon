import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const matchKeys = new Set(['source', 'component', 'kind', 'labelIncludes', 'childSummaryIncludes'])

function matches(surface, match) {
  return (
    surface.source === match.source &&
    surface.component === match.component &&
    surface.kind === match.kind &&
    (!match.labelIncludes || surface.labels.some((label) => label.includes(match.labelIncludes))) &&
    (!match.childSummaryIncludes ||
      (surface.childText ?? surface.childSummary).includes(match.childSummaryIncludes))
  )
}

/** Evidence covers only the named state and the fixture scope supplied by its author. A source
 * match never establishes every state, environment or nested control of the same component. */
export function mergeInventoryEvidence(input, overlays, artifactExists = () => true) {
  const inventory = structuredClone(input)
  const report = {
    exactRecordsApplied: 0,
    stateBindingsApplied: 0,
    issues: [],
    owners: [],
    workflowEntries: [],
  }
  for (const owner of new Set(overlays.map((overlay) => overlay.owner))) {
    // Reconcile the author's previous bindings before applying the current exact selectors. A
    // removed record or changed cardinality must not leave stale coverage from an earlier merge.
    for (const surface of inventory.surfaces) {
      const removedReferences = new Set()
      for (const state of Object.values(surface.states)) {
        const owned = (state.boundedBindings ?? []).filter((binding) =>
          binding.key.startsWith(`${owner}:`),
        )
        for (const binding of owned) removedReferences.add(binding.reference)
        state.boundedBindings = (state.boundedBindings ?? []).filter(
          (binding) => !binding.key.startsWith(`${owner}:`),
        )
        state.evidence = (state.evidence ?? []).filter(
          (reference) => !owned.some((binding) => binding.reference === reference),
        )
        if (state.status === 'bounded-evidence' && !state.boundedBindings.length)
          state.status = 'pending'
      }
      surface.evidence = (surface.evidence ?? []).filter(
        (reference) => !removedReferences.has(reference),
      )
      if (
        surface.status === 'partial-bounded-evidence' &&
        !Object.values(surface.states).some((state) => state.boundedBindings?.length)
      )
        surface.status = 'pending'
    }
  }
  for (const [overlayIndex, overlay] of overlays.entries()) {
    report.owners.push(overlay.owner)
    // Free-form workflow descriptions stay separate: they cannot safely identify individual JSX.
    for (const entry of overlay.entries ?? [])
      report.workflowEntries.push({
        owner: overlay.owner,
        ...entry,
        surfaceBinding: 'not inferred',
      })
    for (const [recordIndex, record] of (overlay.records ?? []).entries()) {
      const issue = (reason, extra = {}) =>
        report.issues.push({
          owner: overlay.owner,
          recordIndex,
          match: record.match,
          reason,
          ...extra,
        })
      const match = record.match ?? {}
      if (
        !match.source ||
        !match.component ||
        !match.kind ||
        Object.keys(match).some((key) => !matchKeys.has(key))
      ) {
        issue('Incomplete or unsupported source selector')
        continue
      }
      if (!Number.isSafeInteger(record.expectedMatches) || record.expectedMatches < 1) {
        issue('A positive exact expectedMatches count is required')
        continue
      }
      const targets = inventory.surfaces.filter((surface) => matches(surface, match))
      if (targets.length !== record.expectedMatches) {
        issue('Source cardinality changed; manual reconciliation required', {
          expected: record.expectedMatches,
          actual: targets.length,
        })
        continue
      }
      const states = Object.entries(record.states ?? {})
      if (
        !states.length ||
        states.some(
          ([state, evidence]) =>
            !targets.every((target) => target.states[state]) ||
            !['tested', 'verified'].includes(evidence.status) ||
            !overlay.evidence?.[evidence.evidenceId],
        )
      ) {
        issue('Unknown state, unsupported status or missing scoped evidence; record not applied')
        continue
      }
      for (const target of targets) {
        for (const [stateName, stateEvidence] of states) {
          const reference = `${overlay.owner}:${stateEvidence.evidenceId}`
          const artifacts = stateEvidence.pixelReviewedArtifacts ?? []
          const missingPixels = artifacts.filter((path) => !artifactExists(path))
          if (stateEvidence.pixelReviewed && (!artifacts.length || missingPixels.length))
            issue(
              'Pixel review reference unavailable; functional binding retained without pixel claim',
              { state: stateName, missingPixels },
            )
          const binding = {
            key: `${overlay.owner}:${overlayIndex}:${recordIndex}:${stateName}`,
            reference,
            authorStatus: stateEvidence.status,
            scopeNote: record.scopeNote ?? '',
            scope: structuredClone(overlay.evidence[stateEvidence.evidenceId]),
            pixelReviewed: Boolean(
              stateEvidence.pixelReviewed && artifacts.length && !missingPixels.length,
            ),
            pixelReviewedArtifacts: artifacts.filter((path) => artifactExists(path)),
          }
          const state = target.states[stateName]
          state.boundedBindings = [
            ...(state.boundedBindings ?? []).filter((prior) => prior.key !== binding.key),
            binding,
          ]
          state.evidence = [...new Set([...(state.evidence ?? []), reference])]
          state.status = 'bounded-evidence'
          target.evidence = [...new Set([...(target.evidence ?? []), reference])]
          target.status = 'partial-bounded-evidence'
          report.stateBindingsApplied += 1
        }
      }
      report.exactRecordsApplied += 1
    }
  }
  inventory.evidenceReconciliation = {
    generatedAt: new Date().toISOString(),
    policy:
      'Only exact source selectors and explicitly named scoped states are bound. Unlisted states and combinations remain pending. No surface or component receives an unconditional pass.',
    ...report,
  }
  return { inventory, report }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '../..')
  const output = resolve(root, 'docs/qa/2026-10')
  const names = process.argv.slice(2)
  const files = names.length
    ? names
    : [
        'events-management-admin-evidence.json',
        'visual-controls-evidence.json',
        'knowledge-nested-evidence.json',
        'account-settings-evidence.json',
        'calendar-fields-evidence.json',
        'calendar-shell-evidence.json',
        'fields-current-evidence.json',
        'knowledge-publication-evidence.json',
        'sidebar-evidence.json',
        'head-scope-evidence.json',
        'shell-recovery-evidence.json',
        'goals-evidence.json',
        'work-controls-evidence.json',
        'events-nested-evidence.json',
      ]
  const overlays = files.map((file) => JSON.parse(readFileSync(resolve(output, file), 'utf8')))
  const input = JSON.parse(readFileSync(resolve(output, 'inventory.json'), 'utf8'))
  const { inventory, report } = mergeInventoryEvidence(input, overlays, (path) =>
    existsSync(resolve(root, path)),
  )
  writeFileSync(resolve(output, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n')
  writeFileSync(
    resolve(output, 'evidence-reconciliation.json'),
    JSON.stringify(report, null, 2) + '\n',
  )
  const csv = (value) => `"${String(value).replaceAll('"', '""')}"`
  writeFileSync(
    resolve(output, 'traceability.csv'),
    [
      'id,feature,component,kind,source,line,status,evidence,colleagueRouteApplicability',
      ...inventory.surfaces.map((surface) =>
        [
          surface.id,
          surface.feature,
          surface.component,
          surface.kind,
          surface.source,
          surface.line,
          surface.status,
          surface.evidence.join(';'),
          surface.applicability?.status ?? 'pending',
        ]
          .map(csv)
          .join(','),
      ),
    ].join('\n') + '\n',
  )
  console.log(
    JSON.stringify({
      records: report.exactRecordsApplied,
      stateBindings: report.stateBindingsApplied,
      issues: report.issues.length,
      policy: 'partial scoped evidence only',
    }),
  )
}
