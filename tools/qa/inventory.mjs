import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { storyApplicability } from './source-applicability.mjs'

const root = resolve(import.meta.dirname, '../..')
const requireWeb = createRequire(join(root, 'apps/web/package.json'))
const ts = requireWeb('typescript')
const output = join(root, 'docs/qa/2026-10')
const states = [
  'default',
  'hover',
  'focus',
  'active',
  'selected',
  'disabled',
  'loading',
  'empty',
  'populated',
  'validation',
  'error',
  'success',
]
// Include the actual layered surfaces as well as their controls; a child button's evidence does
// not establish the popup, dialog or keyboard state of its enclosing surface.
const interactive =
  /^(?:button|a|input|select|textarea|form|summary|details|dialog|article|canvas|audio|video|Button|IconButton|Checkbox|Switch|Input|Textarea|Combobox|Select|SegmentedControl|DatePicker|RadioOption|RadioGroup(?:Item)?|Tabs(?:Content|List|Trigger)?|Tab|MenuItem|DropdownMenu(?:Content|Item|Trigger|CheckboxItem|RadioItem)?|Dialog(?:Content|Trigger)?|Sheet(?:Content|Trigger)?|Popover(?:Content|Trigger)?|Tooltip(?:Content|Trigger)?|HoverCard(?:Content|Trigger)?|ContextMenu(?:Content|Item|Trigger|CheckboxItem|RadioItem)?|Collapsible(?:Content|Trigger)?|Table|DataList|DataRow|Card|Chip|FilterChip|Progress|ProgressRing|StateView|ForcedStateBlock|DemoChip)$/
const allFiles = []
function list(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) list(join(dir, entry.name))
    else if (/\.(?:tsx?|css)$/.test(entry.name) && !/\.(?:test|spec)\.[jt]sx?$/.test(entry.name))
      allFiles.push(join(dir, entry.name))
  }
}
list(join(root, 'apps/web/src'))
list(join(root, 'packages/ui/src'))
const old = existsSync(join(output, 'inventory.json'))
  ? JSON.parse(readFileSync(join(output, 'inventory.json'), 'utf8'))
  : {}
const prior = new Map((old.surfaces ?? []).map((s) => [s.id, s]))
const priorRoutes = new Map((old.routes ?? []).map((r) => [r.path, r]))
const surfaces = [],
  routes = new Map()
