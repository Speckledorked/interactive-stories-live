'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { getLastCampaignId } from '@/lib/clientAuth'

export default function HelpPage() {
  const [lastCampaignId, setLastCampaignId] = useState<string | null>(null)

  useEffect(() => {
    setLastCampaignId(getLastCampaignId())
  }, [])

  return (
    <TavernPage>
      <TavernHeader backHref="/campaigns" title="Help & Documentation" />

      <main className="max-w-4xl mx-auto px-4 pt-28 pb-28">
        <p className="text-ember-300/50 text-sm mb-8">Everything you need to know about playing AI-powered TTRPGs</p>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <Link
          href="/tutorial"
          className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-6 group hover:scale-[1.02] transition-all duration-200"
        >
          <div className="text-5xl mb-4">📚</div>
          <h3 className="text-2xl font-bold text-ember-100 mb-2 group-hover:text-ember-300 transition-colors">
            Interactive Tutorial
          </h3>
          <p className="text-sm text-ember-300/60 leading-relaxed">
            Step-by-step guide to get started with character creation, scenes, and gameplay
          </p>
        </Link>

        <button
          onClick={() => {
            const event = new KeyboardEvent('keydown', { key: '?' })
            window.dispatchEvent(event)
          }}
          className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-6 group hover:scale-[1.02] transition-all duration-200 text-left"
        >
          <div className="text-5xl mb-4">⌨️</div>
          <h3 className="text-2xl font-bold text-ember-100 mb-2 group-hover:text-ember-300 transition-colors">
            Keyboard Shortcuts
          </h3>
          <p className="text-sm text-ember-300/60 leading-relaxed">
            Speed up your workflow with Cmd+K command palette and navigation shortcuts
          </p>
        </button>
      </div>

      {/* Main Documentation */}
      <div className="space-y-6">
        <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-6">
          <h2 className="text-3xl font-bold text-ember-100 mb-6">Getting Started</h2>
          <div className="space-y-6">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-ember-900/30 border border-ember-800/40 flex items-center justify-center text-ember-300 font-bold">1</div>
                <h3 className="text-xl font-bold text-ember-100">Create a Campaign</h3>
              </div>
              <p className="text-ember-300/60 leading-relaxed ml-13">
                Start by creating a campaign from the campaigns page. Choose a universe (Fantasy, Sci-Fi, Modern, etc.)
                and the AI will generate a starting scenario.
              </p>
            </div>

            <div className="h-px bg-ember-900/30"></div>

            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-ember-900/30 border border-ember-800/40 flex items-center justify-center text-ember-300 font-bold">2</div>
                <h3 className="text-xl font-bold text-ember-100">Create Your Character</h3>
              </div>
              <p className="text-ember-300/60 leading-relaxed ml-13">
                Design your character with a name, pronouns, concept, and description. The system handles
                dice and stats behind the scenes, so you can focus on freeform storytelling.
              </p>
            </div>

            <div className="h-px bg-ember-900/30"></div>

            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-ember-900/30 border border-ember-800/40 flex items-center justify-center text-ember-300 font-bold">3</div>
                <h3 className="text-xl font-bold text-ember-100">Enter the Story</h3>
              </div>
              <p className="text-ember-300/60 leading-relaxed ml-13">
                Navigate to the Story tab to see the current scene. Submit actions for your character,
                and the AI GM will resolve them narratively.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-6">
          <h2 className="text-3xl font-bold text-ember-100 mb-6">Core Concepts</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <svg className="w-6 h-6 text-ember-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                </svg>
                <h3 className="font-bold text-ember-100 text-lg">Scenes & Exchanges</h3>
              </div>
              <p className="text-sm text-ember-300/60 leading-relaxed">
                Scenes are continuous until the GM ends them. Each round of actions is called an "exchange."
                Submit actions, and the AI resolves them as a group to advance the story.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <svg className="w-6 h-6 text-ember-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                <h3 className="font-bold text-ember-100 text-lg">Dice Rolls (2d6 + Stat)</h3>
              </div>
              <p className="text-sm text-ember-300/60 leading-relaxed">
                When you attempt risky actions, roll 2d6 + a relevant stat:
              </p>
              <ul className="text-sm text-ember-300/60 space-y-1 ml-4">
                <li className="flex items-start gap-2">
                  <span className="text-success-400 font-bold">10+:</span>
                  <span>Full success</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-ember-400 font-bold">7-9:</span>
                  <span>Partial success with a cost</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-wine-400 font-bold">6-:</span>
                  <span>Failure with complications (but you gain XP!)</span>
                </li>
              </ul>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <svg className="w-6 h-6 text-ember-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <h3 className="font-bold text-ember-100 text-lg">Freeform Combat</h3>
              </div>
              <p className="text-sm text-ember-300/60 leading-relaxed">
                Combat is narrative by default. Describe your actions naturally, and the AI GM
                will narrate the outcome. Everyone can act at the same time — no waiting your turn,
                unless the GM turns on optional turn order for a scene.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <svg className="w-6 h-6 text-ember-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <h3 className="font-bold text-ember-100 text-lg">Zone Positioning</h3>
              </div>
              <p className="text-sm text-ember-300/60 leading-relaxed">
                Characters occupy tactical zones: Close, Near, Far, Distant. Your zone affects
                what actions you can take (melee requires Close, ranged works at Near/Far, etc.)
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-6">
          <h2 className="text-3xl font-bold text-ember-100 mb-6">Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: '👥', title: 'Invite Your Party', desc: 'No cap on how many players can join a campaign — share an invite link from the Players panel and everyone plays together' },
              { icon: '💬', title: 'Chat', desc: 'Real-time in-character (IC) and out-of-character (OOC) chat to talk with the other real players in your campaign' },
              { icon: '🎲', title: 'Turn Order', desc: 'Play is simultaneous by default — everyone acts anytime. A GM can turn on an optional turn queue for a scene that wants it' },
              { icon: '📝', title: 'Notes', desc: 'Take private, GM-only, or shared notes to track NPCs, clues, and plot points' },
              { icon: '🗺️', title: 'Maps', desc: 'AI-generated tactical maps with zones and character tokens' },
              { icon: '📚', title: 'Wiki', desc: 'Track NPCs, factions, and progress clocks automatically updated by the AI' },
              { icon: '📜', title: 'Story Log', desc: 'Auto-generated chronicle of your adventure with highlights and timeline' },
              { icon: '📥', title: 'Export', desc: 'Download your campaign data — characters, scenes, factions, and more — as JSON' }
            ].map((feature, index) => (
              <div key={index} className="p-4 bg-black/25 rounded-xl border border-ember-900/30 hover:border-ember-700/40 transition-all duration-200">
                <div className="text-3xl mb-2">{feature.icon}</div>
                <h3 className="font-bold text-ember-100 mb-1 text-lg">{feature.title}</h3>
                <p className="text-sm text-ember-300/60 leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-gradient-to-br from-wine-800/20 to-wine-800/10 border border-wine-700/40 shadow-lg shadow-black/30 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="text-4xl">✋</div>
            <h2 className="text-3xl font-bold text-ember-100">Safety Tools</h2>
          </div>
          <div className="space-y-6">
            <div>
              <h3 className="font-bold text-ember-100 mb-2 text-lg">X-Card</h3>
              <p className="text-sm text-ember-300/60 leading-relaxed">
                Use the X-Card button on the story page to pause or rewind uncomfortable content.
                No explanation needed—your comfort is the priority.
              </p>
            </div>

            <div className="h-px bg-ember-900/30"></div>

            <div>
              <h3 className="font-bold text-ember-100 mb-2 text-lg">Content Warnings</h3>
              <p className="text-sm text-ember-300/60 leading-relaxed">
                GMs can set content warnings for the campaign (violence, trauma, etc.)
                in the Safety Settings panel.
              </p>
            </div>

            <div className="h-px bg-ember-900/30"></div>

            <div>
              <h3 className="font-bold text-ember-100 mb-2 text-lg">Lines & Veils</h3>
              <p className="text-sm text-ember-300/60 leading-relaxed">
                Define hard boundaries (lines - won't appear) and soft boundaries
                (veils - happen off-screen) in campaign safety settings.
              </p>
            </div>

            <div className="h-px bg-ember-900/30"></div>

            <div>
              <h3 className="font-bold text-ember-100 mb-2 text-lg">Block & Report</h3>
              <p className="text-sm text-ember-300/60 leading-relaxed">
                Any player can block another player in a campaign, and report content to admins —
                on you, not just the GM, to keep the table comfortable.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-gradient-to-br from-ember-900/25 to-wine-800/15 border border-ember-800/40 shadow-lg shadow-black/30 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="text-4xl">💡</div>
            <h2 className="text-3xl font-bold text-ember-100">Support</h2>
          </div>
          <p className="text-ember-300/60 mb-6 leading-relaxed">
            Need more help? Here are some resources:
          </p>
          <div className="space-y-3">
            {[
              { key: 'Cmd+K', desc: 'Open the command palette anywhere' },
              { key: '?', desc: 'See all keyboard shortcuts' },
              { key: 'Tutorial', desc: 'Check the tutorial for hands-on guidance' }
            ].map((item, index) => (
              <div key={index} className="flex items-center gap-3 p-3 bg-black/25 rounded-lg border border-ember-900/30">
                <div className="flex-shrink-0">
                  <kbd className="px-3 py-1.5 bg-black/40 border border-ember-900/40 rounded-lg text-sm font-medium text-ember-300 shadow-inner">
                    {item.key}
                  </kbd>
                </div>
                <span className="text-ember-200/80">{item.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      </main>

      <TavernNav campaignId={lastCampaignId || undefined} />
    </TavernPage>
  )
}
