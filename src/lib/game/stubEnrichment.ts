// src/lib/game/stubEnrichment.ts
// Post-commit, fire-and-forget enrichment for stub NPCs/factions the AI
// introduced mid-scene with no description: one lightweight AI call per
// entity kind, filling in a short description (and, for factions, goals)
// from the resolved scene text.
//
// Moved out of stateUpdater.ts, where enrichStubFactions/enrichStubNPCs
// were near-identical hand-duplicated functions — same find-stubs / build-
// prompt / call-model / parse-JSON / recordAICost / write-back shape,
// differing only in the Prisma model, the description-empty filter
// (`null` vs `''`), the prompt wording, and the response's JSON key.
//
// Deliberately still a single raw `openaiFetch` call rather than
// `lib/ai/chatCompletion.ts`: the original request is a single user
// message with no system prompt at all, and chatCompletion.ts always
// sends a system + user pair. Forcing this through it would mean either
// inventing a new system prompt (a real behavior change, not just a
// shape change) or sending an empty system message the original request
// never had — neither is "identical request," so the duplicate fetch
// boilerplate is deduped here instead, without changing the wire shape.
//
// Silently skips if OpenAI is unconfigured or the call fails — both
// functions are intentionally non-critical.

import { prisma } from '@/lib/prisma'
import { openaiFetch } from '@/lib/ai/openaiCompat'
import { AI_MODELS } from '@/lib/ai/models'
import { recordAICost, estimateTokenCount } from '@/lib/ai/cost-tracker'

const STUB_CUTOFF_MS = 2 * 60 * 1000

interface StubEntity {
  id: string
  name: string
}

interface EnrichedResult {
  name: string
  description: string
  goals?: string
}

interface StubEnrichmentSpec<TStub extends StubEntity> {
  /** Used in the lowercase-context log lines: "stub NPC(s)", "Enriched NPC:". */
  kindLabel: string
  /** Used in the "X enrichment API call failed" / "X enrichment failed" lines. */
  apiErrorLabel: string
  requestType: string
  findStubs: (campaignId: string, cutoff: Date) => Promise<TStub[]>
  buildPrompt: (sceneText: string, stubs: TStub[]) => string
  parseResults: (content: string) => EnrichedResult[]
  applyEnrichment: (stub: TStub, enriched: EnrichedResult) => Promise<void>
}

async function enrichStubEntities<TStub extends StubEntity>(
  campaignId: string,
  sceneText: string,
  spec: StubEnrichmentSpec<TStub>
): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return

  const cutoff = new Date(Date.now() - STUB_CUTOFF_MS)
  const stubs = await spec.findStubs(campaignId, cutoff)
  if (stubs.length === 0) return

  console.log(`🪄 Enriching ${stubs.length} stub ${spec.kindLabel}(s): ${stubs.map(s => s.name).join(', ')}`)

  const prompt = spec.buildPrompt(sceneText, stubs)
  const startTime = Date.now()
  try {
    const response = await openaiFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: AI_MODELS.EFFICIENT,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 400,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      console.warn(`⚠️ ${spec.apiErrorLabel} enrichment API call failed:`, response.status)
      return
    }

    const data = await response.json()
    const rawContent = data.choices[0].message.content
    const results = spec.parseResults(rawContent)

    const usage = data.usage || {}
    await recordAICost({
      campaignId,
      model: AI_MODELS.EFFICIENT,
      requestType: spec.requestType,
      inputTokens: usage.prompt_tokens || estimateTokenCount(prompt),
      outputTokens: usage.completion_tokens || estimateTokenCount(rawContent),
      responseTimeMs: Date.now() - startTime,
      success: true
    }).catch(console.error)

    for (const enriched of results) {
      const stub = stubs.find(s => s.name.toLowerCase() === enriched.name.toLowerCase())
      if (stub && enriched.description) {
        await spec.applyEnrichment(stub, enriched)
        console.log(`  ✅ Enriched ${spec.kindLabel}: ${stub.name}`)
      }
    }
  } catch (err) {
    console.warn(`⚠️ ${spec.apiErrorLabel} enrichment failed (non-critical):`, err)
  }
}

/**
 * Enrich stub NPCs that were auto-created mid-scene with no description.
 *
 * After `applyWorldUpdates` commits, any NPC introduced by the AI without
 * a description exists as a bare name in the DB. This makes a single
 * lightweight AI call to flesh them out based on the resolved scene text,
 * then persists the result.
 */
export async function enrichStubNPCs(campaignId: string, sceneText: string): Promise<void> {
  return enrichStubEntities<{ id: string; name: string }>(campaignId, sceneText, {
    kindLabel: 'NPC',
    apiErrorLabel: 'NPC',
    requestType: 'npc_enrichment',
    findStubs: (campaignId, cutoff) => prisma.nPC.findMany({
      where: { campaignId, description: null, createdAt: { gte: cutoff } },
      select: { id: true, name: true }
    }),
    buildPrompt: (sceneText, stubs) => {
      const nameList = stubs.map(n => `- ${n.name}`).join('\n')
      return `You are a TTRPG game master. The following scene just resolved:\n\n${sceneText}\n\nThese NPCs were introduced for the first time:\n${nameList}\n\nFor each NPC, write a SHORT 1-2 sentence description (appearance, role, or personality) based on how they appear in the scene. If the scene doesn't mention them explicitly, invent something consistent with the fiction.\n\nRespond with valid JSON:\n{"npcs": [{"name": "...", "description": "..."}]}`
    },
    parseResults: (content) => (JSON.parse(content) as { npcs: EnrichedResult[] }).npcs,
    applyEnrichment: async (stub, enriched) => {
      await prisma.nPC.update({
        where: { id: stub.id },
        data: { description: enriched.description }
      })
    }
  })
}

/**
 * Enrich stub factions auto-created mid-campaign with no description.
 * Mirror of enrichStubNPCs — same pattern, same non-critical fire-and-forget usage.
 */
export async function enrichStubFactions(campaignId: string, sceneText: string): Promise<void> {
  return enrichStubEntities<{ id: string; name: string }>(campaignId, sceneText, {
    kindLabel: 'faction',
    apiErrorLabel: 'Faction',
    requestType: 'faction_enrichment',
    findStubs: (campaignId, cutoff) => prisma.faction.findMany({
      where: { campaignId, description: '', createdAt: { gte: cutoff } },
      select: { id: true, name: true }
    }),
    buildPrompt: (sceneText, stubs) => {
      const nameList = stubs.map(f => `- ${f.name}`).join('\n')
      return `You are a TTRPG game master. The following scene just resolved:\n\n${sceneText}\n\nThese factions or groups were introduced for the first time:\n${nameList}\n\nFor each faction, write a SHORT 1-2 sentence description (what they are, their role or agenda) based on context from the scene. Invent something consistent with the fiction if they aren't explicitly described.\n\nRespond with valid JSON:\n{"factions": [{"name": "...", "description": "...", "goals": "..."}]}`
    },
    parseResults: (content) => (JSON.parse(content) as { factions: EnrichedResult[] }).factions,
    applyEnrichment: async (stub, enriched) => {
      await prisma.faction.update({
        where: { id: stub.id },
        data: {
          description: enriched.description,
          ...(enriched.goals ? { goals: enriched.goals } : {})
        }
      })
    }
  })
}
