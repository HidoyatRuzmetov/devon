// Shared ESLint 9 flat config for every Devon workspace package.
// Consume it as: import base from '@devon/config/eslint/base.js'; export default [...base, { ... }]
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/.turbo/**', '**/node_modules/**', '**/*.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // No feature is worth a console.log left behind in production code (TECH-SPEC §16).
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Namespace imports and `any` erode the point of Zod-as-source-of-truth (TECH-SPEC §16).
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-restricted-syntax': [
        'error',
        {
          // await-in-a-loop over independent items is a named anti-pattern (TECH-SPEC §16); a
          // sequential loop with an intentional dependency should use a plain for-loop with a
          // comment, which this rule does not touch (it only flags `for-of`/`for-in` bodies).
          selector: 'ForOfStatement > BlockStatement > ExpressionStatement > AwaitExpression',
          message:
            'Avoid awaiting inside a for-of loop over independent items; use Promise.all (TECH-SPEC §16).',
        },
      ],
    },
  },
)
