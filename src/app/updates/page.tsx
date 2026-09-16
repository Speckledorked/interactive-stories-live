// src/app/updates/page.tsx
//
// Everything that has changed, grouped by release. The homepage carries the
// most recent few; this is where they all live so that list can stay short
// as releases accumulate rather than slowly burying the pitch.
//
// A server component with no interactivity — unlike /help next door, which
// is a client page because its whole point is search. There is nothing to
// search here yet, and adding a client boundary for a list of five items
// would cost hydration for nothing.

import type { Metadata } from 'next'
import Link from 'next/link'
import { releaseNotesByVersion } from '@/lib/releases/releaseNotes'

export const metadata: Metadata = {
  title: 'Updates — MythOS',
  description: 'What has changed in MythOS, and when.',
}

/** ISO date to something a person reads, without pulling in a date library. */
function readableDate(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return iso
  return parsed.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export default function UpdatesPage() {
  const releases = releaseNotesByVersion()

  return (
    <div className="-mx-4 -my-8">
      <section className="px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-3xl">
          <Link href="/" className="text-sm text-myth-ink-muted underline hover:text-myth-ink">
            ← MythOS
          </Link>
          <h1 className="mt-6 font-display text-3xl text-myth-ink sm:text-4xl">Updates</h1>
          <p className="mt-3 text-myth-ink-muted">
            What has changed, and when. Newest first.
          </p>

          <div className="mt-12 space-y-14">
            {releases.map((release) => (
              <section key={release.version}>
                <div className="mb-6 flex flex-wrap items-baseline gap-x-3 border-b border-myth-border pb-3">
                  <h2 className="font-display text-2xl text-myth-ink">{release.version}</h2>
                  <span className="text-sm text-myth-ink-faint">{readableDate(release.date)}</span>
                </div>
                <ul className="space-y-8">
                  {release.notes.map((note) => (
                    <li key={note.id}>
                      <h3 className="font-display text-lg text-myth-ink">{note.title}</h3>
                      {note.body.map((paragraph, i) => (
                        <p
                          key={i}
                          className="mt-3 text-sm leading-relaxed text-myth-ink-muted"
                        >
                          {paragraph}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <p className="mt-16 border-t border-myth-border pt-8 text-sm text-myth-ink-faint">
            <Link href="/tutorial" className="underline hover:text-myth-ink-muted">
              How it works
            </Link>
            <span className="mx-3">·</span>
            <Link href="/help" className="underline hover:text-myth-ink-muted">
              Help
            </Link>
          </p>
        </div>
      </section>
    </div>
  )
}
