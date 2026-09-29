// src/app/privacy/page.tsx
//
// The other half of #498's broken signup fine print.
//
// Grounded in the code rather than in a template, because a privacy policy
// that describes a different system than the one running is worse than no
// policy: the session cookie details match lib/auth.ts, the localStorage
// list matches lib/clientAuth.ts, and the retention periods match the
// constants in lib/game/retention.ts. If one of those changes, this page
// is part of the change.
//
// Sub-processors are named by role ("our payments provider") rather than
// by brand, per the product's naming rule. A reader who needs the vendor
// names should be able to ask and get them.

import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage, LegalSection } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy Policy — MythOS',
  description: 'What MythOS collects, why, who sees it, and how long it is kept.',
}

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="29 September 2026">
      <LegalSection heading="The short version">
        <p>
          We collect your email address, what you write while playing, and enough technical
          information to keep the service running and paid for. We do not sell your data and we do
          not run advertising. Your story content is sent to the third-party providers that generate
          narration and images, because that is how the service works.
        </p>
      </LegalSection>

      <LegalSection heading="1. What we collect">
        <p>
          <strong className="text-myth-ink">Account details.</strong> Your email address, an
          optional display name, and a hashed password. We never store your password itself.
        </p>
        <p>
          <strong className="text-myth-ink">What you write.</strong> Characters, actions, notes,
          chat messages, world settings, and everything generated in response — scenes, world
          events, and the history of how your world changed.
        </p>
        <p>
          <strong className="text-myth-ink">Payment records.</strong> Your credit balance and a
          record of each top-up and charge. Card details go directly to our payments provider and
          never reach us.
        </p>
        <p>
          <strong className="text-myth-ink">Usage and cost records.</strong> Which features you
          used and when, and the per-request cost of generating your scenes, so your balance can be
          metered accurately and so we can tell whether the service is working.
        </p>
        <p>
          <strong className="text-myth-ink">Technical data.</strong> Server logs, error reports,
          and — where a feature depends on it, such as counting views on a shared story link — a
          derived, non-reversible fingerprint rather than a stored address.
        </p>
      </LegalSection>

      <LegalSection heading="2. Cookies and local storage">
        <p>
          We use two session cookies. Both are <em>httpOnly</em>, meaning no script on the page can
          read them: a short-lived access cookie and a longer-lived refresh cookie scoped to the
          sign-in endpoints. They exist to keep you signed in. That is all they do — no tracking
          cookies, no advertising cookies, no third-party cookies.
        </p>
        <p>
          Your browser also stores a few preferences locally: your display name and email for
          showing in the interface, your theme choice, a flag saying a session exists, and the last
          campaign you looked at. None of these is a credential and none is sent anywhere. Signing
          out clears them.
        </p>
      </LegalSection>

      <LegalSection heading="3. Why we are allowed to hold it">
        <p>
          If you are in the UK or EU, our lawful bases are: performing our contract with you
          (running your account and your worlds), our legitimate interests (keeping the service
          secure, working and affordable), and legal obligation (keeping payment records).
        </p>
      </LegalSection>

      <LegalSection heading="4. Who else sees it">
        <p>We use a small number of providers, each for one job:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong className="text-myth-ink">Our text-generation provider</strong> receives the
            story context needed to write the next scene — your action, your characters, and the
            relevant parts of your world. This is unavoidable; it is the feature.
          </li>
          <li>
            <strong className="text-myth-ink">Our image-generation and file-storage providers</strong>{' '}
            receive scene descriptions, and hold the resulting images.
          </li>
          <li>
            <strong className="text-myth-ink">Our payments provider</strong> handles card details
            and tells us only that a payment succeeded.
          </li>
          <li>
            <strong className="text-myth-ink">Our hosting, database and email providers</strong>{' '}
            store the data and deliver account emails.
          </li>
          <li>
            <strong className="text-myth-ink">Our realtime provider</strong> delivers live updates
            to other players in your campaign.
          </li>
        </ul>
        <p>
          We do not sell your data, and we do not share it for advertising. We will disclose data if
          the law requires it, and we will tell you unless we are forbidden to.
        </p>
        <p>
          Some of these providers operate outside the UK and EU. Where that is the case, transfers
          rely on the standard safeguards those providers offer.
        </p>
      </LegalSection>

      <LegalSection heading="5. Other players">
        <p>
          A campaign is shared. The people in your campaign can see your characters, your actions
          and your messages within it. Private notes stay private to you. If a game master turns on
          a public share link for a world, anyone with that link can read that world&apos;s story
          log until sharing is turned off again.
        </p>
      </LegalSection>

      <LegalSection heading="6. How long we keep it">
        <p>
          Your account and your worlds are kept while your account is open. Some records are pruned
          automatically as a world grows, so a long-running campaign does not accumulate
          indefinitely:
        </p>
        <ul className="ml-5 list-disc space-y-1">
          <li>old world events are pruned once they fall far enough behind the current turn;</li>
          <li>archived memories are removed after about a year;</li>
          <li>records of failed processing are removed after about six months;</li>
          <li>
            per-request cost records are kept for about two years, because they are the accounting
            trail behind what you were charged.
          </li>
        </ul>
        <p>
          When you close your account we delete your personal data, other than payment records we
          are required to keep. Backups roll off on their own schedule shortly afterwards.
        </p>
      </LegalSection>

      <LegalSection heading="7. Your rights">
        <p>
          You can ask us for a copy of your data, ask us to correct it, ask us to delete it, object
          to or restrict how we use it, and ask for it in a portable form. Contact us and we will
          respond within a month.
        </p>
        <p>
          If you are in the UK you can complain to the Information Commissioner&apos;s Office; if
          you are in the EU, to your national data protection authority. We would rather you came to
          us first, but it is your right either way.
        </p>
      </LegalSection>

      <LegalSection heading="8. Security, and honesty about it">
        <p>
          Passwords are hashed, sessions live in httpOnly cookies, session tokens rotate and reused
          tokens are treated as theft, and traffic is encrypted in transit. No service is perfectly
          secure, and MythOS is in beta. If we ever suffer a breach affecting your data, we will
          tell you and the relevant regulator as the law requires.
        </p>
      </LegalSection>

      <LegalSection heading="9. Children">
        <p>
          MythOS is not for children under 13, and we do not knowingly collect their data. If you
          believe a child has created an account, contact us and we will remove it.
        </p>
      </LegalSection>

      <LegalSection heading="10. Changes, and contacting us">
        <p>
          We will update this page when our practices change, and change the date at the top. For a
          significant change we will give notice in the app.
        </p>
        <p>
          To exercise a right, ask which providers we use by name, or ask anything else about this
          policy, reach us through the contact details on the MythOS site. See also our{' '}
          <Link href="/terms" className="underline hover:text-myth-ink">Terms of Service</Link>.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
