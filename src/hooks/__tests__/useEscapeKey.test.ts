// src/hooks/__tests__/useEscapeKey.test.ts
//
// This hook consolidates what used to be six near-identical hand-written
// "close on Escape" effects across AdminNav, KeyboardShortcutsModal,
// CharacterSnapshotModal, TavernMobileMenu, and the escape half of
// FieldHelp/StatBar's dismissible popovers. These tests pin the contract
// all of them relied on: fires only on Escape, only while enabled, and
// always calls the *latest* callback even if the caller passes a fresh
// inline function every render (which most of them do).

import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useEscapeKey } from '../useEscapeKey'

function pressEscape() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
}

function pressKey(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key }))
}

describe('useEscapeKey', () => {
  it('calls onEscape when Escape is pressed', () => {
    const onEscape = vi.fn()
    renderHook(() => useEscapeKey(onEscape))

    pressEscape()

    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('does not call onEscape for any other key', () => {
    const onEscape = vi.fn()
    renderHook(() => useEscapeKey(onEscape))

    pressKey('Enter')
    pressKey('a')

    expect(onEscape).not.toHaveBeenCalled()
  })

  it('does not call onEscape while enabled is false', () => {
    const onEscape = vi.fn()
    renderHook(() => useEscapeKey(onEscape, false))

    pressEscape()

    expect(onEscape).not.toHaveBeenCalled()
  })

  it('starts responding once enabled flips from false to true', () => {
    const onEscape = vi.fn()
    const { rerender } = renderHook(({ enabled }) => useEscapeKey(onEscape, enabled), {
      initialProps: { enabled: false },
    })

    pressEscape()
    expect(onEscape).not.toHaveBeenCalled()

    rerender({ enabled: true })
    pressEscape()
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('stops responding once enabled flips from true to false', () => {
    const onEscape = vi.fn()
    const { rerender } = renderHook(({ enabled }) => useEscapeKey(onEscape, enabled), {
      initialProps: { enabled: true },
    })

    rerender({ enabled: false })
    pressEscape()

    expect(onEscape).not.toHaveBeenCalled()
  })

  it('always calls the latest callback, even without re-registering on every render', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ cb }) => useEscapeKey(cb), {
      initialProps: { cb: first },
    })

    rerender({ cb: second })
    pressEscape()

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('removes its listener on unmount', () => {
    const onEscape = vi.fn()
    const { unmount } = renderHook(() => useEscapeKey(onEscape))

    unmount()
    pressEscape()

    expect(onEscape).not.toHaveBeenCalled()
  })
})