const astFiles = allFiles.filter((f) => /\.[jt]sx?$/.test(f))
const applicabilityFacts = {
  runtimeImportSpecifiers: [],
  runtimeGlobs: [],
  uiExportTargets: Object.values(
    JSON.parse(readFileSync(join(root, 'packages/ui/package.json'), 'utf8')).exports,
  ),
  storybookPatterns: [],
}
const storybookConfig = readFileSync(join(root, 'packages/ui/.storybook/main.ts'), 'utf8')
const storybookAst = ts.createSourceFile(
  'storybook/main.ts',
  storybookConfig,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
)
function readStorybookPatterns(node) {
  if (
    ts.isPropertyAssignment(node) &&
    node.name.getText(storybookAst) === 'stories' &&
    ts.isArrayLiteralExpression(node.initializer)
  )
    for (const pattern of node.initializer.elements)
      if (ts.isStringLiteralLike(pattern)) applicabilityFacts.storybookPatterns.push(pattern.text)
  ts.forEachChild(node, readStorybookPatterns)
}
readStorybookPatterns(storybookAst)
const slug = (s) => s.replaceAll('\\', '/')
const propName = (n) => n?.name?.getText()?.replace(/^['"]|['"]$/g, '')
const literal = (n) => (n && ts.isStringLiteralLike(n) ? n.text : null)
const historic = JSON.parse(readFileSync(join(root, 'e2e/routes.json'), 'utf8')).routes
for (const r of historic) routes.set(r.path, { ...r, sources: [], status: 'pending', evidence: [] })
for (const file of astFiles) {
  const path = slug(relative(root, file)),
    source = readFileSync(file, 'utf8')
  const ast = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const feature =
    /features\/([^/]+)\//.exec(path)?.[1] ??
    (path.startsWith('packages/ui') ? 'shared-ui' : 'shell-auth')
  const occurrences = new Map()
  function walk(node, owner = 'module') {
    if (!/\.stories\.tsx?$/.test(path)) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      )
        applicabilityFacts.runtimeImportSpecifiers.push(node.moduleSpecifier.text)
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0]
        applicabilityFacts.runtimeImportSpecifiers.push(
          argument && ts.isStringLiteralLike(argument)
            ? argument.text
            : '<computed runtime import>',
        )
      }
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 'import.meta.glob') {
        const argument = node.arguments[0]
        if (argument && ts.isStringLiteralLike(argument))
          applicabilityFacts.runtimeGlobs.push(argument.text)
        else if (argument && ts.isArrayLiteralExpression(argument))
          for (const item of argument.elements) {
            if (ts.isStringLiteralLike(item)) applicabilityFacts.runtimeGlobs.push(item.text)
            else applicabilityFacts.runtimeGlobs.push('<computed runtime glob>')
          }
        else applicabilityFacts.runtimeGlobs.push('<computed runtime glob>')
      }
    }
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name)
      owner = node.name.text
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    )
      owner = node.name.getText(ast)
    if (
      /manifest\.tsx?$/.test(file) &&
      ts.isPropertyAssignment(node) &&
      propName(node) === 'routes' &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      for (const item of node.initializer.elements) {
        if (!ts.isObjectLiteralExpression(item)) continue
        const props = Object.fromEntries(
          item.properties.filter(ts.isPropertyAssignment).map((p) => [propName(p), p.initializer]),
        )
        const pathValue = literal(props.path)
        if (!pathValue) continue
        const existing = routes.get(pathValue)
        routes.set(pathValue, {
          ...(existing ?? {
            path: pathValue,
            auth: pathValue.startsWith('/admin')
              ? 'super_admin'
              : ['register', 'join'].includes(pathValue.slice(1))
                ? 'public'
                : 'session',
            roles: ['head', 'member'],
            status: 'pending',
            evidence: [],
          }),
          feature,
          component: props.component?.getText(ast) ?? null,
          titleKey: literal(props.titleKey),
          sources: [...(existing?.sources ?? []), path],
        })
      }
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(ast)
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute)
      const interactiveProps = attrs.filter((a) =>
        /^on(?:Click|Submit|Change|KeyDown|PointerDown)|role$|tabIndex$/.test(a.name.getText(ast)),
      )
      if (interactive.test(tag) || interactiveProps.length) {
        const labels = attrs
          .filter(
            (a) =>
              /^(?:aria-label|title|name|placeholder|label|labelKey|aria-labelledby|data-testid|role|type)$/.test(
                a.name.getText(ast),
              ) ||
              (['StateView', 'ForcedStateBlock'].includes(tag) &&
                /^(?:titleKey|bodyKey|kind|state|action)$/.test(a.name.getText(ast))),
          )
          .map((a) => `${a.name.getText(ast)}=${a.initializer?.getText(ast) ?? 'true'}`)
        const parent = node.parent && ts.isJsxElement(node.parent) ? node.parent : null
        const childText = parent
          ? parent.children
              .map((c) => c.getText(ast).trim())
              .filter(Boolean)
              .join(' ')
          : ''
        const children = childText.slice(0, 220)
        const signature = `${path}:${owner}:${tag}:${labels.join('|')}:${children}`
        const occurrence = (occurrences.get(signature) ?? 0) + 1
        occurrences.set(signature, occurrence)
        const id = createHash('sha256')
          .update(`${signature}:${occurrence}`)
          .digest('hex')
          .slice(0, 16)
        const previous = prior.get(id)
        surfaces.push({
          id,
          feature,
          component: owner,
          kind: tag,
          source: path,
          line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
          labels,
          childSummary: children,
          childText,
          contentProvenance: ts.isJsxSelfClosingElement(node)
            ? 'enclosing JSX context; self-closing control has no children'
            : 'own JSX children',
          ownChildText: ts.isJsxSelfClosingElement(node) ? '' : childText,
          handlers: interactiveProps.map((a) => a.name.getText(ast)),
          permissionEvidence: 'derive from source and role fixture; not inferred from visibility',
          status: previous?.status ?? 'pending',
          evidence: previous?.evidence ?? [],
          states:
            previous?.states ??
            Object.fromEntries(states.map((s) => [s, { status: 'pending', evidence: [] }])),
        })
      }
    }
    ts.forEachChild(node, (child) => walk(child, owner))
  }
  walk(ast)
}
for (const surface of surfaces) {
  const applicability = storyApplicability(surface.source, applicabilityFacts)
  if (applicability) surface.applicability = applicability
}
for (const path of ['/login', '/setup', '/404']) {
  const existing = routes.get(path)
  routes.set(path, {
    ...(existing ?? { path, auth: 'public', status: 'pending', evidence: [] }),
    sources: ['apps/web/src/app.tsx'],
    feature: 'shell-auth',
  })
}
const routeList = [...routes.values()]
  .map((r) => ({
    ...r,
    status: priorRoutes.get(r.path)?.status ?? r.status,
    evidence: priorRoutes.get(r.path)?.evidence ?? r.evidence,
  }))
  .sort((a, b) => a.path.localeCompare(b.path))
