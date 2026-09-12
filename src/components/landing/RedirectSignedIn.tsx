// src/components/landing/RedirectSignedIn.tsx
//
// `/` is the marketing page now, and marketing is for people who are not
// signed in. A returning player who types the bare domain still wants their
// campaigns, so they get bounced.
//
// The check is client-side because the token lives in localStorage, which
// means a signed-in visitor sees one frame of the landing page before the
// redirect. That is the right way round to spend the flash: the page exists
// for signed-out visitors, and making THEM wait on an auth check — behind a
// spinner, as the old redirect-only page did — would delay the first paint
// for exactly the audience the page is trying to convince.

'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isAuthenticated } from '@/lib/clientAuth'

export function RedirectSignedIn() {
  const router = useRouter()

  useEffect(() => {
    if (isAuthenticated()) {
      router.replace('/campaigns')
    }
  }, [router])

  return null
}
