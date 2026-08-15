'use client'

import Link from 'next/link'
import type { ComponentType } from 'react'

export interface SubNavTab {
  key: string
  label: string
  /** Either a component (rendered as `<Icon className="w-3.5 h-3.5" />`) or a plain string/emoji (rendered as-is). */
  icon: ComponentType<{ className?: string }> | string
  /** Present -> renders as a Link to a sibling page. Absent -> renders as a button (if onSelect is given) or an inert span for the current page's own tab. */
  href?: string | null
  badge?: number
}

export interface SubNavTabsProps {
  tabs: SubNavTab[]
  activeKey: string
  /** Called when a tab with no href is clicked — omit for pages where every non-href tab is just the current page's own inert label. */
  onSelect?: (key: string) => void
  /**
   * Extra classes appended to every tab item, on top of the shared base
   * shape. Lets each caller keep whatever it already had beyond that base
   * (e.g. `whitespace-nowrap flex-shrink-0` for a horizontally-scrolling nav).
   */
  itemClassName?: string
  /**
   * Opt-in myth-token styling for pages already ported to that design
   * system (mirrors TavernHeader/TavernNav's own `variant` prop). Default
   * `'tavern'` keeps every existing caller's classNames byte-identical —
   * SubNavTabs.test.tsx pins the default variant's active-tab class.
   */
  variant?: 'tavern' | 'myth'
}

/**
 * The sub-navigation tab bar repeated, nearly identically, across 6 page
 * files (friends, settings, wiki, story, characters, characters/[id]) —
 * three of them building it from a local tabs array and `.map()`, two
 * hand-writing each tab's JSX individually with no array at all. All six
 * share the same visual shape (border-b-2, active/inactive ember colors,
 * w-3.5 h-3.5 icon sizing) and the same three interaction models: a Link
 * to a sibling page, a button that switches in-page state, or (for the
 * current page's own tab) inert text — this component covers all three
 * per tab rather than assuming one for the whole bar.
 */
export function SubNavTabs({ tabs, activeKey, onSelect, itemClassName = '', variant = 'tavern' }: SubNavTabsProps) {
  const myth = variant === 'myth'
  return (
    <>
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey
        const activeClass = myth ? 'border-myth-accent text-myth-ink' : 'border-ember-400 text-ember-200'
        const inactiveClass = myth
          ? 'border-transparent text-myth-ink-faint hover:text-myth-ink-muted'
          : 'border-transparent text-ember-300/40 hover:text-ember-300/70'
        const className = `flex min-h-[44px] items-center gap-1.5 px-2.5 py-2 border-b-2 transition-colors touch-manipulation${itemClassName ? ` ${itemClassName}` : ''} ${
          isActive ? activeClass : inactiveClass
        }`

        const content = (
          <>
            {typeof tab.icon === 'string' ? <span>{tab.icon}</span> : <tab.icon className="w-3.5 h-3.5" />}
            <span>{tab.label}</span>
            {!!tab.badge && (
              <span
                className={`text-[10px] rounded-full px-1.5 py-0.5 leading-none ${
                  myth ? 'bg-myth-accent text-myth-accent-ink' : 'bg-wine-600 text-ember-100'
                }`}
              >
                {tab.badge}
              </span>
            )}
          </>
        )

        if (tab.href) {
          return (
            <Link key={tab.key} href={tab.href} className={className}>
              {content}
            </Link>
          )
        }

        if (onSelect) {
          return (
            <button key={tab.key} onClick={() => onSelect(tab.key)} className={className}>
              {content}
            </button>
          )
        }

        return (
          <span key={tab.key} className={className}>
            {content}
          </span>
        )
      })}
    </>
  )
}
