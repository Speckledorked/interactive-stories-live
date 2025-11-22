'use client'

import Link from 'next/link'

export default function HelpPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <Link
          href="/campaigns"
          className="text-gray-400 hover:text-white text-sm mb-4 inline-block"
        >
          ← Back to Campaigns
        </Link>

        <h1 className="text-4xl font-bold text-white mb-2">Help & Documentation</h1>
        <p className="text-gray-400">
          Everything you need to know about playing AI-powered TTRPGs
        </p>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <Link
          href="/tutorial"
          className="card hover:border-primary-500 transition-all group"
        >
          <div className="text-4xl mb-3">📚</div>
          <h3 className="text-xl font-bold text-white mb-2 group-hover:text-primary-400 transition-colors">
            Interactive Tutorial
          </h3>
          <p className="text-sm text-gray-400">
            Step-by-step guide to get started with character creation, scenes, and gameplay
          </p>
        </Link>

        <button
          onClick={() => {
            const event = new KeyboardEvent('keydown', { key: '?' })
            window.dispatchEvent(event)
          }}
          className="card hover:border-primary-500 transition-all group text-left"
        >
          <div className="text-4xl mb-3">⌨️</div>
          <h3 className="text-xl font-bold text-white mb-2 group-hover:text-primary-400 transition-colors">
            Keyboard Shortcuts
          </h3>
          <p className="text-sm text-gray-400">
            Speed up your workflow with Cmd+K command palette and navigation shortcuts
          </p>
        </button>
      </div>

      {/* Main Documentation */}
      <div className="space-y-6">
        <div className="card">
          <h2 className="text-2xl font-bold text-white mb-4">Getting Started</h2>
          <div className="space-y-3 text-gray-300">
            <div>
              <h3 className="font-bold text-white mb-1">1. Create a Campaign</h3>
              <p className="text-sm text-gray-400">
                Start by creating a campaign from the campaigns page. Choose a universe (Fantasy, Sci-Fi, Modern, etc.)
                and the AI will generate a starting scenario.
              </p>
            </div>
            <div>
              <h3 className="font-bold text-white mb-1">2. Create Your Character</h3>
              <p className="text-sm text-gray-400">
                Design your character with a name, pronouns, concept, and description. The system uses
                Powered by the Apocalypse (PbtA) rules for freeform storytelling.
              </p>
            </div>
            <div>
              <h3 className="font-bold text-white mb-1">3. Enter the Story</h3>
              <p className="text-sm text-gray-400">
                Navigate to the Story tab to see the current scene. Submit actions for your character,
                and the AI GM will resolve them narratively.
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="text-2xl font-bold text-white mb-4">Core Concepts</h2>
          <div className="space-y-4 text-gray-300">
            <div>
              <h3 className="font-bold text-white mb-1">Scenes & Exchanges</h3>
              <p className="text-sm text-gray-400">
                Scenes are continuous until the GM ends them. Each round of actions is called an "exchange."
                Submit actions, and the AI resolves them as a group to advance the story.
              </p>
            </div>
            <div>
              <h3 className="font-bold text-white mb-1">Dice Rolls (2d6 + Stat)</h3>
              <p className="text-sm text-gray-400">
                When you attempt risky actions, roll 2d6 + a relevant stat:
                <br />• 10+: Full success
                <br />• 7-9: Partial success with a cost
                <br />• 6-: Failure with complications (but you gain XP!)
              </p>
            </div>
            <div>
              <h3 className="font-bold text-white mb-1">Freeform Combat</h3>
              <p className="text-sm text-gray-400">
                Combat is narrative by default. Describe your actions naturally, and the AI GM
                will narrate the outcome. No strict turn order—actions happen simultaneously.
              </p>
            </div>
            <div>
              <h3 className="font-bold text-white mb-1">Zone Positioning</h3>
              <p className="text-sm text-gray-400">
                Characters occupy tactical zones: Close, Near, Far, Distant. Your zone affects
                what actions you can take (melee requires Close, ranged works at Near/Far, etc.)
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="text-2xl font-bold text-white mb-4">Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <h3 className="font-bold text-white mb-1">💬 Chat</h3>
              <p className="text-gray-400">
                In-character (IC) and out-of-character (OOC) chat to communicate with other players
              </p>
            </div>
            <div>
              <h3 className="font-bold text-white mb-1">📝 Notes</h3>
              <p className="text-gray-400">
                Take private, GM-only, or shared notes to track NPCs, clues, and plot points
              </p>
            </div>
            <div>
              <h3 className="font-bold text-white mb-1">🗺️ Maps</h3>
              <p className="text-gray-400">
                AI-generated tactical maps with zones and character tokens
              </p>
            </div>
            <div>
              <h3 className="font-bold text-white mb-1">📚 Wiki</h3>
              <p className="text-gray-400">
                Track NPCs, factions, and progress clocks automatically updated by the AI
              </p>
            </div>
            <div>
              <h3 className="font-bold text-white mb-1">📜 Story Log</h3>
              <p className="text-gray-400">
                Auto-generated chronicle of your adventure with highlights and timeline
              </p>
            </div>
            <div>
              <h3 className="font-bold text-white mb-1">📥 Export</h3>
              <p className="text-gray-400">
                Download your campaign data as JSON or readable text transcripts
              </p>
            </div>
          </div>
        </div>

        <div className="card bg-red-900/20 border-red-700">
          <h2 className="text-2xl font-bold text-white mb-4">✋ Safety Tools</h2>
          <div className="space-y-3 text-gray-300">
            <div>
              <h3 className="font-bold text-white mb-1">X-Card</h3>
              <p className="text-sm text-gray-400">
                Use the X-Card button on the story page to pause or rewind uncomfortable content.
                No explanation needed—your comfort is the priority.
              </p>
            </div>
            <div>
              <h3 className="font-bold text-white mb-1">Content Warnings</h3>
              <p className="text-sm text-gray-400">
                GMs can set content warnings for the campaign (violence, trauma, etc.)
                in the Safety Settings panel.
              </p>
            </div>
            <div>
              <h3 className="font-bold text-white mb-1">Lines & Veils</h3>
              <p className="text-sm text-gray-400">
                Define hard boundaries (lines - won't appear) and soft boundaries
                (veils - happen off-screen) in campaign safety settings.
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="text-2xl font-bold text-white mb-4">Support</h2>
          <p className="text-gray-400 mb-4">
            Need more help? Here are some resources:
          </p>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-primary-400">•</span>
              <span className="text-gray-300">
                Press <kbd className="px-2 py-1 bg-gray-700 rounded text-xs">Cmd+K</kbd> anywhere
                to open the command palette
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-primary-400">•</span>
              <span className="text-gray-300">
                Press <kbd className="px-2 py-1 bg-gray-700 rounded text-xs">?</kbd> to see all keyboard shortcuts
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-primary-400">•</span>
              <span className="text-gray-300">
                Check the tutorial for hands-on guidance
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
