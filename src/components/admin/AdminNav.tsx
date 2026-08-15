'use client'

import { useEffect, useState } from 'react'
import { Menu, X, ChevronDown } from 'lucide-react'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'

export type AdminTabKey =
  | 'overview'
  | 'npcs'
  | 'factions'
  | 'wars'
  | 'clocks'
  | 'locations'
  | 'lore'
  | 'map'
  | 'ai'
  | 'integrity'
  | 'members'
  | 'invites'
  | 'safety'
  | 'data'

interface AdminNavItem {
  key: AdminTabKey
  label: string
}

interface AdminNavGroup {
  key: string
  label: string
  items: AdminNavItem[]
}

// Grouped by what an admin is actually trying to do, not by history. World
// holds every living simulation entity together (including Wars/Clocks,
// which used to be split off into "Story Engine" alongside an unrelated
// config screen and a diagnostics screen for no reason beyond history) —
// see docs/ARCHITECTURE.md's admin-tooling Scorecard row for the full
// before/after rationale.
export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  { key: 'overview', label: 'Overview', items: [{ key: 'overview', label: 'Overview' }] },
  {
    key: 'world',
    label: 'World',
    items: [
      { key: 'npcs', label: 'NPCs' },
      { key: 'factions', label: 'Factions' },
      { key: 'wars', label: 'Wars' },
      { key: 'clocks', label: 'Threads' },
      { key: 'locations', label: 'Locations' },
      { key: 'lore', label: 'Lore' },
      { key: 'map', label: 'Map' },
    ],
  },
  { key: 'configuration', label: 'Configuration', items: [{ key: 'ai', label: 'Configuration' }] },
  {
    key: 'players',
    label: 'Players',
    items: [
      { key: 'members', label: 'Members' },
      { key: 'invites', label: 'Invites' },
    ],
  },
  { key: 'safety', label: 'Safety & Publishing', items: [{ key: 'safety', label: 'Safety & Publishing' }] },
  {
    key: 'diagnostics',
    label: 'Diagnostics & Data',
    items: [
      { key: 'integrity', label: 'World Integrity' },
      { key: 'data', label: 'Data & Advanced' },
    ],
  },
]

function findLocation(activeKey: AdminTabKey) {
  for (const group of ADMIN_NAV_GROUPS) {
    const item = group.items.find((i) => i.key === activeKey)
    if (item) return { group, item }
  }
  return { group: ADMIN_NAV_GROUPS[0], item: ADMIN_NAV_GROUPS[0].items[0] }
}

function NavList({
  activeKey,
  onSelect,
  expandedGroups,
  onToggleGroup,
}: {
  activeKey: AdminTabKey
  onSelect: (key: AdminTabKey) => void
  expandedGroups: Set<string>
  onToggleGroup: (groupKey: string) => void
}) {
  return (
    <nav className="space-y-1">
      {ADMIN_NAV_GROUPS.map((group) => {
        const isSingleItem = group.items.length === 1
        const isActiveGroup = group.items.some((i) => i.key === activeKey)
        const expanded = isSingleItem || expandedGroups.has(group.key)

        if (isSingleItem) {
          const item = group.items[0]
          const isActive = item.key === activeKey
          return (
            <button
              key={group.key}
              type="button"
              onClick={() => onSelect(item.key)}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                isActive
                  ? 'bg-myth-accent/10 font-medium text-myth-accent'
                  : 'text-myth-ink-muted hover:bg-myth-surface-sunken hover:text-myth-ink'
              }`}
            >
              {group.label}
            </button>
          )
        }

        return (
          <div key={group.key}>
            <button
              type="button"
              onClick={() => onToggleGroup(group.key)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-mono uppercase tracking-wider transition-colors ${
                isActiveGroup ? 'text-myth-ink' : 'text-myth-ink-faint hover:text-myth-ink-muted'
              }`}
              aria-expanded={expanded}
            >
              {group.label}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
            {expanded && (
              <div className="ml-1 space-y-0.5 border-l border-myth-border pl-2">
                {group.items.map((item) => {
                  const isActive = item.key === activeKey
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => onSelect(item.key)}
                      className={`block w-full rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                        isActive
                          ? 'bg-myth-accent/10 font-medium text-myth-accent'
                          : 'text-myth-ink-muted hover:bg-myth-surface-sunken hover:text-myth-ink'
                      }`}
                    >
                      {item.label}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

export function AdminNav({ activeKey, onSelect }: { activeKey: AdminTabKey; onSelect: (key: AdminTabKey) => void }) {
  const { group: activeGroup, item: activeItem } = findLocation(activeKey)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set([activeGroup.key]))

  useEffect(() => {
    setExpandedGroups((prev) => new Set(prev).add(activeGroup.key))
  }, [activeGroup.key])

  useEscapeKey(() => setDrawerOpen(false), drawerOpen)

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }

  const handleSelect = (key: AdminTabKey) => {
    onSelect(key)
    setDrawerOpen(false)
  }

  const breadcrumb = activeItem.label === activeGroup.label ? activeGroup.label : `${activeGroup.label} / ${activeItem.label}`

  return (
    <>
      {/* Mobile: breadcrumb + drawer trigger, sticky within the content area */}
      <div className="mb-4 flex items-center justify-between border-b border-myth-border pb-3 md:hidden">
        <p className="font-mono text-xs uppercase tracking-wider text-myth-ink-muted">{breadcrumb}</p>
        <Button
          variant="secondary" size="sm"
          type="button"
          onClick={() => setDrawerOpen(true)}
        >
          <Menu className="h-3.5 w-3.5" />
          Sections
        </Button>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto border-r border-myth-border bg-myth-surface-raised p-4 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.16)]">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-display text-sm font-semibold text-myth-ink">Admin Sections</p>
              <IconButton
                icon={X}
                label="Close admin sections"
                size="sm"
                onClick={() => setDrawerOpen(false)}
              />
            </div>
            <NavList activeKey={activeKey} onSelect={handleSelect} expandedGroups={expandedGroups} onToggleGroup={toggleGroup} />
          </div>
        </div>
      )}

      {/* Desktop: persistent left rail */}
      <div className="hidden shrink-0 md:block md:w-56">
        <div className="sticky top-24">
          <NavList activeKey={activeKey} onSelect={onSelect} expandedGroups={expandedGroups} onToggleGroup={toggleGroup} />
        </div>
      </div>
    </>
  )
}
