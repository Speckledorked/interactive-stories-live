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

/** A few lines of placeholder prose. Last line is short, as real text is. */
export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-4', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  )
}

/** Placeholder matching the reference-card shape used across the app. */
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={cn('rounded-xl border border-myth-border bg-myth-surface p-5', className)} aria-hidden>
      <Skeleton className="h-5 w-1/3" />
      <div className="mt-3 space-y-2">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-4/5" />
      </div>
    </div>
  )
}

/**
 * Wrapper that announces loading to assistive tech while showing visual
 * skeletons. Without this the skeletons are aria-hidden and a screen
 * reader hears nothing at all during the wait.
 */
export function SkeletonRegion({ label = 'Loading', children }: { label?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy aria-label={label}>
      {children}
    </div>
  )
}
