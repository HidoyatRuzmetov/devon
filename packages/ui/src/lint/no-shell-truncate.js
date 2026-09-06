// Package-local ESLint rule (EPIC-000.4 handoff, design.md §3.5/§4(i), AC-6): nothing under
// `packages/ui/src/shell/**` may ellipsize a label. Russian and Uzbek run 20-35% longer than English;
// the fix for an overflowing string is always a shorter i18n *key*, never a clipped one. This rule is
// a gate, not a style preference -- it is scoped to `src/shell/**` only in `src/lint/eslint.config.js`.
const TRUNCATE_CLASS = /(^|\s)(truncate|text-ellipsis)(\s|$)/

/** @type {import('eslint').Rule.RuleModule} */
const noShellTruncate = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid `truncate` / `text-overflow: ellipsis` in packages/ui/src/shell/** (design.md §3.5, AC-6).',
    },
    schema: [],
    messages: {
      classTruncate:
        'No `{{token}}` utility class in shell/** -- design.md §3.5 forbids ellipsis in the shell (AC-6). Shorten the i18n key or let the label wrap.',
      styleEllipsis:
        'No `textOverflow: "ellipsis"` in shell/** -- design.md §3.5 forbids ellipsis in the shell (AC-6).',
      cssEllipsis:
        'No `text-overflow: ellipsis` in a shell/** template literal -- design.md §3.5 forbids ellipsis in the shell (AC-6).',
    },
  },
  create(context) {
    /** @param {import('estree').Node} node @param {string | undefined} raw */
    function checkClassString(node, raw) {
      if (typeof raw !== 'string') return
      const match = raw.match(TRUNCATE_CLASS)
      if (match) context.report({ node, messageId: 'classTruncate', data: { token: match[2] } })
      if (/text-overflow\s*:\s*ellipsis/.test(raw)) {
        context.report({ node, messageId: 'cssEllipsis' })
      }
    }

    /** @param {import('estree').Node} node */
    function checkExpression(node) {
      if (!node) return
      if (node.type === 'Literal' && typeof node.value === 'string') {
        checkClassString(node, node.value)
      } else if (node.type === 'TemplateLiteral') {
        for (const quasi of node.quasis) checkClassString(node, quasi.value.raw)
      } else if (node.type === 'CallExpression') {
        // cn(...) / clsx(...) with string / template literal arguments
        for (const arg of node.arguments) checkExpression(arg)
      } else if (node.type === 'ConditionalExpression') {
        checkExpression(node.consequent)
        checkExpression(node.alternate)
      } else if (node.type === 'LogicalExpression') {
        checkExpression(node.left)
        checkExpression(node.right)
      }
    }

    return {
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'className') return
        const value = node.value
        if (!value) return
        if (value.type === 'Literal' && typeof value.value === 'string') {
          checkClassString(node, value.value)
        } else if (value.type === 'JSXExpressionContainer') {
          checkExpression(value.expression)
        }
      },
      Property(node) {
        const key = node.key
        const keyName =
          key.type === 'Identifier' ? key.name : key.type === 'Literal' ? String(key.value) : null
        if (keyName !== 'textOverflow') return
        if (node.value.type === 'Literal' && typeof node.value.value === 'string') {
          if (/ellipsis/.test(node.value.value)) {
            context.report({ node, messageId: 'styleEllipsis' })
          }
        }
      },
    }
  },
}

export default { rules: { 'no-shell-truncate': noShellTruncate } }
