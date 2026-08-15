'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { SectionHeader } from '@/components/ui/section-header'
import { getLastCampaignId } from '@/lib/clientAuth'
import { BookOpen, Dices, Download, Feather, Map as MapIcon, MessageSquare, Scroll, Users } from 'lucide-react'
import { HEADER_OFFSET } from '@/components/tavern/headerOffset'

export default function HelpPage() {
  const [lastCampaignId, setLastCampaignId] = useState<string | null>(null)

  useEffect(() => {
    setLastCampaignId(getLastCampaignId())
  }, [])

  return (
    <TavernPage background="myth">
      <TavernHeader backHref="/campaigns" title="Help & Documentation" variant="myth" />

      <main className={`max-w-4xl mx-auto px-4 ${HEADER_OFFSET} pb-28`}>
        <p className="mb-8 text-sm text-myth-ink-faint">Everything you need to know about playing AI-powered TTRPGs</p>

      {/* Quick Links — real navigation/action CTAs, stay bordered */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
        <Link
          href="/tutorial"
          className="group rounded-lg border border-myth-border bg-myth-surface p-6 transition-colors hover:border-myth-border-strong"
        >
          <BookOpen className="mx-auto mb-4 h-10 w-10 text-myth-ink-faint" />
          <h3 className="font-display mb-2 text-2xl font-semibold text-myth-ink">
            Interactive Tutorial
          </h3>
          <p className="text-sm leading-relaxed text-myth-ink-muted">
            Step-by-step guide to get started with character creation, scenes, and gameplay
          </p>
        </Link>

        <button
          onClick={() => {
            const event = new KeyboardEvent('keydown', { key: '?' })
            window.dispatchEvent(event)
          }}
          className="group rounded-lg border border-myth-border bg-myth-surface p-6 text-left transition-colors hover:border-myth-border-strong"
        >
          <div className="text-5xl mb-4">⌨️</div>
          <h3 className="font-display mb-2 text-2xl font-semibold text-myth-ink">
            Keyboard Shortcuts
          </h3>
          <p className="text-sm leading-relaxed text-myth-ink-muted">
            Speed up your workflow with Cmd+K command palette and navigation shortcuts
          </p>
        </button>
      </div>

      {/* Documentation prose — narrative content, de-boxed (see
          docs/design-system.md): meant to be read, not acted on. */}
      <div className="space-y-10">
        <section>
          <SectionHeader as="h2" title="Getting Started" />
          <div className="mt-6 space-y-6 divide-y divide-myth-border">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-myth-border bg-myth-surface-sunken font-bold text-myth-ink">1</div>
                <h3 className="text-xl font-bold text-myth-ink">Create a Campaign</h3>
              </div>
              <p className="leading-relaxed text-myth-ink-muted">
                Start by creating a campaign from the campaigns page. Choose a universe (Fantasy, Sci-Fi, Modern, etc.)
                and MythOS will generate a starting scenario.
              </p>
            </div>

            <div className="pt-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-myth-border bg-myth-surface-sunken font-bold text-myth-ink">2</div>
                <h3 className="text-xl font-bold text-myth-ink">Create Your Character</h3>
              </div>
              <p className="leading-relaxed text-myth-ink-muted">
                Design your character with a name, pronouns, concept, and description. The system handles
                dice and stats behind the scenes, so you can focus on freeform storytelling.
              </p>
            </div>

            <div className="pt-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-myth-border bg-myth-surface-sunken font-bold text-myth-ink">3</div>
                <h3 className="text-xl font-bold text-myth-ink">Enter the Story</h3>
              </div>
              <p className="leading-relaxed text-myth-ink-muted">
                Navigate to the Story tab to see the current scene. Submit actions for your character,
                and MythOS will resolve them narratively.
              </p>
            </div>
          </div>
        </section>

        <section>
          <SectionHeader as="h2" title="Core Concepts" />
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <svg className="w-6 h-6 text-myth-ink-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                </svg>
                <h3 className="font-bold text-myth-ink text-lg">Scenes & Exchanges</h3>
              </div>
              <p className="text-sm leading-relaxed text-myth-ink-muted">
                Scenes are continuous until a player ends them — any player can start or end a scene.
                Each round of actions is called an "exchange." Submit actions, and MythOS resolves them
                as a group to advance the story.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <svg className="w-6 h-6 text-myth-ink-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                <h3 className="font-bold text-myth-ink text-lg">Dice Rolls (2d6 + Stat)</h3>
              </div>
              <p className="text-sm leading-relaxed text-myth-ink-muted">
                When you attempt risky actions, roll 2d6 + a relevant stat:
              </p>
              <ul className="ml-4 space-y-1 text-sm text-myth-ink-muted">
                <li className="flex items-start gap-2">
                  <span className="font-bold text-myth-good">10+:</span>
                  <span>Full success</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-myth-warn">7-9:</span>
                  <span>Partial success with a cost</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-myth-danger">6-:</span>
                  <span>Failure with complications — the story takes a hard turn</span>
                </li>
              </ul>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <svg className="w-6 h-6 text-myth-ink-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <h3 className="font-bold text-myth-ink text-lg">Freeform Combat</h3>
              </div>
              <p className="text-sm leading-relaxed text-myth-ink-muted">
                Combat is narrative by default. Describe your actions naturally, and MythOS
                will narrate the outcome. Everyone can act at the same time — no waiting your turn,
                unless the table turns on optional turn order for a scene.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <svg className="w-6 h-6 text-myth-ink-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <h3 className="font-bold text-myth-ink text-lg">Scene Maps</h3>
              </div>
              <p className="text-sm leading-relaxed text-myth-ink-muted">
                Scenes can generate maps that visualize where everyone is. Positioning is
                narrative — describe where your character moves in your action, and MythOS
                takes it into account when resolving.
              </p>
            </div>
          </div>
        </section>

        <section>
          <SectionHeader as="h2" title="Features" />
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: Users, title: 'Invite Your Party', desc: 'No cap on how many players can join a campaign — share an invite link from the Players panel and everyone plays together' },
              { icon: MessageSquare, title: 'Chat', desc: 'Real-time in-character (IC) and out-of-character (OOC) chat to talk with the other real players in your campaign' },
              { icon: Dices, title: 'Turn Order', desc: 'Play is simultaneous by default — everyone acts anytime. Any player can turn on an optional turn queue for a scene that wants it' },
              { icon: Feather, title: 'Notes', desc: 'Take private or shared notes to track NPCs, clues, and plot points' },
              { icon: MapIcon, title: 'Maps', desc: 'AI-generated tactical maps with zones and character tokens' },
              { icon: BookOpen, title: 'World & Codex', desc: 'World tracks the NPCs, factions, locations and threads MythOS updates every turn; the Codex holds the lore, items and rumors behind them' },
              { icon: Scroll, title: 'Story Log', desc: 'Auto-generated chronicle of your adventure with highlights and timeline' },
              { icon: Download, title: 'Export', desc: 'Download your campaign data — characters, scenes, factions, and more — as JSON' }
            ].map((feature, index) => (
              <div key={index} className="rounded-lg border border-myth-border p-4">
                <feature.icon className="mb-2 h-6 w-6 text-myth-ink-muted" />
                <h3 className="mb-1 text-lg font-bold text-myth-ink">{feature.title}</h3>
                <p className="text-sm leading-relaxed text-myth-ink-muted">{feature.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <SectionHeader as="h2" title="Safety Tools" />
          <div className="mt-6 space-y-6 divide-y divide-myth-border">
            <div>
              <h3 className="mb-2 text-lg font-bold text-myth-ink">X-Card</h3>
              <p className="text-sm leading-relaxed text-myth-ink-muted">
                Use the X-Card button on the story page to pause or rewind uncomfortable content.
                No explanation needed—your comfort is the priority.
              </p>
            </div>

            <div className="pt-6">
              <h3 className="mb-2 text-lg font-bold text-myth-ink">Content Warnings</h3>
              <p className="text-sm leading-relaxed text-myth-ink-muted">
                The campaign host can set content warnings for the campaign (violence, trauma, etc.)
                in the Safety Settings panel.
              </p>
            </div>

            <div className="pt-6">
              <h3 className="mb-2 text-lg font-bold text-myth-ink">Lines & Veils</h3>
              <p className="text-sm leading-relaxed text-myth-ink-muted">
                Define hard boundaries (lines - won't appear) and soft boundaries
                (veils - happen off-screen) in campaign safety settings.
              </p>
            </div>

            <div className="pt-6">
              <h3 className="mb-2 text-lg font-bold text-myth-ink">Block & Report</h3>
              <p className="text-sm leading-relaxed text-myth-ink-muted">
                Any player can block another player in a campaign, and report content to the
                campaign host — keeping the table comfortable is on everyone, not one person.
              </p>
            </div>
          </div>
        </section>

        <section>
          <SectionHeader as="h2" title="Support" description="Need more help? Here are some resources:" />
          <div className="mt-6 space-y-3">
            {[
              { key: 'Cmd+K', desc: 'Open the command palette anywhere' },
              { key: '?', desc: 'See all keyboard shortcuts' },
              { key: 'Tutorial', desc: 'Check the tutorial for hands-on guidance' }
            ].map((item, index) => (
              <div key={index} className="flex items-center gap-3 rounded-lg border border-myth-border p-3">
                <div className="flex-shrink-0">
                  <kbd className="rounded-lg border border-myth-border bg-myth-surface-sunken px-3 py-1.5 text-sm font-medium text-myth-ink">
                    {item.key}
                  </kbd>
                </div>
                <span className="text-myth-ink-muted">{item.desc}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      </main>

      <TavernNav campaignId={lastCampaignId || undefined} variant="myth" />
    </TavernPage>
  )
}
