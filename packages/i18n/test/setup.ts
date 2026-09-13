// This package's own suite compares all four catalogues against each other (key parity, banned
// words, dash rules) and switches locale synchronously in `t.test.ts`. `src/messages.ts` statically
// registers only the default locale so a browser's shell chunk carries one catalogue instead of
// four; registering the other three here restores the all-four, fully synchronous view that every
// Node-side caller of this package gets by importing `@devon/i18n/catalogues`.
import '../src/catalogues.js'
