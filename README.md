# MythOS

*The world remembers.*

An AI-powered collaborative storytelling platform: an AI Game Master runs
scenes, but the world underneath it is a real, mostly-deterministic
simulation — factions pursue goals, wars escalate, territory changes hands,
and NPCs carry on their own business — that keeps advancing whether or not
anyone is looking. The AI's job is to *narrate* what the simulation decided,
not to invent it from scratch each time.

**Where this actually stands** (full audit below): the deterministic core —
dice resolution, faction simulation, wars/territory, capability progression,
the Debt/standing economy — is genuinely deep and compounding, not a thin
wrapper around a chatbot. A series of July 2026 depth audits found several
systems that *looked* equally systemic but weren't (a dead-logic bug in
memory importance scoring, write-only relationships, random-chance clock
advancement, a conflict "resolver" that only punted to the AI, and more) —
most of the highest-ROI fixes are now shipped (see
[Known Bugs / Known Issues](#known-bugs--known-issues) for what's still
actually open). Nothing below overstates what's shipped; where something is
cosmetic, it's labeled that way.

## What MythOS Is

- **AI Game Master**: OpenAI-powered scene narration, scoped narrowly — the AI classifies player intent and writes prose; it never decides dice outcomes or faction stats itself
- **Living World Simulation**: a deterministic, AI-free "world tick" advances NPCs, factions, weather, and territory every in-game day, independent of the AI and independent of whether players are present — see [World Simulation](#world-simulation)
- **Server-Rolled Move Resolution**: every risky action is classified to a PbtA basic move and rolled 2d6+modifiers *on the server*; the outcome band is a binding constraint on the narration, not a suggestion. Modifiers blend stats, capability bands, faction standing, and harm. Receipts are persisted and viewable in an opt-in transparency panel — mechanics stay out of the prose by design
- **Debt & Standing Economy**: player choices create real, mechanically-binding consequences — a faction losing a war in the offscreen tick changes what a player can roll next session. This is the bridge between player agency and the living simulation, and it's the single most differentiated thing in the codebase
- **Player-Faction Integration**: a player character can lead a faction outright — set its strategic goal in-fiction, watch it keep ticking autonomously between sessions
- **Fog of War**: hidden factions/NPCs/locations, GM-only notes, and exact simulation numbers never reach player-facing text or prompts — enforced at the query layer, not just the UI
- **Campaign Memory (RAG)**: real pgvector semantic search over campaign history — cross-entity recall ("what happened between X and Y"), automatic decay/consolidation so a long campaign's memory table stays bounded
- **Knowledge-Relative Character Sheets**: a sheet shows what the *character* knows, not what the database knows — glimpsed abilities render as "???", unlocked ones grow through use with deterministic, arc-capped gains
- **Corruption Track**: per-universe "power at a cost" theme, irreversible marks, engine-enforced bargains (a corruption surge lands even if the AI forgets to narrate it)
- **Lore Import**: paste text, a URL, or crawl an entire MediaWiki wiki — chunked, embedded, retrieved per scene as canon; a canon URL can regenerate the world's structure (factions, systems, archetypes) from that lore
- **Quest & Item Tracking**: quests have a real lifecycle (registered → progress beats → completed/failed/abandoned); inventories aggregate into a browsable wiki registry
- **Safety Tooling**: X-Card with a real scene pause (not a no-op), content reporting, campaign bans, per-player blocking, lines/veils fed into the AI prompt
- **Admin Tooling**: faction relationship/territory map, a tick-log viewer with the reasoning behind every simulated change, a dry-run "preview next tick" mode
- **Real-time Collaboration**: Pusher-backed live chat, notifications, and scene updates
- **Payments**: Stripe integration with metered per-call AI cost tracking (not a flat per-scene guess), balance gating, per-user rate limiting
- **Ask the GM**: an out-of-character Q&A channel architecturally isolated from action resolution — no dice, no state changes, fog-of-war-safe answers

## Status at a Glance

A maturity scorecard from a full code-level audit (July 2026), not a features
list — this is "how deep is it," graded 0–5 (0 = missing, 1 = placeholder,
2 = cosmetic/basic CRUD, 3 = functional but shallow, 4 = substantive, 5 =
robust and compounding), with the honest catch: several rows below look
identical in *style* to the 5s and are not identical in *substance*. That gap
is exactly what the Known Bugs / Known Issues section exists to close.

| System | Score | Status |
|---|:-:|---|
| Server-rolled dice/outcome engine | 5 | Pure, RNG-injected, unit-tested. The AI never touches the arithmetic. |
| Faction simulation (goals/collapse/succession/territory) | 5 | Goal-driven stat deltas, banded reassessment, collapse → absorption or remnant succession, real territory reassignment. Deepest subsystem in the codebase. |
| War & coalition system | 5 | Multi-turn momentum/attrition, allies join sides, decisive/stalemate resolution, losing side takes a real stability hit. |
| World tick orchestration | 5 | Nine deterministic handlers, genuinely sequenced same-tick dependencies, zero AI calls. |
| Debt economy | 4 | Directional, persisted, and actually consumed as a roll modifier — not just a label. |
| Faction standing | 4 | Same — feeds `computeMechanics()` directly. |
| Relationships (trust/tension/respect/fear) | 4 | Fixed (`#29`): now feeds `computeMechanics()` via a banded `relationshipModifier`, the same way standing does — no longer write-only. |
| Capability / skill-tree progression | 4 | Glimpse→unlock→progress state machine, feeds roll modifiers directly. |
| Character harm/death state machine | 4 | Full model: auto-conditions, death saves, permanent injury, engine-arbitrated recovery. |
| Corruption track | 4 | Theme-gated, irreversible, force-applied backstop even if the AI forgets to narrate it. |
| Consequence engine (player action → faction/NPC state) | 4 | Deterministic per-action deltas, same rigor as faction tick. |
| Character progression (advancement) | 4 | Usage-gated growth with real PbtA constraint validation, not a level-up button. |
| Memory retrieval (RAG) | 4 | Genuine pgvector cosine search, cost-tracked, well-designed consolidation. |
| Memory importance/tag classification | 4 | Fixed (`#28`): field-name mismatch corrected, exported, regression-tested — no longer silently dead. |
| AI response validation | 4 | Improved (`#36`): one bounded repair round-trip is attempted before falling through to the degradation ladder — no longer purely silent. Still basic JSON mode, not strict structured outputs (`#35`, open — see Known Bugs / Known Issues). |
| Clock advancement (non-ambition clocks) | 4 | Fixed (`#30`): deterministic, faction/relation-driven pacing (`decideClockAdvancement`) in place of the random-chance coin flip. |
| Quest lifecycle | 4 | Fixed (`#31`): a structured `reward_grant` is applied deterministically the first time a quest completes, reusing the same standing-change writer `pc_changes` uses — no longer prose-only. |
| Combat / complex exchange resolution | 4 | Fixed (`#32`): conflicting actions on the same target are now ranked by actual roll outcome (`rankActionsByOutcome`), not left to an AI punt. Still no dedicated combat subsystem beyond PbtA resolution — that's by design, not a gap. |
| Inventory / items | 4 | Fixed (`#39`): weapons now carry a structured `damageBonus` symmetric to armor's `armorValue`, and consumables carry a real `effect` — `'heal'` is enforced deterministically the instant an item is used, `'custom'` is honestly labeled flavor-only rather than implying enforcement it doesn't have. Discovered along the way: NPCs had zero harm state at all, so a weapon's damage had nowhere honest to land against the dominant PC-attacks-NPC case — added minimal `NPC.harm` tracking (mirrors `Character.harm`, no conditions/death-saves) to close that gap. Still JSON-blob CRUD, not a relational Item table — durability/crafting/stacking remain deliberately out of scope. |
| Downtime activities | 4 | Fixed: day-by-day events now roll a deterministic, riskLevel-weighted outcome category (`decideDowntimeDayEvent`) before the AI narrates, replacing a bare `Math.random()` coin flip and fully-freeform event nature. Entry costs (gold/items/favor/quest) were already genuinely enforced. |
| NPC goal/movement simulation | 4 | Fixed: goal progress is now phase-weighted (`acting` 2x, `preparing` 1x, `observing`/`resting` 0.5x baseline) — all four plan phases carry real mechanical weight now, not just `acting`'s joint-scheme gating. Overall completion pace unchanged (weights average to the prior flat rate). |
| Weather | 4 | Fixed: a deterministic `weatherPenalty` now shifts rolls (-1) in severe non-benign conditions (severity 4+, excluding CLEAR/CLOUDY) at the acting character's location — the first real mechanical consumer of the tick's weather state. |
| DB `Move` table | 5 | Fixed (`#38`): the fixed 7 `BASIC_MOVES` stay the single mechanical source of truth, but each campaign now gets its own AI-generated flavor text (name/trigger/outcome prose) for them, the same relationship `statLabels` has to the 5 fixed stat keys — and unlike the old per-template `defaultMoves` it replaced, it's genuinely read at roll time: `computeMechanics()` looks flavor up by `Move.baseMoveKey` and the result feeds both the transparency-panel receipt and the AI narrator's `move_name`/`outcome_text`. No flavor generated (no API key, generation failed) just falls back to `BASIC_MOVES`' own generic text — never a broken roll. |
| `TurnOrder` model | — (removed) | Fixed (`#34`): zero live references anywhere, so the model was dropped from the schema entirely rather than left to imply a feature that doesn't exist. |
| Multi-scene / split-party handling | 4 | Fixed: the API already supported multiple concurrent `AWAITING_ACTIONS` scenes, but the AI context builders leaked every living character's full sheet into every scene's prompt regardless of that scene's actual participants — a "focused" scene wasn't really focused, and a split party's two scenes would each see the other's characters. `worldState.ts`'s `scopeCharactersToParticipants` now scopes character context (and derived NPC/faction location-relevance) to the scene's real participant list; the server enforces that list on action submission instead of only the client hiding it; the story page picks the scene the viewer's own character is actually in instead of always the first active scene; a GM gets a one-click "start a scene per location" prompt when the party's split; character creation defaults/warns on starting location against the existing party. No new schema, no "merge scenes" mechanic needed — ending both split scenes and starting a Full Party one already works. |
| "Story cards" (as a named concept) | 0 | Confirmed absent — doesn't exist anywhere in the codebase under any name. |

## Architecture: Where the Depth Actually Lives

For anyone extending this codebase: not every file that *looks* like core
simulation infrastructure carries equal weight. Ranked by what the rest of
the system actually depends on:

**Foundational** (the depth genuinely lives here; treat changes carefully):
`prisma/schema.prisma` · `lib/game/resolution.ts` (dice/outcome math) ·
`lib/game/stateUpdater.ts` (the transactional write-back from AI narrative to
durable state) · `lib/ai/client.ts` (the `AIGMResponse` contract everything
else must agree with) · `lib/game/worldTick.ts` + `lib/game/tick/factionTick.ts`
+ `lib/game/tick/warTick.ts` (the deterministic simulation core) ·
`lib/game/worldTurn.ts` (ties tick output into ambitions/territory/memory) ·
`lib/ai/worldState.ts` (the prompt builder — real fog-of-war and
qualitative-stat enforcement, not just formatting) · `lib/ai/validation.ts`
(the correctness gate all mechanical depth passes through) ·
`lib/game/sceneResolver.ts` (the top-level orchestrator) ·
`lib/game/consequences.ts` (player choice → persistent world state).

**Surface area**: none currently identified — the last confirmed instance
(`lib/game/tick/weatherTick.ts` having no mechanical consumer) was fixed;
see Known Bugs / Known Issues and Shipped.

## Known Bugs / Known Issues

Confirmed by direct code inspection, not inferred — a single, deduplicated,
priority-ordered backlog consolidated from every audit pass to date (the
original depth audit, its two re-audits, and the two fake-depth passes).
Where the same defect surfaced more than once, or a later pass added new
evidence to an existing entry, it's merged below rather than repeated.
Historical issue numbers are kept parenthetically for cross-referencing
against git history and the Shipped ledger.

### P0

*None currently open.* Both P0s from the consolidated audit are fixed — see Shipped.

### P1

**Unbounded append-only text growth (#46)**
- *Why it matters:* `NPC.gmNotes`, `Quest.progressLog`, and the advancement log all grow forever via string concatenation with no consolidation — a long campaign's prompt payload and DB row size grow without bound.
- *Evidence:* `NPC.gmNotes`, `Quest.progressLog`, advancement-log fields (`prisma/schema.prisma`) — contrast with `lib/ai/memoryConsolidation.ts`, which already solves exactly this problem for campaign memory.
- *Scope:* performance, persistence, scaling risk.
- *Suggested fix:* Apply the same era-summary consolidation `memoryConsolidation.ts` already gives campaign memory.

**Automatic AI map generation has no off switch and no cleanup path (#9, #59)**
- *Why it matters:* every scene resolution unconditionally makes a second AI call to regenerate the battle map, and by default creates a brand-new `Map`+`Zone` set each time — unbounded AI cost and database growth for a feature a campaign may never actually use, with no per-campaign control.
- *Evidence:* `lib/game/sceneResolver.ts` (step 7.5, `AIVisualService.generateMapFromScene`), `lib/ai/ai-visual-service.ts`, `lib/maps/map-service.ts` (no cleanup path found).
- *Scope:* AI behavior, performance/cost, persistence.
- *Suggested fix:* Add a per-campaign toggle (default off), cap maps-per-campaign, and default to reuse when the location name matches instead of leaving reuse entirely up to the AI's own JSON output.

### P2

**Zones are dead drawing data, not a mechanic (#2, #43)**
- *Why it matters:* two separate, unconnected zone implementations exist and neither gates any action — melee/ranged distance isn't enforced anywhere despite the data existing. Compounded by the map-generation bug above, which keeps manufacturing more non-functional zones every scene.
- *Evidence:* `lib/game/exchange-manager.ts:451-501` (`currentZone` machinery, zero callers), `lib/maps/map-service.ts` (render-only zone rectangles).
- *Scope:* core gameplay, UX (misleading).
- *Suggested fix:* Gate melee/ranged actions on zone distance in `computeMechanics`, or delete both dead implementations.

**Turn-order countdown enforces nothing (#6, #52)**
- *Why it matters:* `TurnTracker` renders a live deadline timer, but nothing acts on it when it expires — a countdown that visibly hits zero and does nothing.
- *Evidence:* `lib/notifications/turn-tracker.ts` (`checkExpiredTurns`, `sendPeriodicReminders` — fully built, zero callers), `Scene.autoAdvanceTurn` (never set `true`).
- *Scope:* UX (misleading).
- *Suggested fix:* Call the existing functions from the heartbeat cron, or remove the countdown UI.

**Notification delivery is disconnected on the sound and push channels (#10, #63, #64)**
- *Why it matters:* a full sound-effect library/playback engine and two independent push-notification implementations all exist, each wired at only one end — nothing is ever actually heard or received; only the in-app bell works end-to-end.
- *Evidence:* `lib/notifications/sound-service.ts` (zero real callers beyond a settings preview button; `public/sounds/` doesn't exist as a directory); `public/sw.js` (a correct `push` listener with no `PushSubscription` flow anywhere — no `pushManager.subscribe`/VAPID/`web-push` usage in the repo); `lib/notifications/push-service.ts` (sends over Pusher's `push-notification` event, which has no client-side listener).
- *Scope:* UX, maintainability.
- *Suggested fix:* Pick and finish one push implementation's real subscription flow; either wire the `sound-notification` Pusher event to `SoundService` client-side and add the audio files, or delete both dead pipelines.

**Debt/economy mechanical depth is asymmetric (#44, #47)**
- *Why it matters:* Debts and `Faction.resources` are treated as flavor/prompt leverage rather than mechanically connected the way Standing already is — the same "looks systemic, isn't" pattern found elsewhere, here in the economy layer.
- *Evidence:* `lib/game/debts.ts` (no roll-time weight; contrast with `lib/game/standing.ts`'s `effectiveStandingModifier`); `Character.resources.gold` has real sinks but no scarcity/pricing tied to `Faction.resources`.
- *Scope:* core gameplay.
- *Suggested fix:* Give a called-in debt the same ±1 roll weight Standing gets; route downtime costs/reward grants through faction-state-aware pricing.

**`CampaignHealthMonitor` computes real metrics with no consumer (#57)**
- *Why it matters:* 359 lines compute a real health score, issues, and recommendations every 5 turns and only `console.warn` them — an operational blind spot, not a UI-facing feature.
- *Evidence:* `lib/game/campaign-health.ts`.
- *Scope:* maintainability, UX (operational visibility).
- *Suggested fix:* Surface it as a lobby/admin card, or delete it.

**5 chronically flaky orchestrator tests (#48)**
- *Why it matters:* a suite that's red-by-default normalizes ignoring red; these have been failing since before this backlog began.
- *Evidence:* `sceneResolver.test.ts` (×3), `safety-service.test.ts` (×2) — mock-wiring timeouts.
- *Scope:* maintainability.
- *Suggested fix:* Fix the mock wiring causing the timeouts.

**Basic JSON mode, not strict structured outputs (#1, #35)**
- *Why it matters:* the AI GM call uses `response_format: json_object`, not OpenAI's `json_schema` strict mode, so shape violations aren't caught before the fallback ladder. Deliberately not yet attempted blind: a strict-mode migration needs a live API round-trip to verify a hand-rolled schema actually validates under strict mode, and getting it wrong would mean every AI GM call starts failing in production.
- *Evidence:* `lib/ai/client.ts` (`callAIGM`), `lib/ai/schema.ts` (`WorldUpdatesSchema`).
- *Scope:* AI behavior.
- *Suggested fix:* Migrate once a live-testable environment is available, or make an explicit decision to accept the current risk.

### P3

**Leftover "GM Notes" copy after the GM-removal pass (#60)**
- *Why it matters:* five labels/placeholders in the admin NPC/Faction/Location/Clock edit forms still say "GM Notes," inconsistent with the "campaign host" reframing already shipped everywhere else in the same file.
- *Evidence:* `src/app/campaigns/[id]/admin/page.tsx` (5 occurrences).
- *Scope:* UX (copy consistency).
- *Suggested fix:* Rename to "Host Notes" or similar.

**Dead `getWorldStateChanges()` export (#61)**
- *Why it matters:* the one real consumer reads `scene.consequences.worldStateChanges` directly instead of calling this accessor, so the export silently implies a read path nothing actually uses.
- *Evidence:* `lib/game/world-state-tracker.ts`, `src/app/campaigns/[id]/story/page.tsx:172-173`.
- *Scope:* maintainability.
- *Suggested fix:* Switch the call site to use it, or delete the export.

## Roadmap

### 🎯 Next — Product & Market

Carried over from a July 2026 competitive-intelligence pass (benchmarked
against Friends & Fables, AI Dungeon, NovelAI, Hidden Door, Inworld AI,
Character.AI, Fable/Showrunner, KoboldAI/SillyTavern, Convai). That report was
written without codebase access and undersold what's shipped — the confirmed
differentiators are the Debt/standing bridge to a live simulation (no
comparator in the report does this), fog-of-war enforced at the API layer
(not just prompted away), and full safety tooling (not benchmarked for any
platform in the report, MythOS included). Its two genuinely correct findings
are folded in below. `#22` (de-jargon) and `#23` (surface multiplayer) shipped — see Shipped below.

- [ ] **#24 Decide, on purpose, whether dice stay opt-in** — re-run the "mechanics invisible by default" decision against real playtest feedback now that the Debt/standing/harm economy is live.
- [ ] **#25 Scene illustration** — one generated image per resolved scene; async resolution already keeps cost/latency off the request path.
- [ ] **#26 Shareable session recaps** — package a resolved scene or short arc as a social-media-sized card, building on the existing chronicle share link.
- [ ] **#27 Public API / developer access** — the one open item with no existing decision on record; needs a yes/no before monetization pricing tiers lock in.
- [ ] **#45 Structured quest objectives** — add `objective_key` + preconditions so quests can gate content availability and chain. Not a bug (today's narrative-thread quest model — status + progress log + reward grant — works as designed), but the highest-ROI remaining depth gap once the Known Bugs list above is clear.

### ✅ Shipped

Full narrative detail for everything below (including specific bug
postmortems) is preserved in this file's git history — this is the condensed
ledger.

**Both P0s from the consolidated audit, fixed:**
- **AI response cache cross-tenant leak (`#8`, `#58`, `#62`)** — rather than re-key a cache whose entire premise (coarse-bucket matching two "similar" requests to the same cached narrative) turns out to be unsafe for any per-scene resolution call — even correctly scoped by `campaignId`+`sceneId`, a scene resolved across multiple exchanges would still replay an earlier exchange's cached text for the same scene — the cache was removed from `callAIGM`'s live call path entirely. `lib/ai/response-cache.ts` (the `AIResponseCache` class, its dead `sceneContext`/`PATTERN_TEMPLATES`/`matchPattern` code included) is deleted; `client.ts` no longer imports or consults it, and the now-meaningless `skipCache` option was removed from `callAIGM`'s signature. Every AI GM call is a real, uncached call.
- **Entity resolution via `contains`-mode name matching (`#3`, `#40`)** — replaced across all 5 sites in `stateUpdater.ts` (clocks, NPCs, the NPC-harm attacker lookup, player characters, factions) with a new `lib/game/entityResolution.ts`: exact id → exact name (case/whitespace-insensitive) → a single, tightly-gated fuzzy match (Levenshtein distance ≤2 *and* ≤20% of name length — enough to catch a genuine AI typo, never enough to conflate two different short names). A `contains` match's two failure modes are both gone: it could cross-match an unrelated entity whose name merely contained the search string ("Bob" matching "Bobby's Assistant"), and it could fail on a trivial typo and silently spawn a duplicate stub instead. Multiple equally-plausible fuzzy candidates now resolve to a logged "ambiguous, skipping" rather than a guess — the system never picks a side when it's genuinely unsure which entity is meant. Each entity type's full campaign roster is fetched once per batch and resolved in memory rather than one `contains` query per change; newly-created stubs are added to that in-memory roster so a later change in the same batch referencing the same new name doesn't spawn a second stub.

**`stateUpdater.ts` decomposed into per-domain appliers, each unit-tested (`#4`, `#41`)** — the 1,439-line monolith (zero direct tests, verified only indirectly through route tests) is now a ~450-line orchestrator in `lib/game/stateUpdater.ts` plus 8 domain appliers under `lib/game/worldUpdaters/`: `timelineEvents.ts`, `clocks.ts`, `npcs.ts`, `characters.ts` (the largest — harm/conditions/relationships/consequences/appearance/personality/equipment/inventory/resources, kept as one function since harm state genuinely threads through several sequential sub-steps, but now directly tested rather than split further), `factions.ts`, `locations.ts`, `quests.ts`, `bargainOffers.ts`, and `worldMetaNotes.ts` — matching the same `db: Prisma.TransactionClient`-parameter pattern `debts.ts`/`standing.ts`/`questRewards.ts` already used. Every applier is independently unit-tested against a mocked transaction client (80 new tests total), covering behavior that had never been directly exercised before: armor-mitigated harm damage, the Taken-Out recovery roll, death saves, heroic sacrifice, corruption marks, consumable heal-on-use, relationship/consequence deltas, and delegation to the debt/standing/capability writers. No behavior changed — this is a straight extraction, verified line-for-line against the original and confirmed against the full existing test suite (same pass/fail baseline, only the 5 pre-existing flakes).

**`Location` gets a real nullable FK alongside the free-text string (`#42`)** — `Character.locationId` / `NPC.locationId` sit next to the existing `currentLocation` string, which stays the field the AI/creation forms write directly. Every write path that sets `currentLocation` now also resolves/creates the matching `Location` row and links `locationId` through a new shared `resolveOrCreateLocationId` (`lib/game/worldUpdaters/locations.ts`, case/whitespace-insensitive match before falling back to create — a strict improvement over the exact-string upsert the old auto-register pass did, with no behavior change for any caller that already matched exactly): the AI write-back's `pc_changes.location` handling (folded the old separate "auto-register locations from movement" pass directly into `characters.ts`, since it needs the same id anyway), the world tick's NPC day/night commute (`npcTick.ts`), and character/NPC creation and admin-edit routes. The two consumers the bug named as actually decoupled by string drift were migrated to prefer the stable id: `resolution.ts`'s weather-modifier lookup (`weatherByLocationId`, falling back to the old name-string match only for a character whose `locationId` hasn't resolved yet) and `story/page.tsx`'s split-party location grouping (groups by `locationId` when resolved, falling back to the trimmed string, while still displaying the human-readable name). `worldState.ts`'s NPC-relevance filter was deliberately left alone — it turned out to already be a substring match against free-text NPC `description`/`gmNotes`, not a Location-table join at all, so an FK doesn't fix it, and changing that heuristic is a separate, riskier call about what the AI prompt should include.
  - **Deploy note:** this project's build command runs `prisma db push`, not `prisma migrate deploy` (see `vercel.json`) — `db push` applies the schema change (the new columns/FK/indexes) straight from `schema.prisma`, but never executes anything in `prisma/migrations/`, so the one-time backfill that links *existing* rows to their matching `Location` doesn't run automatically. `scripts/backfill-location-ids.sql` has the same backfill as a standalone script — run once by hand (`psql "$DATABASE_URL" -f scripts/backfill-location-ids.sql`) after this deploys. Not required before traffic resumes: every consumer already falls back to the old string match for a row that hasn't backfilled yet, and a row self-populates the next time that character/NPC moves regardless.

**Depth Hardening (`#28`–`#37`, 9 of 10)** — from the July 2026 codebase
depth audit's highest-ROI backlog:
- `#28` fixed the memory-importance field-name mismatch (`memoryCreation.ts` was reading response fields that don't exist) — regression-tested so it can't silently break again
- `#29` wired `Character.relationships` (trust/tension/respect) into `computeMechanics()` via a banded `relationshipModifier`, parallel to faction standing
- `#30` replaced clock advancement's random-chance coin flip with deterministic, faction/relation-driven pacing (`decideClockAdvancement`)
- `#31` added a structured `reward_grant` on quest completion, applied deterministically the first time a quest transitions to `COMPLETED` — reuses the same standing-change writer `pc_changes` already uses
- `#32` gave `ComplexExchangeResolver` a real deterministic conflict-resolution mechanism (`rankActionsByOutcome`, ranked by actual roll outcome) instead of only flagging conflicts and punting to the AI
- `#33` added a structured `armorValue` to inventory items, honored exactly when present and falling back to the existing keyword heuristic otherwise
- `#34` removed the fully-dead `TurnOrder` model and documented the DB `Move` table's real (narrower) role instead of removing it, since campaign export/import genuinely depends on it
- `#36` added a single bounded repair round-trip to AI response validation — a fixable JSON-shape mistake gets one real re-prompt before falling through to the degradation ladder
- `#37` added `capForPrompt()`, a hard per-category cap (NPCs/factions/locations/clocks/quests) on the live world-state payload, as a backstop against unbounded growth in a maximally active long campaign
- `#35` (strict structured outputs) remains open — see Known Bugs / Known Issues

**Conditions, perks, and earned Abilities now mechanically enforced, not just prose (`#5`, `#49`, `#50`, `#51`)** — the fixed pattern this codebase already uses for weather/standing (a real, re-validated modifier folded into `computeMechanics`) was extended to cover all three:
- **Conditions** get a structured `rollModifier` field (`harm.ts`'s `Condition`, clamped -2..2 in `schema.ts`'s `ConditionSchema`) alongside the existing freeform `mechanicalEffect` flavor text — set only where a condition's real effect is genuinely flat/undirected. The old `getTotalConditionPenalty()` (a regex parse of `mechanicalEffect` text, zero callers, and provably wrong for a bidirectional condition like Enraged's "+1 combat/-2 social" — the regex would misread its "-2" as a flat penalty applied to every roll) is deleted outright in favor of a new pure `conditionPenalty()` in `resolution.ts` that sums each active condition's `rollModifier`, floored at -3. 5 of the 11 `COMMON_CONDITIONS` (stunned, poisoned, broken_limb, terrified, despair, confused) now carry a real `rollModifier`; the rest (bleeding's per-turn harm tick, enraged's directional split, cursed/marked/unstable's freeform/different sub-mechanics) are deliberately left unset with an in-code explanation rather than forced into an inaccurate flat number — the same judgment call `RelationshipForRoll` already makes by excluding `fear` from its modifier.
- **Perks and earned Abilities** (`advancement.ts`'s `Perk`/`Move`) are both genuinely situational ("+1 ongoing when fighting multiple foes") rather than flat, so a universal bonus would be wrong as often as right. Instead, `classifyActions()`'s existing per-turn classifier — already trusted to resolve `capability_key`/`faction_name`/`npc_name` against live state — is extended with a new `matched_signature_id` field: each character's perks+Abilities are listed to the classifier as `id (name: trigger)`, and the classifier picks at most one id whose trigger the current action clearly matches, or `null`. Exactly like every other classifier field, the result is never trusted blindly: `computeMechanics` re-validates the returned id against that character's real `signatures` list (built server-side from live `perks`/`moves` rows in `resolveActionMechanics`, no new query needed) before applying the flat `SIGNATURE_BONUS` (+1) — an id the classifier hallucinates or that doesn't belong to that character is silently ignored.
- **`canAct()`** (`harm.ts` — fully built, zero callers before this) is now wired into the scene action-submission route: a character at harm 6 (Taken Out) or under an incapacitating condition ("Cannot act"/"Cannot take actions" in `mechanicalEffect`) gets a clear 409 instead of being allowed to submit an action normally.
- Both new modifiers thread all the way through: `ActionMechanics`'s `conditionMod`/`signatureMod`/`signatureName`, the persisted `DiceRoll.modifier` sum, and the human-readable roll receipt (`", -1 condition penalty"` / `", Battle Hardened"`). New unit tests cover `conditionPenalty`'s summing/flooring, `computeMechanics`'s condition and signature paths (including the classifier-hallucinated-id case), and `canAct`'s harm/condition gating.

**Perks are AI-authored and campaign-grounded, not one of 4 fixed templates** — `computeOrganicGrowth()` (`advancement.ts`) used to grant perks itself: a keyword-tag counter (`combat`/`stealth`/`investigation`/`training`) that, once crossed, handed out one of exactly 4 hardcoded perks (Disciplined, Battle Hardened, Shadow Operator, Keen Eye) with fixed name/description text — every character in every campaign who fought a lot got the literal same "Battle Hardened: You've seen real combat. Take +1 ongoing when fighting multiple foes.", regardless of genre or backstory. Capabilities and earned Abilities never had this problem (both are already AI-authored, grounded in the specific character/campaign); perks now work the same way. `computeOrganicGrowth` no longer proposes perks at all — it's back to doing exactly one deterministic thing (stat-increase detection, the one kind of growth that's a flat numeric fact rather than invented content). All perk content comes from `organic_advancement.new_perks`, authored by the AI from what the character actually did; a new `buildPerkFromAI` (mirroring the existing `buildMoveFromAI`) derives the perk's `id` server-side from its name via `slugifyCapabilityKey`, so the AI is never trusted to invent one and the same conceptual perk earned via differently-phrased reports still dedupes — `PerkSchema` no longer accepts an AI-supplied `id` at all. The prompt guidance (`client.ts`) was rewritten from "the engine detects the common ones on its own, propose your own only for what its list wouldn't catch" to actively instruct grounding: two characters who both fight a lot should end up with *different* perks if their fights actually played out differently. The now-dead keyword classifier this replaced (`extractTagsFromAction`, a `/\b(attack|fight|combat...)\b/`-style regex — exactly the kind of guesswork this codebase's own `weatherPenalty` doc comment warns against) is deleted along with the now-unused `tags` field on `RecentAction`. New unit tests cover `buildPerkFromAI`'s id derivation/dedup, `applyOrganicGrowth`'s perk-granting path, and a regression test confirming `computeOrganicGrowth` never proposes a perk or move on its own.

**Two AI-reported numbers were completely unbounded — time passage and gold** — an audit of every AI-reported field against its downstream consumer (prompted by "relying on good prompting isn't engineering a good system") found that harm (0-6), corruption (+1/scene, hard capped), standing (±1/scene, ±3 bound), and relationships (clamped -100..100) all already have a deterministic backstop independent of the AI getting the number right — but `time_passage.days`/`.hours` and gold (`resource_changes.gold_delta`, `reward_grant.gold`) had none:
- `time_passage` fed straight into the displayed in-game date and the world-turn simulation clock with zero ceiling — a single scene reporting `{"days": 9000}` would have jumped the calendar by 9000 days and banked that toward the next world tick in one shot. `elapsedInGameHours()` (`tick/pacing.ts`) now clamps a single scene to `MAX_TIME_PASSAGE_HOURS_PER_SCENE` (14 days) — a backstop against one absurd/hallucinated report, not a ceiling on how much time a campaign can cover (the accumulator it feeds can still legitimately grow past that over many turns, and a genuine multi-week skip already has a dedicated path: the downtime system, which resolves up to 365 days day-by-day with real events instead of one freeform number). Along the way, found and fixed a second bug this surfaced: `time_passage.new_date` was a free-text date override that bypassed all hour-based math entirely — a report using it alone would jump the *displayed* date while banking *zero* hours toward the world-turn clock, desyncing the two. It was never actually used by the prompt's own examples, so it's removed from the contract entirely; the date is now always derived from the same clamped hour count that gets banked, so the two can't drift.
- Gold had no upper bound at all (only floored at 0) — unlike every other magnitude field, an AI-misjudged `gold_delta` or quest `reward_grant.gold` could hand out an arbitrary amount. New `clampGoldDelta()` (`economy.ts`) bounds any single reported gold change to ±100,000 and maps non-finite input (NaN/Infinity) to 0 — explicitly *not* a game-balance number (this engine has no canonical gold scale the way PbtA has a fixed stat range), purely a backstop against a clearly malformed or hallucinated value reaching a character's resources unclamped. Wired into both `resource_changes.gold_delta` (`worldUpdaters/characters.ts`) and `reward_grant.gold` (`questRewards.ts`, which also now floors reward grants at 0 — a reward is a payout, never a debit).
- New unit tests cover the clamp boundary (`economy.test.ts`, `pacing.test.ts`) and the quest-reward integration (`questRewards.test.ts`).

**Write-only state across several systems, fixed (`#7`, `#53`, `#54`, `#55`, `#56`)** — multiple fields were written durably by the AI contract (or by admins) and read by nothing, producing silent duplicate systems and broken narrative continuity. Each one got the fix that actually fit it, not a blanket treatment:
- **`appearance_changes`/`personality_changes` now actually reach the narrator.** Both fields were already fetched in `generateNewSceneIntro`'s query and never used, and not even fetched in the main per-turn prompt builders. Added to both `buildOptimizedWorldSummary`/`buildWorldSummaryForAI`'s character mapping (`worldState.ts`) and to `buildUserPrompt`'s actual rendered text (`client.ts`) — a scar written on turn 3 is now visible to the narrator on turn 30, the same way `description`/`backstory` already were. `generateNewSceneIntro`'s hook-focused opener gets a truncated version, matching how it already handles `backstory`.
- **The duplicate reputation system is gone, not fixed.** `resource_changes.reputation_changes` (`resources.reputation[faction]`) was a parallel, unenforced shadow of the real, roll-feeding `FactionStanding`/`standing_changes` system and was read by nothing — removed from `PCChangesSchema`, the `AIGMRequest` type, the prompt, and its handler in `worldUpdaters/characters.ts`. `contacts_add`/`contacts_remove` turned out to be a false positive in the original bug report — it's real, lightweight flavor already displayed on the character sheet — so it's untouched.
- **NPC `threat`/`impulses`/`moves` (PbtA GM-facing flavor — archetype, drives, custom moves) now reach the prompt.** The bug report named `impulses`/`moves`; investigating turned up `threat` had the identical problem and wasn't even named. All three were admin-writable and fetched nowhere. A new `npcFlavorFields()` helper (`worldState.ts`) adds them to both world-summary builders' NPC mapping, and to the rendered `IMPORTANT NPCs:` prompt line (`client.ts`) — but only for the NPCs that actually have them set, so the vast majority of minor NPCs don't bloat every prompt with empty arrays.
- **Inventory `slots` (capacity) is deleted, not enforced.** It was tracked, player-editable at character creation, AI-adjustable via `slots_delta` — and never checked against anywhere; `items_add` pushed items unconditionally regardless of the number. Unlike the other items here, "enforce" wasn't a clean wiring fix: nothing in this engine defines what "full" should mean (reject the pickup and contradict the AI's own narration that the item was just found? auto-drop something? ask the player?) — that's a product decision, not a bug fix, so it's removed instead: `slots`/`slots_delta`/`hasInventorySpace()` and the now-fully-dead `addItemToInventory`/`removeItemFromInventory`/`findItem` (zero callers each, confirmed) are gone from `inventory.ts`, `schema.ts`, `client.ts`, `worldUpdaters/characters.ts`, `questRewards.ts`'s `mergeGrantedItems`, and the character-creation form/route.
- **Confirmed-dead weight removed:** `campaign-templates.ts`'s `defaultPerks`/`startingItems` (and their now-unused `PerkTemplate`/`ItemTemplate` types) — `applyCampaignTemplate` never read either, only `factionTemplates`/`frontTemplates`/`capabilityTemplates`; and `Scene.turnDeadline`, which turned out to still have two live writers in `turn-tracker.ts` (mirrored alongside the real, actually-read `TurnTracker.turnDeadline` on every turn advance/scene end) despite nothing ever reading the `Scene` copy — both writers and the schema column are removed, `TurnTracker`'s own field (the one `TurnTracker.tsx` and the countdown logic actually use) is untouched.
- New unit tests cover `npcFlavorFields`; existing tests updated for the removed `slots`/`reputation_changes` fields.

**A campaign's opening scene ignored every character but one** — `generateNewSceneIntro` (used for a campaign's first scene, and any later "Continue Story Naturally"/"Full Party Scene" opener) already fetched every living character and put each one's location/career/goals in the prompt, but the actual scene-writing instructions were written entirely in singular "the character" language, with zero guidance for what to do when a party has more than one person — in practice this meant the AI just picked one character and wrote an opener that never mentioned the rest, confirmed against a real 2-character campaign where the opener was 100% about one PC and the second never appeared. A new `MULTIPLE CHARACTERS` instruction block (`worldState.ts`, spliced into both the first-scene and later-scene opener guidance) now explicitly tells the AI to ground every character listed, and — if their starting locations/careers genuinely differ — to invent a concrete, plausible reason they're together for the scene rather than silently dropping everyone but one.
- **New: regenerate a scene's opening.** There was no way to redo a bad opener short of restarting the campaign — added `POST /api/campaigns/[id]/scenes/[sceneId]/regenerate-intro` plus a "🔄 Regenerate" button on the story page, so the fix above (or just a bad roll of the dice on tone) can be applied retroactively. Guarded to scenes with zero submitted player actions and no resolution yet, so nobody's already-submitted response can be orphaned; preserves whatever participant scope the scene was created with (a split-party scene stays scoped to the same characters). Any campaign member can trigger it, same gating as starting a scene in the first place — there's no human GM in this product, so redoing an opener is a table decision, not a hosting duty.

**Open scenes resolved on the very first action, not once everyone had acted** — a scene with an explicit participant list (a Character-Focused/split-party scene) correctly waited for every named participant before resolving, showing a live "waiting for N more player(s)" indicator. An open scene — which is what a campaign's default, "everyone together" scene actually is (first scene, "Continue Story Naturally") — did not: `scene/route.ts`'s POST handler had a dedicated `else` branch that read *"For open scenes (no predefined participants), resolve immediately... this is how the GM AI responds to player actions in real time"* and unconditionally enqueued resolution on any single action, and the UI's own copy documented this as intentional ("This is an open scene — each action resolves as it lands"). In practice this meant a 2+ character party's first scene resolved the instant the first person acted, narrating only their action and leaving the rest of the party's submissions for later exchanges instead of one shared moment — confirmed against a real multi-character campaign. Unified the two branches: an open scene's "whole party" is now derived as every living character's owning user (`prisma.character.findMany({ isAlive: true })`), and it waits for all of them exactly the way a defined-participant scene already did, using the identical "check submitted vs. party, update `waitingOnUsers`, enqueue once everyone's in" logic — no more special-cased immediate resolve. The story page's Scene Controls panel and success-toast copy were updated to match (no more "each action resolves as it lands"); the existing admin "Force Resolve" rescue button needed no changes, since it already bypassed this check entirely. New tests cover an open scene waiting for a second living character and resolving once both have acted.

**Story Log entries were truncated raw prose, not summaries** — `generateCampaignLog` (`sceneResolver.ts`) built each entry by splitting the scene's narrated text on `.`/`!`/`?`, taking the first 3 fragments, and appending `...` — the function's own comment admitted it: *"Create a simple summary by taking the first few sentences... In a production system, you'd call an AI to generate a proper summary."* Splitting narrative prose on every punctuation mark breaks mid-quote and mid-abbreviation, so entries read as raw text cut off arbitrarily, not an actual recap — confirmed against a real campaign's log. "Key Moments" had the same root problem one layer deeper: it kept any sentence *fragment* containing one of 9 fixed keywords (`fought`, `discovered`, `found`, `defeated`, `rescued`, `escaped`, `learned`, `met`, `confronted`), so a highlight could be half a sentence sheared off mid-clause. Fixed by having the AI report a genuine summary in the same response it already returns, rather than deriving one after the fact: a new `scene_summary` field (`schema.ts`, optional so a response missing it doesn't fail validation) asks for "1-2 sentences, past tense, third person, no dialogue quotes... written so a player skimming their campaign's history would want to read it" — free, since it's the same API call. `generateCampaignLog` now takes `scene_summary` and uses it directly; "Key Moments" now comes from `new_timeline_events`' titles (already real, complete headlines the AI writes to mark a notable beat) instead of keyword-matched fragments. The old truncation logic (`fallbackSummaryFromSceneText`) is kept as a fallback, exercised only when `scene_summary` is missing — which only happens on a repaired/degraded AI response that never included one — so a log entry is never worse than before, just no longer the default. New unit tests cover the fallback's sentence-boundary handling directly (including the exact mid-quote-breaking case that motivated the fix). Note: `lib/ai/memoryCreation.ts`'s RAG-memory `extractSummary` has the identical splitting pattern and wasn't touched here — it feeds semantic search relevance rather than a player-facing page, a separate fix with different stakes.

**Quests get a real player-facing log, not just prose** — `Quest` rows have existed since the AI GM contract was built (`world_updates.quest_changes` → `worldUpdaters/quests.ts`) and are read into every prompt, but the only place a player could ever see one was buried in the generic Wiki page's `QUEST` tab, where status/objective/giver/reward all got flattened into one prose blob (`sceneResolver.ts`'s wiki sync) instead of staying structured fields — and the bottom-nav "Quests" icon didn't even point there, it pointed at the Story Log (`TavernNav.tsx`), a leftover mislabel from before Story Log had its own page. New `GET /api/campaigns/[id]/quests` (member-gated, reads the `Quest` table directly) plus a dedicated `/campaigns/[id]/quests` page group entries by status (Active/Completed/Failed/Abandoned) with objective/giver/reward as their own lines and a real color-coded status badge instead of a lowercase text tag. `TavernNav`'s "Quests" icon and the Overview tab's "Quests" tile both now point here; the wiki's `QUEST` tab is untouched and still works as a secondary view, just no longer the only one.

**Milestones now hit the world, not just the Story Log** — a milestone's own recap (above) was purely narrative; the actual ask was for something world-changing to actually happen. Added `lib/game/tick/crisisClock.ts` (pure, deterministic, no AI call): `pickMostThreateningFaction` picks the single most threatening active faction (highest `threatLevel`, ties broken by military+resources then id), and `decideCrisisEscalation` either jumps an existing clock tied to that faction forward by half its remaining ticks (never completing it outright — a milestone raises the stakes, it doesn't unilaterally end the threat) or spawns a new, already-partway-advanced crisis clock if it has none. `campaignMilestone.ts`'s `triggerMilestoneCrisis` applies the decision, logs a real `PUBLIC` `TimelineEvent` (so it also surfaces in the wiki's Rumors feed), and folds a one-line blurb into both the milestone's Story Log entry and its notification — one connected moment ("here's what you've been through — and the world just moved against you"), not two disconnected pings. Best-effort and independent of the recap: a crisis failure never blocks the real milestone entry from being written. New unit tests cover the threat-ranking tie-breaks and the escalate/spawn decision boundaries.

**Story Log duplicate cleanup, retroactive** — the duplicate-per-exchange fix above only stops *new* duplicates; rows already sitting in the table from before it shipped stayed duplicated forever, with no way to fix them (confirmed live: the milestone progress bar's scene count read as inflated, effectively counting old per-exchange rows instead of per-scene ones). "Regenerate All" (`/api/campaigns/[id]/logs/regenerate`) now runs a consolidation pass first: `lib/game/storyLogConsolidation.ts`'s `planLogConsolidation` (pure) groups scene-type rows by `sceneId`, and for any scene with more than one row, keeps the earliest (lowest `turnNumber`) as canonical, merges+dedupes all their highlights onto it, and deletes the rest. This is a cheap DB-only pass — no AI calls — so it runs across every duplicate in one request regardless of the resummarization cap below it; the canonical row's summary then gets regenerated from `Scene.sceneResolutionText` same as any other entry. Both "Regenerate All" buttons now report how many entries were merged. New unit tests cover single-row (no-op), null-`sceneId` (no-op), canonical selection, highlight merging, and multiple independently-duplicated scenes.

**"Milestone at 20 scenes" is now a real milestone, not a copy lie** — the campaign hub's Story Log progress bar has always shown "Milestone at 20 scenes," but nothing was wired to it: the bar was hardcoded to `campaignLogs.length / 20` and the text was static — no reward, notification, or campaign-state change actually happened at 20. Added `lib/game/campaignMilestone.ts`: every `CAMPAIGN_MILESTONE_INTERVAL` (20) scene-type Story Log entries, a new `generateMilestoneRecap` (`worldState.ts`, `AI_MODELS.EFFICIENT`) writes a short retrospective from the last 20 scenes' own summaries (a summary-of-summaries, not a re-read of raw scene text), saved as a new `entryType: 'milestone'` Story Log entry and pushed to every member via a new `CAMPAIGN_MILESTONE` notification type. Wired into `generateCampaignLog`'s new-scene branch only (an exchange that extends an already-logged scene doesn't advance the count a milestone is measured against). The progress bar itself is now driven by the same interval and only counts `entryType: 'scene'` rows (so a milestone entry doesn't inflate the count it's measured against), and always shows the *next upcoming* milestone rather than a fixed 20. Best-effort throughout — a failed recap generation logs and skips, never taking down the real per-scene log entry it rides alongside.

**Story Log: one entry per scene, not per exchange** — confirmed against a real campaign: consecutive Story Log entries all titled "Scene 1" reading as near-identical re-narrations of the same fight, one beat later each time. Root cause: a scene stays open across several exchanges (`resolveScene`'s "Keep scene active for continuous play"), but `generateCampaignLog` unconditionally `create`d a brand-new row on every single exchange resolution, always titled `Scene ${sceneNumber}` — since `scene_summary` only describes the exchange that just resolved (not the whole scene), the result was a wall of overlapping partial recaps instead of one coherent entry. `generateCampaignLog` now looks for an existing entry for that `sceneId` first: if one exists, it's extended (`appendSummarySegment` appends the new segment, `highlights` are merged and deduplicated) instead of a new row being created. Growth is bounded by sentence count, not raw characters (`MAX_SUMMARY_SENTENCES_PER_SCENE`), so a long-running scene drops its *oldest complete sentences* once the cap is hit rather than truncating mid-sentence the way the original bug did. New unit tests cover appending, starting fresh, and the sentence-boundary-respecting cap.

**Character roster showed emails instead of display names** — `Settings` already lets a user set `User.name`, and `CharacterRoster`/admin member list/etc. already had `character.user.name || character.user.email` fallback logic written — but the campaign GET (`api/campaigns/[id]/route.ts`) and the scene GET (`api/campaigns/[id]/scene/route.ts`) both selected `{ id, email }` on the character/playerAction/membership `user` relation, never fetching `name` at all. The fallback was permanently forced to its email branch for every user regardless of whether they'd set a display name — the classic write-only-field pattern this session already fixed elsewhere, just not caught here yet. Added `name: true` to all four selects; no frontend change needed since the fallback logic was already correct.

**Story Log: regenerate existing entries** — the `scene_summary` fix above only improves entries written *after* it shipped; every Story Log entry written before that point still carries the old truncated/malformed text, and the original AI response that would have contained `scene_summary`/`new_timeline_events` for those scenes was never persisted anywhere — only `Scene.sceneResolutionText` survives. Added `summarizeSceneForLog` (`worldState.ts`), a small dedicated `AI_MODELS.EFFICIENT` call that re-summarizes a scene from its resolution text alone, and `POST /api/campaigns/[id]/logs/regenerate` plus a "🔄 Regenerate All" button on the Story Log page to apply it retroactively. Admin-gated (unlike per-scene intro regeneration, which any member can trigger) because this fans out one AI call per entry in a single request — a real cost surface a lone member shouldn't be able to trigger repeatedly — and capped at 25 entries per request to stay well inside the Hobby-tier `maxDuration=60` window; a campaign with more just needs the button pressed again, and the response reports how many are left. Failures on an individual entry (e.g. its scene got deleted) are counted and skipped rather than aborting the whole batch.

**Depth Hardening, follow-up round** — the remaining items from the first
round's Known Issues list, all shipped in one pass:
- Weather: added `weatherPenalty` — a deterministic -1 to rolls in severe non-benign conditions (severity 4+) at the acting character's location, the first real mechanical consumer of `weatherTick.ts`'s state
- NPCs: goal progress is now phase-weighted (`decideNpcTick`'s `PHASE_PROGRESS_WEIGHT`) — `acting` advances a goal fastest, `preparing` at the baseline rate, `observing`/`resting` slowest, instead of a flat rate regardless of phase; weights average to the original pace over a full cycle
- Downtime: added `downtimeEventOutcome.ts` — a deterministic, riskLevel-weighted roll (`decideDowntimeDayEvent`) decides whether a day has an event and its category (setback/complication/smooth/opportunity) before the AI narrates, replacing a bare `Math.random() < 0.4` and fully-freeform event nature
- Schema cleanup: removed `DiceRoll.moveId`, the one FK that structurally could never reference the `Move` table correctly (a real roll's move is always `BASIC_MOVES`, which has no `Move` row) — confirmed zero application-code references before removal

**Move flavor, wired for real (`#38`)** — closed the last Known Issue from the depth audit: the DB `Move` table was real but disconnected from live resolution. Now:
- `pbta-moves.ts`'s fixed `BASIC_MOVES` each carry a stable `key` (`Move.baseMoveKey`); mechanics (stat, rollType, outcome bands) stay canonical and untouched
- `lib/ai/moveFlavor.ts` generates per-campaign name/trigger/outcome-prose flavor for all 7 moves at creation time (and via lore reseed, fill-only in live mode / atomic replace in fresh mode) — same fail-open pattern as `statLabels`/archetypes/corruption theme, run as an independent third-stage call so a truncated response can't zero out factions/capabilities
- `computeMechanics()` looks up flavor by `baseMoveKey` and overrides only `moveName`/`outcomeText` in its return value — the roll math never reads it, and per-band fallback to generic text covers a partially-flavored move
- that override reaches both the transparency-panel receipt (`formatRollReceipt`) and the AI narrator's prompt (`mechanics.move_name`/`outcome_text` in `worldState.ts`) — the first time Move flavor has been visible anywhere outside campaign export
- retired the old per-template `defaultMoves`/`MoveTemplate` seeding entirely (it never worked for template-less campaigns, and its richer Dungeon-World-style movesets were never mechanically distinct from the fixed 7 anyway) — every campaign now gets flavored moves, not just the 3 static templates

**Inventory/items, full scope (`#39`)** — closed the last low-scoring row on the scorecard:
- `InventoryItem` gains `damageBonus` (weapons) symmetric to `#33`'s `armorValue` (armor), plus a keyword-heuristic fallback (`getWeaponDamageBonus`) for freeform weapon names with no structured value — same relationship `getArmorReduction` has to `armorValue`
- `InventoryItem.effect` gives consumables a real mechanical payoff: `'heal'` is enforced deterministically the instant an item is consumed (`items_remove`, or a negative `items_modify` delta) via `resolveConsumableHeal`, regardless of what the AI separately narrates; `'custom'` is deliberately NOT enforced and documented as such — an unenforced-but-present `kind` would be exactly the "looks wired, isn't" problem `#38` just fixed elsewhere
- `itemType` adds broad categorization (weapon/armor/consumable/quest/currency/misc), surfaced in the wiki's aggregated item entries — purely a display label, nothing keys off it mechanically
- **Discovered mid-implementation**: `harm_damage` only ever applied to a PC taking damage — NPCs had no harm state at all (`isAlive` was set once at creation and never flipped anywhere), so the dominant real case for a weapon mattering (a PC attacking an NPC) had nowhere honest to write to. Rather than ship a decorative `damageBonus`, added minimal `NPC.harm` (mirrors `Character.harm`, no conditions/death-saves/permanent-injury) and `npc_changes.harm_damage`/`harm_damage_dealt_by` so the attacking PC's weapon bonus has a real target
- `questRewards.ts`'s `reward_grant.items` carries the same new fields through quest payouts, not just `inventory_changes`

**De-jargoned player-facing language (`#22`)** — display strings only, no schema/internal-code changes (internal naming stays PbtA/Urban Shadows-accurate, e.g. `BASIC_MOVES`, `pbta-fantasy` template id):
- Renamed the "PbtA Fantasy" template to "Fantasy Adventure" (and dropped its "Dungeon World-style" description wording) in both the server-side template and its client-side mirror on the campaign-creation page
- Rewrote the help page's and onboarding tutorial's "Powered by the Apocalypse (PbtA)" callouts in plain language
- Retitled character-sheet/creation-form section labels to read correctly regardless of universe: "Debts & Enemies" → "Obligations & Rivals", "Promises & Oaths" → "Promises Made", "Debts & Favors Owed" → "Debts Owed", "Obligations & Favors" → "Obligations", "Moves"/"Moves Learned" → "Abilities"/"Abilities Learned"
- Found along the way: the campaign-creation modal's "X moves" badges were stale leftovers from the per-template `defaultMoves` concept `#38` retired — removed them rather than reword them, since the number no longer corresponded to anything real

**Surfaced the multiplayer story, and fixed one that wasn't real (`#23`)** — investigating turned up something bigger than the "marketing gap" the roadmap assumed:
- **Discovered mid-investigation**: the "real turn tracker" the scorecard referenced was dead code — `TurnTracker.initializeScene()` was never called from any UI, `<TurnTracker/>` was imported but never rendered anywhere, and the component's server-side Pusher events (`turn-update`, `turn-reminder`) were never triggered by anything. No player could ever have used it.
- Wired it up for real, advisory-only: a GM can now enable an opt-in turn queue for a scene (`story/page.tsx`'s "Enable turn order"), rendered live via `<TurnTracker/>` — but it never gates or blocks action submission, which stays exactly as simultaneous as it's always been. `lib/notifications/turn-tracker.ts` no longer writes to `Scene.waitingOnUsers`, the field the real (and separate) `ExchangeManager` simultaneous-submission tracker owns — the two systems could otherwise have overwritten each other's state
- Added the missing `pusher.trigger('turn-update', ...)` broadcasts to the `/turns` API route so every connected client's turn tracker actually updates live instead of only on page reload
- Restyled `TurnTracker.tsx` from its original light-mode palette (`bg-white`, `text-gray-900`) to the app's dark tavern theme — it had never been touched since being built, so it visually didn't match anything else in the product
- Help page and onboarding tutorial: added Invite/Turn Order feature callouts, fixed the now-inaccurate "no strict turn order" copy, documented block/report under Safety Tools, added an `invite_players` tutorial step

**Location-aware multi-scene / split-party support** — a user question about how the engine handles multiple players at campaign start, new-scene creation, and mid-campaign joins turned up a real leak: nothing was location-aware anywhere, and the AI context builders leaked every living character into every scene regardless of who was actually in it.
- `worldState.ts` gains `scopeCharactersToParticipants` (pure, unit-tested): scopes the character roster — and the location-derived NPC/faction relevance built from it — to `Scene.participants.characterIds` when a scene has one, for both the scene-intro prompt and every ongoing resolution. `entities.characters` (used for memory/lore RAG) stays the full unfiltered list, matching the existing fog-of-war precedent for NPCs/factions. A genuinely open scene (`participants: null`) is unaffected
- `scene/route.ts` now enforces a scene's explicit participant list server-side on action submission — previously only the client UI hid the action box from non-participants; the server silently added anyone who submitted anyway
- `story/page.tsx`'s `currentScene` is now the scene the viewer's own selected character can actually act in (derived from `activeScenes`), not always `activeScenes[0]` — the API already supported multiple concurrent `AWAITING_ACTIONS` scenes and the UI already rendered each as its own card, but chat/turn-order/map/XCard all silently followed whichever scene happened to be created first
- GMs get a one-click "start a scene per location" prompt when living characters not already in a scene are split across 2+ distinct `currentLocation` values — never automatic, always an explicit GM action
- Character creation now shows the existing party's current location(s) next to the Starting Location field and defaults to match when they agree, instead of an unprompted blank field with nothing keeping a new character in sync with the rest of the party
- No new schema and no "merge scenes" mechanic: ending both split scenes and starting a Full Party one already works with the existing creation flow

**Everyone's a player — removed the accidental human-GM role** — the product's design is AI-GM-only, but the codebase had quietly grown a second, human GM out of the ADMIN membership flag: only admins could start scenes, end scenes, enable turn order, use the split-party prompt, or create maps, and non-admins saw "Waiting for the GM to start a scene."
- Story pacing now belongs to the whole table: any member can start the next scene, end a scene, enable/end turn order, use the split-party prompt, and create maps — the AI is the only GM
- Deliberate billing consequence, accepted and surfaced in the UI: the member who ends a scene pays its metered AI bill, so any player can be the payer, not only the admin
- The admin role shrank to genuine **hosting**: safety settings, bans, reports queue, lore import, AI/simulation settings, invites, and rescue tools (force-resolve, reset stuck scenes, resume after an X-Card, skipping *another* player's turn) — things that override or protect other players, not story control
- All player-facing copy rewritten so "GM" only ever means the AI and the human role is "the campaign host" ("Waiting for the GM…" is gone entirely; "GM Controls" → "Scene Controls"; `TurnTracker`'s `isGM` prop → `isHost`)
- Found along the way: help/tutorial copy advertised "GM-only" notes, a visibility tier the notes UI doesn't actually offer (it's private/shared only) — copy corrected to match reality

**Mechanical spine (Foundation + Phase 0–1)**
- Knowledge-relative capability sheets with deterministic arc-capped growth and per-character narration knowledge-gating
- Server-rolled 2d6 move resolution binding the narration; opt-in transparency panel
- Async scene resolution via job queue with atomic claims, retries, traffic-driven stuck-job recovery
- CI, error monitoring, auth hardening (email verification, password reset, no fallback JWT secret)

**Urban Shadows fusion (Phase 2)** — `#6`–`#12`, all shipped: Debt economy ·
faction standing wired into roll math · world-visibility digest · harm/death
keyed to resolution · origin archetypes at character creation · corruption
track with engine-enforced bargains and shadow capability branches · alpha
funnel/retention instrumentation with stuck-scene alerting.

**Content & shareability (Phase 3)** — `#13` deepened campaign templates
(front-style threats, capability scaffold, starting Debt, now universal
across all campaigns not just templates) · `#15` chronicle share link.
`#14` scene illustration still open (see Next).

**Monetization (Phase 4, partial)** — `#16` signup welcome credit shipped;
pricing validation itself still needs real cohort data.

**Living World simulation (Phases 1–8)** — deterministic AI-free world tick ·
autonomous faction ambitions with archetype-flavored outcomes · faction goal
reassessment/collapse/succession · NPC↔faction affiliation and territory ·
sustained wars and coalitions · player-led factions · fog of war end-to-end ·
RAG memory with consolidation and cross-entity recall · admin relationship
map, tick-log debugger, dry-run preview.

**Recently shipped** — world turns paced by real in-game time · quest
tracking · item registry · lore import (paste/URL/wiki crawl) with
canon-driven world regeneration · organic advancement bug fixes (growth was
silently dead, then double-applying, then fixed) · NPC society (social ties
+ joint schemes as real Clocks) · real-time heartbeat cron so idle campaigns
still advance.

**Hardening backlog (from an earlier full-codebase audit, now resolved)** —
X-Card pause made real (was a literal no-op) · safety admin fully wired
(reporting, bans, blocking) · notification writers connected to their read
side · downtime costs made real and multi-typed (gold/items/favor/quest) ·
several lore-reseed race conditions and truncation bugs fixed · dead schema
cleanup (`Character.experience`/`holds`, unused `Session*` models) · billing
switched from flat-tier guessing to metered real cost per call.

### 🧊 Deferred

Native mobile app, voice/TTS, creator marketplace/UGC, VTT-style grid combat,
5e-style crunch/custom rule import — deliberate calls, not oversights, made on
the reasoning that deeper world-sim work matters more than these before
players can *feel* the simulation through standing/Debts/rumors. Worth
revisiting only if a specific cohort's feedback contradicts that call, not on
an outside report's say-so alone.

## World Simulation

MythOS runs a deterministic "world tick" paced by **in-game time**: each
resolution banks the fiction's time passage, and the tick fires once a full
in-game day (per-campaign configurable) has actually passed in the story —
so a rapid combat exchange doesn't move the world, and a three-day journey
does. The tick itself is a pure, AI-free simulation step that decides what
changes in the background (NPC movement and goal progress, faction
resource/stability/military drift, weather) and writes every change to a
durable event log. Only *narrating* those changes into prose is delegated
to the AI; the underlying simulation state never depends on the AI being
available or consistent.

On top of that tick, factions can autonomously commit to major ambitions —
tournaments, trade wars, coups, heists, crusades — once their resources and
goals justify it. The tick decides **whether** a faction commits to
something big; an offscreen AI call decides **what**, chosen from a bounded,
archetype-specific option list, so the result stays flavorful without the AI
going off-script. If the AI call fails, a deterministic fallback name is used
instead, so an ambition never silently disappears.

Territory is real state, not flavor text: factions can contest and conquer
each other's land, and sustained conflicts escalate into full **wars** —
multi-turn, attrition-driven, momentum-tracked — that can grow into
multi-faction **coalitions** as allies join a side. A player character can
lead a faction outright, setting its strategic goal in-fiction while the
rest of the simulation (stat drift, ambitions, wars, collapse/succession)
keeps running underneath them exactly like an NPC-led faction would.

None of this is narrated to players ahead of what they've actually
discovered: hidden factions/NPCs/locations, GM-only notes, and the
simulation's exact internal numbers never reach the AI's player-facing
prompt — the AI narrates from the same qualitative impressions a character
in the world would have, while the tick itself always operates on real
numbers underneath.

Every active faction is simulated automatically — no opt-in. Each starts
with a default goal and archetype, and the tick reassesses its goal every
turn from its actual circumstances. The admin panel's **Simulation Goal**
and **Archetype** controls are a steering wheel, not an ignition switch —
except for player-led factions, whose chosen goal is deliberately preserved.
The admin panel also has a Map tab (faction relationships and territory), a
Debug tab (why the tick made a given decision, plus a dry-run preview of the
next tick), and a Simulation section for tuning per-campaign tick caps and
pacing.

Weather is part of this same deterministic tick, computed with the same
rigor as everything above — and now a real gameplay variable, not just
narration input: severe conditions (STORM/SNOW/RAIN/FOG at severity 4+)
impose a flat -1 penalty on rolls made at that location, the same way the
Impaired harm rule works.

## Prerequisites

- **Node.js** 18+ and npm
- **PostgreSQL** 15+ with **pgvector extension** ⚠️ **REQUIRED**
- **OpenAI API** key
- **Pusher** account for real-time features
- **Stripe** account for payment processing (optional for development)

### ⚠️ Important: pgvector Requirement

This application uses PostgreSQL's `pgvector` extension for the Campaign Memory RAG system. You **must** install this extension before running the application.

**Easiest option:** Use Docker (pgvector is pre-installed)
```bash
docker-compose up -d
```

**Alternative:** Install pgvector manually
```bash
# Ubuntu/Debian
./scripts/setup-pgvector.sh

# macOS
brew install pgvector
```

See [SETUP.md](SETUP.md) for detailed installation instructions.

## Quick Start

### Option 1: Using Docker (Recommended)

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/interactive-stories-live.git
cd interactive-stories-live

# 2. Install dependencies
npm install

# 3. Start PostgreSQL with pgvector
docker-compose up -d

# 4. Configure environment
cp .env.example .env
# Edit .env and set:
#   DATABASE_URL="postgresql://pguser:pgpassword@localhost:5432/interactive_stories"
#   OPENAI_API_KEY="your-key-here"
#   PUSHER_* variables
#   JWT_SECRET (generate with: openssl rand -base64 32)

# 5. Run database migrations
npx prisma migrate dev

# 6. Start the development server
npm run dev
```

Navigate to `http://localhost:3000` to see the application.

### Option 2: Manual Setup

See [SETUP.md](SETUP.md) for detailed manual setup instructions including:
- Installing PostgreSQL and pgvector
- Configuring environment variables
- Setting up Pusher and OpenAI
- Troubleshooting common issues

## Development

```bash
# Run development server
npm run dev

# Run tests
npm test

# Run tests with UI
npm run test:ui

# Build for production
npm run build

# Start production server
npm start

# Database management
npm run prisma:studio      # Open Prisma Studio
npm run prisma:migrate     # Run migrations
npm run prisma:generate    # Generate Prisma Client
```

## Project Structure

```
.
├── src/
│   ├── app/              # Next.js app router pages
│   ├── components/       # React components
│   ├── lib/              # Utility libraries
│   ├── services/         # Business logic and services
│   └── hooks/            # Custom React hooks
├── prisma/
│   ├── schema.prisma     # Database schema
│   └── migrations/       # Database migrations
├── scripts/
│   ├── setup-pgvector.sh # pgvector installation script
│   ├── init-db.sql       # Database initialization
│   └── README.md         # Scripts documentation
├── docker-compose.yml    # Docker setup with pgvector
└── SETUP.md             # Detailed setup guide
```

## Key Technologies

- **Framework**: Next.js 14 (App Router)
- **Database**: PostgreSQL 15+ with Prisma ORM
- **Vector Search**: pgvector for semantic similarity
- **AI**: OpenAI GPT-4 for story generation
- **Real-time**: Pusher for live updates
- **Styling**: Tailwind CSS
- **Testing**: Vitest
- **Payments**: Stripe

## Troubleshooting

### "ERROR: type 'vector' does not exist"

This means pgvector isn't installed. See [SETUP.md#troubleshooting](SETUP.md#troubleshooting) for solutions.

### Other Issues

Check [SETUP.md](SETUP.md) for detailed troubleshooting steps.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

[Add your license here]

## Support

For issues and questions:
- Check [SETUP.md](SETUP.md) for setup help
- Review [scripts/README.md](scripts/README.md) for database setup
- Open an issue on GitHub