mkdirSync(output, { recursive: true })
const inventory = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  provenance:
    'TypeScript AST of actual manifests/JSX and existing route contract; source discovery is not browser coverage.',
  languages: ['uz-Latn', 'uz-Cyrl', 'ru', 'en'],
  themes: ['light', 'dark', 'system'],
  roles: [
    'public',
    'fresh-account',
    'member',
    'head',
    'unit-head-member',
    'super_admin',
    'super_admin-view-as',
  ],
  environmentMatrix: {
    widths: [1920, 1440, 1280, 1024, 768, 390, 320],
    shortViewport: { width: 1280, height: 600 },
    textZoomPercent: 200,
    desktopZoomPercent: 400,
    reducedMotion: true,
  },
  releaseScopeSteering: {
    recordedOn: '2026-10-09',
    source: 'Latest user steering relayed by the root agent',
    policy:
      'Finish normal-use workflows and release gates now. Tiny-screen/enlarged-text cases are deferred by the user and are not release blockers; retain their actual historical results without relabelling failures as passes.',
    deferredCombinations: ['tiny-screen with enlarged text', 'new optional enlarged-text matrices'],
    existingEvidence:
      'Already executed geometry and pixel evidence remains bounded to its original report. This scope change creates no tested state or component pass.',
  },
  localIntegrationPolicy:
    'Telegram and application AI external calls and tutorial walkthroughs excluded in the current scope; disabled/unavailable boundaries remain in scope. Video work awaits the latest explicit approval prerequisite.',
  routes: routeList,
  surfaces,
  sourceCompleteness: {
    filesDiscovered: allFiles.length,
    filesParsed: astFiles.length,
    routeCount: routeList.length,
    surfaceCount: surfaces.length,
    storybookOnlySurfaces: surfaces.filter(
      (surface) => surface.applicability?.status === 'not-applicable',
    ).length,
    discoveredOnly: true,
  },
  sourceApplicabilityProof: {
    id: 'storybook-source-boundary',
    policy:
      'Only exact *.stories.ts(x) source is inapplicable to ordinary routes. Tests and pixels remain pending; shared runtime components are never excluded by this classification.',
    references: [
      'apps/web/src/index.html',
      'apps/web/src/main.tsx',
      'apps/web/src/features/registry.ts',
      'packages/ui/package.json',
      'packages/ui/src/index.ts',
      'packages/ui/.storybook/main.ts',
    ].map((source) => ({
      source,
      sha256: createHash('sha256')
        .update(readFileSync(join(root, source)))
        .digest('hex'),
    })),
    runtimeImportSpecifiers: [...new Set(applicabilityFacts.runtimeImportSpecifiers)],
    runtimeGlobs: [...new Set(applicabilityFacts.runtimeGlobs)],
    uiExportTargets: applicabilityFacts.uiExportTargets,
    storybookPatterns: applicabilityFacts.storybookPatterns,
  },
  testFileAliases: [
    {
      historical: 'apps/web/test/e2e/canvas-controls.flow.spec.ts',
      current: 'apps/web/test/e2e/canvas-controls.qa.spec.ts',
      note: 'Mechanical QA segregation rename; older executed reports retain the historical filename. The alias does not establish new execution coverage.',
    },
  ],
}
writeFileSync(join(output, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n')
const csv = (value) => `"${String(value).replaceAll('"', '""')}"`
writeFileSync(
  join(output, 'traceability.csv'),
  [
    'id,feature,component,kind,source,line,status,evidence,colleagueRouteApplicability',
    ...surfaces.map((s) =>
      [
        s.id,
        s.feature,
        s.component,
        s.kind,
        s.source,
        s.line,
        s.status,
        s.evidence.join(';'),
        s.applicability?.status ?? 'pending',
      ]
        .map(csv)
        .join(','),
    ),
  ].join('\n') + '\n',
)
console.log(
  JSON.stringify({
    files: allFiles.length,
    routes: routeList.length,
    surfaces: surfaces.length,
    status: 'source-discovered; browser/pixel/transition evidence still required',
  }),
)
