// src/components/ui/skeleton.tsx
//
// New. The app currently shows a bare centred spinner for every loading
// state, which on a phone means the whole screen is blank until data
// lands. A skeleton that matches the shape of what's coming reads as
// faster even when it isn't, and stops the layout jumping on arrival.
//
// `motion-reduce:animate-none` respects a user's reduced-motion setting —
// a pulsing block is exactly the kind of thing that setting exists for.

import React from 'react'
import { cn } from './styles'

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-md bg-myth-surface-sunken motion-reduce:animate-none', className)}
    />
  )
}



