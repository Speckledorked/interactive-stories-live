// src/app/chronicle/[token]/page.tsx
// Public, unauthenticated, read-only story log — the destination for a
// campaign's chronicle share link (see api/campaigns/[id]/chronicle-share
// for the GM toggle, api/public/chronicle/[token] for the data it reads).
// No login, no character sheets, no admin data — just the resolved scenes,
// in order, for anyone the link is shared with.

'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { displayFont } from '@/lib/tavernTheme'
import { TavernSpinner } from '@/components/tavern/ui'

interface ChronicleScene {
  sceneNumber: number
  title: string | null
  introText: string
  resolutionText: string | null
}

interface ChronicleData {
  campaign: { title: string; description: string | null; universe: string | null }
  scenes: ChronicleScene[]
}

export default function PublicChroniclePage() {
  const params = useParams()
  const token = params.token as string

  const [data, setData] = useState<ChronicleData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/public/chronicle/${token}`)
      .then(async res => {
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          throw new Error(json.error || 'This chronicle link is not available')
        }
        return res.json()
      })
      .then(setData)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load chronicle'))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return (
      <div className="min-h-screen bg-tavern-950 flex items-center justify-center">
        <TavernSpinner />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-tavern-950 flex items-center justify-center px-4">
        <div className="text-center">
          <p className={`text-xl text-ember-100 mb-2 ${displayFont.className}`}>Chronicle unavailable</p>
          <p className="text-ember-300/60 text-sm">{error || 'This link may have been disabled.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-tavern-950">
      <header className="border-b border-ember-900/30 px-4 py-8 text-center">
        <p className="text-xs uppercase tracking-widest text-ember-400/50 mb-2">A Chronicle From MythOS</p>
        <h1 className={`text-3xl text-ember-100 mb-2 ${displayFont.className}`}>{data.campaign.title}</h1>
        {data.campaign.universe && (
          <p className="text-sm text-ember-300/50">{data.campaign.universe}</p>
        )}
        {data.campaign.description && (
          <p className="text-sm text-ember-300/60 max-w-xl mx-auto mt-3">{data.campaign.description}</p>
        )}
      </header>

      <main className="max-w-2xl mx-auto px-4 py-10 space-y-10">
        {data.scenes.length === 0 ? (
          <p className="text-center text-ember-300/50">No scenes have concluded yet — check back once the story's underway.</p>
        ) : (
          data.scenes.map(scene => (
            <article key={scene.sceneNumber} className="border-b border-ember-900/20 pb-8 last:border-0">
              <h2 className={`text-lg text-ember-200 mb-3 ${displayFont.className}`}>
                Scene {scene.sceneNumber}{scene.title ? ` — ${scene.title}` : ''}
              </h2>
              <p className="text-ember-100/90 leading-relaxed whitespace-pre-wrap">{scene.introText}</p>
              {scene.resolutionText && (
                <p className="text-ember-100/80 leading-relaxed whitespace-pre-wrap mt-4">{scene.resolutionText}</p>
              )}
            </article>
          ))
        )}
      </main>

      <footer className="text-center text-xs text-ember-400/40 pb-8">
        A read-only chronicle — no login required.
      </footer>
    </div>
  )
}
