// src/lib/game/__tests__/idleCampaign.liveDb.test.ts
//
// #401: run the world forward with nobody playing, and check it changed.
//
// This is the single test both adversarial audit passes concluded was
// missing, and it is missing for a structural reason: every defect it
// covers is a COMPOSITION defect. Each unit involved is individually
// correct and individually tested, which is exactly why 3,977 passing
// tests could coexist with a simulation that had stopped simulating.
//
// It would have caught, at once:
//
//   #374 — runWorldTurn read currentTurnNumber and never wrote it, so
//     every tick ran at the identical turn number. Weather pinned, NPC
//     schedules froze or thrashed, `age = turn - event.turn` never grew so
//     information never propagated, belief drift ran once and then
//     no-opped forever.
//   #375 — eleven handlers each bumped lastTickedAt with the transaction
//     client mid-pass, so each selected a different roster inside one
//     transaction; and the campaign-level drift watermark then discarded
//     that turn's drift for everyone who lost the rotation.
//   #376 — the claim wasn't exclusive, so an idle campaign sitting on the
//     threshold boundary could run the same turn twice.
//
// None of those is visible to a unit test. All of them are visible to
// thirty turns and a handful of assertions.
//
// Opt-in, matching this repo's other *.liveDb.test.ts files:
//
//   RUN_DB_TESTS=1 npx vitest run idleCampaign.liveDb

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { runWorldTurn } from '../worldTurn'

const RUN = process.env.RUN_DB_TESTS === '1'
const describeIfDb = RUN ? describe : describe.skip

/** Long enough for the slow signals — goal commitment windows, information
 * latency, loan maturity — to have had a real chance to fire. */
const IDLE_TURNS = 30

