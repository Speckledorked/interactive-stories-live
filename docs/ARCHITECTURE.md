# MythOS — Technical Architecture & Audit

This is the engineering reference: what's actually built, what's tested,
what's still rough, and what's next. It was originally the bulk of the root
README; split out on 2026-08-06 so the README could speak to players and
prospective users without leading with a scorecard. Nothing below changed in
that move — same content, same claim-checking discipline, new home.

That discipline still applies here, not just historically: this document was
rewritten from a full re-audit of the codebase (not of the previous README)
after eight sequential subsystem refactors — world simulation, AI prompt
generation, state management, the database layer, memory/RAG, UI components,
API routes, and shared utilities. Every claim below was checked against the
actual implementation; nothing here is carried forward from a stale audit.
`src/__tests__/readmeSymbols.test.ts` enforces part of that going forward:
every backticked function name in this file (or in `README.md`) must either
exist in `src/`/`prisma/`, or be documented as deliberately removed — so a
future edit that quietly falsifies a claim here fails a test instead of
sitting unnoticed.

See [`README.md`](../README.md) for what MythOS is and why it exists in
plain terms, and [`SETUP.md`](../SETUP.md) for installation.

## What MythOS Is

- **AI Game Master** — OpenAI-powered scene narration, scoped narrowly: the
  AI classifies player intent and writes prose; it never decides dice
  outcomes or faction/world state directly.
- **Server-rolled move resolution** — every risky action is classified to a
  PbtA-style basic move and rolled 2d6 + modifiers *on the server*, with an
  injectable RNG so the roll is genuinely testable. The arithmetic is
  entirely outside the model's reach and the roll is unconditional.
  Modifiers blend stats, capability bands, faction standing, debt,
  relationships, harm, weather, contested territory, and conditions. Every
  roll is persisted as an auditable receipt, viewable in an opt-in
  transparency panel. Whether the *narration* then actually depicts the
  rolled outcome is tracked (an `outcome_echo` field the narrator reports
  each turn), and any mismatch is now visible to players in that same
  panel — deliberately still only observed, never enforced or rewritten.
  A small backfill call (`outcomeEchoRepair.ts`) repairs the residual
  entries the narrator forgets to self-report, capped at 3 attempts per
  scene so a persistently uncooperative model degrades to "still
  unreported" rather than retrying forever.
- **Living world simulation** — a deterministic "world tick," zero AI calls,
  advances NPCs, factions, weather, and territory once real in-game time has
  passed, independent of whether players are present. Factions pursue
  goals, contest and conquer territory, and sustained conflicts escalate
  into multi-turn wars that can grow into coalitions. A player character can
  lead a faction outright — set its strategic goal in-fiction and watch it
  keep ticking autonomously between sessions. The tick itself
  (`runWorldTick`) never calls AI; a separate step in the same world turn
  (`generateOffscreenEvents` in `worldTurnOffscreenEvents.ts`) narrates what
  the tick just decided, so "the simulation is AI-free" and "offscreen
  drama gets AI narration" are both true at once — they're two different
  layers.
- **Debt & standing economy** — player choices create real, mechanically
  binding consequences: a faction losing a war in an offscreen tick changes
  what a player can roll next session. This is the most differentiated
  thing in the codebase — consequences are remembered mechanically, not
  just narratively.
- **World-visibility digest** — a background world turn's MAJOR, discovered
  drama (a war declared, a faction falling, new leadership) reaches every
  member as a notification, and is also written permanently into the
  campaign's Rumors feed (`/wiki?type=RUMORS`) — so what the world did while
  nobody was watching is a lasting, revisitable record, not just a
  transient alert.
- **Fog of war** — hidden factions/NPCs/locations, GM-only notes, and exact
  simulation numbers never reach player-facing text or prompts, enforced at
  the query layer through a single shared gate rather than by convention at
  each call site. A structural test fails if a new route reads a
  fog-gated model without it.
- **Campaign memory (RAG)** — real pgvector cosine-similarity search over
  campaign history, with decay/consolidation keeping a long campaign's
  memory table bounded rather than growing forever.
- **Knowledge-relative character sheets** — a sheet shows what the
  *character* knows, not what the database knows: glimpsed capabilities
  render as unknown, unlocked ones grow through use with deterministic,
  arc-capped gains.
- **Corruption track** — an irreversible, capped "power at a cost" theme
  that gates location entry, quest acquisition, and NPC goodwill — enforced
  by the engine, not just narrated.
- **Quest & item tracking** — quests have a real lifecycle (registered →
  progress → completed/failed/abandoned) with mechanical consequences for
  failing or walking away; inventories aggregate into a browsable wiki
  registry.
- **Safety tooling** — an X-Card with a real scene pause that reaches every
  player's screen immediately, content reporting, campaign bans,
  per-player blocking, and lines/veils fed into the AI prompt.
- **Admin tooling** — a faction relationship/territory map, a tick-log
  viewer explaining the reasoning behind every simulated change, a dry-run
  "preview next tick" mode, and now a per-entity "why" preview on the
  faction/NPC tabs. Still the weakest part of the product overall — see
  the Scorecard's "Admin tooling as simulation design" row.
- **Real-time collaboration** — Pusher-backed live chat, notifications, and
  scene updates.
- **Scene illustration** — an opt-in, per-campaign AI-generated image for
  each resolved scene, generated off the request path in its own async
  job (never able to slow down scene resolution itself even if the image
  API is slow or down). Built and tested this session; the real
  image-generation call and storage upload still need to be confirmed
  against a real account before enabling it in production — see Features
  & Roadmap.
- **Living chronicle lobby** — the campaign lobby's world-state panel is
  generated in-world prose (weather/faction posture/conflicts/recent
  happenings woven into a few sentences), not a stat-tile dashboard,
  regenerated once per world turn and never re-run per page view. A
  generated hero banner image accompanies it. Same real-credential caveat
  as scene illustration above.
- **Payments** — Stripe integration with metered per-call AI cost tracking
  (not a flat per-scene guess), balance gating, and Postgres-backed
  per-user rate limiting.
- **Ask the GM** — an out-of-character Q&A channel architecturally isolated
  from action resolution: no dice, no state changes, fog-of-war-safe
  answers. Grounded in the campaign's imported lore via RAG, so it can
  confirm setting-wide facts (e.g. "does this world have X") rather than
  only ever answering "I don't know" for anything not already discovered
  in play. Deliberately has no memory of past conversations and cannot
  feed back into narration — a design boundary, not a gap.

## What MythOS Is Trying to Become

Fully realized, "the world remembers" means a player should never be able
to tell where the simulation's memory ends and the AI's improvisation
begins — because it doesn't end. Every mechanical consequence should already
be feeding forward into what the dice do next, and every subsystem's own
history should be an input to its own future decisions rather than a log
nobody reads. Most of that is already true today. The biggest remaining gap
is between what the simulation computes and what a player can actually see:
dice receipts exist but stay opt-in, outcome adherence is measured but never
shown, and a faction's real opinion of you is deliberately kept invisible.
Closing that gap without turning the mechanics into a spreadsheet — enough
transparency that players trust the simulation is real and consistent,
without so much exposure that they start optimizing a number instead of
living in a story — is the next real milestone toward the vision, not a
finished feature.

It also means the admin/host surface should be a real window into the
simulation, not a settings page. The tick dry-run preview and the faction/
NPC "why" panels are real progress toward that; locations, clocks, and wars
still have no equivalent, and a host who wants to understand why the world
is doing what it's doing there still has to read logs. A fully realized
MythOS gives the table a way to watch the simulation reason about itself,
everywhere, at least as deeply as the tick-log debugger already reaches for
developers.

Finally, the vision assumes nothing here is finished just because it works.
Every subsystem in this codebase has already been through one honest audit
that found real gaps between what looked systemic and what was actually a
thin wrapper. The target state is a codebase where the next such audit turns
up successively smaller and rarer things — not the same category of bug
showing up in a new file.

## Current State — What Is Actually Working

Verified functional, end to end, as of this rewrite:

- The dice/outcome engine — pure, RNG-injected, unit-tested, unconditional.
- World tick orchestration, faction simulation, war/coalitions, weather, and
  NPC goal/movement — deterministic, sequenced, tested, including the
  losing-side stability hit, now directly tested rather than only
  incidentally covered through broader war-resolution tests.
- Debt, faction standing, relationships, harm, and corruption — all real,
  persisted, and mechanically consumed by the roll engine, not labels.
- The capability tree — real branching prerequisites, cycle-proof by
  construction, actually gates unlocks.
- Memory/RAG — real pgvector search, with consolidation bounding table
  growth.
- Fog of war — enforced structurally, with a passing test suite that fails
  if a new route bypasses it.
- Quest lifecycle, including FAILED/ABANDONED consequences (trust/respect
  costs, not just prose).
- Combat/complex-exchange resolution — deterministic conflict ranking; no
  dedicated combat subsystem beyond PbtA resolution, which is by design.
- Inventory/items — functional but still JSON-blob CRUD, not a relational
  Item table; no merchant/trading layer (a deliberate scope decision, not a
  gap).
- Downtime activities and completion rewards — deterministic outcomes, real
  payout application (gold/items/standing), not generated-and-discarded.
- Auth/session — real revocation via a token-version bump (`revokeAllSessions`),
  checked by every request helper (`requireAuth`, `verifyAuth`, `getUser`),
  still no refresh-token rotation, still 30-day JWTs.
- Rate limiting — Postgres-backed (correct for a serverless deployment),
  applied at 17 route call sites, unit-tested.
- Multi-scene/split-party handling — a scene's AI context is correctly
  scoped to its actual participants.
- Relationships stay hidden from players — a decided design choice, not an
  unfinished feature.
- The `TurnOrder` model is confirmed removed from the schema; it has no
  live references anywhere.
- The two most recent refactor passes (API routes, shared utilities)
  consolidated duplicated logic without changing behavior: a shared
  admin-gate helper (`requireCampaignAdmin`) and error helpers
  (`handleRouteError`/`handleRouteErrorWithDetails`) replaced dozens of
  hand-rolled copies across route handlers; character/campaign creation and
  action submission were extracted into real services
  (`createCharacter`/`createCampaign`/`submitPlayerAction`); and a new
  `src/lib/format.ts` (`pluralize`/`truncateWithEllipsis`) deduplicated
  string-formatting patterns repeated across the UI and AI prompt code.
  A near-duplicate hash function (`getColorFromName` in `CharacterAvatar.tsx`)
  was checked against the shared `stableHash`/`clamp` (`lib/game/tick/types.ts`)
  and found to genuinely diverge for longer strings — kept separate rather
  than force-merged. `bannerIconFor`, `getInitials`, `getRelativeTime`/
  `formatRelativeTime`, `hashPassword`/`verifyPassword`, `ensureContactNpcStubs`,
  and `getCampaignMembership` are the other helpers these two passes
  consolidated call sites onto.

Partial or weak, and honestly so:

- API route test coverage now covers all 104 routes (#135's final
  batches closed out the base list/create endpoints — campaigns,
  characters, factions, locations, members, notes, npcs, scenes,
  friends, friends/requests — plus admin/analytics). Coverage depth is
  still uneven: the highest-risk routes (fog-of-war reads, money/state/
  access-mutating writes) got the most scrutiny, while the last tiers
  covered mostly gate + shape assertions rather than exhaustive
  behavior. 100% file coverage is not the same claim as 100% behavior
  coverage — see the Scorecard row for what's actually asserted.
