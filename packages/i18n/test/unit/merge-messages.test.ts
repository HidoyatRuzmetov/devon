import { describe, expect, it } from 'vitest'
import { mergeMessageTree } from '../../src/cli/merge-messages.js'

describe('mergeMessageTree (i18n module merge)', () => {
  it('folds a module tree into the base tree, leaving unrelated base keys untouched', () => {
    const base = { shell: { nav: { home: 'Home' } } }
    const incoming = { people: { title: 'People' } }
    expect(mergeMessageTree(base, incoming, 'people')).toEqual({
      shell: { nav: { home: 'Home' } },
      people: { title: 'People' },
    })
  })

  it('merges nested objects instead of replacing the whole subtree', () => {
    const base = { shell: { nav: { home: 'Home' } } }
    const incoming = { shell: { nav: { admin: 'Admin' } } }
    expect(mergeMessageTree(base, incoming, 'admin')).toEqual({
      shell: { nav: { home: 'Home', admin: 'Admin' } },
    })
  })

  it('throws when a module key collides with an incompatible shape (string vs. object)', () => {
    const base = { people: 'not a tree' }
    const incoming = { people: { title: 'People' } }
    expect(() => mergeMessageTree(base, incoming, 'people')).toThrow(/collides/)
  })

  it('is pure: does not mutate either input', () => {
    const base = { a: { b: 'x' } }
    const incoming = { a: { c: 'y' } }
    const baseCopy = JSON.parse(JSON.stringify(base))
    const incomingCopy = JSON.parse(JSON.stringify(incoming))
    mergeMessageTree(base, incoming, 'mod')
    expect(base).toEqual(baseCopy)
    expect(incoming).toEqual(incomingCopy)
  })
})
