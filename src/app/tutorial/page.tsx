// src/app/tutorial/page.tsx
//
// Rewritten. The previous version rendered a progress bar and a checklist
// over the `tutorial_steps` table — a table nothing has ever seeded, since
// initializeTutorialSteps() has no callers anywhere in the repo. In
// production it drew a 0% bar over an empty list, and no step could reach
// IN_PROGRESS in any case because the only path to startStep was a
// function with no callers and no route. It measured nothing and taught
// nobody.
//
// This reads from src/lib/tutorial/content/, which is typechecked and
// ships with the code, so there is no seeding step to forget.
//
// No progress tracking, on purpose. Percent-complete on a tutorial invites
// grinding it to 100% rather than reading it, and the honest state — "have
// you been shown the intro" — is a single timestamp the orientation
// overlay already owns.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, RotateCcw } from 'lucide-react'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { SectionHeader } from '@/components/ui/section-header'
import { Button } from '@/components/ui/button'
import { HEADER_OFFSET } from '@/components/tavern/headerOffset'
import { getLastCampaignId, isAuthenticated } from '@/lib/clientAuth'
import { WALKTHROUGH } from '@/lib/tutorial/content/walkthrough'
import { getMechanic } from '@/lib/tutorial/content/mechanics'
import { OrientationOverlay } from '@/components/tutorial/OrientationOverlay'

export default function TutorialPage() {
  const router = useRouter()
  const [lastCampaignId, setLastCampaignId] = useState<string | null>(null)
  const [showIntro, setShowIntro] = useState(false)

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }
    setLastCampaignId(getLastCampaignId())
  }, [router])

  // Replaying is purely a re-view: it touches neither the server record
  // nor the local cache. The user is saying "let me watch that again",
  // not "pretend I never saw it", so re-arming the overlay — on this
  // device or, worse, on every device they own — would be a surprise.
  const replayIntro = () => setShowIntro(true)
  const closeIntro = () => setShowIntro(false)

  return (
    <TavernPage>
      <TavernHeader backHref="/campaigns" title="How to play" />

      <main className={`max-w-3xl mx-auto px-4 ${HEADER_OFFSET} pb-28`}>
        <p className="mb-8 max-w-prose text-sm leading-relaxed text-myth-ink-faint">
          Enough to get you playing, and nothing you do not need yet. This
          is not the full reference — when you want that, it is in{' '}
          <Link href="/help" className="text-myth-accent underline underline-offset-4">
            Help
          </Link>
          .
        </p>

        <div className="mb-10">
          <Button variant="secondary" icon={RotateCcw} onClick={replayIntro}>
            Show the intro again
          </Button>
        </div>

        <div className="space-y-12">
          {WALKTHROUGH.map(section => (
            <section key={section.id}>
              <SectionHeader as="h2" title={section.title} description={section.lede} />

              <div className="mt-6 space-y-8 divide-y divide-myth-border">
                {section.mechanicIds.map((id, index) => {
                  const mechanic = getMechanic(id)
                  // A walkthrough referencing a mechanic that no longer
                  // exists renders nothing rather than an empty block.
                  // walkthroughIntegrity.test.ts fails the build first.
                  if (!mechanic) return null

                  return (
                    <div key={mechanic.id} className={index === 0 ? '' : 'pt-8'}>
                      <h3 className="mb-2 text-lg font-bold text-myth-ink">{mechanic.term}</h3>
                      <div className="space-y-3">
                        {mechanic.body.map((paragraph, i) => (
                          <p key={i} className="max-w-prose text-sm leading-relaxed text-myth-ink-muted">
                            {paragraph}
                          </p>
                        ))}
                      </div>
                      <Link
                        href={`/help/${mechanic.id}`}
                        className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-myth-accent hover:text-myth-ink"
                      >
                        More on {mechanic.term.toLowerCase()}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-14 border-t border-myth-border pt-8">
          <h2 className="mb-2 text-lg font-bold text-myth-ink">That is the whole tutorial</h2>
          <p className="mb-5 max-w-prose text-sm leading-relaxed text-myth-ink-muted">
            The rest of it — factions and the plans they are pursuing, threads,
            standing, debts, wars, downtime, how the Codex keeps itself current —
            you will meet as you play. All of it is written up properly in Help,
            including how each system actually works, whenever you want to look
            something up.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href={lastCampaignId ? `/campaigns/${lastCampaignId}` : '/campaigns'}>
              <Button iconRight={ArrowRight} fullWidth>
                {lastCampaignId ? 'Back to your campaign' : 'Go to your campaigns'}
              </Button>
            </Link>
            <Link href="/help">
              <Button variant="secondary" fullWidth>
                Browse the full reference
              </Button>
            </Link>
          </div>
        </div>
      </main>

      <OrientationOverlay open={showIntro} onDismiss={closeIntro} />
      <TavernNav campaignId={lastCampaignId || undefined} />
    </TavernPage>
  )
}