describeIfDb('an idle campaign — thirty world turns, no player (#401)', () => {
  const prisma = new PrismaClient()
  let campaignId: string

  beforeAll(async () => {
    const campaign = await prisma.campaign.create({
      data: { title: 'Idle Campaign Live Test', aiSystemPrompt: 'test', initialWorldSeed: 'test' },
    })
    campaignId = campaign.id

    await prisma.worldMeta.create({
      data: { campaignId, currentTurnNumber: 1, simulationTurn: 0, totalElapsedGameHours: 0 },
    })

    // A world with enough in it for the simulation to have somewhere to
    // go: rival factions with members, and several locations so
    // information has distance to cross.
    const [ashcrown, rustwatch] = await Promise.all([
      prisma.faction.create({
        data: { campaignId, name: 'Ashcrown Company', isActive: true, stability: 60, resources: 60, military: 60 },
      }),
      prisma.faction.create({
        data: { campaignId, name: 'The Rustwatch', isActive: true, stability: 55, resources: 50, military: 70 },
      }),
    ])

    const locations = await Promise.all(
      ['Kel Marsh', 'The Ashen Gate', 'Cinderhold', 'Farrow Docks'].map((name) =>
        prisma.location.create({ data: { campaignId, name, isDiscovered: true, conditionScore: 70 } })
      )
    )

    // Major NPCs — importance at or above the tick's threshold, so they
    // are actually simulated — spread across locations.
    await Promise.all(
      [
        { name: 'Marek Vosk', factionId: ashcrown.id, locationId: locations[0].id },
        { name: 'Sera Chal', factionId: rustwatch.id, locationId: locations[1].id },
        { name: 'Old Bran', factionId: ashcrown.id, locationId: locations[2].id },
        { name: 'Vell', factionId: rustwatch.id, locationId: locations[3].id },
      ].map((npc) =>
        prisma.nPC.create({
          data: {
            campaignId,
            name: npc.name,
            factionId: npc.factionId,
            locationId: npc.locationId,
            currentLocation: locations.find((l) => l.id === npc.locationId)!.name,
            isAlive: true,
            importance: 5,
            goals: 'Consolidate their position',
          },
        })
      )
    )

    // A world graph, so information has hops to travel across (#379).
    for (let i = 0; i < locations.length; i++) {
      const a = locations[i].id
      const b = locations[(i + 1) % locations.length].id
      const [locationAId, locationBId] = a < b ? [a, b] : [b, a]
      await prisma.locationAdjacency.create({
        data: { campaignId, locationAId, locationBId, distance: 1 },
      })
    }

    // Thirty turns, no player input of any kind. runWorldTurn directly
    // rather than runWorldTurnIfDue: the pacing gate is a separate
    // concern with its own tests, and what this file is about is what
    // thirty ticks DO.
    for (let i = 0; i < IDLE_TURNS; i++) {
      await runWorldTurn(campaignId)
    }
  }, 300_000)

  afterAll(async () => {
    await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => {})
    await prisma.$disconnect()
  })

  it('advances its own turn counter once per turn', async () => {
    // #374: this was the deepest finding of both audit passes.
    // runWorldTurn read currentTurnNumber (the SCENE counter) and never
    // wrote it, so thirty ticks all ran at turn 1.
    const meta = await prisma.worldMeta.findUnique({
      where: { campaignId },
      select: { simulationTurn: true, currentTurnNumber: true },
    })

    expect(meta?.simulationTurn).toBe(IDLE_TURNS)
    // And the scene counter did NOT move — no scenes were resolved. The
    // two clocks are genuinely separate now.
    expect(meta?.currentTurnNumber).toBe(1)
  })

  it('changes the weather rather than pinning it to a constant', async () => {
    // With a frozen turn number, stableHash(loc:turn:*) is constant, so
    // severityDelta was fixed at -1/0/+1 and severity pinned to 1 or 5
    // within about three ticks.
    const weatherEvents = await prisma.worldEvent.findMany({
      where: { campaignId, targetType: 'LOCATION_WEATHER' },
      select: { newValue: true },
    })

    expect(weatherEvents.length).toBeGreaterThan(0)
    expect(new Set(weatherEvents.map((e) => e.newValue)).size).toBeGreaterThan(1)
  })

  it('propagates information to someone who was not there', async () => {
    // #374's sharpest consequence: `age = currentTurn - event.turnNumber`
    // never grew, so anything with a delay never reached anyone, ever.
    const told = await prisma.eventWitness.count({ where: { campaignId, grade: 'TOLD' } })

    expect(told).toBeGreaterThan(0)
  })

  it('drifts belief for every faction, not just whichever won a rotation', async () => {
    // #375: the campaign-level watermark advanced past a turn after
    // processing only the capped subset, so factions that lost that tick's
    // rotation lost that turn's drift permanently. Over thirty turns with
    // per-entity watermarks, everyone should have been reached.
    const factions = await prisma.faction.findMany({
      where: { campaignId },
      select: { name: true, beliefDriftThroughTurn: true },
    })

    for (const faction of factions) {
      expect(faction.beliefDriftThroughTurn, `${faction.name} never had its belief drift processed`).not.toBeNull()
    }
  })

  it('moves faction goals at least once over thirty turns', async () => {
    const goalChanges = await prisma.worldEvent.count({ where: { campaignId, type: 'faction.goal' } })

    expect(goalChanges).toBeGreaterThan(0)
  })

  it('writes no duplicate world events for a single turn', async () => {
    // #377: a turn spans ~14 commits, so a mid-turn failure re-runs the
    // whole turn — and duplicated WorldEvent rows are not inert, because
    // belief and disposition drift derive from COUNTING them. The dedupe
    // key is what makes a replay a no-op.
    const rows = await prisma.worldEvent.findMany({
      where: { campaignId, dedupeKey: { not: null } },
      select: { dedupeKey: true },
    })
    const keys = rows.map((r) => r.dedupeKey)

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('leaves the world-turn lease released', async () => {
    // #376: the lease is what makes the claim exclusive. A run that
    // finishes without releasing it would block the campaign until the
    // staleness timeout.
    const meta = await prisma.worldMeta.findUnique({
      where: { campaignId },
      select: { worldTurnRunningSince: true },
    })

    expect(meta?.worldTurnRunningSince).toBeNull()
  })
})
