'use client'

import { useEffect, useRef } from 'react'

/**
 * Calls onEscape whenever the Escape key is pressed, while enabled is true.
 * Consolidates the "close this panel/modal on Escape" useEffect that used
 * to be hand-written, slightly differently each time, across several
 * components (AdminNav's drawer, KeyboardShortcutsModal,
 * CharacterSnapshotModal, TavernMobileMenu, and the escape half of
 * FieldHelp/StatBar's dismissible popovers — their outside-click handling
 * stays where it is, since that part isn't the same duplication).
 *
 * onEscape is read through a ref rather than listed as an effect
 * dependency, so passing a fresh inline arrow function each render (as
 * most callers do) doesn't tear down and re-attach the listener on every
 * render — the effect only re-runs when `enabled` itself changes.
 *
 * Always calls useEffect unconditionally — the `enabled` check happens
 * inside the effect body, not by skipping the hook call itself. This
 * matters: CharacterSnapshotModal previously had its equivalent effect
 * declared textually after an `if (!isOpen) return null`, which is only
 * safe if the component is unmounted whenever isOpen is false. Its actual
 * caller (story/page.tsx) mounts it whenever `selectedCharacterId` is set
 * and toggles `isOpen` independently — so the old code could call a
 * different number of hooks between renders of the same mounted instance,
 * a real Rules-of-Hooks violation. Gating internally fixes that as a
 * side effect of removing the duplication, without changing when Escape
 * actually closes the modal.
 */
export function useEscapeKey(onEscape: () => void, enabled: boolean = true): void {
  const onEscapeRef = useRef(onEscape)
  onEscapeRef.current = onEscape

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscapeRef.current()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled])
}
