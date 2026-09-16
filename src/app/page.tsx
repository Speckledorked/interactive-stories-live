// src/app/page.tsx
//
// The front door. Until now this route was a bare redirect — signed in to
// /campaigns, signed out to /login — so a stranger who heard about MythOS and
// typed the domain was handed a password field and no reason to fill it in.
//
// It now serves three audiences from one document: a stranger who needs the
// pitch, a returning player for whom this is home, and anyone wanting to know
// what has changed lately. It stays a server component — the copy belongs in
// the HTML for crawlers and link previews — and there is no client component
// at all: the one thing that differs by visitor, which call to action to
// show, is decided before first paint by an attribute on <html> and a rule in
// globals.css. See lib/authFlag.ts for why it is done that way round.
//
// Signed-in visitors used to be redirected straight to /campaigns, which made
// the page unreachable for anyone with an account — including its owner, who
// needed a private window to look at their own homepage.

import type { Metadata } from 'next'
import Link from 'next/link'
import { latestReleaseNotes } from '@/lib/releases/releaseNotes'

export const metadata: Metadata = {
  title: 'MythOS — the world keeps moving',
  description:
    'Play a tabletop RPG in any world you can name. Factions scheme, wars move and people pursue their own plans between your turns. Now in beta.',
  openGraph: {
    title: 'MythOS — the world keeps moving',
    description:
      'A tabletop RPG where the world does not wait for you. Now in beta.',
    type: 'website',
  },
}

const BEATS = [
  {
    title: 'The world does not wait',
    body: 'Factions act on their goals, wars advance, markets move and people pursue their own plans while nobody is watching. Come back after a week away and things will have happened — not to punish you, but because the people in this world want things and keep wanting them.',
  },
  {
    title: 'It knows what your character knows',
    body: 'You are never told a secret your character could not have learned. What you have not discovered is not on your screen at all — not greyed out, not teased. The story you get is the one your character could actually be living.',
  },
  {
    title: 'Your universe gets its own rules',
    body: 'Name the world and its scaffolding is built to match: what power is called, how people rank, what corruption looks like, how the calendar turns. A setting with no ladder of ranks simply does not get one.',
  },
]

const FAQ = [
  {
    q: 'Do I need to know tabletop rules?',
    a: 'No. You describe what your character does in your own words. The mechanics are resolved for you, and you can look at exactly how at any point.',
  },
  {
    q: 'Can I play with friends?',
    a: 'Yes — campaigns are built for a table. You can also play alone, and the world will still move between your sessions.',
  },
  {
    q: 'What does it cost?',
    a: 'Writing a scene costs real money, and you are charged what it actually cost, split across whoever took part. Usually a few cents each. New accounts start with a credit, so your first scenes are on us.',
  },
  {
    q: 'What happens to my world after the beta?',
    a: 'The plan is that it stays. If that ever changes you will hear it from me first, not discover it.',
  },
]

