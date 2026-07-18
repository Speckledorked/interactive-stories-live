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
wrapper around a chatbot. A July 2026 depth audit found several systems that
*looked* equally systemic but weren't (a dead-logic bug in memory importance
scoring, write-only relationships, random-chance clock advancement, a
conflict "resolver" that only punted to the AI, and more) — nine of the ten
highest-ROI fixes are now shipped (see [Known Issues](#known-issues) and the
[Roadmap](#-now--depth-hardening-highest-roi) for what's still actually
open). Nothing below overstates what's shipped; where something is cosmetic,
it's labeled that way.

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
is exactly what the Known Issues and Depth Hardening sections exist to close.

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
| AI response validation | 4 | Improved (`#36`): one bounded repair round-trip is attempted before falling through to the degradation ladder — no longer purely silent. Still basic JSON mode, not strict structured outputs (`#35`, open — see Known Issues). |
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
see Known Issues and Shipped.

## Known Issues

Confirmed by direct code inspection, not inferred. What's left after the
July 2026 audit's Depth Hardening pass, its follow-up rounds, and the
July 2026 **re-audit** (see Roadmap) — most of what the original audit
found has since been fixed; this is what's still actually true today.

1. **Basic JSON mode, not strict structured outputs.** The AI GM call uses
   `response_format: json_object`, not OpenAI's `json_schema` strict mode.
   **Deliberately not yet attempted** (`#35`): a strict-mode migration needs
   every optional field in the (large, deeply nested) `WorldUpdatesSchema`
   restructured into OpenAI's required-but-nullable shape, and there is no
   way to verify a hand-rolled JSON Schema actually validates against
   OpenAI's strict-mode rules without a live API round-trip — getting it
   wrong would mean every AI GM call starts failing in production, a worse
   outcome than today's lenient mode. Needs either a live-testable
   environment or an explicit decision to accept that risk before
   attempting it blind.
2. **Zones are drawing data, not a mechanic.** The false help/tutorial
   copy ("your zone affects what actions you can take") has been removed,
   but two dead zone implementations remain in the codebase — the
   Close/Near/Far/Distant `currentZone` machinery in
   `lib/game/exchange-manager.ts:451-501` (zero callers) and the zone
   rectangles in `lib/maps/map-service.ts` (render-only). `#43`: make one
   of them real or delete both.
3. **Entity resolution is fuzzy name matching.** The AI→state write-back
   resolves NPCs/characters/clocks by `contains`-mode name match
   (`stateUpdater.ts`), and a misspelled NPC name auto-creates a duplicate
   stub. The #1 state-corruption vector for long campaigns — see `#40`.
4. **`stateUpdater.ts` (1,438 lines) has no direct tests.** The
   transactional heart of the write-back path is verified only indirectly
   through route tests — see `#41`.
5. **A prompt-as-rules periphery.** Condition `mechanicalEffect` text
   ("Stunned: -1 to all rolls"), perk bonuses ("+1 ongoing…"), and earned
   Abilities all reach the player and the narrator prompt but are never
   applied by `computeMechanics` — enforcement is delegated to whether the
   LLM honors its own prose. The enforcement code partly exists, dead
   (`harm.ts`'s `getTotalConditionPenalty`/`canAct` have zero callers).
   See `#49`–`#51`.
6. **The turn-order countdown enforces nothing.** `TurnTracker` renders a
   live deadline timer, but `checkExpiredTurns`/`sendPeriodicReminders`
   (`lib/notifications/turn-tracker.ts`) have zero callers and
   `autoAdvanceTurn` is never set true — nothing fires at 0:00. See `#52`.
7. **Write-only state.** `appearance`/`personality` changes never re-enter
   any prompt after being written; `resources.reputation`/`contacts` are
   written by the AI contract and read by nothing (`reputation` silently
   duplicates the real `FactionStanding` system); `NPC.impulses`/`NPC.moves`
   are admin-writable and consumed nowhere; inventory `slots` is tracked
   but never enforced. See `#53`–`#56`.

## Roadmap

### 🔧 Now — Depth Hardening (highest ROI, from the audit)

Small, mostly mechanical fixes that close the gap between "looks systemic"
and "is systemic." Nine of ten shipped in one pass (see Shipped below) —
several were near-zero-cost because the surrounding infrastructure already
existed. One remains, deliberately not attempted blind:

- [ ] **#35 Move to strict structured outputs** (`json_schema`) for the AI GM response, catching shape violations before they reach the fallback ladder. Blocked on live-API verification — see Known Issues #1 for why this specifically wasn't attempted without it.

### 🔧 Depth Hardening, round two — from the July 2026 re-audit

A second full product-depth audit (run after the first round shipped)
confirmed the simulation core is genuinely deep and compounding, and
re-drew the backlog around what's still thin at the edges. Ordered
roughly by ROI; the first two kill the two biggest state-corruption /
regression risks in the codebase:

- [ ] **#40 Entity-resolution layer for the AI write-back.** `stateUpdater.ts` resolves NPCs/characters/clocks via `contains`-mode name matching, and a misspelled name auto-creates a duplicate stub NPC. Replace with exact-match → alias table → fuzzy-with-confirmation, and stop `contains` writes entirely. Kills the #1 corruption vector for long campaigns.
- [ ] **#41 Decompose `stateUpdater.ts` (1,438 lines, zero direct tests) into per-domain appliers**, each unit-tested — the fixture shapes already exist in the route tests. This is the transactional heart of the product running on indirect coverage.
- [ ] **#42 Make `Location` a real foreign key** (nullable, backfilled by name once) on Character/NPC. Weather modifiers, NPC prompt relevance, and split-party grouping all currently join on free-text `currentLocation` strings — one AI-written "the Docks" vs "The Docks District" silently decouples three systems.
- [ ] **#43 Zones: make them real or delete both dead implementations.** The false help/tutorial copy is already removed (see the fake-depth pass below); what remains is the decision — either gate melee/ranged actions on zone distance in `computeMechanics` (the `currentZone` machinery in `exchange-manager.ts` and the position data in `lib/maps/map-service.ts` already exist, unwired) or delete both dead systems.
- [ ] **#44 Give Debts roll-time weight.** A called-in debt should shift the roll (±1) the way standing already does (`effectiveStandingModifier`) — completing the social economy's second half. Today debts are prompt leverage only.
- [ ] **#45 Structured quest objectives.** Add `objective_key` + preconditions so quests can gate content availability and chain — today a quest is a tracked narrative thread (status + progress log + reward grant), not a rules object.
- [ ] **#46 Consolidation for append-only text.** `NPC.gmNotes`, `Quest.progressLog`, and the advancement log grow unboundedly via string appends; give them the same era-summary treatment `memoryConsolidation.ts` already gives campaign memory.
- [ ] **#47 Connect the economy's two halves.** `Character.resources.gold` has real sinks (downtime costs, reward grants) but no prices or scarcity, and never touches `Faction.resources`. Route downtime costs and reward grants through faction-state-aware pricing so the offscreen economy reaches the player's purse the way standing reaches their rolls.
- [ ] **#48 Fix the 5 chronically flaky orchestrator tests** (`sceneResolver.test.ts` ×3, `safety-service.test.ts` ×2 — mock-wiring timeouts, failing since before this work began). A suite that's red-by-default normalizes ignoring red.

### 🔧 Fake-depth pass — from the stricter second audit

A call-graph-verified sweep for places where the product implies simulation
but the code only performs presentation, CRUD, or prompt formatting. The
two outright copy lies were **fixed immediately, not backlogged**: the
help page and tutorial claimed an XP system ("Use XP to increase stats or
gain perks") that has never existed, and zone-gated actions that were
never enforced — both rewritten to describe what the engine actually does.
What remains is tracked here. A shared theme: several fixes are cheap
because the enforcement code already exists, dead.

- [ ] **#49 Enforce condition penalties — or strip the numbers.** `COMMON_CONDITIONS` promise mechanical effects ("Stunned: -1 to all rolls") that `computeMechanics` never applies; `harm.ts`'s `getTotalConditionPenalty()` and `canAct()` implement exactly this and have zero callers. Wire them into the roll (a 7th modifier, same pattern as weather) or reword conditions as purely narrative.
- [ ] **#50 Make perks mechanical or honest.** Perk text promises roll bonuses ("+1 ongoing…", "guaranteed strong hit") the server-rolled engine structurally cannot honor. Either add a structured `perk.effect` consumed by `computeMechanics`, or reword perks as narrative traits with no numeric claims.
- [ ] **#51 Decide what earned Abilities are worth.** The advancement system's rarest reward (`organic_advancement.new_moves`) grants entries that reach the sheet and the prompt but never affect a roll — resolution only ever rolls the 7 fixed `BASIC_MOVES`. Give them a mechanical hook (e.g. a situational +1 the classifier can match, like capabilities) or present them explicitly as narrative signatures.
- [ ] **#52 Make the turn timer real.** Call `checkExpiredTurns()`/`sendPeriodicReminders()` from the existing heartbeat cron (the functions are fully built — reminders at 15/5/1 minutes, auto-skip on timeout — just never invoked), or remove the countdown UI. A timer that visibly counts to zero and does nothing is theater.
- [ ] **#53 Delete the duplicate reputation system.** `resource_changes.reputation_changes` and `contacts_add/remove` write to `Character.resources` blobs that nothing reads; `reputation` shadows the real, roll-feeding `FactionStanding` system. Remove them from the AI contract (`schema.ts`, `client.ts`) and `stateUpdater.ts` — same two-sources-of-truth cleanup `#38` did for moves.
- [ ] **#54 Feed appearance/personality back into the prompt.** `appearance_changes`/`personality_changes` are written durably ("Make changes MATTER," the prompt insists) but neither field is included in any prompt's character block afterward — the narrator that wrote the scar is never told about it again. One-line fix in both world-summary builders + `generateNewSceneIntro`'s character context.
- [ ] **#55 Enforce inventory slots or remove them.** `slots` is tracked, AI-adjustable (`slots_delta`), and displayed; `hasInventorySpace()` implements the check and has zero callers — items are added unconditionally.
- [ ] **#56 Dead-weight deletion pass.** Remove what implies systems that don't exist: `campaign-templates.ts`'s `defaultPerks` + `startingItems` (zero consumers — the `defaultMoves` cleanup in `#38` missed them), `inventory.ts`'s unused CRUD half (`addItemToInventory`/`removeItemFromInventory`/`findItem` — `stateUpdater` reimplements all of it inline), `NPC.impulses`/`NPC.moves` (admin-writable, read by nothing), and `Scene.turnDeadline` (written, never read).
- [ ] **#57 Give `CampaignHealthMonitor` an audience or delete it.** 359 lines compute a health score, issues, and recommendations every 5 turns — and `console.warn` them to the server log. No UI reads it, nothing acts on it. Surface it as a lobby/admin card, or remove it.

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

### ✅ Shipped

Full narrative detail for everything below (including specific bug
postmortems) is preserved in this file's git history — this is the condensed
ledger.

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
- `#35` (strict structured outputs) remains open — see Known Issues #1

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
