// src/components/character/__tests__/ConsequenceBadge.test.tsx
//
// #292: Character.consequences.debts is a freeform string array — the
// AI-narration path into it was aliased into the real, mechanically-live
// Debt model (see lib/game/debts.ts), and the character-creation form's
// own "Debts Owed" field is the only thing that still writes it, as pure
// flavor text. Neither source is linked to Debt.status, so a 'debt'
// consequence can never be marked resolved and may already be settled.
// This pins that the badge is now honest about that, distinct from the
// real Debt economy shown elsewhere on the sheet (the Obligations
// section) — every other consequence type is unaffected.

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ConsequenceBadge from '../ConsequenceBadge'

describe('ConsequenceBadge', () => {
  it('labels a debt distinctly from the tracked Debt economy and explains why', () => {
    render(<ConsequenceBadge type="debt" description="Owes the Duke a favor" />)
    expect(screen.getByText('Noted Debt')).toBeTruthy()
    expect(screen.getByText('Owes the Duke a favor')).toBeTruthy()
    expect(screen.getByText(/not linked to the tracked Debt economy/i)).toBeTruthy()
  })

  it('shows no such note for a promise', () => {
    render(<ConsequenceBadge type="promise" description="Swore an oath to the King" />)
    expect(screen.getByText('Promise')).toBeTruthy()
    expect(screen.queryByText(/not linked to the tracked Debt economy/i)).toBeNull()
  })

  it('shows no such note for an enemy', () => {
    render(<ConsequenceBadge type="enemy" description="The Baron wants revenge" />)
    expect(screen.getByText('Enemy')).toBeTruthy()
    expect(screen.queryByText(/not linked to the tracked Debt economy/i)).toBeNull()
  })

  it('shows no such note for a long-term threat', () => {
    render(<ConsequenceBadge type="longTermThreat" description="The cult is hunting them" />)
    expect(screen.getByText('Threat')).toBeTruthy()
    expect(screen.queryByText(/not linked to the tracked Debt economy/i)).toBeNull()
  })
})