function Ticker() {
  const events = [
    'The Ironveil withdrew from the eastern quarter — the third district they have abandoned this month.',
    'Grain prices in Hollowmoor rose again. The southern road has been closed eleven days.',
    'Sera Voss was seen in Aldermere. Nobody has said why.',
  ]
  return (
    <div className="rounded-xl border border-myth-border bg-myth-surface-sunken p-5">
      <p className="mb-3 font-display text-sm uppercase tracking-wider text-myth-ink-faint">
        While you were away
      </p>
      <ul className="space-y-3">
        {events.map((e) => (
          <li key={e} className="border-l-2 border-myth-accent/40 pl-3 text-sm text-myth-ink-muted">
            {e}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function HomePage() {
  return (
    <div className="-mx-4 -my-8">
      {/* Hero */}
      <section className="px-4 py-20 sm:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-4 inline-block rounded-full border border-myth-border px-3 py-1 text-xs uppercase tracking-widest text-myth-ink-faint">
            Now in beta
          </p>
          <h1 className="font-display text-4xl leading-tight text-myth-ink sm:text-6xl">
            MythOS
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-myth-ink-muted sm:text-xl">
            A tabletop RPG in any world you can name — where the world keeps
            moving while you are away.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {/* Both are rendered; CSS shows one, chosen before first paint
                from an attribute set by lib/authFlag.ts. See globals.css —
                doing this in React instead would flash the wrong call to
                action at every returning player. */}
            <Link
              href="/signup"
              className="cta-when-signed-out inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-myth-accent px-7 text-base font-medium text-myth-accent-ink transition-colors hover:bg-myth-accent-hover sm:w-auto"
            >
              Create your account
            </Link>
            <Link
              href="/campaigns"
              className="cta-when-signed-in inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-myth-accent px-7 text-base font-medium text-myth-accent-ink transition-colors hover:bg-myth-accent-hover sm:w-auto"
            >
              Continue to your campaigns
            </Link>
            <Link
              href="/login"
              className="cta-when-signed-out inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border border-myth-border px-7 text-base text-myth-ink-muted transition-colors hover:border-myth-border-strong hover:text-myth-ink sm:w-auto"
            >
              Sign in
            </Link>
          </div>
          <p className="cta-when-signed-out mt-4 text-sm text-myth-ink-faint">
            Free to start — your first scenes are on us.
          </p>
        </div>
      </section>

      {/* Three beats */}
      <section className="border-t border-myth-border px-4 py-16">
        <div className="mx-auto grid max-w-5xl gap-10 sm:grid-cols-3">
          {BEATS.map((b) => (
            <div key={b.title}>
              <h2 className="font-display text-xl text-myth-ink">{b.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-myth-ink-muted">{b.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Show it — the prose is the product, so let the prose do the selling */}
      <section className="border-t border-myth-border px-4 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-8 text-center font-display text-2xl text-myth-ink">
            What playing looks like
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-myth-border bg-myth-surface p-6">
              <p className="mb-3 font-display text-sm uppercase tracking-wider text-myth-ink-faint">
                You said
              </p>
              <p className="mb-5 text-sm italic text-myth-ink-muted">
                &ldquo;I put my shoulder to the door and force it.&rdquo;
              </p>
              <p className="mb-3 font-display text-sm uppercase tracking-wider text-myth-ink-faint">
                What happened
              </p>
              <p className="text-sm leading-relaxed text-myth-ink">
                The door gives — not cleanly, but enough. The lock was already
                broken. Someone came through here before you, and recently: the
                dust on the sill is disturbed in one long smear, as though a
                coat dragged across it.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-myth-ink">
                Kessler&rsquo;s people, then. Or someone who wanted you to think so.
              </p>
            </div>
            <Ticker />
          </div>
        </div>
      </section>

      {/* What's new — the third job this page does. Placed after the pitch
          so a stranger reaches it having been told what any of it means,
          and before the beta caveats so a returning player finds it without
          hunting. */}
      <section className="border-t border-myth-border px-4 py-16">
        <div className="mx-auto max-w-3xl">
          <div className="mb-8 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-2xl text-myth-ink">What&rsquo;s new</h2>
            <Link href="/updates" className="text-sm text-myth-ink-muted underline hover:text-myth-ink">
              Everything that&rsquo;s changed
            </Link>
          </div>
          <ul className="space-y-7">
            {latestReleaseNotes(3).map((note) => (
              <li key={note.id}>
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <h3 className="font-display text-lg text-myth-ink">{note.title}</h3>
                  <span className="text-xs uppercase tracking-wider text-myth-ink-faint">
                    {note.version}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-myth-ink-muted">{note.body[0]}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Honest expectations */}
      <section className="border-t border-myth-border px-4 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="font-display text-2xl text-myth-ink">What beta means right now</h2>
          <ul className="mt-5 space-y-3 text-sm leading-relaxed text-myth-ink-muted">
            <li>
              Some worlds come out better than others. Settings with a lot of
              written canon behind them have more to work with than ones you
              invent on the spot.
            </li>
            <li>
              A scene takes a moment to come back. The outcome is being settled
              and the world updated, not autocompleted.
            </li>
            <li>
              Things will break. When they do I would rather hear it from you
              than find it in a log three weeks later.
            </li>
          </ul>

          <h2 className="mt-12 font-display text-2xl text-myth-ink">What I need from you</h2>
          <p className="mt-4 text-sm leading-relaxed text-myth-ink-muted">
            Play a campaign past its tenth turn, and tell me where the fiction
            broke — a moment the world contradicted itself, forgot something it
            should have known, or told you something your character had no way
            of knowing. That last one matters most.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-myth-border px-4 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-8 font-display text-2xl text-myth-ink">Questions</h2>
          <dl className="space-y-6">
            {FAQ.map((item) => (
              <div key={item.q}>
                <dt className="font-medium text-myth-ink">{item.q}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-myth-ink-muted">{item.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Closing CTA + footer */}
      <section className="border-t border-myth-border px-4 py-16 text-center">
        <h2 className="font-display text-2xl text-myth-ink">Name a world.</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-myth-ink-muted">
          Pick somewhere you already love, or somewhere nobody has been yet.
        </p>
        <Link
          href="/signup"
          className="mt-7 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-myth-accent px-7 text-base font-medium text-myth-accent-ink transition-colors hover:bg-myth-accent-hover"
        >
          Create your account
        </Link>
        <p className="mt-10 text-sm text-myth-ink-faint">
          <Link href="/tutorial" className="underline hover:text-myth-ink-muted">
            How it works
          </Link>
          <span className="mx-3">·</span>
          <Link href="/help" className="underline hover:text-myth-ink-muted">
            Help
          </Link>
        </p>
      </section>
    </div>
  )
}
