// React-flavoured ESLint 9 flat config, extending the shared base. For apps/web (and any future
// React surface) -- consume as: import react from '@devon/config/eslint/react.js'.
import base from './base.js'
import reactPlugin from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import globals from 'globals'

export default [
  ...base,
  {
    files: ['**/*.{jsx,tsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs['jsx-runtime'].rules, // React 19: no `import React` needed
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      // I-12 (keyboard-only primary flows) and axe (a11y gate) both start here.
      'jsx-a11y/no-autofocus': 'warn',
    },
  },
]