- Admin tooling was mostly thin CRUD; every world-entity tab (NPCs,
  Factions, Locations, Clocks, Wars) now extends the tick dry-run
  preview's "show your reasoning" pattern (#94/#126) — a per-entity
  `/reasoning` route (or, for Wars, one campaign-wide route) backed by
  the same pure decide/explain functions the real tick uses. Reasoning
  previews are still read-only projections, not an editable simulator.
- AI response validation has a bounded repair round-trip and a
  section-by-section salvage ladder. The contract stays basic JSON mode —
  decided against switching to strict structured outputs (2026-08-02),
  rather than leave it open pending a live API check.

## Scorecard

Graded 0–5 (0 = missing, 1 = placeholder, 2 = cosmetic/basic CRUD, 3 =
functional but shallow, 4 = substantive, 5 = robust and compounding).
Verified against the current implementation, not against a prior version of
this table.

| System | Score | Status |
|---|:-:|---|
| Server-rolled dice/outcome engine | 5 | `computeMechanics` (`src/lib/game/resolution.ts`) is genuinely pure, RNG-injected, and unit-tested with real edge cases — stacked-modifier totals including a fully-negative case, both dice extremes, and the exact outcome-band boundaries (`resolution.goldenVectors.test.ts`). `resolveActionMechanics`, named alongside it above, is the orchestrator around it and is NOT itself pure (real Prisma reads/writes, a live network call) — the two shouldn't be described as one "pure" unit. The silent-degrade gap this row used to name (#200 — a classifier failure, whether from a missing `OPENAI_API_KEY`, an OpenAI outage, or a genuine error, produced the exact same bare `[]` as the legitimate "nothing needed rolling" case, with no player-facing signal either way) is fixed: `resolveActionMechanics` now returns `{ mechanics, classificationUnavailable }`, `classificationUnavailable` is true only when classification itself genuinely failed (never on a real "no roll needed" outcome), and the flag threads through as `_mechanicsUnavailable` on `AIGMRequest` to a prominent, visible-by-default `worldStateChanges` entry — a player now sees when a roll silently didn't happen instead of it reading as ordinary freeform narration. |
| Faction simulation (goals/collapse/succession/territory) | 5 | Goal-driven stat deltas (`decideFactionTick`), banded reassessment (`decideFactionGoalReassessment`, now also overridable by a drifted `beliefVector` — see the Cultural drift row), collapse (`decideFactionCollapse`) → absorption or remnant succession, territory claims. `decideSuccession` is a standalone, tested, pure function with deterministic tie-breaking (`compareCandidates`) that holds even on a full tie (falls through to `id.localeCompare` as a final backstop) and a correctly-handled zero-candidate case (`decideSuccession` returns `null`, not a throw). The same-tick absorption bug this row used to name (#199 — `tickFactions` looping over a faction array snapshotted before the loop starts, so a faction B processed after absorbing faction A silently overwrote the just-transferred resources with its own stale pre-absorption snapshot) is fixed: an `appliedDeltaThisTick` map plus `rawFaction`/`faction` shadowing keeps every read in the same pass current against what's already been written this tick. See the Fix Log. |
| War & coalition system | 4 | Multi-turn momentum/attrition, allies join sides, decisive/stalemate resolution. The pure deciders (`decideWarDeclaration`, `decideWarProgress`, `decideWarResolution`, `decideWarJoiner`) and the tick-side functions that apply them (`declareNewWars`, `resolveWarProgress`, `growWarCoalitions`) are all unit-tested, including the losing side's stability hit, now directly tested rather than only incidentally covered. Mid-war collapse of an entire side resolves cleanly as a stalemate, verified. Note on scope: `WarParticipant.side` is strictly `'ATTACKER' \| 'DEFENDER'` — "coalition" means multiple factions sharing one of two slots, never a genuine 3+-way war. |
| World tick orchestration | 5 | 19 deterministic handlers confirmed (`runWorldTick`/`TICK_HANDLERS`), sequenced same-tick dependencies with genuinely broad pairwise-ordering coverage (10+ documented dependencies, not just a couple of pairs), zero AI calls confirmed by direct audit across every handler, all inside one `prisma.$transaction` — a failed turn rolls back cleanly instead of committing partial state. The `TICK_TRANSACTION_TIMEOUT_MS` (20s) vs. admin-configurable `factionCap`/`npcCap` gap this row used to name (#203 — `resolveTickCaps` had no upper clamp on either, so a campaign that raised those caps had no matching timeout headroom) is fixed: `caps.ts` now defines `MAX_FACTION_CAP`/`MAX_NPC_CAP` (5x the defaults, documented against Phase 3's own measured ~100ms real tick-pass timing — ~200x headroom under the 20s timeout even at the new ceiling), and the simulation settings route rejects a `factionCap`/`npcCap` above them with a 400 instead of silently accepting an unsafe value. |
| Debt economy | 5 | Directional, persisted, and consumed as a real roll modifier (`debtModifier`), correctly clamped to ±2 regardless of how many debts exist — not a label. The underlying query that feeds it is now bounded (`orderBy: createdAt desc, take: 300` — a generous backstop, not a tight precision cap, since `debtsWithCounterparty` needs a specific counterparty's full count for correctness), and the display-only `worldSummary.ts` debt includes got the same treatment (`take: 20`). Fixed — see the Fix Log (#221). |
| Faction standing | 4 | Feeds `computeMechanics()` directly via a banded modifier, correctly zeroed for a collapsed/absorbed faction. The unwritten-influence gap this row used to name (#218 — the modifier's LOW-band cap was keyed on `Faction.influence`, which no tick or consequence path ever wrote, so the "bled dry by a lost war" scenario the code's own comment described couldn't occur through simulation) is fixed: a decisive war resolution now moves influence alongside the existing stability hit (loser -8, winner +4, coalition-wide), so the LOW-influence cap is reachable through real play. |
| Relationships (trust/tension/respect — 3 of 4 tracked axes) | 4 | Feeds `computeMechanics()` via a banded `relationshipModifier`. Deliberately never rendered to players as raw numbers. `fear` is the 4th tracked axis but stays narrative-only by design (`resolution.ts`'s own comment: it "cuts both ways depending on the move and the classifier doesn't currently signal which") — #220 confirmed this row's own title previously implied all 4 axes were mechanical when only 3 are; retitled rather than silently corrected in the body alone. Not a 5 — wiring fear in would need the classifier to signal a direction first, which is real follow-up work, not a documentation fix. |
| Capability / skill-tree progression | 4 | Glimpse → unlock → progress state machine, real branching prerequisites (`resolvePrerequisiteLinks`, enforced via `applyCapabilityChanges`/`prerequisiteUnlockBlocked`), cycle-proof by construction, feeds roll modifiers directly. |
| Character harm/death state machine | 4 | Full model: auto-conditions (`applyHarm`), death saves (`makeDeathSave`), permanent injury (`performRecoveryRoll`), a `canAct()` gate, one parse boundary for the harm blob (`parseHarmState`). Three recovery speeds — medical attention (`applyMedicalAttention`), in-game time (`accrueNaturalRecovery`), and rest (`applyRest`) — all blocked by recurring-harm conditions (`blocksNaturalRecovery`). Both gaps #213 named are fixed: `applyCharacterChanges` now individually gates every physical-state mutation (`harm_damage`/`harm_healing`/conditions/`medical_attention`/`rest_quality`/`death_save_result`/`heroic_sacrifice`/`corruption_change`, plus the two inventory-triggered consumable-heal paths) on `character.isAlive`, warning once per pcChange rather than silently mutating a corpse; and the Taken-Out roll — both the 2d6 itself and, one level deeper, `performRecoveryRoll`'s permanent-injury pick — now takes the same injectable `Rng` type (`src/lib/game/rng.ts`) the rest of the dice engine uses, defaulting to `Math.random` for every real caller but genuinely testable via injection instead of globally mocking `Math.random`. Not a 5 — non-physical changes (location, knowledge, relationships, inventory, resources) still process for a dead character by design (gear can be looted, the party can learn something about the deceased), which is a real and deliberate boundary but means "dead" isn't a single hard stop the same way `canAct()` gates it at combat time. See the Fix Log. |
| Corruption track | 4 | Irreversible, capped at +1/scene (`applyCorruptionMarks`), force-applied even if the AI forgets to narrate it. |
| Consequence engine (player action → faction/NPC state) | 4 | Deterministic per-action deltas (`extractAndApplyConsequences`/`applyConsequences`). Entity lookup now goes through the same roster-based `resolveEntityByNameOrId` every other AI write-back applier uses (fetched once per batch, not once per name) — see the Fix Log. The exact-name-match branch's ambiguity gap (#215) is fixed: it now collects every exact-name match (not just `.find()`'s first) and returns `ambiguous` when there's more than one, the same shape the fuzzy-match path already used — a campaign with two same-named entities can no longer have a consequence silently applied to the wrong one. Not a 5 — resolution still depends on the AI reporting a name/id that matches at all; a hallucinated or misspelled reference still fails closed (skipped, not guessed). |
| Character progression (advancement) | 4 | Usage-gated growth with real PbtA constraint validation. AI-authored perks/Abilities carry a real per-arc grant budget (`countGrantsInArc`, applied in `applyOrganicGrowth`), not a level-up button. The read-then-write race #214 named is fixed: `Character.advancementVersion` is a dedicated optimistic-concurrency counter (a single grant touches 5 different fields — `statUsage`/`stats`/`perks`/`moves`/`advancementLog` — not all of which change together, so no existing field could double as a reliable "nothing else changed" proof) — `applyOrganicCharacterGrowth`'s writes now go through a guarded `updateMany({where: {id, advancementVersion}, data: {..., advancementVersion: {increment: 1}}})`, and a losing concurrent write is detected via `result.count === 0` and skipped with a warning rather than silently clobbering or double-applying. Not a 5 — the skipped-write case degrades to "this grant is lost, log it," not an automatic retry against the fresh row. |
| Player stress & trait/move evolution | 3 | `Character.stress` (0-10, recoverable — decays on any quiet exchange rather than only ever climbing) drifts from signals the engine already computes this same `pc_changes` apply pass — the binding outcome band from `action_mechanics` (never the AI's own `outcome_echo` self-report), applied harm ≥2, a costly `enemy`/`longTermThreat` consequence, an applied corruption mark (`stress.ts`'s `classifyStressEvents`/`decideStressDrift`, wired into `worldUpdaters/characters.ts`). Crossing a threshold (`isEvolutionEligible` in `advancement.ts`, reusing the existing perk/move arc budget rather than a second counter) surfaces a boolean-only `evolution_eligible` flag to the prompt, with spiral-vs-resilience framing guidance for the *existing* `organic_advancement.new_perks/new_moves` channel — no new AI-facing field for the offer itself. Fully hidden, not even a qualitative band the way capability proficiency gets one — a visible number would turn "did I fail?" into "am I about to level up," the same reasoning `Character.relationships` is hidden for. Not a 4 — live-verified against real Postgres (including the DB CHECK constraint actually rejecting out-of-range writes) but no real campaign has produced an actual evolution offer yet. |
| Memory retrieval (RAG) | 4 | Genuine pgvector cosine search, cost-tracked, gracefully returning empty on a campaign with no memories yet. Consolidation now covers both tiers: `MINOR`/`NORMAL` memories ≥20 turns old (10-turn buckets) and, as of the fix, `MAJOR`/`CRITICAL` memories ≥150 turns old (50-turn buckets) — the two tiers share one parameterized implementation (`ConsolidationTierConfig`) so they can't drift apart, and each tier catches its own failure independently so one tier's error can't erase the other's already-successful result. Fixed — see the Fix Log (#216). Not a 5 — the table still "is never capped at write time" per its own header comment; consolidation bounds it after the fact, not at insert. |
| Memory importance/tag classification | 4 | The historical field-name mismatch is fixed and regression-tested; `determineImportance`/`extractTags` read the AI response's real field names. |
| AI response validation | 4 | One bounded repair round-trip (`validateAIResponseWithRepair`), then a degradation ladder (`extractValidWorldUpdates`) that salvages `world_updates` through the real schemas section-by-section and element-by-element rather than zeroing the whole thing. `time_passage` is now a required field (`TimePassageSchema`'s own `.refine()` demands at least `days` or `hours`, even if the value is 0) rather than silently omittable, and — since making it required alone didn't survive a degraded response — `extractValidTimePassage` salvages it independently on the `'partial'`/`'emergency'` levels too, so world-turn pacing (`hoursSinceWorldTurn`) can no longer starve just because some other part of a response needed to degrade. See the Fix Log. The background world-turn call is validated too (`callAIForWorldTurn` → `validateWorldTurnResponse`), not a bare parse. Basic JSON mode, not strict structured outputs — a deliberate decision (2026-08-02) to keep this contract rather than switch. The validation-rigor inconsistency this row used to name (#217 — `worldGenerator.ts`'s campaign-creation call silently coerced a malformed faction's missing name to a fake "Unknown Faction" default rather than rejecting it, becoming permanent world state from unvalidated data since world generation runs once at creation) is fixed, and the issue's own broader claim was audited rather than assumed: `worldGenerator.ts` now filters out any faction with no real (non-empty) name before mapping, matching the sibling `fronts`-parsing pattern already in the same function; flavor-text/numeric fields keep their existing safe-default coercion, since those aren't identity fields. Auditing the other 4 call sites the issue named turned up no matching defect — `worldGraphGenerator.ts` already rejects edges naming unknown locations or malformed distances, `consequenceExtraction.ts` already rejects entries with an invalid entity type/name/action, and `chronicleNarration.ts`/`sceneStakes.ts` are single flavor-text fields each with a real validate-and-reject-to-null function — only `worldGenerator.ts` had the actual defect. |
| Clock advancement (non-ambition clocks) | 4 | Deterministic, faction/relation-driven pacing (`decideClockAdvancement`), not a random coin flip — every write path correctly clamps at `maxTicks`, and a clock linked to a collapsed faction stalls/defaults correctly rather than crashing. The mid-loop partial-failure gap #229 named is fixed: `advanceClocks`'s pure decision loop now only collects `{clock, newTicks}` pairs, and the writes themselves go through one `prisma.$transaction(clockUpdates.map(...))` batch — all clocks this turn advance together or none do, instead of the old un-transacted per-clock loop that could leave some clocks advanced and others stale against a failure partway through. Not a 5 — `advanceClocks` still runs as its own transaction, separate from the main world-tick transaction (`runWorldTick`'s `$transaction`), called after it has already committed — a deliberate boundary, not a bug (the AI offscreen-narration call sits between them and can't be held inside a DB transaction), but it does mean a clock-advancement failure still can't roll back an already-committed tick, only its own batch. |
| Quest lifecycle | 4 | A structured reward grant is applied deterministically the first time a quest completes. FAILED/ABANDONED are not inert — walking away costs trust and standing, failing honestly costs respect (`applyQuestFailureCost`). An unresolved quest-giver (`resolveQuestGiver` returning unresolved, guarded by `hasQuestGiver`) costs nothing rather than guessing. "The first time" is now actually enforced (#212 fixed): a status transition routes through a guarded `tx.quest.updateMany({where: {id, status: existing.status}, data: updateData})` instead of a plain `update` — a losing concurrent write's `count === 0` is detected and its `justCompleted`/`justFailed` flags are reset to `false` rather than double-granting the reward. Not a 5 — the loser's transition is silently dropped for that turn rather than retried against the fresh row. |
| Combat / complex exchange resolution | 4 | Conflicting actions on the same target are ranked by actual roll outcome (`rankActionsByOutcome`/`compareActionsByOutcome`, surfaced via `detectConflicts`), not left to an AI punt. No dedicated combat subsystem beyond PbtA resolution — by design. The unstable-secondary-sort gap #219 named is fixed: `getActionsByPriority`'s query orders by `actionPriority`, then `createdAt` (real submission order), then `id` (a final always-unique tiebreak) — a fully deterministic chain Postgres can never leave ambiguous, so `compareActionsByOutcome`'s stable sort now actually gets the deterministic input order it needs. Not a 5 — still no dedicated combat subsystem beyond PbtA resolution, by design. |
| Inventory / items | 4 | Structured `armorValue`/`damageBonus`/`effect`, with `'heal'` enforced deterministically (`resolveConsumableHeal`, correctly floors healing at 0 harm). `value`/`rarity` under a per-arc budget for grants that go through it. NPCs have a lighter mirrored harm model (`healHarm`). Still JSON-blob CRUD, not a relational Item table; no merchant/trading layer by design. A prior `slots` capacity field was removed and never re-enforced — no cap on total item count today, revisited and reconfirmed as a deliberate scope decision (#222, matching the "no merchant/trading layer" boundary elsewhere: an unbounded item list is a slow, cosmetic JSON-blob-growth concern on a very long campaign, not an exploit surface), not an unexamined gap. |
| Downtime activities | 3 | A deterministic, risk-weighted outcome category (`decideDowntimeDayEvent`) is rolled before the AI narrates, replacing a random coin flip. Completion rewards are genuinely applied (`applyDowntimeRewards`), not generated and discarded. The unlimited-concurrent-activities half of #211's exploit is fixed with a real DB constraint, not just app-level checking: a partial unique index (`CREATE UNIQUE INDEX ... ON downtime_activities (characterId) WHERE status = 'ACTIVE'`) makes a second concurrent activity structurally impossible, backstopped by an `existingActive` pre-check (so the common case never even reaches the AI interpretation call) and a caught/cleanly-surfaced `P2002` for the genuine race. Not a 4 — downtime rewards still don't run through the faction-affordability check quest rewards enforce (`assessPayout`); unlike a quest reward, though, a downtime completion has no explicit in-fiction payer (`paid_by_faction`/a resolved giver faction) to charge, so this is a real asymmetry worth revisiting rather than a like-for-like gap. |
| NPC goal/movement simulation | 4 | Goal progress is phase-weighted (acting fastest, observing/resting slowest) rather than a flat rate. |
| Weather | 4 | A deterministic `weatherPenalty` (-1) shifts rolls in severe non-benign conditions at the acting character's location — a real mechanical consumer, not just narration input. |
| DB `Move` table | 5 | The 7 fixed basic moves stay the mechanical source of truth (`BASIC_MOVES`), confirmed never editable per-campaign — `Move.rollType` is written but never read back for mechanics. Flavor-text fallback is genuinely tested for the failure modes `generateMoveFlavor` itself can produce (null return, per-band omission). The malformed-`outcomes`-crash gap this row used to name (#201 — the fallback expression only optional-chained `moveFlavor`, not `.outcomes`, so a malformed `Move.outcomes` reachable via `campaign-exporter.ts`'s zero-validation `importMoves` would throw and drop dice mechanics for the *whole exchange*, not just that move's flavor) is fixed: a new `sanitizeMoveOutcomes` boundary function drops any non-object/malformed shape to `{}` and keeps only string-valued outcome text, applied at both the import write boundary and the read boundary, with the full `moveFlavor?.outcomes?.[outcome]` chain now actually optional-chained end to end — and it's no longer untested, with a new `campaign-exporter.test.ts` covering the malformed-import case directly. |
| `TurnOrder` model | — (removed) | Confirmed: zero references anywhere in the schema or code. |
| Multi-scene / split-party handling | 4 | Character context (`scopeCharactersToParticipants`) is scoped to a scene's real participants, enforced server-side on action submission, not just hidden client-side. |
| Quest identity/gating | 4 | `givenBy` resolves to a real NPC/faction FK; quests carry a stable `objectiveKey`; corruption gates acquisition; FAILED/ABANDONED carry real, contextual costs. Not a 5: the whole party is charged collectively since there's no quest-participant model. |
| Downtime completion rewards | 3 | Parsed strictly (unparseable entries skipped and logged, never guessed). The item-grant half of #211 is fixed: `applyDowntimeRewards` now takes a `currentTurn` parameter and, when given one, routes item grants through `applyGrantBudget` — the same per-arc rarity cap quest rewards enforce — before merging, logging any item skipped as beyond what the character has earned this arc, instead of granting unbudgeted through `mergeGrantedItems` directly. Not a 4 — still no faction-affordability check on the gold half, same asymmetry noted on the Downtime activities row above (these two rows describe one combined finding). |
| Relationships — player-facing visibility | — (decided) | Decided: they stay hidden. A relationship a player could see is a number they'd optimize instead of a private opinion someone has earned. Recorded beside the schema column. |
| NPC harm/recovery | 4 | NPCs have a real, if deliberately thinner, recovery path through the same `healHarm` PCs use — no conditions or death saves, by design. |
| World history as a decision input | 5 | Crisis targeting (`pickMostThreateningFaction`) reads a genuinely bounded, windowed slice of `WorldEvent` history, not the whole campaign. The war-outcome cooldown is real and exactly deterministic — `WAR_EXHAUSTION_TURNS=6` vs. `WAR_DEFEAT_EXHAUSTION_TURNS=12`, precisely 2x, not merely "roughly," and thoroughly unit-tested. `factionTick.ts`'s goal-commitment lookback query is now bounded too (`GOAL_HISTORY_LOOKBACK_TURNS = GOAL_COMMITMENT_TURNS * 10`, plus a `take: 500` row backstop) — the commitment check only ever needs to know whether the most recent goal change happened within the last `GOAL_COMMITMENT_TURNS`, so the window costs nothing behaviorally. Fixed — see the Fix Log (#202). `WorldEvent` still has no general pruning/archival job — every currently-known read path that touches it is now individually bounded, but a table-wide retention policy doesn't exist. |
| Capability tree (branching prerequisites) | 4 | A real tree gates unlocks: same-domain, strictly-lower-tier links (`resolvePrerequisiteLinks`) make cycles structurally impossible, not just detected. Not a 5 — prerequisites are single-parent and depth is whatever generation produces. |
| Corruption as a content gate | 4 | Gates location entry, quest acquisition, and NPC leverage (`checkCorruptionGate`) — three real enforcement points at boundaries, never retroactive. Not a 5 — gates are authored by the fiction, not seeded at world generation. |
| Cross-system economy (faction wealth ↔ items ↔ downtime ↔ quests) | 4 | Quest/downtime payouts are real transfers out of a faction's resources (`assessPayout`); a broke faction pays partially and defaults on the rest (though see the Downtime rows above — this doesn't apply to downtime rewards). Debt moves the dice in both directions. Granted items merge through one genuinely shared path (`mergeGrantedItems`). The duplicated-floor fragility #223 named is fixed: `applyGoldDelta` (`economy.ts`) is now the single place the "gold can't go negative" guarantee lives — `Math.max(0, current + clampGoldDelta(delta))` — and all 3 call sites (`worldUpdaters/characters.ts`, `questRewards.ts`, `downtime/downtimeRewards.ts`) route through it instead of each re-implementing the floor inline. `clampGoldDelta` itself is unchanged and still the right tool wherever a caller needs a clamped delta on its own, not a balance. Not a 5 — this engine still has no canonical gold scale by design; the guardrail is a magnitude backstop against malformed values, not game balance. |
| Outcome-band adherence (does the narration obey the roll?) | 4 | The narrator self-reports which band its prose depicts (`outcome_echo`); mismatches are logged (`checkOutcomeAdherence`), feed a consistency metric, and are now persisted per-exchange and surfaced in the transparency panel (`AITransparencyPanel`) that already shows dice receipts. A small backfill call (`outcomeEchoRepair.ts`/`repairUnreportedAdherence`) resolves residual unreported entries after the fact — one word, capped at 3 attempts per scene, fails open to "still unreported" rather than retrying forever. Deliberately still only observed, never enforced — rewriting prose to match a roll would be a worse product than an occasional, visible drift. Not a 5 — the mechanism is entirely self-report-based, with zero cross-check against the actual prose (`checkOutcomeAdherence` only compares the rolled band against `outcome_echo`, never against `scene_text`); a confidently-wrong-but-self-consistent report — the band matches the roll, but the prose depicts something else — is structurally invisible to this system. The code's own header comment already admits real prose-matching isn't available. See #204. |
| Fog-of-war enforcement mechanism | 5 | One shared `visibleTo(model, role)` gate, correctly handling the polarity difference (clocks gate on hidden state, everything else on discovered state). An unknown role fails closed, tested. The exemption list is narrow and genuinely self-policing — 2 entries, each restricted to `select: { id: true }` only, with its own staleness test. The regex-vs-AST gap this row used to name (#205 — the structural bypass test was `DIRECT_READ = /prisma\.(nPC|faction|location|clock)\.(findMany|findFirst|findUnique)/g`, pattern-matching rather than real analysis) is fixed: `fogOfWar.test.ts` now walks the real TypeScript AST (the same technique `entityResolutionConvention.test.ts` already used for its own guard) — confirmed byte-for-byte behavioral parity against every existing route first, then proven to genuinely catch what the regex couldn't (bracket/computed property access, and `groupBy`/other read methods outside the old 3-method pattern list) via new synthetic-source tests. |
| API route test coverage | 4 | All 109 routes now have a dedicated test file (109/109, up from 30 at the start of #93 — corrected here from a stale "104/104," confirmed by direct count). Depth is uneven by design: the highest-blast-radius routes — campaign bans, member removal/role changes (including the "last admin" guard on both paths), campaign PATCH/DELETE, account deletion, the character `PLAYER_EDITABLE_FIELDS` anti-cheat allowlist, Stripe checkout, stuck-scene recovery, campaign-scoped user blocking, individual NPC/faction/location PATCH/DELETE, friend-request accept/reject, the turn-order route, the auth/session/password family, and the AI-triggering scene-action tier (billing preflight/charge sequence, moderation-before-AI-call) — got real behavioral coverage: validation branches, cross-campaign scoping, fog-of-war redaction, and failure paths, not just the auth gate. The routes closed out last (base list/create endpoints, health checks, internal worker routes, lore/tutorial CRUD) got gate + shape assertions — auth, membership/admin checks, required fields, and the response shape — which catches regressions in access control and routing but not every business-logic edge case. Writing this pass surfaced a real access-control gap — none of the three dynamic-downtime routes (`characters/[id]/dynamic-downtime[/suggestions]`, `dynamic-downtime-events/[id]/respond`) verified the caller owned the character they were acting on — since fixed: `requireCharacterOwner`/`requireDowntimeEventOwner` (`lib/db/characterAccess.ts`) now gate all three, with regression tests proving a non-owner gets 403 (or 404 for a nonexistent event). Not a 5 — file coverage isn't behavior coverage, and the last-closed tiers only have gate + shape assertions, not exhaustive business-logic coverage. |
| Auth / session | 4 | Real revocation: `requireAuth`/`verifyAuth`/`getUser` all check `isTokenRevoked`, and a token-version bump (`revokeAllSessions`, stamped by `createToken`) invalidates every existing session at once. Deliberately fails open for pre-revocation tokens and for an unreadable database, both to avoid a mass logout from a blip. Not a 5 — no refresh-token rotation, still 30-day JWTs; reviewed and deliberately left as-is (#208, closed `not_planned`) rather than an unexamined gap — rotation's real benefit (shrinking the window of an *undetected* silent replay) is low-value against `tokenVersion`'s already-instant revocation, and the app's one payment surface (`user/balance/add`) only ever redirects to Stripe's own hosted Checkout, so there's no stored payment method a replayed token could reach either. |
| Rate limiting / abuse | 4 | Postgres-backed (`checkRateLimit`, correct for serverless, where in-memory wouldn't actually limit anything), unit-tested. The inverted-risk-allocation gap this row used to name (#210 — `auth/login`, `auth/signup`, `auth/request-password-reset`, `auth/reset-password`, `auth/verify-email`, and Stripe checkout creation had **zero** rate limiting while lower-risk endpoints were already covered) is fixed: all 6 now route through `checkRateLimit`, generalized to key on more than just an authenticated `userId` since 5 of the 6 run pre-auth — IP+email for login (brute-force protection per pair without globally limiting a shared IP off every account), IP for signup/reset-password/verify-email, the target email (not the caller's IP) for password-reset requests (protects one inbox regardless of attacker IP count, without weakening the existing no-enumeration guarantee), and `userId` for the authenticated Stripe checkout route. A new `getClientIp()` reads `x-forwarded-for`/`x-real-ip`, falling back to a shared `'unknown'` bucket rather than ever blocking legitimate traffic on a missing header. Live-verified against real Postgres: the composite IP+email key correctly blocked an 11th request against a limit of 10. Not a 5 — still no distributed/CDN-level layer in front of the app (e.g. Cloudflare rate limiting), so this is the app's own last line of defense, not the only one a production deployment would ideally have. |
| Admin tooling as simulation design (beyond CRUD) | 4 | Every world-entity tab now shows real reasoning, not just fields. Faction/NPC "Why?" (#94) plus two more built the same way (#126): Locations preview `explainConditionDrift` (the WITH-reasoning counterpart of `decideConditionDrift`, which is now a thin wrapper over it — same pattern as `explainFactionGoalReassessment`), Clocks preview `explainClockAdvancement` (same pattern, all 4 drivers narrated — own ambition, linked-faction front, joint NPC scheme, category/tension/season fallback). Wars get a standalone tab instead of a per-entity click — momentum is cheap to compute for every escalating war at once, so one campaign-wide route lists all of them with `explainWarMomentum` (previously only ever nested inside a faction's own preview) already computed, no click needed. The admin nav itself was reorganized around what an admin is doing rather than history (every world entity grouped together; AI Settings, World Integrity, and Data & Advanced separated out of the old "Story Engine" grab-bag), and every previously-header-less tab (NPCs/Factions/Locations/Clocks/Wars/Members/Invites/Map) gained a real explanatory description. The wars route's query is now bounded too (`take: 100`, a generous backstop given realistic campaign scale). Fixed — see the Fix Log (#224). Not a 5 — reasoning previews are still read-only projections, not an editable "what-if" simulator. |
| Platform admin dashboard (`/admin/analytics`) | 3 | Site-owner-only, gated by `PLATFORM_ADMIN_EMAILS` (an env-var allowlist checked against campaign membership, not just presence of a role — a campaign admin who isn't a platform admin is rejected), not campaign membership. Shows the activation funnel, daily signups, weekly D1/D7/D28 cohort retention, stuck/abandoned resolution and lore-import jobs, a metadata-only Users & Campaigns listing (most-recently-joined 100 users and the campaigns each administers, read off `CampaignMembership.role === 'ADMIN'` since there's no `Campaign.creatorId`), and an AI Cost by Campaign section — real per-campaign spend (`AICostEntry`, one `groupBy`) alongside real revenue actually billed and collected (`Transaction` DEBIT rows tagged with `campaignId` in `metadata`, summed via a raw JSON-path query since `Transaction` has no `campaignId` column). Not a 4 — it's a single flat top-20-by-cost list with no time-series/trend view. The dead-code gap this row used to name (#209 — `AICostTracker.getGlobalStatistics()`, a global-aggregate helper superseded by this page's own per-campaign query but never removed) is fixed: the unused method (49 lines, zero callers) was deleted outright rather than wired in, since this page's real per-campaign query already covers the need. |
| Integrity Engine — structural/semantic data repair | 4 | Deterministic, per-tick checks (`runIntegrityPass`) detect and repair broken references, duplicate names, and (for one registered universe-scoped semantic family, `faction.leaderOptional`) AI-generated verdicts gated by confidence and a probation window (`isRuleActive`). Every repair is blast-radius-capped (`MAX_REPAIRS_PER_PASS`/`MAX_REPAIRS_PER_ENTITY`) and idempotent by construction; verified live against real Postgres, not just mocked. A separate, deliberately non-repair-based signal now also runs alongside it: `detectValidationDegradation` (`persistReport.ts`) flags a campaign whose recent scene resolutions are falling back to `'partial'`/`'emergency'` AI validation more than the built-in threshold — a symptom of a code bug in the AI/validation layer itself, which has no stored entity to repair and stays out of the repair-based `Violation`/`Escalation` machinery on purpose (see the check's own header comment). Not a 5 — only one semantic family exists, and Phase 4's planned oscillation-based rule retirement was never built. The registration-order gap this row used to name (#225 — the blast-radius cap was hit in check-registration order, not by violation severity, so a higher-severity `factionHasOneLivingLeader` repair further down the registry could lose its shot at the budget to a pile of lower-severity referential violations alone) is fixed: `checkSeverity.ts`'s hand-maintained `CHECK_SEVERITY` ranking (leadership repairs ranked most severe) is applied via a stable sort before `applyRepairs`'s cap-limited loop runs, with a regression test reproducing the exact scenario — referential violations alone exceeding the cap, plus one leaderless faction — confirming the leadership repair still lands. |
| Autonomous code-fix pipeline (`integrity-autofix.yml`) | 4 | Fully autonomous by design — no human review tier at all, every oracle tier (including `suite-only`) merges itself. Since nothing else catches a bad merge first, the pipeline watches its own history instead: `regressionDetection.ts` reverts a merged fix automatically if its checkKey escalates again, `verifyOracleTechnique.ts` mechanically forbids a diff from registering a *weaker* oracle for its own checkKey than it had before (an agent can strengthen its own bar — see the growth step in the prompt — but never lower it), and scope is closed in advance (`escalationSourceMap.ts`) rather than judged per fix. Now proven, not just designed: fired manually (`workflow_dispatch`) against a real, deliberately seeded bug (the Phase 0 `character.relationships.keys.resolve` orphan-key defect) across 12 runs, diagnosing, drafting a fix, verifying it, and merging it — PR #153 — with zero human involvement in the merge decision itself. Getting there surfaced 8 real, previously-unknown defects in the pipeline's own plumbing (not the app code it was diagnosing), each fixed and reverified live rather than in isolation: a missing `id-token: write` blocking the diagnosis step's own OIDC exchange; that same OIDC exchange silently displacing the checkout step's git credential, breaking the later push; a script-injection path where campaign-derived evidence text was spliced with `${{ }}` directly into a `run:` script body instead of passed through `env:`; `gh label create` needing `issues: write` (not covered by `pull-requests: write`) to create the label a fix PR is tagged with; that same label's `integrity-autofix:<checkKey>` prefix exceeding GitHub's 50-character label-name limit for the longest registered checkKey; a `--max-turns 30` budget that was tight-to-insufficient for every real run regardless of model; the repository's own "Allow GitHub Actions to create and approve pull requests" setting never having been enabled, a gate entirely separate from the workflow's `permissions:` block; and a prompt gap where a diagnosis that correctly relied on an already-existing test (rather than writing a redundant new one) produced a diff with no test changes, which the diff-based oracle check can't tell apart from "no proof was ever offered" — costing one genuinely correct fix a merge before the prompt was corrected to require touching that file either way. Not a 5 — the revert-on-regression path has still never fired for real (only unit-tested), and the `schedule` trigger is still deliberately left commented out (see #89, retitled to reflect this is the actual remaining prerequisite). The workflow's missing `concurrency:` guard (#226) — two `workflow_dispatch` runs started close together could both pass the "no open PR" dedup check and open competing fix PRs — is fixed: a workflow-scoped `concurrency: { group: integrity-autofix, cancel-in-progress: false }` block means an overlapping run now queues behind whatever's already diagnosing/fixing instead of racing it. |
| Institutional memory (wake ripples on death/collapse) | 4 | A major NPC's death or a faction's collapse leaves a real, decaying mark: `decideWakeStabilityPenalty` hits the affected faction's stability immediately (leader deaths and collapse ripples weighted higher than an ordinary member loss), then `decideWakeDecayStep` restores it gradually over a fixed window rather than snapping back — `tickWake`'s own three-phase ordering (decay existing wakes, then detect new NPC deaths, then new faction collapses) exists specifically so a wake created this same tick is never also decayed the same tick it was born. Feeds `Faction.stability`, a real roll input, not a cosmetic log line. Not a 5 — only stability is affected; no mechanical consumer reads *how many* wakes a faction is currently carrying. |
| Cultural drift, belief evolution & multi-stage ambitions | 4 | `Faction.beliefVector` (`aggression`/`isolationism`/`mercantilism`/`zealotry`, 0-100) drifts from the faction's own recent history (`decideBeliefDrift` reading `WAR_WON`/`WAR_LOST`/`COLLAPSE_RIPPLE_SURVIVED`/`AMBITION_SUCCEEDED`/`AMBITION_FAILED` events) and can override the stat-band-driven goal reassessment once an axis drifts far enough past neutral (see the Faction simulation row). A completed ambition can also spawn a continuation clock (`decideAgendaContinuation`, capped at `MAX_AGENDA_STAGES`) instead of just resolving cleanly, so a faction's trajectory compounds across multiple stages rather than resetting to nothing. Not a 5 — belief axes are a fixed, closed set, not something new fiction can add to. The same-tick contradiction this row used to name (#227 — ambition resolution reading `faction.goal` fresh from the DB after belief-drift's own goal override had already committed that tick, flavoring a continuation clock for a different goal than the agenda it was nominally continuing) is fixed: `ambitionResolution.ts` now resolves `ambitionGoal` once, from the clock's own snapshotted `Clock.goal` (falling back to the faction's current goal only if the clock predates that field), and every subsequent reference in the function — the outcome decision, the territory-claim check, the continuation-eligibility gate, the continuation clock's own `goal` field — uses that single resolved value instead of re-reading a goal that may have already moved under it this tick. See the Fix Log. |
| NPC motivation model (individual disposition) | 3 | `NPC.disposition` (`selfPreservation`/`loyalty`/`ambition`, 0-100) is the individual-NPC counterpart to `beliefVector` above — same closed-axis, drift-from-classified-`WorldEvent`-history shape (`npcDispositionTick.ts`'s `decideDispositionDrift`, reading the prior turn's own consequence/goal-completion events and its faction's war/wake events), but with three concrete downstream consumers instead of zero: `selfPreservation` orders and filters who flees a distressed location first in `decideMigration` (a low-threshold cutoff means some NPCs refuse to flee at all); `loyalty` splits a collapsing faction's members between defecting to the absorbing rival and staying independent (`decideDefection`, `factionTick.ts`) instead of the previous unconditional transfer; `ambition` nudges succession scoring (`effectiveScore` in `leadershipTick.ts`) without touching `computeSuccessionRoughness`, which stays about objective contestedness. Never exposed to the AI prompt — same boundary `beliefVector` already keeps. Not a 4 — same ceiling as belief evolution: a fixed, closed 3-axis set. |
| Resource infrastructure & logistics | 3 | A location with `resourceSlots` only pays out to its owning faction while at least one `SupplyRoute` touching it is unblockaded (`decideExtraction`); an ESCALATING war over a contested location automatically blockades routes through it and lifts the blockade the same turn the war resolves. Routes are flat/arbitrary rows (`SupplyRoute.fromLocationId`/`toLocationId`), not yet validated against real spatial adjacency — a deliberate, decided-in-advance scope, not an oversight. Not higher than a 3 until routes are generated from (or checked against) `WorldGraph` adjacency. |
| WorldGraph (location adjacency) | 3 | A real, if flat, adjacency graph (`LocationAdjacency`, undirected, distance-weighted) backs `directNeighborsOf`/`shortestPath`/`nearestLocation` (`worldGraph.ts`), and two real consumers already use it instead of a blind pick: `decideTerritoryClaim`'s candidate selection and `decideNpcTick`'s "work" location both prefer a genuine graph neighbor of "home" when adjacency data covers it, falling back to their exact pre-adjacency behavior (alphabetical-first / hash-rotation) otherwise. AI-authored backfill (`worldGraphGenerator.ts`) infers a plausible graph from existing lore for campaigns with none. Not a 4 — shortest-path uses simple O(V²) node selection, fine at the real scale (tens of locations) but not built for more. |
| Environmental state & location aging | 5 | `Location.conditionScore` (0-100, DB-range-checked) drifts from war/contested-territory presence (`decideConditionDrift`) and derives a closed condition-tag vocabulary on read (`deriveConditionTags`: `RUINED`/`DAMAGED`/`STABLE`/`PROSPEROUS`/`CONTESTED`/`ABANDONED`) rather than a free-form label. Feeds migration's own distress signal directly (see the next row), and also feeds a real roll modifier: `locationConditionPenalty` (`resolution.ts`) shifts rolls ±1 for RUINED/ABANDONED vs. PROSPEROUS locations, wired into `computeMechanics` as `siteConditionMod` and populated from a real per-character location lookup in production. The access-*gate* gap this row used to name (#206 — only the roll-modifier half existed, with no entry-time gate the way `checkCorruptionGate` gates quest acquisition/location entry on corruption) is fixed: `conditionGates.ts`'s `checkConditionGate` blocks `RUINED`/`ABANDONED` locations at the same two boundary-only enforcement points corruption already uses — location entry (`worldUpdaters/characters.ts`) and quest acquisition, resolved via the quest's giver NPC's location (`worldUpdaters/quests.ts`) — never retroactively ejecting a character already inside a location whose condition later degrades. |
| Migration & population flows | 3 | `decideMigration` moves NPCs out of locations whose `conditionScore` has crossed a distress threshold toward the nearest condition-viable destination, plus a background population-flight fraction for the location's own `population` count — reads this same turn's post-commute NPC positions, not last turn's, so an NPC that already fled isn't double-counted. Not a 4 — population is currently a single number with no per-NPC identity tracked once it moves in the aggregate. |
| Economic contagion & cascading collapse | 3 | A real faction-to-faction `FactionDebt` (directional, distinct from the Character-centric `Debt` model, in `src/lib/game/tick/economyTick.ts`, registered in `TICK_HANDLERS`): a broke faction's active ally can be extended a bailout loan (`decideLoanExtension`, reusing `factionPayout.ts`'s existing capacity math as the lender's affordability check), and a debtor that collapses or stays broke defaults, cascading a real stability hit to the creditor through the same wake mechanism deaths use (`decideDefaultCascade`, tagged `sourceType: 'FACTION_DEFAULT'`). Corrected here: this was originally planned with a second origination path (quest/downtime payout shortfalls auto-creating debt) that was deliberately reinterpreted rather than built as planned — `questRewards.ts` pays gold to *Characters*, not a second Faction, so a shortfall there has no creditor faction to attach a debt to; `economyTick.ts`'s own header comment documents this pivot. Not a 4 — origination is loan-only in practice (one function creates `FactionDebt` rows). The "at most one outstanding debt" limit is enforced only in application code (`findFirst` before creating), not a schema constraint — `schema.prisma` explicitly has no `@@unique` on the pair, and the check is actually per-**debtor** (any creditor), not per debtor-creditor pair as previously stated here. |
| Signed push / contested value model (Arc) | 4 | `War.momentum`'s existing tug-of-war math (military edge + deterministic per-tick variance, clamped, resolved decisively past a threshold or by timeout) is now a real, shared, reusable primitive (`decideArcDelta`/`applyArcDelta`/`decideArcResolution` in `arc.ts`), proven genuinely reusable rather than a one-off: `decideWarProgress`/`decideWarResolution` (`warTick.ts`) delegate to it directly (verified byte-identical against the full pre-existing war test suite), and a second, independent consumer — contested territory loyalty (`tickTerritoryLoyalty`) — pushes a location's ownership between its owner and on-record rival each turn, resolving to cement the hold, flip the location outright, or settle as a stalemate, instead of sitting `isContested` forever unless a war was separately declared over it. Not a 5 — only two consumers exist, and `War.momentum`'s own column deliberately stays untouched (see `Arc`'s schema comment for why). The two-systems-flip-flop-ownership gap #228 named is fixed: `tickTerritoryLoyalty` now queries every `ESCALATING` war with a `contestedLocationId` before running and excludes any location it finds from that pass's contested-location set entirely, so a location that's a live war's contested target is only ever resolved by the war (a `RESOLVED` war's former location remains fair game, and an unrelated contested location in the same pass is unaffected). |
| Seasonal pressure + calendar mechanics | 3 | The in-fiction calendar (`Campaign.calendarConfig`, previously display-only) now drives two closed mechanical knobs (`SEASON_MODIFIERS` in `seasonTick.ts`, decided 2026-08-02 as the fixed set): faction resource regen (autumn boosts, winter slows) and unattached-GM-clock speed (passed into `decideClockAdvancement` as a multiplier, since clock advancement runs outside `TICK_HANDLERS`). `calendarGenerator.ts`'s old "mechanics never come from here" doc comment is updated to match, not left silently stale. Not a 4 — exactly two knobs by design; no other system reads season yet. The clock-speed knob still feeds `advanceClocks`, which runs as its own transaction outside the main world-tick transaction (see the Clock advancement row) — that boundary is deliberate, not a bug, but it's worth noting this row's knob shares that scope rather than the main tick's stronger atomicity guarantee. |
| Multi-model fallback chain | 4 | `callAIGM` (`client.ts`) tries `AI_MODELS.FLAGSHIP` first and falls back to `AI_MODELS.EFFICIENT` exactly once — either on a hard failure of the primary attempt, or up front when the campaign's circuit breaker is already open (skipping a call already known to be failing) — never chained further, so a fallback failure surfaces to the caller the same way a primary failure without a fallback chain always did. Not a 5 — the chain is fixed at two OpenAI tiers, no second vendor. The same-prompt-reuse question this row used to flag (#230 — the fallback attempt reuses the exact same, flagship-sized prompt with no model-aware re-trimming) was investigated and closed as a documentation gap, not a defect: every OpenAI model family to date ships its "mini" tier with the same context window as its flagship (the mini tier trades latency/cost, not context length), and `DEFAULT_TOKEN_BUDGET` (12,000 tokens) is tiny relative to any GPT-4/5-class window, so there's no realistic scenario where `EFFICIENT` would reject a request `FLAGSHIP` accepted purely on size — now documented explicitly at all three relevant sites (`tokenBudget.ts`, `client.ts`, `models.ts`), with the honest caveat that this is reasoned from OpenAI's naming convention, not a number confirmed via a live API call. |
| Token-budget message pruning | 4 | A real token-budget pass (`applyTokenBudget`, `tokenBudget.ts`) sits on top of the existing fixed entity-count caps and per-string character clamps — not a replacement for them — trimming whole prompt *sections* in a decided priority order (world-summary macro detail first, recent-scene text second, character sheets protected longest and only trimmed down to the scene's actual participants) until the assembled request is back under a configured ceiling. The no-floor gap this row used to name (#231 — `currentSceneIntro` was halved repeatedly with no minimum-length floor, so under extreme prompt pressure it could shrink to a near-empty, incoherent fragment before Tier 3 was even reached) is fixed: below a `MIN_SCENE_INTRO_CHARS` (300) threshold, the tier now drops the scene intro entirely instead of handing the model an unreadable fragment — a fragment that short is noise, not "less continuity." Not a 5 — the token estimate is still the same rough ~4-chars-per-token heuristic used for cost logging, not a real tokenizer count. |
| Outcome-band → narration routing | 4 | The scene prompt's tone/pacing instructions are now derived from the actual worst roll outcome this exchange landed on (`selectPrimaryOutcomeBand` feeding `buildOutcomeBandSection` in `scenePrompt.ts`) rather than left for the model to infer from context alone — a mechanical signal routed into narration guidance, not a new AI judgment call. `<mechanical_outcomes>` itself also gained a named move menu (6 mixed-success moves — escalate danger, extract a cost, create urgency, force a choice, reveal an unwelcome truth, split attention; 10 failure moves — inflict harm, destroy equipment, drain a resource, capture, advance a clock, trigger a flaw, turn the action back on them, reveal a consequence, force a hard choice, moral complication) in place of open-ended "add a cost" / "make a hard move" guidance, so a miss doesn't default to the same move (usually harm) every time. Not a 5 — only the single worst band across all rolled actions this exchange is used, not a per-character breakdown. The unmeasured-compliance gap this row used to name (#232 — the named move menu was pure prompt instruction, with nothing tracking which move the model actually picked, so a monotonous "inflict harm on every miss" pattern couldn't be detected) is fixed with the same "ask, don't infer" measurement `outcomeAdherence.ts` already established for band adherence: `outcome_echo` gains an optional free-text `move_used` self-report, `moveVariety.ts` tracks a bounded per-scene ring buffer of recent moves and flags repeats, and — going past a measurement-only fix — `Scene.progressState.recentMoves` is read back into `MECHANICAL_OUTCOMES` as a soft "avoid repeating" prompt nudge, not just logged. Surfaced in `AITransparencyPanel`, collapsed by default unless a repeat is actually detected. Deliberately still never enforced or rewritten — same observational posture as outcome-band adherence — so "doesn't default to the same move every time" is now measured and nudged, not merely trusted, but still not a hard guarantee. |
| Scene endings — a real narrative close, not a status flip | 4 | `Scene.stakes` (a dormant schema field, previously read once in `memoryRetrieval.ts` but never written anywhere) is now populated at scene creation by a small, separate, fail-open AI call (`generateSceneStakes`) grounded in the scene's own opening text, surfaced under the scene header in the story page UI, and echoed back to the model in `<scene_ending>` when a scene is force-ended so it has something concrete to resolve against rather than an abstract "wrap it up." See the matching Fix Log entry for the other half — the actual silent-no-narration ending bug. Not a 5 — stakes generation is one-shot at scene creation and never revised mid-scene if the situation shifts. |
| Shareable session recaps | 3 | A resolved scene/arc from the Story Log can be shared as a social-media-sized card — `Share` on any `CampaignLog` entry copies a link to `/chronicle/[token]/recap/[logId]`, gated on the same chronicle-share token the full public chronicle already uses (deliberately not a separate share mechanism). The card itself is Next's `opengraph-image` file convention (`ImageResponse`, server-rendered, auto-wired into the page's meta tags — no manual OG tag plumbing) reading the campaign's hero image + the `CampaignLog` title/summary already shown in-app, not a re-derived summary. The chronicle-share GET route was relaxed from admin-only to any campaign member (POST/DELETE stayed admin-only) — reading the already-meant-to-be-public token isn't a privilege escalation, and a non-admin player should be able to share a recap too. Not a 4 — the card layout is fixed (no per-campaign theming beyond the hero image), and there's no analytics on whether a shared link was ever actually clicked. |
| Campaign lobby "Word From the World" | 4 | The lobby overview tab's old stat-tile grid (`WorldSummaryPanel`, bare labeled counts) is replaced by a few sentences of generated in-world prose (`generateChronicleNarration`, `AI_MODELS.EFFICIENT`) synthesizing weather/faction posture/active conflicts/recent happenings — the design principle behind it: "a dashboard shows you data, a chronicle tells you a story about the same data." Regenerated once per world turn (`WorldMeta.chronicleNarration`/`chronicleNarrationTurn`) inside `runWorldTurn`, never live per page view; a progress bar under the prose shows in-game hours banked toward the next update (`hoursSinceWorldTurn`/`worldTurnHours`) rather than a real-world countdown, since the gate is in-game time accrued through play, not a wall-clock timer. Fog-of-war-safe: undiscovered factions/wars are filtered out of the input (`chronicleContext.ts`) before the prompt is ever built. Also adds a one-shot generated campaign hero banner image (`generateCampaignHeroImage`, reusing #96's OpenAI image-gen call shape but not its job-queue machinery — a one-time cosmetic generation doesn't need retry/recovery), now confirmed generating successfully against real production credentials (2026-08-07). Not a 5 — the specific fix for the earlier `FAILED` state was never pinned down, and scene illustration (#96) hasn't independently confirmed the same. The fog-of-war gap this row used to name (#233 — the weather signal read a character's current location with no `isDiscovered` check at all, unlike `worldSummary.ts`'s equivalent query) is fixed: `buildChronicleNarrationInput`'s character query now selects `isDiscovered` on the location relation and only takes a character's location as the weather source when it's actually discovered, closing the one real (if low-probability) inconsistency the "fog-of-war-safe" claim had. |

## Fix Log

Every entry here is resolved — this is a terse historical record, not a
list of open issues (see the Scorecard/Priority List for what's actually
outstanding). Full root-cause detail lived in the original PR
descriptions/commit history if it's ever needed again; this is
deliberately just enough to know what happened without re-deriving it.

- Auto-fix dedup only checked open PRs, letting an unfixable escalation reopen forever — superseded by a self-merge + auto-revert design with no "closed without merging" case left. *(Integrity Engine/CI)*
- Escalation aggregation read a campaign's full 14-day report history instead of just the latest, re-flagging already-fixed issues. *(Integrity Engine)*
- checkKeys were duplicated bare strings across 4 files with no shared type — now a real `CheckKey` union. *(Integrity Engine)*
- Two competing Pusher modules read different env vars, with an ungated server-side singleton that could hang an unconfigured request — server triggers now go through one gated module. *(Real-time/API)*
- Campaign health admin panel never called its own fetch, so it silently rendered nothing. *(Admin tooling)*
- Consequence engine's entity-lookup fallback was dead code (an unawaited promise, so `??` never reached it) and would have unsafely substring-matched if it had run — now uses the shared roster-based resolver. *(Consequence engine)*
- "Not a member of this campaign" returned 403 at ~37 call sites but 404 at 2, with different wording. *(API routes)*
- Truncation helpers appended "..." even to strings that weren't actually cut. *(UI/shared utilities)*
- Leadership-change digest line checked the wrong field name, so real leadership changes fell through to a generic message. *(Notifications/world tick)*
- A fast non-OK response (misconfigured job secret) wasn't treated as a lost delivery — jobs looped through stale-job recovery forever instead of retrying. *(Async scene resolution)*
- A DB read-back failure right after claiming a resolution job left it stuck RUNNING for 6 minutes with no recorded error. *(Async scene resolution)*
- Outcome-adherence ratio's denominator excluded two of four categories, showing "0/0 matched" instead of the real ratio. *(AI transparency/UI)*
- `outcome_echo` was described in prompt prose but never shown in the example JSON, so the model reliably omitted it. *(AI response validation)*
- Token-budget trimming cut the newest continuity instead of the oldest, causing repeated/"doubled" narration beats. *(AI prompt/token budget)*
- Quote-wrapping player actions in the prompt let out-of-character asides get narrated as spoken dialogue. *(AI narration)*
- Removing/banning a campaign member never released their character as a required scene participant, blocking resolution indefinitely. *(Scene resolution)*
- Stalled scenes had no way to escalate toward resolution and looped fresh manufactured complications forever. *(AI narration/pacing)*
- Promises/enemies/long-term threats had no "resolve it" guidance, unlike debts/quests — so once created they only ever accumulated. *(AI narration)*
- Generated stat labels ignored canon naming even with lore imported — fixed with a targeted lookup plus a hard verbatim-match requirement. *(World generation/lore grounding)*
- A second scene-image enqueue for a scene with an existing COMPLETED/FAILED row threw on a unique constraint instead of deduping or retrying. *(Scene illustration)*
- Ending a scene early skipped narration entirely, with no closing beat. *(Scene resolution/AI narration)*
- `time_passage` could be silently dropped on any degraded AI-validation level, freezing world-turn pacing at 0 with no error surfaced. *(AI response validation/world pacing)*
- Eight pipeline-plumbing defects (shell-unsafe PR-body heredoc, missing `id-token: write`, a push credential clobbered by the action's own OIDC exchange, `issues: write` needed for label creation, a label-name length limit, a missing repo setting for Actions-created PRs, a proving test the verifier didn't recognize as already existing, and too-tight `--max-turns`) blocked `integrity-autofix.yml` from completing an end-to-end run — all found and fixed while firing it for real (see the Scorecard's Autonomous code-fix pipeline row). *(Integrity Engine/CI)*
- `pc_changes` for an unresolved character name were silently dropped instead of surfaced, and `conditions_remove`/capability glimpse-unlock were missing from the `<response_format>` canonical example JSON, same "described but never demonstrated" defect class as `outcome_echo` above. *(AI response validation/character state)*
- "What's already happened" in a scene was re-derived from raw prose every exchange, with no structured record of established facts/resolved beats/active conflict, and pacing pressure was gated on pure exchange count instead of actual stalling — replaced with `Scene.progressState` (a structured per-scene ledger the model reports into and reads back each exchange) and stall-based pacing (`exchangesSinceProgress`). *(AI narration/scene progression)*
- `WikiEntry.summary` was written once at creation from the same text that seeds `description`'s first paragraph, then never refreshed by either wiki-sync path — only `description` was ever updated, which is why Summary looked frozen and identical to Details. Both sync paths now regenerate a purpose-built, always-current `summary` every time. *(Wiki/world knowledge)*
- On mobile, the wiki's list and detail panes stack instead of sitting side by side, but selecting an entry never changed which pane was visible — the detail view rendered below the entire still-visible entry list. Now mutually exclusive below the `lg` breakpoint, with a back button. *(Wiki UI/mobile)*
- The character sheet and wiki pages both re-fetch on a Pusher `scene:resolved` event with no request-sequencing guard — two events firing close together could let a stale response overwrite fresher state. Both now ignore a response that's no longer the most recently started load. *(Character UI/Wiki UI)*
- A cleared condition (e.g. Restrained → released) was dropped outright, with no record it had ever applied — only the *current* state changed, the *event* vanished. `Character.conditions` now also carries a bounded `conditionHistory` log, appended whenever `conditions_remove` clears one, and shown on the character sheet as Past Conditions. *(Character state/harm system)*
- Character knowledge had no structured representation at all — "does my character know X?" could only be answered by RAG similarity search, campaign-scoped and retrieval-based, not tied to what a specific character had actually confirmed learning. Added `Character.knownConcepts` (see `lib/game/knowledge.ts`), a `knowledge_add`/`knowledge_remove` pair on `pc_changes` mirroring `conditions_add`/`conditions_remove`, and a "Known Facts" card on the character sheet. Distinct from `CharacterCapability` (system existence + proficiency) — this is standalone declarative fact-knowledge. Also fixed a related, previously-unnoticed gap while wiring this in: `Character.harm`/`conditions` were present in the AI's world-summary data but never actually rendered in the scene prompt — the narrator had no structural way to know a condition was still active except by re-reading its own recent prose. *(Character state/knowledge)*
- `WorldEvent` (the unified structured-history stream) only ever received tick/consequence-origin changes — the highest-frequency source of state change in the whole engine, scene resolution's own per-exchange domain appliers (`stateUpdater.ts`), fed it nothing at all. Each of the 7 appliers wired directly into `stateUpdater.ts` now derives `WorldChange` entries from its own persisted diff (not a hand-maintained parallel log — can't drift out of sync with what's actually written) and reports them up; `stateUpdater.ts` collects and persists them once, tagged `origin: 'sceneResolution'`. Deliberately skips fields hidden from players by design (`relationships`, corruption bargain offers) and delegated sub-writers (debts/standing/capabilities — a natural follow-up). *(World event architecture)*
- `<mechanical_outcomes>`'s weak-hit/miss guidance was open-ended ("add a real cost" / "make a hard move against them") with no concrete options, which reliably defaulted to the same move — usually harm — every time. Replaced with two named move menus and an explicit instruction to vary which one gets used. *(AI narration/mechanical outcomes)*
- A stuck scene kept re-explaining already-established exposition and ran 45 exchanges past its own prompt's "HARD REQUIREMENT" text — prose-only urging isn't a guarantee. Fixed with a structural backstop (`deriveEffectiveSceneEnding`, `SCENE_RUNAWAY_EXCHANGE_CEILING`) that force-triggers scene closure past a hard exchange count regardless of model compliance, plus a widened (but still bounded) recent-exchange window and honoring an explicit player timeskip request the same exchange it's made (`detectsSkipRequest`). *(AI narration/pacing)*
- An outward capability-use attempt ("I check myself for a hidden power") was narrated as automatically succeeding just because the action was submitted; the initial fix made this an absolute rule, which broke a legitimate genre convention (introspection as a real discovery mechanic, e.g. He Who Fights With Monsters). Revised so introspection is judged like any other narrative payoff — genuinely earned via history/world rules/foreshadowing can produce a real glimpse or unlock, ungrounded stays "finding nothing yet." *(AI narration/capabilities)*
- The Active Clocks panel never checked `Clock.resolvedAt` — a fully completed clock stayed listed indefinitely instead of dropping off. *(Story page UI)*
- Wiki entries (Clocks/Locations/NPCs/Factions/Quests) rendered as one long undifferentiated list with no categorization, and `tags` was only ever written at entity creation — never on update — which would have silently defeated retroactive categorization for every already-existing entry. Fixed by grouping entries by category (`groupWikiEntriesByCategory`) and writing `tags` on both create and update paths. *(Wiki UI)*
- `SupplyRoute` rows (#106) had never actually been created anywhere in the codebase — no world-updater, admin UI, or seed script ever called `.create()` on the model, so `decideExtraction`'s unblockaded-route gate could never fire in a real campaign despite the feature reading as shipped. Fixed with a self-healing tick step that auto-derives a missing route from faction-owned-location adjacency each turn, live-verified against real Postgres as the model's first-ever production write. A related migration-destination reachability gap (picking a campaign-wide highest-condition target with no regard for whether it was actually reachable) was fixed in the same pass using the real `WorldGraph` adjacency data. *(World simulation/logistics)*
- A faction absorbed mid-tick could have the transfer silently reverted: `tickFactions` looped over a faction array snapshotted before the loop started, so the absorbing faction's own regular tick write later in the same loop overwrote the just-transferred resources with its stale pre-absorption values. Fixed with a same-tick applied-delta tracker plus current-value shadowing, so every read in the pass stays current against what's already been written that tick. *(World simulation/factions)* #199
- Two gaps in the character harm/death pipeline: nothing checked `isAlive` before applying harm/corruption/condition changes to a character, so a dead character could still have state mutated; and the Taken-Out roll (both the 2d6 itself and, one level deeper, the permanent-injury pick) used raw `Math.random()` inline instead of the dice engine's injectable RNG, making it untestable without globally mocking `Math.random`. Fixed with per-field `isAlive` gating on every physical mutation, and a shared `Rng` type (extracted to `src/lib/game/rng.ts` to avoid a cycle between `resolution.ts` and `harm.ts`) threaded through both rolls, defaulting to `Math.random` for every real caller. *(Character harm/death)* #213
- The consequence engine's exact-name-match branch used `.find()` and would silently apply a consequence to whichever of two same-named entities happened to match first, unlike its own fuzzy-match path (which correctly returned `ambiguous`). Now collects every exact match and returns `ambiguous` once there's more than one. *(Consequence engine)* #215
- The per-arc organic-growth grant budget check was a read-then-write race with no lock — two overlapping scene resolutions on the same character could both read the same stale grant count and the second write would silently clobber the first. Fixed with a dedicated `Character.advancementVersion` optimistic-concurrency counter (no single existing field on the multi-field grant write could double as a reliable version key), guarding the write via `updateMany` and skipping-with-a-warning on a lost race instead of clobbering or double-applying. *(Character progression)* #214
- `advanceClocks` wrote each clock's advancement in its own un-transacted call; a failure partway through the loop left some clocks advanced and others stale against already-committed world state, with no repair path. Fixed by collecting the turn's clock writes as pure data first, then applying all of them in one `prisma.$transaction` batch. *(Clock advancement)* #229
- Quest completion's "first time only" reward grant was a read-then-write race with no unique constraint, version column, or row lock — two racing scene resolutions on the same quest could both pass the `justCompleted`/`justFailed` check and double-grant the reward. Fixed with a guarded `updateMany` keyed on the `status` value that was actually read, resetting the flags rather than granting when the guard's `count` comes back 0. *(Quest lifecycle)* #212
- Complex-exchange combat resolution's tie-break relied on an unstable secondary sort — the pending-action query was ordered only by `actionPriority`, so Postgres gave no ordering guarantee among ties, meaning which of two simultaneous same-priority actions resolved "first" could vary run to run for identical stored data. Fixed with a fully deterministic `actionPriority`/`createdAt`/`id` ordering chain. *(Combat/exchange resolution)* #219
- Nothing prevented a character from starting unlimited concurrent downtime activities, and completion rewards bypassed the per-arc item-rarity budget quest rewards enforce — combined, an unbudgeted item/gold farming vector. Fixed with a real Postgres partial unique index (`WHERE status = 'ACTIVE'`) making a second concurrent activity structurally impossible (backstopped by a pre-check and a caught `P2002`), and by routing item grants through the shared `applyGrantBudget` function used elsewhere. Downtime rewards still don't run through a faction-affordability check the way quest rewards do — a real asymmetry, though not a like-for-like gap, since a downtime completion has no explicit in-fiction payer to charge. *(Downtime)* #211
- `clampGoldDelta` only clamped a reported gold delta's magnitude; the actual "gold can't go negative" guarantee was a `Math.max(0, ...)` floor duplicated at 3 separate call sites instead of centralized, fragile against a future 4th site forgetting it. Fixed with a single `applyGoldDelta` function all three call sites (`worldUpdaters/characters.ts`, `questRewards.ts`, `downtime/downtimeRewards.ts`) now route through. *(Economy)* #223
- A same-tick contradiction in belief-driven ambition continuation: ambition resolution re-read `faction.goal` fresh from the DB after belief-drift's own goal override had already committed that same tick, so a continuation clock could end up flavored for a different goal than the agenda it was nominally continuing. Fixed by resolving the ambition's goal once, from the clock's own snapshotted `Clock.goal` field, and using that single resolved value for every decision the rest of the function makes. *(Faction ambitions/belief drift)* #227
- Territory loyalty and war resolution could flip-flop the same contested location's ownership out from under each other — `tickTerritoryLoyalty` had no check against the `War` table, so a location that was the live contested target of a still-`ESCALATING` war could also be picked up and resolved by territory loyalty the same or a following tick. Fixed by excluding any location tied to a currently-escalating war from that pass's contested-location set. *(Territory/war resolution)* #228
- `Faction.influence` fed `effectiveStandingModifier`'s LOW-influence cap but was never written by any tick or consequence path — the "bled dry by a lost war" scenario its own doc comment named couldn't occur through simulation. Fixed: a decisive war resolution now moves influence alongside the existing stability hit (loser -8, winner +4, coalition-wide). *(Faction standing/war resolution)* #218
- A faction's currently-unresolved `ActiveWake` count was written but never read by anything — a faction reeling from recent leader deaths/collapses behaved identically to one with none. Fixed with two consumers: `explainFactionGoalReassessment` overrides to DEFEND at 2+ unresolved wakes (same priority tier as the existing stability-LOW check), and `decideFactionCollapse` adds a roughness bump at the same threshold, scattering more of a collapse's remains when the faction was already mid-crisis. *(Faction simulation/institutional memory)* #207
- The "Relationships (trust/tension/respect/fear)" Scorecard row's own title implied all 4 axes were mechanical when only 3 feed `relationshipModifier` — `fear` is deliberately narrative-only (the classifier doesn't yet signal which direction it should cut). Retitled to "3 of 4 tracked axes" rather than leaving the mismatch between title and body text. No code change — the exclusion itself is a defensible, already-explained design decision; wiring fear in for real is separate follow-up work, not done here. *(Docs/relationships)* #220
- The debt query feeding `debtModifier` had no row limit — a debt-heavy campaign fetched every outstanding debt row every time, unbounded. Fixed with `orderBy: createdAt desc, take: 300` (a generous backstop, not a tight precision cap, since the counterparty-scoped count needs to stay correct) plus a `take: 20` on `worldSummary.ts`'s display-only debt includes. *(Debt economy/world prompt)* #221
- `consolidateOldMemories` only ever rolled up `MINOR`/`NORMAL` memories — `MAJOR`/`CRITICAL` rows were permanently exempt and grew forever on an active campaign. Fixed with a second consolidation tier (150-turn age threshold, 50-turn buckets), sharing one parameterized implementation with the existing tier via `ConsolidationTierConfig` so the two policies can't drift apart, with each tier catching its own failure independently. Also fixed a real data-loss bug found while live-verifying: `createCampaignMemory` silently swallowed its own failures and returned `void`, so the consolidation loop deleted source memories even when the replacement summary was never written — it now returns `Promise<boolean>` and the delete is gated on a successful write. *(Memory retrieval/consolidation)* #216
- `factionTick.ts`'s goal-commitment lookback query (`worldEvent.findMany` for `faction.goal` events) had no `take`/recency bound, fetching a campaign's entire goal-change history every tick. Fixed with a bounded recency window (`GOAL_COMMITMENT_TURNS * 10` = 30 turns) plus a `take: 500` row backstop — the commitment check only ever needs to know whether the most recent change happened within the last `GOAL_COMMITMENT_TURNS`, so the window costs nothing behaviorally. *(World history/faction simulation)* #202
- The campaign-wide wars reasoning route (`wars/reasoning/route.ts`) queried every `ESCALATING` war with no `take`/limit. Fixed with a `take: 100` backstop, matching the same "generous backstop, not a tuned cap" convention as #221/#202. *(Admin tooling/war system)* #224

## Priority List

Ordered by what most closes the gap between current state and the vision
above. Items that block later ones are flagged.

1. **Verify `integrity-autofix.yml`'s detect-and-revert path for real, then
   decide whether to enable `schedule`.** Half proven, half still not (see
   #89's own status comments): the fire-and-merge half is done — 12 manual
   (`workflow_dispatch`) runs, culminating in a real defect diagnosed,
   fixed, verified, and merged with zero human involvement in the merge
   decision (PR #153; see the Scorecard's Autonomous code-fix pipeline row
   and the Fix Log for the 8 pipeline-plumbing defects that run surfaced).
   `regressionDetection.ts` — the piece that's supposed to catch a merged
   fix going bad and auto-revert it — has **never fired for real, only
   unit-tested**. The remaining step: deliberately seed a second violation
   for the same checkKey (simulating the fix not actually working) and
   confirm a real auto-revert happens. Only once both halves have been
   watched happening for real should `schedule` be considered — this needs
   a human to watch a live `workflow_dispatch` run, not more code.
*(The Pusher module split, `consequences.ts`'s entity-matching bug, giving
checkKeys a shared type, the war stability-hit write path's missing direct
test coverage, making outcome-band adherence visible to players, the
strict-structured-outputs and dice-opt-in-only decisions, extending the
tick dry-run preview's reasoning pattern to the faction/NPC tabs, checking
whether `computeTension` should weight Environmental aging/Economic
Contagion, the individual NPC/faction/location PATCH/DELETE + friend-
request + turn-order test-coverage gap, broadening API route test
coverage to every route (104/104, #93/#134/#135), and the dynamic-downtime
ownership gap that same sweep surfaced — that used to be items 2, 6, 7, 4,
3, 2, 5, 3, 3, part of 2, 2 again, and 2 a third time here — are all
resolved (the admin-tooling item only partially — see its Scorecard row
for what's still missing; the `computeTension` item resolved to a decided
"no," recorded in `tension.ts` itself — see #122; the dynamic-downtime fix
added `requireCharacterOwner`/`requireDowntimeEventOwner`
(`lib/db/characterAccess.ts`) to all three affected routes, mirroring the
campaign-membership pattern everywhere else, with regression tests
proving a non-owner gets 403/404).
See the Fix Log and the Scorecard's War & coalition system, Admin tooling,
and API route test coverage rows.)*

## Features & Roadmap

### Planned but not started

No code exists yet for any of these.

- **Per-campaign move sets (AI-selected, not admin-authored)** — every
  campaign currently plays the same 7 moves with the same stat mappings and
  the same 10+/7-9/6- thresholds (`BASIC_MOVES` in `lib/pbta-moves.ts`);
  `moveFlavor.ts` only reskins names/outcome text per campaign, never the
  underlying math. Explored 2026-08-05: a small, hand-authored catalogue of
  genuinely distinct move sets (e.g. a grittier one with tougher thresholds
  and violence routed through `hard` instead of `hot`; a political-intrigue
  one with no combat move at all and a new debt-leveraging move) that the AI
  picks between at campaign creation from a few tone questions — never
  free-form invention, reusing the same closed-catalogue discipline
  `worldRulesGenerator.ts` already uses for semantic-invariant verdicts
  (`FAMILY_QUESTIONS`, can't invent an unreviewed rule). Three draft move
  sets were sketched to test whether the mechanical difference would
  actually be felt (stat-mapping shifts, threshold shifts, roster
  differences, not just relabeling). Shelved, not built: value is entirely
  contingent on hand-designing genuinely distinct move sets first (a
  content task, not an engineering one), and that design work hasn't
  happened — revisit only if there's real appetite to author 2-3 mechanically
  distinct game feels, not as a first step on its own.
- **Deliberately deferred, not overlooked**: native mobile app, voice/TTS,
  a creator marketplace/UGC, VTT-style grid combat, and public API/developer
  access (decided against for now, 2026-08-02 — blocks monetization
  tiering until real demand justifies revisiting it). Explicit calls to
  prioritize deeper world-simulation work first — worth revisiting only if
  real cohort feedback contradicts that call.

### In progress

Partial implementation exists in the codebase today.

- **Scene illustration** — one generated image per resolved scene, opt-in
  per campaign (`Campaign.sceneImageGenerationEnabled`, off by default,
  same shape as `mapGenerationEnabled`). A new `SceneImage` job/artifact
  table, `imageGenQueue.ts` (copies `resolutionQueue.ts`'s hardened
  claim/retry/recovery pattern, including both of its #120 fixes from day
  one), a new internal worker route
  (`/api/internal/generate-scene-image`), and a Vercel Blob upload wrapper
  (`src/lib/blob/sceneImageStorage.ts`) are all built, tested, and
  live-verified against real Postgres — the full job lifecycle (real
  enqueue, real self-fetch kick, real retry-then-terminal-failure
  bookkeeping, real cost-tracking entries, the real `@@unique([sceneId])`
  constraint) was exercised end-to-end against `camp_uitest`. The
  automatic trigger only ever fires once, at a scene's first exchange —
  an admin-only manual backfill
  (`POST /api/campaigns/[id]/scenes/[sceneId]/generate-image`, a button
  on the story page) covers a scene already open when the toggle got
  turned on, or one whose one attempt failed, building the prompt from
  the scene's FIRST exchange specifically so it still fits how the scene
  opened even if it's moved on since. **Not verified**: this sandbox has
  no `OPENAI_API_KEY` or `BLOB_READ_WRITE_TOKEN`, so the actual
  image-generation call and Blob upload have only ever been unit-tested
  with mocks, never run for real — confirm both work against a real
  account before enabling the toggle in production. `gpt-image-1`'s flat
  per-image cost also needs re-verifying against OpenAI's live pricing
  page (`cost-tracker.ts`'s `AI_PRICING`
  entry is a documented estimate, not a re-confirmed one).
- **Campaign lobby "Living Chronicle"** — the lobby overview tab's old
  stat-tile grid (`WorldSummaryPanel`) is replaced by generated in-world
  prose (`generateChronicleNarration`, `WorldChronicle.tsx`), regenerated
  once per world turn (`WorldMeta.chronicleNarration`/
  `chronicleNarrationTurn`, written from `runWorldTurn`) rather than live
  per page view, plus a one-shot generated campaign hero banner image
  (`generateCampaignHeroImage`, reusing #96's image-gen call shape but not
  its job-queue machinery, kicked via a self-fetch to
  `/api/internal/generate-campaign-hero-image` at campaign creation). All
  built, unit-tested, and live-verified against real Postgres (the
  `WorldMeta`/`Campaign` schema round-trip, the fog-of-war filtering in
  `chronicleContext.ts`, and the hero-image status lifecycle degrading to
  `FAILED` gracefully with no API key). **The hero image is now confirmed
  working against real production credentials** (2026-08-07) — an earlier
  attempt landed on `FAILED` (leading theory was `gpt-image-1` requiring
  OpenAI organization ID verification), but it now generates and renders
  successfully on a real campaign; the specific fix was never pinned down.
  Scene illustration (#96, a separate per-campaign toggle) shares the same
  underlying image model and Blob storage path but has not been
  independently tested — likely also resolved, not yet confirmed.
- **API route test coverage** — every one of the 104 routes now has a
  dedicated test file (#93 → #134 → #135, ending with the base
  list/create endpoints and admin/analytics). File-complete, not
  behavior-complete: the highest-risk routes got real behavioral
  coverage, the last tiers got gate + shape assertions. Writing that
  last stretch surfaced a real access-control gap in the dynamic-downtime
  routes, since fixed (see the Scorecard row).

## Architecture: Where the Depth Actually Lives

For anyone extending this codebase — not every file that looks like core
simulation infrastructure carries equal weight. Foundational (the depth
genuinely lives here; treat changes carefully):

`prisma/schema.prisma` · `lib/game/resolution.ts` (dice/outcome math) ·
`lib/game/stateUpdater.ts` (the transactional write-back from AI narrative
to durable state) · `lib/ai/client.ts` (the AI response contract everything
else must agree with) · `lib/game/worldTick.ts` + `lib/game/tick/factionTick.ts`
+ `lib/game/tick/warTick.ts` (the deterministic simulation core) ·
`lib/game/worldTurn.ts` (ties tick output into ambitions/territory/memory) ·
`lib/ai/worldSummary.ts` + `lib/ai/worldSummaryMappers.ts` (fog-of-war and
qualitative-stat enforcement for the AI prompt, not just formatting —
`buildOptimizedWorldSummary`/`buildWorldSummaryForAI`/`buildSceneResolutionRequest`
are the actual entry points) · `lib/ai/scenePrompt.ts` (the actual prompt
text sent to the model) · `lib/ai/validation.ts` (the correctness gate all
mechanical depth passes through) · `lib/game/sceneResolver.ts` (the
top-level orchestrator, and home of `generateNewSceneIntro`/
`summarizeSceneForLog`/`generateMilestoneRecap`'s callers) ·
`lib/game/consequences.ts` (player choice → persistent world state) — the
write-back orchestrator itself is `stateUpdater.ts`'s `applyWorldUpdates`,
the function every domain applier plugs into.

## World Simulation

The world tick is paced by in-game time, not real time or player action
count: each scene resolution banks the fiction's time passage
(`elapsedInGameHours`), and the tick fires once a full in-game day
(per-campaign configurable) has actually passed in the story. The tick itself is a pure, AI-free step — NPC movement
and goal progress, faction resource/stability/military drift, weather — and
every change it makes is written to a durable event log. Only narrating
those changes into prose is delegated to the AI.

Factions can autonomously commit to major ambitions once their resources and
goals justify it — the tick decides *whether*; a bounded, archetype-specific
AI call decides *what*, with a deterministic fallback if that call fails, so
an ambition never silently disappears. A completed ambition can chain into a
continuation stage instead of just resolving cleanly, so a faction's
trajectory can compound across a campaign rather than resetting each time.
Territory is real state: factions can contest and conquer land, and
sustained conflicts escalate into multi-turn, attrition-driven wars that can
grow into coalitions as allies join a side. Contested territory that never
escalates into a declared war isn't stuck in limbo either — the same signed,
bidirectional push/resolve math wars use (`game/arc.ts`) independently
resolves who ends up holding a contested location.

A faction's own outward disposition (`beliefVector` — aggression,
isolationism, mercantilism, zealotry) drifts from its actual recent history
and can redirect its goal reassessment once an axis drifts far enough from
neutral, and a death or a faction's collapse leaves a real, gradually-healing
stability wound on whoever it affected rather than resolving instantly.
Individual major NPCs carry the same kind of drifted disposition
(`selfPreservation`/`loyalty`/`ambition`) from their own recent history, and
it actually changes their behavior: who flees a distressed location first
(and who refuses to), who defects when their faction collapses versus stays
independent, and who's favored in a contested succession.
Locations age and take real, tagged condition damage from war and neglect,
which drives distressed NPCs to migrate toward more viable ground; a
location's resource output depends on an actual unblockaded supply route to
it, not just ownership; and a broke or collapsed faction's debts can cascade
a real stability hit to whichever ally extended it credit. A real (if flat)
location-adjacency graph backs nearest-neighbor territory/movement choices
where adjacency data exists, falling back to the exact pre-adjacency
behavior where it doesn't. The in-fiction calendar drives two small
mechanical knobs — seasonal resource regen and unattached-clock pacing — on
top of its narration-flavor role.

Every active faction is simulated automatically — there is no opt-in. The
admin panel's Simulation Goal and Archetype controls are a steering wheel,
not an ignition switch, except for player-led factions, whose chosen goal is
deliberately preserved rather than overwritten by the tick's own
reassessment. A deterministic, per-tick Integrity Engine (`runIntegrityPass`)
validates the state every handler above just produced — broken references,
duplicate names, and a closed catalogue of universe-scoped semantic
invariants — and repairs what it safely can before the turn's changes are
ever narrated.
