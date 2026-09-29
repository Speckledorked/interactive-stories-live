// src/app/terms/page.tsx
//
// Linked from the signup form's fine print, which 404'd (#498) — the worst
// possible moment for a broken legal link, since it is shown at the exact
// point someone is asked to agree to it.
//
// Written against what the product actually does rather than from a
// template: the balance really is prepaid credit metered against real
// per-scene cost, worlds really do move while you are away, and the
// service really is in beta. Anything here that the code contradicts is a
// bug in one of the two.

import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage, LegalSection } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'Terms of Service — MythOS',
  description: 'The agreement between you and MythOS.',
}

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="29 September 2026">
      <LegalSection heading="1. What MythOS is">
        <p>
          MythOS is a persistent storytelling service. You create a world, play characters in it,
          and the world keeps moving between your visits. These terms are the agreement between you
          and MythOS for using it.
        </p>
        <p>
          MythOS is in beta. Features change, break and occasionally disappear. We may modify or
          discontinue any part of the service, and we will give notice of significant changes where
          we reasonably can.
        </p>
      </LegalSection>

      <LegalSection heading="2. Your account">
        <p>
          You need an account to play. You are responsible for keeping your password secure and for
          activity under your account. Tell us promptly if you believe someone else has access to it.
        </p>
        <p>
          You must be old enough to form a binding contract where you live, and at least 13 years
          old. If you are under 18, you need a parent or guardian&apos;s permission.
        </p>
        <p>
          You may close your account at any time. We may suspend or close an account that breaks
          these terms, and we will tell you why unless doing so would be unlawful or unsafe.
        </p>
      </LegalSection>

      <LegalSection heading="3. Credit and payment">
        <p>
          Play is funded by prepaid credit on your account balance. Generating a scene costs real
          money to run, and your balance is metered against that actual cost rather than a flat
          per-action fee. Your current balance and recent charges are visible in your settings.
        </p>
        <p>
          Credit is for use within MythOS. It is not transferable, has no cash value, and cannot be
          redeemed for money. New accounts may receive a small amount of credit to start with; that
          is a gift, not a purchase, and may be withdrawn or changed at any time.
        </p>
        <p>
          Purchases are processed by our payments provider; we never see or store your card details.
          If you believe you were charged in error, contact us and we will look into it. Where the
          law gives you a right to a refund, these terms do not remove it.
        </p>
        <p>
          If your balance runs out, play pauses until you add more. Your world and your characters
          are not deleted because your balance reached zero.
        </p>
      </LegalSection>

      <LegalSection heading="4. What you write, and what MythOS writes back">
        <p>
          You keep ownership of what you write — your characters, your actions, your notes, your
          worlds. By using MythOS you give us permission to store that content and to process it as
          needed to run the service, including sending it to the third-party providers described in
          our <Link href="/privacy" className="underline hover:text-myth-ink">Privacy Policy</Link>.
        </p>
        <p>
          Narration that MythOS generates in response to your play is yours to use. We make no claim
          to it. Be aware that generated text is not unique to you: another player&apos;s world may
          produce something similar, and we cannot promise otherwise.
        </p>
        <p>
          If you make a world publicly viewable through a share link, you are choosing to publish
          it. Anyone with the link can read it until you turn sharing off.
        </p>
      </LegalSection>

      <LegalSection heading="5. Acceptable use">
        <p>You agree not to use MythOS to:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>create sexual content involving minors, in any form, real or fictional;</li>
          <li>harass, threaten or impersonate a real person;</li>
          <li>plan or promote real-world violence or other serious harm;</li>
          <li>break the law, or infringe someone else&apos;s rights;</li>
          <li>
            attack the service — automated scraping, credential stuffing, denial of service,
            circumventing rate limits or payment, or probing other players&apos; data;
          </li>
          <li>resell access, or run the service on someone else&apos;s behalf as a paid product.</li>
        </ul>
        <p>
          Fiction is allowed to be dark. MythOS is a storytelling service and its worlds contain
          conflict, violence and moral complexity. The list above is about real harm, not about the
          tone of your story. Campaigns carry their own content settings, which a game master sets.
        </p>
      </LegalSection>

      <LegalSection heading="6. Generated content has no guarantee">
        <p>
          MythOS generates narration automatically. It can be wrong, inconsistent, or produce
          something you did not want. It is not advice of any kind — not legal, medical, financial
          or professional. Do not rely on it as fact.
        </p>
        <p>
          We apply content filtering, but no filter is perfect in either direction: unwanted content
          can get through, and wanted content can be blocked.
        </p>
      </LegalSection>

      <LegalSection heading="7. Availability, and your data">
        <p>
          We try hard to keep MythOS running and your worlds intact, and we take backups. We cannot
          promise uninterrupted service or that data will never be lost. This is a beta service; do
          not treat it as the only copy of anything you would be upset to lose.
        </p>
        <p>
          Some data is pruned on a schedule as worlds grow — see the Privacy Policy for what is kept
          and for how long.
        </p>
      </LegalSection>

      <LegalSection heading="8. Liability">
        <p>
          MythOS is provided as-is. To the fullest extent the law allows, we exclude implied
          warranties, and we are not liable for indirect or consequential loss, lost profits, or
          lost content.
        </p>
        <p>
          Where we are liable, our total liability to you is limited to the greater of the amount
          you paid us in the twelve months before the claim, or twenty pounds sterling.
        </p>
        <p>
          Nothing here limits liability that cannot lawfully be limited — including for death or
          personal injury caused by negligence, or for fraud. If you are a consumer, you keep all
          your statutory rights.
        </p>
      </LegalSection>

      <LegalSection heading="9. Changes to these terms">
        <p>
          We may update these terms. If a change materially affects your rights, we will give
          reasonable notice before it takes effect. Continuing to use MythOS after that means you
          accept the updated terms; if you do not, you can close your account.
        </p>
      </LegalSection>

      <LegalSection heading="10. Governing law, and contacting us">
        <p>
          These terms are governed by the laws of England and Wales, and the courts of England and
          Wales have jurisdiction. If you are a consumer resident elsewhere, you keep the protection
          of any mandatory law of your home country.
        </p>
        <p>
          Questions about these terms, a charge, or your account: reach us through the contact
          details on the MythOS site.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
