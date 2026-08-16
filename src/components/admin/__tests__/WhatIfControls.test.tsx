// src/components/admin/__tests__/WhatIfControls.test.tsx
// #427: the admin-facing half of the what-if projection.

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WhatIfControls, type WhatIfField } from '../WhatIfControls'

const FIELDS: WhatIfField[] = [
  { key: 'resources', label: 'Resources', min: 0, max: 100 },
  { key: 'stability', label: 'Stability', min: 0, max: 100 },
]

const ACTUAL = { resources: 40, stability: 55 }

function renderControls(props: Partial<React.ComponentProps<typeof WhatIfControls>> = {}) {
  const onApply = vi.fn()
  const onReset = vi.fn()
  render(
    <WhatIfControls fields={FIELDS} actual={ACTUAL} onApply={onApply} onReset={onReset} {...props} />
  )
  return { onApply, onReset }
}

describe('WhatIfControls (#427)', () => {
  it('shows the real value beside each field so the admin need not remember it', () => {
    renderControls()

    expect(screen.getByText(/now 40/)).toBeTruthy()
    expect(screen.getByText(/now 55/)).toBeTruthy()
  })

  it('sends only the fields that were actually filled in', () => {
    const { onApply } = renderControls()

    fireEvent.change(screen.getByLabelText('Resources what-if value'), { target: { value: '80' } })
    fireEvent.click(screen.getByRole('button', { name: 'Project' }))

    // Not `{ resources: 80, stability: 55 }` — sending the untouched field
    // as an "override" would make every projection a hypothetical and the
    // Hypothetical badge permanent, which would train the admin to ignore
    // the one signal that matters.
    expect(onApply).toHaveBeenCalledWith({ resources: 80 })
  })

  it('sends several overrides together', () => {
    const { onApply } = renderControls()

    fireEvent.change(screen.getByLabelText('Resources what-if value'), { target: { value: '80' } })
    fireEvent.change(screen.getByLabelText('Stability what-if value'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Project' }))

    expect(onApply).toHaveBeenCalledWith({ resources: 80, stability: 10 })
  })

  it('marks the projection as hypothetical once the server says it applied one', () => {
    // The single most important element. A projection from invented numbers
    // that looks like a projection from real state is worse than no preview
    // at all, because an admin could act on it.
    renderControls({ overridden: ['resources'] })

    expect(screen.getByText(/Hypothetical/)).toBeTruthy()
  })

  it('shows no hypothetical badge when nothing was overridden', () => {
    renderControls({ overridden: [] })

    expect(screen.queryByText(/Hypothetical/)).toBeNull()
  })

  it('surfaces the server’s rejection verbatim rather than re-deriving it', () => {
    // Duplicating the bounds client-side is how the two drift apart; the
    // server owns validation and this renders what it said.
    renderControls({ rejected: ['resources: 150 is outside 0–100'] })

    expect(screen.getByText('resources: 150 is outside 0–100')).toBeTruthy()
  })

  it('clears the draft and asks for real state on reset', () => {
    const { onReset } = renderControls({ overridden: ['resources'] })

    fireEvent.change(screen.getByLabelText('Resources what-if value'), { target: { value: '80' } })
    fireEvent.click(screen.getByRole('button', { name: /Back to real state/ }))

    expect(onReset).toHaveBeenCalled()
    expect((screen.getByLabelText('Resources what-if value') as HTMLInputElement).value).toBe('')
  })

  it('disables reset when there is nothing to go back from', () => {
    renderControls({ overridden: [] })

    expect((screen.getByRole('button', { name: /Back to real state/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables both actions while a projection is in flight', () => {
    renderControls({ busy: true, overridden: ['resources'] })

    expect((screen.getByRole('button', { name: 'Projecting…' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Back to real state/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('ignores a non-numeric entry rather than sending NaN to the server', () => {
    const { onApply } = renderControls()

    fireEvent.change(screen.getByLabelText('Resources what-if value'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Project' }))

    expect(onApply).toHaveBeenCalledWith({})
  })
})
