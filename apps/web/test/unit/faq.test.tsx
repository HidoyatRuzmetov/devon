import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { setLocale } from '@devon/i18n'
import FaqScreen from '../../src/features/pages/faq-screen.js'

describe('quick help', () => {
  it('keeps answers folded, searches answer text, and explains empty results', () => {
    setLocale('en')
    const { container } = render(<FaqScreen />)
    expect(container.querySelectorAll('details')).toHaveLength(9)
    expect(container.querySelectorAll('details[open]')).toHaveLength(0)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'quiet hours' } })
    expect(container.querySelectorAll('details')).toHaveLength(1)
    expect(container.querySelectorAll('details[open]')).toHaveLength(1)
    expect(screen.getByText('How do I connect Telegram and control notifications?')).toBeVisible()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzznomatch' } })
    expect(screen.getByRole('status')).toHaveTextContent('No matching answer')
  })
})
