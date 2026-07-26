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
- **Server-Rolled Move Resolution**: every risky action is classified to a PbtA basic move and rolled 2d6+modifiers *on the server*; the outcome band is handed to the narrator as a binding constraint. Stated precisely, because the distinction matters: the **arithmetic** is entirely outside the model's reach and the roll is unconditional, but adherence to the band is currently instructed rather than verified — nothing compares the returned prose against the outcome (`#93`). Modifiers blend stats, capability bands, faction standing, and harm. Receipts are persisted and viewable in an opt-in transparency panel — mechanics stay out of the prose by design
- **Debt & Standing Economy**: player choices create real, mechanically-binding consequences — a faction losing a war in the offscreen tick changes what a player can roll next session. This is the bridge between player agency and the living simulation, and it's the single most differentiated thing in the codebase
- **Player-Faction Integration**: a player character can lead a faction outright — set its strategic goal in-fiction, watch it keep ticking autonomously between sessions
- **Fog of War**: hidden factions/NPCs/locations, GM-only notes, and exact simulation numbers never reach player-facing text or prompts — enforced at the query layer, not just the UI. Enforced by a single shared `visibleTo()` gate (`#94`) rather than by hand at each call site, with a structural test that fails if a new route reads a gated model without it.
- **Campaign Memory (RAG)**: real pgvector semantic search over campaign history — cross-entity recall ("what happened between X and Y"), automatic decay/consolidation so a long campaign's memory table stays bounded
- **Knowledge-Relative Character Sheets**: a sheet shows what the *character* knows, not what the database knows — glimpsed abilities render as "???", unlocked ones grow through use with deterministic, arc-capped gains
- **Corruption Track**: per-universe "power at a cost" theme, irreversible marks, engine-enforced bargains (a corruption surge lands even if the AI forgets to narrate it)
- **Lore Import**: paste text, a URL, or crawl an entire MediaWiki wiki — chunked, embedded, retrieved per scene as canon; a canon URL can regenerate the world's structure (factions, systems, archetypes) from that lore
- **Quest & Item Tracking**: quests have a real lifecycle (registered → progress beats → completed/failed/abandoned); inventories aggregate into a browsable wiki registry
- **Safety Tooling**: X-Card with a real scene pause (not a no-op) that now reaches every player's screen the moment it's raised, content reporting, campaign bans, per-player blocking, lines/veils fed into the AI prompt
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

**Re-audited against the code, not against this file (July 2026).** The
previous pass graded some rows from the ledger's own claims, which is how a
score survives the thing it described changing. This pass verified each row
by reading the implementation and its call sites. It cost three 5s — faction
simulation, war, and world-tick orchestration are 4s now — and the reason in
every case was the same: **the specific rule named in the row had no test**,
even where the surrounding module was well covered. It also added five rows
that did not exist, and that omission was the larger problem: a scorecard
listing only simulation depth grades generously by construction. The
narration-adherence, fog-of-war-mechanism, route-coverage and auth rows score
1–2, and they are closer to what a user is exposed to than anything above
them. Six findings became `#93`–`#98`.

| System | Score | Status |
|---|:-:|---|
| Server-rolled dice/outcome engine | 5 | Pure, RNG-injected, unit-tested. The AI never touches the arithmetic, and the roll is unconditional — not gated by any setting. Verified end to end. The score is for the *engine*; whether the narration then obeys it is a separate row below, and it is not a 5. |
| Faction simulation (goals/collapse/succession/territory) | 5 | Goal-driven stat deltas, banded reassessment, collapse → absorption or remnant succession, territory claims. Fixed (`#97`): succession was the one rule in this row with no pure form and no test — `leadershipTick.ts` kept its entire rule inline in the DB handler while every other module here exports a testable `decide*`. Extracting `decideSuccession` found **two real defects**: ties in `importance` were left to Postgres row order, so two equally ranked lieutenants could promote differently on identical data (now broken by name, then id — deterministic like the rest of the engine); and `previousValue: 'MEMBER'` was hardcoded against a **nullable** `factionRole`, so an unranked member entered campaign history having lost a role they never held. Mutation-checked on the tie-break, the honest role, and the never-promote-over-a-player guard.|
| War & coalition system | 4 | Multi-turn momentum/attrition, allies join sides, decisive/stalemate resolution, losing side takes a real stability hit. All four deciders (`decideWarDeclaration`/`Progress`/`Resolution`/`Joiner`) are unit-tested; the handler that actually applies the stability hit is covered only incidentally. Not a 5 until the write path is tested directly. |
| World tick orchestration | 5 | Nine deterministic handlers, genuinely sequenced same-tick dependencies, zero AI calls. Fixed (`#96`): the sequencing is the claim, and it now has a test. `runWorldTick` had zero test references, so the order lived in a 25-line comment and was enforced by nothing — reordering `TICK_HANDLERS` broke the simulation silently and left the suite green. Each of the five documented same-turn dependencies is now a **pairwise** assertion (so adding a tenth handler doesn't fail unrelated tests), alongside the accumulation, `pendingAmbitions` threading, three-way fan-out and the dry-run short-circuit. Mutation-checked: swapping relationships/factions, moving ambitions before wars, dropping a handler, and letting a dry run persist each fail the specifically relevant case. |
| Debt economy | 4 | Directional, persisted, and actually consumed as a roll modifier — not just a label. |
| Faction standing | 4 | Same — feeds `computeMechanics()` directly. |
| Relationships (trust/tension/respect/fear) | 4 | Fixed (`#29`): now feeds `computeMechanics()` via a banded `relationshipModifier`, the same way standing does — no longer write-only. |
| Capability / skill-tree progression | 4 | Glimpse→unlock→progress state machine, feeds roll modifiers directly. |
| Character harm/death state machine | 4 | Full model: auto-conditions, death saves, permanent injury, engine-arbitrated recovery. Recovery now has three speeds and no button: a healer's hands, a narrated stretch of rest graded by shelter, and the passage of in-game time (a day per point). Conditions dealing recurring harm block the latter two, so an open wound doesn't mend. Condition effects are enforced fields, not free text (`#88`). |
| Corruption track | 4 | Theme-gated, irreversible, force-applied backstop even if the AI forgets to narrate it. |
| Consequence engine (player action → faction/NPC state) | 4 | Deterministic per-action deltas, same rigor as faction tick. |
| Character progression (advancement) | 4 | Usage-gated growth with real PbtA constraint validation, not a level-up button. Fixed (`#65`): AI-authored perks/Abilities now carry a real per-arc grant budget, the last permanent reward that was governed by prompt text alone. |
| Memory retrieval (RAG) | 4 | Genuine pgvector cosine search, cost-tracked, well-designed consolidation. Prompt payload is now bounded by field length as well as entity count (`#67`). |
| Memory importance/tag classification | 4 | Fixed (`#28`): field-name mismatch corrected, exported, regression-tested — no longer silently dead. |
| AI response validation | 4 | Improved (`#36`): one bounded repair round-trip is attempted before falling through to the degradation ladder — no longer purely silent. Fixed (`#66`): the background world-turn call is validated too, having previously been a bare `JSON.parse` feeding the same state writer. Below full validation the ladder no longer zeroes `world_updates`: it salvages section by section and element by element **through the real schemas**, so one bad field stops costing a scene every mechanical consequence, and nothing kept is anything full validation would have rejected. Still basic JSON mode, not strict structured outputs (`#35`, open — see Known Bugs / Known Issues). |
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
| Quest identity/gating (does anything react to who gave it, or to FAILED/ABANDONED) | 4 | Fixed (`#45`, `#75`, and now the design half): `givenBy` resolves to a real NPC/faction FK, quests carry a stable `objectiveKey`, corruption gates acquisition — and **FAILED/ABANDONED are no longer inert.** The cost is contextual, where the context is state the engine already owns: who commissioned the job and how it ended. Walking away is a broken commitment, so it costs the giver's **trust** and is the only outcome that moves faction standing; failing honestly costs **respect** and nothing else. Split by which meter moves rather than by magnitude, because standing is a coarse -3..+3 track that should shift for a betrayal and not for a defeat, while trust and respect are separate meters already feeding `relationshipModifier` independently. A quest whose giver never resolved costs nothing at all — charging a best guess would land real consequences on an innocent faction, the failure `resolveQuestGiver`'s ambiguity rule exists to prevent, one system downstream. Not a 5: the party is charged collectively because there is no quest-participant model, and inventing one to make a penalty more precise is a worse trade than charging the group.|
| Downtime completion rewards (gold/items/reputation/contacts) | 4 | Fixed (`#74`): parsed strictly (unparseable entries skipped and logged, never guessed) and applied through the same primitives quest payouts use. The entry-cost/payout asymmetry is closed. |
| Relationships — player-facing visibility | — (decided) | `#91` is **decided: they stay hidden.** Not a gap. The numbers drive a real roll modifier, and that is precisely why a visible meter would be wrong — it turns a relationship into a resource to farm, and players optimise a number they can see. What a character has earned reaches them through the fiction and the receipt's diegetic phrasing ("they trust you", "word travels in your favor"), never as `trust: 62`. Deliberately not the same call as capability proficiency, which is hidden as a number but surfaced as a band: a proficiency band describes the character's own competence, which they would plausibly know, while rapport is someone else's private opinion of them. Recorded in `schema.prisma` beside the column so the decision is where the next reader will be.|
| NPC harm/recovery | 4 | Fixed (`#71`): `harm_healing` gives NPCs a real recovery path through the same `healHarm` PCs use. Deliberately thinner than the PC model (no conditions/death saves) by design, not by omission. |
| World history as a decision input | 5 | Fixed (`#79`, second pass). The first pass gave crisis targeting a read-back so a milestone would not hit the same faction twice; auditing it found that was the **only** deterministic consumer of history in the whole engine — every faction, war and ambition decider was memoryless. The clearest symptom: `factionIdsAtWar` excluded only *active* wars, so the tick after a war resolved the same pair could declare another over the same ground, and the tick after that, forever. Two rivals with standing armies simply fought for the rest of the campaign. `War.resolvedTurn` and `War.outcome` had been recorded since wars existed and nothing read them. Now they gate the next declaration — and the **outcome** is the input, not merely the fact of a past war: the side that was beaten waits about twice as long as the victor, which is the difference between remembering *that* something happened and remembering *what*. Weariness wears off, because a world that could never refight a war would be as memoryless as one that always did. **Goal commitment (`GOAL_COMMITMENT_TURNS`) closes the second half**, and finding it corrected my own claim: I had assumed ambition selection was the gap, and it is not — a failed ambition costs the 20-resource commit plus its own penalty, and re-committing needs 67, so the economy already spaces attempts out. The real artifact was goal *thrash*. Reassessment was a pure function of current bands with no notion of what the faction decided last turn, and the arithmetic made that a permanent cycle rather than an edge case: DESTABILIZE_RIVAL drains 2 resources a turn until it dips under the LOW cutoff, ENRICH earns 4 and lifts it straight back over, which re-qualifies DESTABILIZE_RIVAL — every third turn, forever. The faction abandoned its scheme to go make money, resumed it, and never accumulated enough to do anything. A faction now holds a goal for three turns before circumstances may talk it out of one, read back from the `faction.goal` world events the tick has always written — no new column, and a stability crisis still overrides immediately, because a faction coming apart does not stay the course out of consistency. A simulation test reproduces the original cycle and fails if it returns.|
| Capability tree (branching prerequisites) | 4 | Fixed (`#82`): `parentId`/`children` is a real tree that gates. Generation declares each deeper art's prerequisite; unlocking a node whose parent the character hasn't unlocked downgrades to a glimpse and names what's missing. Not a 5 only because prerequisites are single-parent and the depth is whatever generation produces (typically 3). |
| Corruption as a content gate | 4 | Fixed (`#83`): gates locations on entry, quests on acquisition, and an NPC's roll-modifying goodwill on leverage — three real enforcement points on top of the shadow-capability unlock. Not a 5 because gates are authored by the fiction rather than seeded at world generation, so a campaign only develops them as the narrator establishes them. |
| Cross-system economy (faction wealth ↔ items ↔ downtime ↔ quests) | 4 | Fixed (`#44`, `#47`, `#76`, `#77`): quest payouts are real transfers out of `Faction.resources` (goods included, so a broke patron can't settle in artifacts), `Debt` moves the dice in both directions like `Standing` does, and items carry value + rarity under a per-arc grant budget. Not a 5: there's still no merchant/trading layer, which is a separate product question — value is a property of an item here, not a market. |
| **Outcome-band adherence (does the narration obey the roll?)** | 4 | Fixed (`#93`). The engine rolled, the prompt said BINDING, and nothing checked — the largest gap between what this product claimed and what it enforced. Reading `scene_text` and deciding whether it "reads like a miss" is not available: prose is not classifiable without a second model call, and a check wrong a third of the time is worse than none. So the narrator is **asked** — `outcome_echo` reports which band its prose actually depicts per character, compared against what was rolled. Mismatches log, and feed the AI-consistency metric alongside the validation level, because a response can be perfectly well-formed and still ignore every roll in it. Deliberately observed, never enforced: rewriting prose to match a band is a worse product than a narrator that occasionally drifts, and failing the turn would let a bookkeeping error cost a player their scene. Ambiguous cases (a character with two rolled actions) report as ambiguous rather than guessing — false alarms are how a check earns its way onto the ignore list. Not a 5 until a mismatch is visible to the player in the transparency panel, which needs a schema field.|
| **Fog-of-war enforcement mechanism** | 5 | Fixed (`#94`). Was 23 hand-written `isDiscovered`/`isHidden` clauses across 11 route files with no helper and no test — correct, but resting on every future route author remembering, at the one layer where drift is a leak rather than a wrong number. Now one `visibleTo(model, role)` in a dependency-free `lib/api/visibility.ts`, which also owns the detail a route author should not have to carry: **clocks gate on `isHidden` while everything else gates on `isDiscovered`** — opposite polarity, different column, trivial to copy wrong. An unknown role fails closed. The durable half is a structural test: any route reading a fog-gated model must use the helper, be admin-only, or be exempted **with a reason**, and exemptions are self-policing — an exempt route may only `select: { id: true }`, so the moment one starts returning entity data it fails instead of leaking. Mutation-checked four ways, including a brand-new route that forgets. `#95` added the behavioural half: every gated route is now tested for what it actually returns to each role, so the helper being *reached* and the route *behaving* are both verified.|
| **API route test coverage** | 4 | Fixed (`#95`). Was 6 test files for 93 routes. Two batches, both aimed at risk rather than at the count: the **reads** that carry the fog-of-war claim (every entity list plus the aggregate campaign GET — player restricted, admin not, non-member refused *before* the query, no unrecognised role treated as staff), and the **writes** that spend money, mutate scene state or hand out access. The write tests assert guards rather than happy paths, and specifically that a refusal lands **before** the irreversible thing: a failed billing preflight must not have already called `resolveScene`, since a 402 returned after the LLM ran means the user was refused service and billed for it. Also pinned: force-resolve is the host's alone, invites are admin-only to *list* as well as create (a token is the access), and ending a scene is open to any member — a deliberate product decision that now fails loudly if someone tightens it by accident. Mutation-checked across eight guards. Not a 5: coverage is targeted, not broad — most of the 93 remain untested, and the case for going further is thin next to the untested surface that is left.|
| **Auth / session** | 4 | Fixed (`#98`). Was 30-day JWTs with **no revocation path at all** — a leaked token stayed valid for a month, and changing a password did nothing to sessions someone else already held — plus zero tests on the file every route depends on. `User.tokenVersion` is stamped into each token and checked on every request; bumping it kills every older token at once, and `POST /api/auth/logout-all` is that button. Deliberately **fails open** in two places, both pinned as tests because they look like bugs at a glance: a token minted before versions existed is accepted (rejecting them would sign out the entire userbase on deploy), and an unreadable database is not treated as evidence of revocation (the request needs the DB anyway, so failing closed buys no safety and turns a blip into a mass logout). Revocation is applied at all three request helpers — `getUser`, `verifyAuth` and `requireAuth`, which became async across 25 route files — since an inconsistency between them is a hole. Not a 5: still no refresh-token rotation, and the 30-day life is unchanged.|
| Rate limiting / abuse | 4 | Genuinely good and worth naming: Postgres-backed (`RateLimitCounter`) rather than in-memory, with the reasoning written down — each serverless instance has its own memory, so an in-memory limiter would not actually limit anything. Applied at ~60 route call sites and unit-tested. |
| Admin tooling as simulation design (beyond CRUD) | 2 | Every tab but one is a thin PATCH wrapper; the one genuinely deep feature — the tick dry-run preview — is real but read-only (`#87`). Now also surfaces campaign health (`#57`) and the map-generation toggle (`#9`/`#59`), but both are settings/readouts rather than design tooling. |

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
`lib/ai/worldSummary.ts` + `lib/ai/worldSummaryMappers.ts` (real fog-of-war
and qualitative-stat enforcement, not just formatting — `worldState.ts` is
now a thin re-export barrel over this and three sibling modules, split out
during a prompt-generation refactor) · `lib/ai/scenePrompt.ts` (the actual
system/user prompt text sent to the model) · `lib/ai/validation.ts`
(the correctness gate all mechanical depth passes through) ·
`lib/game/sceneResolver.ts` (the top-level orchestrator) ·
`lib/game/consequences.ts` (player choice → persistent world state).

**Surface area**: none currently identified — the last confirmed instance
(`lib/game/tick/weatherTick.ts` having no mechanical consumer) was fixed;
see Known Bugs / Known Issues and Shipped.

## Known Bugs / Known Issues

Confirmed by direct code inspection, not inferred — a single, deduplicated,
priority-ordered backlog consolidated from every audit pass to date (the
original depth audit, its two re-audits, the two fake-depth passes, and a
further two-part audit — a full domain-by-domain depth re-audit plus a
stricter follow-up pass hunting specifically for places where the product
implies simulation but the code is actually presentation, CRUD, or prompt
formatting).
Where the same defect surfaced more than once, or a later pass added new
evidence to an existing entry, it's merged below rather than repeated.
Historical issue numbers are kept parenthetically for cross-referencing
against git history and the Shipped ledger.

### P0

*None currently open.* Both P0s from the consolidated audit are fixed — see Shipped. No new P0s surfaced in the two most recent audit passes either — everything they found is P1 or lower.

### P1

*None currently open.* All six P1s are fixed — see Shipped.

### P2

*None currently open.* Everything that remained here turned out to need a
design decision rather than a fix — see the section below.

### Needs a product decision, not a bug fix

These were filed as P2 defects, and on working through the rest of the
backlog they don't belong there: each one is a real depth gap, but closing
it means *choosing a game design*, not fixing something that's broken.
Inventing an answer unilaterally would be a worse outcome than leaving the
gap visible, so they're recorded here honestly rather than sitting in a bug
list nobody can action.

**Basic JSON mode, not strict structured outputs (#1, #35)** — unchanged and still correctly blocked: a strict-mode migration needs a live API round-trip to verify the hand-rolled schema actually validates, and getting it wrong means every AI GM call fails in production. `#66` narrowed the blast radius by validating the one path that had no schema at all, but this remains a deploy-environment dependency rather than a code decision.

### P3

**Four parallel "what happened" logging models (#86)** — unchanged, and deliberately left open: `CampaignLog`, `TimelineEvent`, `WorldEvent` and `CampaignMemory` each have a defensible individual reason to exist, and consolidating them is a refactor with real regression risk for no user-visible gain. Worth a design pass before a fifth is added, not a change to make speculatively. `#79` has since given `WorldEvent` **two** deterministic readers (crisis targeting and faction goal commitment), which strengthens the case for it as the canonical structured stream if this is ever revisited.

Re-examined rather than re-asserted, and the decision holds with evidence behind it now: `TimelineEvent` carries fog of war (`visibility`, separate public and GM summaries) and `CampaignLog` has no notion of it; `CampaignLog` carries in-game date, duration and highlights and `TimelineEvent` has none of them; `WorldEvent` is not prose at all but a structured `field`/`previousValue`/`newValue` diff stream; `CampaignMemory` is pgvector-embedded, written by raw SQL and retrieved by cosine similarity rather than queried by turn. One model covering all four would need fog-of-war visibility AND in-game duration AND embeddings AND machine-readable diffs — a union type across four access patterns, which is usually worse than four focused tables.

**The "before a fifth is added" half is now enforced** (`src/__tests__/loggingModels.test.ts`) rather than left as prose nobody would be reminded of. A model pairing a temporal marker with either a prose summary or a structured diff is detected from the schema, and a fifth fails the suite with a message asking for the sentence that distinguishes it — writing that sentence *is* the design pass. The known four are self-pruning, and a separate case fails if fog of war is ever "unified" off the timeline, which is the specific distinction most likely to be eroded by someone merging these two.

- *Evidence:* `prisma/schema.prisma` (all four models).
- *Scope:* maintainability, drift risk.

**Admin panel is CRUD, not simulation-design tooling (#87)**
- *Why it matters:* every admin tab but one is a thin PATCH wrapper — the "Simulation Goal"/"Archetype" controls are bare `<select>` elements over enum values with no preview of tick effect, and the "Map" tab is an unrelated client-computed SVG relationship graph that never touches the real `Map`/`Zone`/`Token` tables used during play (a naming collision, not a data link). The one genuinely deep feature — the tick dry-run preview — is real and deliberately read-only (see above; the apply side was removed on purpose, not left unbuilt).
- *Evidence:* full read of `src/app/campaigns/[id]/admin/page.tsx` (2,511 lines), `world-tick/preview/route.ts`.
- *Scope:* UX, product positioning — worth knowing before describing the admin panel as a "design tool" anywhere external.
- *Suggested fix:* No fix needed if the intent is genuinely "host settings," not "simulation design" — but the copy/positioning should match reality.

**Naming inconsistency in `lib/game/`: kebab-case survivors among camelCase (#99)** — found during a world-simulation refactor pass (`worldTick.ts`/`worldTurn.ts`/`tick/*`, which came back clean of dead code and unused imports — this is what was left over): four files — `world-state-tracker.ts`, `complex-exchange-resolver.ts`, `exchange-manager.ts`, `campaign-health.ts` — use kebab-case while every other file in `lib/game/` (the entire simulation subsystem included, ~25 files) uses camelCase. Purely cosmetic; each file works correctly under either convention, but a new file in this directory has no single pattern to copy.
- *Evidence:* `find src/lib/game -maxdepth 1 -name "*-*.ts"` returns exactly these four.
- *Scope:* maintainability only — no behavior involved.
- *Suggested fix:* rename to camelCase (`worldStateTracker.ts`, etc.) the next time one of these four is touched for its own reasons, updating its importers in the same commit — not worth a standalone rename-only PR against systems outside the simulation refactor's scope.

**`warTick.ts`'s `tickWars` split short of separate files (#100)** — the world-simulation refactor broke `tickWars` (previously one ~300-line function covering three jobs) into three named functions — `resolveWarProgress`, `growWarCoalitions`, `declareNewWars` — in the same file, rather than three separate modules. Deliberate: this is the most heavily mutation-tested file in the simulation (see the War & coalition system row above), and a full-file split touches every import in `warCoalitions.test.ts`/`tick.test.ts` for a stylistic win with no behavior change. Left as an open option for whoever revisits this file next rather than decided unilaterally.
- *Evidence:* `src/lib/game/tick/warTick.ts`.
- *Scope:* maintainability only.
- *Suggested fix:* split into `tick/war/progress.ts`, `tick/war/coalitions.ts`, `tick/war/declaration.ts` if the file grows further; not urgent at its current size.

**Loose `any` typing through the clock/ambition/offscreen-event pipeline (#101)** — `advancedClocks: any[]`, `completedAmbitionClocks: any[]`, and one `(c: any) =>` filter carry through `worldTurn.ts`, `tick/clockTick.ts`, `tick/ambitionResolution.ts`, and `worldTurnOffscreenEvents.ts` (plus one `worldMeta.otherMeta as any` for the untyped GM-notes JSON blob). Pre-existing looseness, preserved as-is by the world-simulation refactor rather than widened into a type-strengthening pass — moving code and changing its types in the same diff would have made "no behavior change" harder to verify honestly.
- *Evidence:* `src/lib/game/worldTurn.ts`, `worldTurnOffscreenEvents.ts`, `tick/ambitionResolution.ts`, `tick/clockTick.ts`.
- *Scope:* type-safety only — every current call site already passes the right shape, so nothing is silently wrong today.
- *Suggested fix:* define a shared interface (fields already implied by usage: `id`, `oldTicks`, `newTicks`, `category`, `sourceFactionId`, etc.) and thread it through the four files instead of `any[]`.

**`callAIGM`'s two fetch calls not routed through the new shared completion helper (#102)** — a later prompt-generation refactor deduped the "build request → `openaiFetch` → pull message content" shape repeated across 7 call sites into `lib/ai/chatCompletion.ts`, and switched all 7 over to it. `client.ts`'s `callAIGM` (the main scene-resolution call, plus its one-shot repair round-trip) deliberately stayed on raw `openaiFetch` calls: both are threaded through circuit-breaker recording, a repair-specific `AICostTracker` instantiation, and response validation closely enough that folding them into the shared helper risked changing that surrounding behavior, not just the fetch shape — a worse trade than leaving one documented exception.
- *Evidence:* `src/lib/ai/client.ts` (two `openaiFetch(` call sites inside `callAIGM`), `src/lib/ai/chatCompletion.ts`'s header comment, which names this exception explicitly.
- *Scope:* maintainability only — the duplication left behind is two call sites, not the original seven.
- *Suggested fix:* only worth revisiting if `callAIGM` itself is next refactored anyway; extracting the repair round-trip as its own step first would make folding both into `callChatCompletion` a smaller, safer follow-up.

**`buildSceneResolutionRequest` stayed one ~340-line function (#103)** — splitting `worldState.ts` moved this function verbatim into `sceneResolutionRequest.ts` rather than decomposing it further. It still interleaves world-summary selection, action-mechanics resolution, complex-exchange/narrative-flow guidance, campaign-memory and lore retrieval (including the named-entity and cross-entity recall passes), and corruption-theme assembly in one function body. Left alone deliberately: every one of those steps is already a thin call into a genuinely separate, out-of-scope system (`memoryRetrieval.ts`, `loreRetrieval.ts`, `lib/game/complex-exchange-resolver.ts`, `lib/game/corruption.ts`) — the function's job is real sequencing and shared local state (`entities`, `relevantMemories`) between those calls, not duplicated logic, so splitting it further is a design call about this file specifically rather than a mechanical extraction.
- *Evidence:* `src/lib/ai/sceneResolutionRequest.ts` (417 lines).
- *Scope:* maintainability only.
- *Suggested fix:* if revisited, split along its existing numbered-comment steps (memory retrieval, lore retrieval, named/cross-entity recall, corruption assembly) into named helper functions the same way `scenePrompt.ts`'s sections were extracted — each step already reads as a self-contained unit with a clear boundary.

**`contextManager.ts`'s naming zoo, and `assessCampaignHealth`'s misplacement, revisited in the prompt-generation subsystem itself (#104)** — noted previously as a `lib/game/` finding (see the naming-inconsistency entry above); the same file is also squarely in scope for prompt generation (it shapes what reaches the AI's context window) and wasn't touched here either. `cap`/`clamp`/`classify`/`assess`/`generate` is a five-verb spread against the `build*`/`generate*`/`describe*`/`summarize*` convention the rest of `lib/ai/` settled into (and `answerGmQuestion` → `generateGmAnswer` was renamed to fit it this pass). `assessCampaignHealth` specifically has zero prompt or AI-call involvement — pure DB counts and thresholds — and is called only by the adjacent `lib/game/campaign-health.ts`, not by anything in `lib/ai/`.
- *Evidence:* `src/lib/ai/contextManager.ts` (474 lines; `capForPrompt`, `clampPromptStrings`, `classifySceneImportance`, `assessCampaignHealth`, `generateCampaignSummary` all in one file).
- *Scope:* maintainability/naming only.
- *Suggested fix:* `assessCampaignHealth` belongs in `lib/game/campaign-health.ts` beside its only caller, not in the AI context-management file; moving it means touching that adjacent file's imports in the same commit, which is why it wasn't done as part of either refactor pass so far.

**Three world-generation callers never track their AI cost (#105)** — `generateWorldFromTemplate` (`worldGenerator.ts`), `generateWorldExtras` (`worldExtras.ts`), and `generateMoveFlavor` (`moveFlavor.ts`) call the model directly and never call `recordAICost`, unlike every other AI-calling function in `lib/ai/` (`callAIGM`, `callAIForWorldTurn`, `generateGmAnswer`, `generateNewSceneIntro`, `summarizeSceneForLog`, `generateMilestoneRecap`). Found while deduping the shared chat-completion boilerplate these three share with the tracked callers; left as-is because adding cost tracking is a new behavior (a new `AICostTracker`/`recordAICost` write per call), not a refactor of existing behavior, and this pass's mandate was to preserve prompt output and call behavior exactly.
- *Evidence:* `src/lib/ai/worldGenerator.ts`, `worldExtras.ts`, `moveFlavor.ts` — zero references to `recordAICost` in any of the three; confirmed no special-casing for `world_generation`/`world_extras`/`move_flavor` request types in `cost-tracker.ts` either.
- *Scope:* cost observability — these are one-time-per-campaign calls (creation, and lore reseed), not per-scene, so the blind spot is bounded, but it's a real gap in the same metered-cost tracking the README's Payments section claims.
- *Suggested fix:* thread the same `recordAICost` call these three are missing through `callChatCompletion`'s callers, using each function's existing `campaignId`/model/timing already in scope — mechanical, but a genuine behavior addition, not something to slip into a "no behavior change" pass.

**`client.ts` is still 949 lines mixing the wire contract with two call orchestrations (#106)** — this pass extracted `buildSystemPrompt`/`buildUserPrompt` into `scenePrompt.ts`, but left `client.ts` holding three still-distinct concerns: the `AIGMResponse`/`AIGMRequest` interfaces (the wire contract shared with `validation.ts`/`schema.ts`/`stateUpdater.ts`), `callAIGM` (circuit breaker, repair round-trip, outcome adherence, cost tracking), and `callAIForWorldTurn` (a second, simpler prompt-and-call path for offscreen events). Deliberately not split further: the type contract is explicitly out of scope for a prompt-generation pass (touching it means touching the adjacent validation/state-update systems that depend on its exact shape), and the two `call*` functions are call-orchestration infrastructure more than prompt text construction.
- *Evidence:* `src/lib/ai/client.ts` (949 lines: `AIGMResponse` ~280 lines, `AIGMRequest` ~175 lines, `callAIGM` ~255 lines, `callAIForWorldTurn` ~185 lines).
- *Scope:* maintainability only.
- *Suggested fix:* if this file is revisited, the wire-contract interfaces are the safest first extraction (a pure type move, zero runtime risk) into something like `aiContracts.ts`; splitting `callAIGM`/`callAIForWorldTurn` apart is lower priority since each is already a single cohesive orchestration, not a mix of unrelated ones.

**`consequences.ts`'s entity lookup still uses the `contains` fallback `entityResolution.ts` was built to replace (#107)** — `findNpcByName`/`findFactionByName` do exact-match-then-`contains` against the campaign's NPCs/Factions, the precise failure mode `entityResolution.ts`'s own header names as the bug it exists to prevent: a `contains` query can cross-match an entity whose name merely contains the search string (its own example is "Bob" landing on "Bobby's Assistant"), and has no tolerance for a trivial AI-side typo the way `resolveEntityByNameOrId`'s confidence-gated fuzzy match does. Not fixed in this pass: `consequences.ts` (`extractAndApplyConsequences`, called from `sceneResolver.ts` for player-choice consequences) is a separate pipeline from `stateUpdater.ts`'s appliers — it runs one live DB query per entity rather than resolving against a roster fetched once per batch, so swapping in `resolveEntityByNameOrId` isn't a mechanical substitution; it means restructuring the function to fetch a roster first, which is a bigger change than "preserve state behavior exactly" allowed this pass.
- *Evidence:* `src/lib/game/consequences.ts` (`findNpcByName`/`findFactionByName`); `src/lib/game/entityResolution.ts`'s header comment, which names this exact failure mode as the reason it exists.
- *Scope:* correctness — a scene whose consequence-extraction step names an entity whose name is a substring of another's could resolve to the wrong one.
- *Suggested fix:* give `consequences.ts` id+name NPC/Faction rosters (it already fetches both, name-only, for `extractConsequences`) and resolve against them via `resolveEntityByNameOrId` before ever falling back to a fresh query.

**`bargainOffers.ts`'s character lookup duplicates a roster already in scope (#108)** — `applyBargainOffers` runs its own `tx.character.findFirst` (by id or case-insensitive name) per offer, even though `stateUpdater.ts`'s transaction already holds a `charactersForResolution` roster fetched once for `npc_changes`/`pc_changes`. Not simply wired together: that roster is only fetched when `npc_changes` or `pc_changes` is non-empty, and an AI response can carry `bargain_offers` with neither — reusing the roster as-is would silently break bargain resolution on exactly that turn. Fixing it means widening the fetch-gating condition in `stateUpdater.ts`'s orchestration, not just this applier.
- *Evidence:* `src/lib/game/worldUpdaters/bargainOffers.ts` (the `tx.character.findFirst` call); `src/lib/game/stateUpdater.ts`'s `charactersForResolution` fetch condition.
- *Scope:* performance/consistency only — this lookup is exact id/case-insensitive-name, not the buggy `contains` match `#107` is about, just a redundant query using a different resolution path than every other applier.
- *Suggested fix:* broaden `charactersForResolution`'s fetch gate to also cover `bargain_offers.length`, thread the roster into `applyBargainOffers`, and resolve via `resolveEntityByNameOrId` the way `npcs.ts`/`factions.ts`/`characters.ts` already do.

**Two independent "what changed" diff systems, no shared code (#109)** — `world-state-tracker.ts`'s `detectWorldStateChanges` snapshots every NPC/Faction/Clock/Character before an AI resolution and diffs the after-state field-by-field for the AITransparencyPanel; `tick/types.ts`'s `WorldChange` (built by `consequences.ts` and the tick's own goal-driven changes, logged via `historyLog.ts`/`wikiSync.ts`) is a separate structured diff stream feeding `CampaignLog`/`TimelineEvent`/`WorldEvent`. Different consumers (a live per-scene transparency panel vs. the persistent history/wiki pipeline) and different cadence, but real conceptual overlap: both exist to answer "what changed, and how do I describe it," computed independently with no shared comparison logic between them. Same shape as the already-documented `#86` (four parallel logging models) — a design question, not a mechanical dedup, and not one "preserve state behavior exactly" is the mandate to resolve.
- *Evidence:* `src/lib/game/world-state-tracker.ts` (`detectWorldStateChanges`); `src/lib/game/tick/types.ts` (`WorldChange`), `src/lib/game/consequences.ts` (`applyNpcConsequence`/`applyFactionConsequence`).
- *Scope:* maintainability, drift risk — a future change to what counts as a "significant" change would need updating in two unconnected places to stay consistent.

**`npcs.ts`/`factions.ts`: a shared applier abstraction considered, not built (#110)** — at a glance these looked like the same resolve-roster → warn-if-ambiguous → update-or-create-stub → track-involved-ids shape `tickPairwiseTies()` was extracted for in the world-simulation refactor (`#4`-era work). Reading both in full, the shared shape is ~15 lines out of 115/160; the rest is genuinely entity-specific — NPC harm/healing/weapon-bonus math with no faction equivalent, faction threat-level mapping and the leader-gated goal write with no NPC equivalent. A generic wrapper would need enough parameters to cover both that it would read as more complex than the two current files, not less, so it wasn't built. Recorded as considered-and-rejected rather than silently skipped, matching `#100`'s precedent for `warTick.ts`.
- *Evidence:* `src/lib/game/worldUpdaters/npcs.ts`, `src/lib/game/worldUpdaters/factions.ts`.
- *Scope:* maintainability only — no behavior involved either way.

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
are folded in below. `#22` (de-jargon), `#23` (surface multiplayer), `#45`/`#75` (structured quest objectives and a real quest-giver FK) `#93` (outcome adherence is measured, not assumed), `#98` (real session revocation), `#94`/`#95` (a real fog-of-war mechanism, its structural test, and behavioural route tests) and `#96`/`#97` (tick-order and succession tests, which restored two 5s honestly) shipped, and `#91` is decided (relationships stay hidden) — see Shipped below. What a FAILED or ABANDONED quest should *cost* is still open; the structure to answer it now exists.

- [ ] **#24 Decide, on purpose, whether dice stay opt-in** — re-run the "mechanics invisible by default" decision against real playtest feedback now that the Debt/standing/harm economy is live.
- [ ] **#25 Scene illustration** — one generated image per resolved scene; async resolution already keeps cost/latency off the request path.
- [ ] **#26 Shareable session recaps** — package a resolved scene or short arc as a social-media-sized card, building on the existing chronicle share link.
- [ ] **#27 Public API / developer access** — the one open item with no existing decision on record; needs a yes/no before monetization pricing tiers lock in.
- [ ] **#46 Platform admin dashboard** — a site-owner-only view listing every user, selectable to see the campaigns they've created (metadata only — title/universe/status/created date/member count/turn count, not full campaign content). There's currently no platform-level admin concept at all in the data model — every existing "admin" check is per-campaign (`CampaignMembership.role`) — so this needs its own gating, decided but not yet built: a `PLATFORM_ADMIN_EMAILS` env var checked server-side, mirroring how `CRON_SECRET` already gates the cron sweep, rather than adding a new schema field. Deliberately scoped to metadata only, not full click-through access into a campaign's actual story/NPCs/factions — that would mean bypassing the per-campaign membership check every other route in the app relies on, a materially bigger and riskier ask than a listing view.

### ✅ Shipped

Full narrative detail for everything below (including specific bug
postmortems) is preserved in this file's git history — this is the condensed
ledger.

### Maintaining this ledger

This section is long, and an entry written six sections ago can be quietly falsified by a later change. That is not hypothetical: the `#60`/`#61`/`#90` entry once claimed a `getWorldStateChanges()` accessor was "restored as a real accessor" while the dead-export sweep below explained why it had been removed. The file contradicted itself, `tsc` was clean, and every test passed. Prose about code is exactly as prone to drift as a duplicated threshold in two files — the same defect this ledger keeps documenting, one layer up.

**`src/__tests__/readmeSymbols.test.ts` enforces the part that can be enforced.** Every backticked camelCase symbol named here must either exist in `src/`/`prisma/`, or be listed in that file's `DELIBERATELY_ABSENT` map with a reason. It catches three things:

- **A renamed or removed symbol still named as current.** This found a second live bug on its first run: the `#69` entry credited `applyPCChanges`, a function that hasn't existed under that name.
- **A removed symbol described as though it still exists** — the original contradiction. Checked per *sentence*, not by proximity, because a nearby "removed" elsewhere in the same dense paragraph would otherwise excuse the one sentence that contradicts it.
- **An allowlisted symbol coming back.** This is what stops the list rotting into a suppression file: it can only ever hold things that are genuinely gone, and it prunes itself when that stops being true.

Comments are stripped before the existence check, so the `// NOTE: there is deliberately no X` comments left behind by removals don't make a dead symbol look alive.

**What it deliberately does not check**, because a regex would do it badly and a noisy check gets switched off: prose claims with no symbol in them, whether a grading number is still deserved, and whether an item in the open checklist above has quietly shipped. That last one is a real recurring failure — `#45` sat open here after shipping — so it's a review rule rather than a test: **when you finish an item, remove it from the open list in the same commit**, following the `#22`/`#23` precedent of noting it as shipped rather than leaving a ticked box.

**P3 cleanup — `#60`, `#61`, `#90`:** the five leftover "GM Notes" labels in the admin edit forms are now "Host Notes", matching the campaign-host reframing shipped everywhere else in that file. The shape extraction behind scene consequences lives in a dependency-free `worldStateChanges.ts`, so importing it into a client component can't drag Prisma into the browser bundle. (This entry originally also restored a `getWorldStateChanges()` accessor beside it; that has since been removed — it never found a caller and never could, since every consumer already holds the Scene. See the dead-export sweep below.) And every confirmed-dead field named in that entry is **wired up rather than dropped** — the first pass deleted three of them, which was the wrong call:

- **`WikiEntry.changelog`** — declared, initialized empty at creation, never appended to, while the wiki page's `changelog.length > 0` display guard could simply never become true. The tick's wiki sync now appends a turn-stamped entry, bounded like every other append-only field here, and it won't record the same no-op twice for one turn. Wiring the render surfaced a real bug beside it: the display read `change.summary` while the writer produces `{ turn, change }`, so every history line would have rendered blank the moment the field started filling.
- **`WikiEntry.relatedEntries`** — now written by wiki sync (an NPC links to their faction and current location, a faction to its discovered territories, all fog-of-war gated) and rendered as a **Connections** block whose links navigate, switching wiki tabs when the target lives on another one and tolerating a target that fog of war hides. Links are stored by *name* rather than row id, because entries are looked up by `(campaignId, entryType, name)` everywhere else and a link may be written before its target entry exists — a name resolves later, a dangling id never does.
- **`WorldMeta.tension`/`phase`** — read only by the export dump, so every campaign sat at the same default forever; the names promised a pacing model and there wasn't one. `lib/game/tick/tension.ts` is that model. Tension is **derived, never reported**: computed each world turn from state the simulation already owns (clocks near firing, live wars, party harm, standing threats), the same way faction drift and weather are — a gauge the narrator could set would just be the narrator's opinion of itself. It has a mechanical consumer, not just a prompt line: at breaking point, GM-authored clocks with no faction driving them close faster. Deliberately 0-or-1, and deliberately only for *unattached* clocks — a faction-driven clock is already paced by that faction's strength, and double-counting it would build the runaway loop (tense → faster clocks → tenser) that a bigger number invites.

**Contested territory is now a real mechanic (`#78`)** — `Location.isContested` was written by the tick (a rival has moved against a place but hasn't taken it yet) and read by nothing mechanical, so territory changing hands had no consequence for anyone standing on it and the whole war/expansion layer was invisible to players except as narration. Added `contestedPenalty`, resolved off the same id-then-name location join weather already uses, and threaded through the roll total, the persisted `DiceRoll.modifier`, and the transparency-panel receipt ("contested ground"). Flat and universal at -1, matching harm/weather rather than introducing a new scale or making per-move judgments about which actions contested ground "should" affect — that judgment from a move name is the keyword guesswork this codebase avoids. Unknown contested state is neutral, never a penalty: a character whose location hasn't resolved isn't silently punished for it.

**Recovery is fiction and time — and the time half didn't exist:**

A product decision, now implemented: harm comes down through in-fiction events and through the passage of in-game time. There is deliberately **no rest action** — no button a player presses to heal.

The fiction half already worked (`harm_healing`, `medical_attention`). The **time half did nothing at all**: a character could carry a broken rib across three in-game weeks and arrive exactly as broken, because the only path down was the narrator explicitly reporting healing. `accrueNaturalRecovery` runs on the same hours that advance the calendar after each scene.

- **A full in-game day per point of harm.** Deliberately slow on a 0-6 track where 4 is Impaired — a serious injury sits several days from healed, so wounds stay meaningful across an arc instead of evaporating between scenes. Fiction remains the fast path, which is the point of having both.
- **Partial hours are carried, not discarded.** Exchanges advance a handful of hours at a time; rounding each one down separately would mean nobody ever heals. The remainder lives in the existing harm-state blob, so no migration.
- **Never touches a character who is Taken Out.** At harm 6 the way back is stabilization and a narrated recovery roll — not the calendar quietly undoing it. Exactly the rule recurring harm follows in the other direction.
- **An open wound doesn't mend.** Anything dealing recurring harm blocks natural recovery, matched on the enforced field rather than by name, so a condition the fiction invents blocks it too. Bleeding now costs harm every scene *and* stops you healing, which is how it should have read all along.
- **Campaign-wide, not scene-scoped** — time passes for the character who sat this scene out too, and scoping it to participants would mean a wound heals faster the more you play.

**Rest is now the third recovery speed, and it comes from the fiction (`rest_quality`):**

`applyRest` was the last recovery function with no caller — written with `poor`/`adequate`/`excellent` bands that read like a player-choice API, in a design that has no player choice in it. Rather than delete it, it's wired the way `medical_attention` already is: **the narrator reports the shelter, the engine decides what it was worth.** Setting `rest_quality` on a `pc_changes` entry is how "they held up at the inn for the night" reaches the sheet — there's still no rest button.

- **Graded by shelter, not by duration.** A bed and a fire heals 2, somewhere dry and quiet heals 1, sleeping rough in shifts heals nothing. Duration is already the calendar's job; grading rest by it too would double-count the same hours.
- **A third speed on purpose.** Slower than a healer's hands (up to 3 at expert with supplies), faster than the calendar (a full day per point). If it matched either it would be an alias rather than a mechanic.
- **Same reason `medical_attention` exists:** the engine picks the number so the AI can't. Left to `harm_healing`, "they slept well" is a free-text integer between 0 and 6.
- **Bleeding blocks it, exactly as it blocks the calendar.** Without that guard, a narrated night's sleep would be the way around the rule the time path enforces — so the conditions are passed in and the same `blocksNaturalRecovery` check runs. Rest still can't touch a character at harm 6, either; that road out is stabilization and a recovery roll.

**Shared notes are live (`triggerNoteUpdate`):**

A realtime pipeline built end to end and connected at *neither* end: `triggerNoteUpdate` had no caller, `'note-update'` had no subscriber, and `RealtimeNoteUpdate` described an event nobody sent. Sharing a note with the table was invisible to everyone else until they happened to reload — in a feature whose entire point is that other people see it. Both halves are now wired: the note write routes publish, and `NotesPanel` subscribes.

- **The visibility check is a security boundary, not a filter.** `campaign-${id}` reaches every member, so a PRIVATE note landing there is a leak. The routes report visibility honestly and let `triggerNoteUpdate` drop it, rather than deciding per call site — one place to be right instead of three.
- **Un-sharing is a retraction, and it has to be announced.** A note going SHARED → PRIVATE (or being deleted) is broadcast under its *old* visibility with `action: 'deleted'` — publish the new one and the guard eats it, leaving the note on every other player's screen indefinitely. Title and content are stripped: the event exists to take the note back, not to deliver it one last time to the people losing access.
- **The client refetches rather than rendering the pushed body.** The GET route is what applies visibility rules; trusting a broadcast payload would put a second, weaker copy of those rules in the browser. The event is only ever a signal that *something* changed.
- **Fire-and-forget.** A note must save whether or not the socket layer is healthy, and an unconfigured Pusher degrades to the old behavior (the panel works, it just isn't live) rather than erroring.

**The harm tracker now reads the harm bands from the engine (`getHarmStatus`):**

`getHarmStatus` is where the 0-6 track's bands, labels and roll penalty are defined — and it had no callers. `HarmTracker.tsx` held three separate copies of the same rule instead: the status label (`>= 6` / `>= 4`, in its own wording — "Healthy" where the engine says "Fine"), the warning banner's visibility (`>= 4`), and the banner's text (a hand-written "-1 to all rolls"). The numbers a player read were only *coincidentally* the numbers being applied to their rolls; move a band in the engine and the sheet would have gone on confidently reporting the old one. All three now come from `getHarmStatus`.

- **The `-999` sentinel is not rendered.** `getHarmStatus` uses it to mean "cannot act" rather than as a modifier, so the component shows the prose description instead — printing it raw would be nonsense on a character sheet.
- **This repo's first component test**, and it needed `@vitejs/plugin-react` in the Vitest config to exist at all: without it Vitest hands raw JSX to the parser and a `.test.tsx` file fails to load, which is why `@testing-library/react` was installed with nothing using it. The load-bearing case asserts the component agrees with `getHarmStatus` at every point on the track, so moving a band in the engine fails a test instead of silently desyncing the UI.

**`Character.conditions` has one parse boundary now — and it was silently eating recovery time:**

`HarmState`, `createDefaultHarmState` and `validateHarmState` described the contents of that column and had no callers, so nothing ever forced the description to meet the data. It didn't: the interface carried `currentHarm` (which lives in its own `Character.harm` column and has never been in the blob) and typed `permanentInjuries` as `string[]` where every writer puts objects. `validateHarmState` would have returned false for **every real row in the database** — harmless only because nothing called it.

Meanwhile the blob was parsed ad hoc at six sites, once per field, each independently responsible for remembering the column is nullable and which fields live in it. That cost something real:

- **Fixed: any harm event wiped a character's accrued recovery time.** The three write sites in the pc_changes applier rebuilt the blob from exactly `{conditions, permanentInjuries, deathSaves}` — so `restHours`, added later for natural recovery, was reset to zero whenever someone took a scratch. Days of mending, gone, with no symptom beyond "healing feels broken." Writes now go out as a complete `HarmState`.
- **`parseHarmState` is the single read boundary**, and it degrades field by field rather than all-or-nothing: a corrupt `deathSaves` costs the death saves, not a character's whole condition list. It also rejects null/undefined *before* coercion, since `Number(null)` is `0` and finite.
- **Parse repairs, validate reports.** Production reads through `parseHarmState`, so it has to be forgiving; `validateHarmState` stays strict and answers whether a repair *was* needed. A test asserts the two agree — anything parse returns, validate accepts.
- **Unknown keys are still dropped, deliberately.** The way a new field stays safe is by being in `HarmState`, not by the blob accumulating whatever anyone happened to write.

**The dead-export sweep, finished — four wired, three removed, and three real bugs behind them:**

Each one was checked for a possible caller before anything was deleted. Three turned out to be things that *could not* have a caller, and wiring them as written would have been actively wrong:

- **`buildFullWorldState`** — removed. It was documented as "used for admin views", and took a `campaignId` and nothing else: no membership check, no role check, and it returned every hidden clock and GM-only timeline event unconditionally. `GET /api/campaigns/[id]` already loads the same set and gates each relation on `membership.role`. This was a fog-of-war bypass waiting for someone to call it.
- **`getWorldStateChanges(sceneId)`** — both real consumers (story page, exporter) already hold the Scene when they need its changes, so a fetch-by-id would only add an N+1. The shape extraction they genuinely share already lives in `worldStateChanges.ts`.
- **`triggerSceneUpdate` / `'scene-update'`** — no publisher, no subscriber, and an orphan of an older naming convention; everything scene-related settled on `scene:verb`.

The other four found real consumers, and finding them turned up bugs:

- **Fixed: the X-Card didn't reach anyone.** `scene:paused` and `scene:resumed` were published by the safety service and bound by **nothing** — hit the X-Card and the scene stopped on the server while every other player's screen carried on. They kept writing into a scene that could no longer accept anything and found out when submission failed. Of everything on that channel this is the event that most needs to land immediately. `scene:ended` had the same problem, less urgently.
- **Fixed: a scene losing every mechanical consequence over one bad field.** Below full validation the ladder zeroed `world_updates` outright — harm dealt, clocks advanced, relationships moved, all gone with a console warning as the only evidence. `extractValidWorldUpdates` was written for exactly that and never called. **It validated nothing**, though: it kept any non-empty array as-is, so wiring it in unchanged would have handed unvalidated objects to the state appliers and bypassed every bound the schemas enforce. Rewritten to salvage *through the real schemas*, section by section and then element by element — one malformed NPC entry costs that entry, not the other four, and nothing kept is anything Level 1 would have rejected.
- **Fixed: "AI consistency" read 100 on a campaign whose model had stopped producing usable output.** A response that fell through to an emergency template still returns successfully, and `success` was all the metric looked at — so it was blind to precisely the failure it exists to measure. `addValidationMetadata` now stamps the degradation level, the cost tracker records it, and the metric gives partial credit. History written before the field existed keeps full credit: a scoring change must not retroactively invent a decline that never happened.
- **`checkCampaignNeedsIntervention` → `needsIntervention`.** Three definitions of "is this campaign in trouble" that agreed in none: `isHealthy` on the monitor, the uncalled async checker, and the admin panel's own colour thresholds invented locally — a GM could read an amber badge on a campaign the engine considered to need intervention. The rule now lives once, in a **dependency-free** `campaignHealthBands.ts`, because the admin panel is a client component and `campaign-health.ts` imports Prisma.
- **`assessCampaignHealth` + `suggestStoppingPoints`** — two *more* dead systems, both about campaign scale, while `calculateHealth` (the only health surface a GM sees) had no notion of size at all. A campaign with 120 scenes and 60 NPCs straining the context window every turn could report a clean bill of health. Merged and deduped, since the two overlapped on the "50+ scenes" advice. Size is advice, not a fault — only a *critical* scale problem becomes an issue, or every long-running campaign would cross the intervention threshold for the crime of lasting.

**The manual world-turn trigger is removed, on purpose:**

`manualWorldTurn` and `getWorldTurnSummary` were exported with no callers anywhere — a host-facing "advance the world now" surface built and never connected. Removed rather than wired up, which is the opposite of the usual call here and the reasoning is worth keeping:

The world already moves on its own, twice over — `runWorldTurnIfDue` when a scene ends, and the daily cron sweep for idle campaigns. Both respect the pacing gate in `tick/pacing.ts`, which exists precisely because world turns used to fire on every player action. `manualWorldTurn` called `runWorldTurn` **directly, bypassing that gate**: a button that overrode a deliberate design decision, spent a metered AI call per press, and had no cooldown. And a world that moves without you is the product — a button that moves it for you undercuts the pitch.

**The admin tick preview (`/api/campaigns/[id]/world-tick/preview`) is intentionally read-only and should stay that way.** It is not a half-built feature missing its apply step; the preview *is* the feature. That's recorded here and in `worldTurn.ts` so the gap isn't "discovered" and re-filled later. If it's ever revisited, it needs a cooldown and an explicit cost warning before it deserves to exist.

**Dead-export sweep — and a correction to what I claimed for `#88`:**

Swept every exported symbol for ones nothing calls anywhere, tests included. 22 came back genuinely dead. The most important finding corrects an earlier claim of mine.

- **`COMMON_CONDITIONS` had zero production consumers.** Nothing instantiated the catalogue, `createConditionFromTemplate` was never called, and `applyHarm` built its one auto-condition inline. So `#88` was **half-landed and I said otherwise**: the enforcement machinery is real, but it only ever fired for conditions the AI authored with the fields explicitly set — the entry specifying Bleeding = 1 harm/scene was true of a table nobody read. `applyConditionTemplate` now fills a reported condition's enforced fields in from the catalogue where the report left them out, with reported values still winning so a deliberately nastier Bleeding survives. Taken Out moved into the catalogue too, since `canAct()` keys off its exact text and two definitions were free to drift. The applier path was untested — mutating it to skip the catalogue left all 45 tests green — so it has tests now, and that mutation fails them.
- **`stabilizeCharacter` had no callers while the death-save branch duplicated it inline.** Routed through the real function. Doing so would have silently regressed — the inline branch cleared "Critically Dying" and the function didn't — caught by reading it rather than assuming, and fixed in the *function*, because being no longer dying is what stabilizing means and leaving that to each caller is how they drifted.
- **The campaign export** now surfaces each scene's world-state changes as a named field rather than leaving them in the untyped `consequences` blob, through the shared reader from `#61`. No extra queries — mapped over rows already fetched.

Also confirmed clean: **no TODO/FIXME/HACK markers anywhere** in `src/`. The dead code here hides behind plausible-looking exports, not abandoned comments — which is why grepping for prose found nothing and structural analysis found plenty.

**The roll orchestrator had no tests, and the receipt trail dead-ended:**

A sweep of every Prisma scalar field for ones the code barely touches turned up `PlayerAction.rollMade`, documented as *"Link to DiceRoll.id if rolled"* and never written — while its two siblings `moveUsed` and `rollRequired` both were. So an action recorded that it *required* a roll, `DiceRoll` rows existed, and nothing connected the two. Now written, which required creating rolls individually rather than via `createMany` (which returns no ids); N is party-sized and the block immediately after already issues one update per action, so it's the same order of work.

Writing that exposed something bigger: **`resolveActionMechanics` had no test coverage at all.** `resolution.test.ts` covers `computeMechanics` and every pure modifier thoroughly and stops at the door of the function that actually runs during play — the one that loads the world, classifies, rolls, and persists every receipt a player can audit. That's precisely how a documented field sat unwritten. It now has tests: per-action roll links, the move/flag stamps, the no-roll and empty cases, fail-open on a classifier outage, and range-band persistence. Mutation-checked — reverting the link, or pointing every action at the same roll, both fail.

Two fields the sweep flagged were checked and deliberately left alone: `WorldEvent.actorId` carries a comment explaining it stays null until per-character attribution exists, and `Scene.framing` is marked "optional alternative, preserved". Documented-and-deliberate is not the same as disconnected.

**P3 batch — conditions and NPC society made real:**

**Condition `mechanicalEffect` text is mostly unenforced flavor (#88)** — **FIXED.** `mechanicalEffect` is free text and `canAct()` was the only thing reading it, via two hardcoded substrings, so Bleeding said *"1 harm per turn"* from the day it was written and nothing ever applied it. Both halves of the suggested fix were taken, each where it belongs:

- **`harmPerScene`** — a structured, enforced counterpart, applied to a scene's participants at scene creation. Bleeding now bleeds. Capped by `RECURRING_HARM_CEILING` so recurring harm can carry someone to Impaired and hold them there but **never to Taken Out**: Taken Out is resolved by a server-side recovery roll during scene resolution — a narrated moment with the death-save path behind it — and there is no such moment in the gap before a scene starts. A condition ticking away must not kill someone while nobody is looking.
- **`statModifiers`** — per-stat effects, for conditions whose text is stat-shaped rather than flat. Enraged's *"+1 to combat rolls, -2 to social rolls"* had **no** enforcement at all, because `rollModifier` can only express one undirected number; it now maps onto `hard`/`hot`, which is exactly what the classifier already picks per action. Unlike `conditionPenalty` this can be positive — a condition with real upside and real downside was previously enforced as neither.
- **Honest text where no mechanic is definable.** Unstable promised *"Roll 1d6 at start of turn: 1-2 = random effect"* — a die this engine never rolled against a table that never existed. Defining one would be inventing game design rather than implementing text already on the sheet, so its description now says what it actually is: a narrative instability the GM plays. The condition itself is untouched and still applies. Cursed and Marked were already honestly narrative.
- **Found while fixing it:** the `conditions_add` writer was dropping `rollModifier` entirely, so *every* AI-authored condition reached the dice as pure flavor no matter what number it reported — despite that field's own schema comment promising "the AI can also set this directly on a custom condition it authors". Exactly the same defect as `#88` itself, one field over: read at one end, never written at the other. All three enforced fields are now persisted.

A test scans every entry in `COMMON_CONDITIONS` and fails if its text quotes a modifier or a damage figure with no field behind it, so the class of defect can't come back. Mutation-checked in both directions rather than assumed.

**NPC social ties reach only two narrow consumers (#89)** — **FIXED.** `socialTies` (ally/rival stance between major NPCs, derived from faction politics) was read in exactly three places: the tick that writes it, one wiki flavor sentence, and joint-scheme clock spawning. It never reached a dice roll or anything a player could feel.

It does now, via the obvious consumer: **rapport propagates through the graph.** If you did right by someone, their allies have heard about it — and so have their rivals. Standing with the world stops being a set of unconnected one-to-one meters and becomes a position in a society that talks to itself.

Two properties keep it honest. It's an **echo, never the thing itself** — capped at ±1 against direct rapport's ±2, so the person actually in front of you always matters more than who they drink with; a reputation that outweighed the relationship would make direct rapport pointless. And it **cuts both ways**: being well in with someone's rival counts against you, which is what makes it a social position rather than a bonus track. Reflection needs a real feeling to reflect (the same 50-point step `relationshipModifier` treats as one full point) — an ally hearing you're mildly well-regarded changes nothing.

Reads only state that already exists (the character's own relationships, the tick's own ties), writes nothing, adds no AI channel, and an NPC with no ties on record contributes exactly zero — so a campaign whose society tick has never run behaves precisely as before.

**One place, one row — and two more fields that were validated then discarded:**

Found by sweeping every AI schema field against the applier that owns it, the same way `#88`'s dropped `rollModifier` turned up. That direction of the pipeline is now clean.

- **`applyLocationChanges` and `resolveOrCreateLocationId` disagreed about what a location IS.** The first used `findUnique` on the `campaignId_name` compound key, which Postgres matches **case-sensitively**; the second matched case-insensitively. So a `location_changes` entry saying "the Docks" after "The Docks" already existed minted a **second row**, and every later lookup went through the case-insensitive path and took whichever came back first. Weather, `isContested`, faction territory and the corruption gates all hang off `Location`, so a split row silently strands the party on one copy while the state they care about lives on the other. Both writers now resolve identity the same way.
- **`LocationChangesSchema.is_new` was declared, prompted for, and never read** — so any unresolvable location name created a row, where the same bare mention of an unknown NPC or faction is correctly skipped. It now carries the guard NPCs and factions already use: `is_new` or a description mints a row, a bare name is logged and skipped. The main path for genuinely new places is untouched, since characters moving somewhere go through `resolveOrCreateLocationId`.
- **The corruption gates (`#83`) were dropped on the location create path** while the update path wrote them, so a location born already gated came out ungated. My own bug from that work, and the same read-at-one-end/never-written-at-the-other shape as `#88`. NPCs and quests were checked and were already correct.

**Product decisions, decided and built:**

Three of the four entries that were parked as "needs a product decision" have been decided and shipped. They were parked honestly — each meant choosing a game design rather than fixing something broken — and each is now built to the call that was made.

- **Corruption is a real content gate (`#83`)** — it gated exactly one thing (shadow-capability unlock) plus a +2 surge and prompt flavor: a complete cost/benefit loop, but a private one. A five-mark character could walk into any temple, take any job, and lean on any ally's goodwill, and nothing outside their sheet reacted. Now `minCorruption`/`maxCorruption` on `Location`, `Quest` and `NPC` gate three real things — entering a place, taking a job, and whether an NPC's rapport still modifies your rolls.

  **The safety rule is the whole design.** Marks are irreversible and capped at one per scene, so a gate evaluated against state a character already *holds* would be a one-way trap: gain a mark and get permanently locked inside a room, or hold an active quest you can never progress. So every gate applies at a **boundary and never retroactively** — locations check on ENTRY (you can be refused a door, never ejected through one you already walked through), quests check on ACQUISITION (an active quest is never revoked and completion is never blocked), and NPCs check on LEVERAGE, which writes nothing at all and therefore reverses itself the moment the gate stops applying. That rule costs nothing in expressiveness, because everything a gate is *for* happens at a boundary anyway. Gates fail open on every uncertainty, are off entirely in a campaign with no corruption theme, and are opt-in per row — so nothing that already exists changes behavior.

- **Quests got structure, not a gating rule (`#45`, `#75`)** — `#75` reads as "quests need a gate", but the gate was never the blocker: a quest could not *reach* anything. "The magistrate remembers you abandoned his job" needs to know **which** magistrate, and `givenBy` was a free-text string that can't be queried back to the NPC standing in front of you. Added `Quest.objectiveKey` (a stable per-campaign handle — quest names are prose and drift as the fiction re-phrases them) and real FKs to the commissioning NPC or faction. An NPC wins over a faction on a tie, because matching "Lady Ashcrown" to the Ashcrown Court would attribute her private errand to her whole institution — and that attribution decides who pays for it. An ambiguous fuzzy match resolves to nothing: not resolving costs flavor, resolving *wrong* lands consequences on an innocent party. `objectiveKey` is only claimed when genuinely free, because it's unique per campaign and these writes run inside the scene-resolution transaction — a collision would abort the batch and take unrelated quest progress with it.

- **Faction wealth reaches players (`#76`, `#77`)** — `Faction.resources` was never dead; ambition thresholds, goal drift, war outcomes and absorption transfer all read it. What it never did was reach a player, so a bankrupt faction could hand out 500 gold and paying it cost them nothing. A payout is now a **transfer**: what a faction pays, it stops having, feeding straight back into the thresholds that already read resources. A faction that can't afford its promise pays what it has and defaults on the rest — partial rather than nothing, because stiffing the party entirely is a beat the narrator should choose while "they scraped together what they could" is what being poor looks like. Cost is assessed across the whole party, rounded up so a payout can never be free through rounding, and capped per payout: `clampGoldDelta`'s ceiling is 100,000, and without a cap one hallucinated grant would zero a faction and cascade into war outcomes. The payer is named explicitly or falls back to the quest's resolved giver faction — never inferred from `standing_changes`, even though a reward that shifts standing is *usually* paid by that faction, because "usually" is the problem. A named faction that doesn't resolve pays in full from nowhere rather than withholding: failing to charge someone is far cheaper than failing to pay the party what the fiction promised.

**The economy, decided and connected (`#44`, `#47`, `#76`, `#77`):**

Four separately-filed entries that were really one gap, and the last of the parked product decisions. The call was to build all of it, so all of it is built.

- **Faction wealth reaches players.** Covered above — payouts are transfers, and a faction that can't afford its promise defaults on part of it.
- **Goods cost the payer too.** An items-only reward used to cost a paying faction *nothing*, which was a real hole in the transfer model: a bankrupt patron could settle every debt in artifacts forever. Item value now counts toward what a faction spends, assessed against the same budget as the gold. Only the gold half can be reduced by a shortfall, though — goods the fiction already handed over can't be un-given, so a faction that overreaches pays in resources rather than by clawing an item back out of a character's pack.
- **`Debt` moves the dice (`#47`).** It was the one Urban Shadows currency with no mechanical weight: standing, relationships and corruption all shift a roll, while "the social currency of this world" reached the prompt as prose and bought nothing. Now an outstanding debt with whoever the action names shifts the roll in *both* directions — a favor owed to you is leverage you can spend, and one you owe is leverage they hold ("you already owe me" is a real answer to a request). Netted, because owing someone who also owes you is a wash rather than two independent pressures, and flattened past the second favor so a pile of small debts can't out-weigh a deep faction standing.
- **Items have worth and scarcity (`#44`).** Inventory had `armorValue`, `damageBonus` and `effect` — everything an item does in a *fight* — and nothing about what it's worth. Added `value` and `rarity`, both with consumers attached rather than as display fields: rarity is budgeted per arc (roughly one legendary, or two rares, or four uncommons, per character per ten turns) on the same guardrail pattern as the perk/move caps, because a narrator asked to reward players will reward them every single scene; value feeds the payout cost above; and a qualitative carried-wealth band reaches the prompt so the narrator knows whether these are people who can buy their way out of trouble.

  The budget is **derived from the inventory** rather than tracked in a counter — items carry their own `grantedTurn` — for the same reason `countGrantsInArc` derives the perk cap: a stored counter is a second source of truth that drifts the moment any path grants or removes an item without updating it. Items with no grant stamp (everything predating this, and anything an admin handed over) count as nothing, since budgeting retroactively against history the engine never metered would refuse rewards for a reason no player could see.

  Deliberately **not** included: prices, merchants, haggling or trading. That's a shopping system, and a different product question from "loot has worth".

**P2 batch — the simulation reads its own history, and two dead pipelines removed:**

- **World history became a real decision input (`#79`)** — every deterministic decision in the engine (faction goals, war momentum, clock advancement, pacing, crisis escalation) was a pure function of *right now*, so the simulation had no way to notice it was repeating itself. `WorldEvent`'s own doc comment describes future systems reading from it; nothing did. The clearest symptom was crisis targeting: the strongest faction stays the strongest, so `pickMostThreateningFaction` handed every milestone crisis to the same faction forever and "the world moves against you" decayed into one organisation menacing the party every twenty scenes. Milestone crises now write a structured `faction.crisis` `WorldEvent`, and the *next* crisis reads the last few back to demote recently-used factions. Deliberately demotion rather than exclusion — with two factions everyone is recent, and escalating the usual suspect is a far better failure mode than a milestone that silently does nothing. A failed history read degrades to the old current-state-only behavior rather than skipping the crisis. Keying off the structured event rather than the `TimelineEvent` prose is the point: a deterministic decision shouldn't parse narration.
- **The abstract zone system is now a real roll modifier (`#2`, `#43`, `#85`)** — `ZoneManager` (close/near/far/distant, plus narrative-advantage and zone-distance math) had *zero* consumers outside its own file: nothing set a character's zone, nothing read one, and the `{ hasAdvantage, description }` it returned was presentation wearing a mechanic's clothes. It was briefly deleted; the concept was worth keeping, so it's rebuilt in `lib/game/zones.ts` as something the dice feel. Three things the original got wrong, each fixed rather than reproduced:
  - **It needed two positions.** It asked for an attacker zone *and* a target zone, but nothing in this engine gives NPCs positions, so the function could never be called with real arguments. A zone is now the acting character's distance from the centre of the action, and the modifier falls out of that alone.
  - **It returned a string.** `rangeModifier` returns a number that lands in the roll total, in the `DiceRoll` receipt's modifier sum, and in the transparency panel beside weather and contested ground. Melee wants to be close and degrades outward; ranged wants a middle band and is penalized both for being crowded *and* for extreme range — the case a naive "closer is better" model gets wrong; an action that isn't reaching for a target is unaffected, which is most actions.
  - **Nothing ever set a position.** The classifier that already reads `capability_key` and `npc_name` off the action text now also reports how the action reaches (`engagement`) and any explicit reposition — both readings of the fiction, with the code deciding what they're worth, the same trust split `capability_key` uses. The resolved band is persisted after each exchange so it carries forward, and `zoneMetadata.sceneId` scopes it to its scene without needing a hook in scene creation: a zone stored under a different scene is stale by definition and resolves back to the default on read. The default band penalizes nothing, so every existing character is unaffected rather than silently taxed.
  
  `#85` asked for one canonical positioning model. It's answered by making each one's job explicit rather than by deleting one: the `Map`/`Zone`/`Token` grid draws battle maps, this prices rolls. They answer different questions and never need to reconcile.
- **Both notification pipelines finished, not removed (`#10`, `#63`, `#64`, `#92`)** — sound published a Pusher event to a service whose audio files don't exist, and push published one with no client listener, while the service worker's correct-looking `push` handler waited on an event that had no way to be produced (no `pushManager.subscribe`, no VAPID, no server-side send). Each burned a message per notification to deliver nothing. These were briefly deleted; that was the wrong call, and both are now wired end-to-end instead:
  - **Web push is real.** `web-push` with VAPID signing, a `PushSubscription` table storing each browser's endpoint and keys, `GET/POST/DELETE /api/notifications/push` for the subscription lifecycle, a client `enablePush()` that does the permission prompt and `pushManager.subscribe()` the old version never had, and live service-worker `push`/`notificationclick` handlers (clicking focuses an existing tab rather than piling up windows). A send that comes back **404/410 prunes that subscription** — the push service saying it's gone is definitive — while a 5xx or timeout deliberately does **not**, since treating a transient outage as "unsubscribe everyone" is how a push implementation quietly destroys its own userbase. Configured via `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (`npx web-push generate-vapid-keys`); with no keys set it degrades to a no-op and the settings toggle hides itself, so a deployment without push is a supported state rather than a broken one.
  - **Sound is real, and needs no binary assets.** Each cue is synthesized with the Web Audio API — a couple of oscillators and a gain envelope, which is all a notification chime is — so the cues are reviewable *data* in `sound-service.ts` rather than unreviewable files, with per-type cues that are deliberately distinguishable by ear (a whisper and a safety alert must not sound alike). It's dispatched client-side off the existing realtime event rather than as a second server message, since the browser is the only thing that can make a noise; that round trip was part of what made the original design pointless. `playSound` is the single seam if real recorded audio is ever wanted.
  - Settings UI and preference columns for both are back, and the push section only renders when the browser supports it *and* the server has keys.


**P2 batch — two fully-built systems that had no callers:**

- **The turn countdown enforced nothing (`#6`, `#52`)** — `checkExpiredTurns` and `sendPeriodicReminders` were both fully implemented with zero callers anywhere, so the deadline the `TurnTracker` UI renders visibly hit zero and did nothing at all. Both are now called from the existing daily cron. Neither changes the queue's advisory-only design, which is the reason this was safe to wire rather than delete: `checkExpiredTurns` is already gated on `autoAdvanceTurn`, which nothing currently sets true, so it's a no-op today and only ever acts on a tracker that has explicitly opted in; reminders just nudge, which is exactly what an advisory queue should do as a deadline approaches.
- **`CampaignHealthMonitor` had no consumer (`#57`)** — 359 lines computing a real score, issue list and recommendations every 5 scenes, persisted to `WorldMeta`, and then only ever `console.warn`'d. Genuine analysis whose entire audience was a server log. Added a member-gated `GET /api/campaigns/[id]/health` that reads what's already stored (deliberately does not recompute, so hitting it costs one indexed read and can't trigger AI usage or shift the every-5-scenes cadence) plus a card in the admin panel. Found while wiring it: `recordHealthCheck` persisted `issues` and `metrics` but silently dropped `recommendations` — the actionable half — so that's now stored too, otherwise the new endpoint would have returned an empty list forever.

**P2 batch — NPC recovery and the duplicate debt channel:**

- **NPC harm was a one-way ratchet (`#71`)** — damage landed on NPCs through the same `applyHarm` PCs use, but nothing anywhere wrote a *lower* NPC harm value, so a wounded-but-living NPC could only ever get worse. PCs get five recovery branches (stabilize, death save, medical attention, heroic sacrifice, permanent injury); NPCs had none. Added `npc_changes.harm_healing`, mirroring the PC field through the same `healHarm`. Deliberately kept thin — no conditions, death saves, or stabilize/capture outcomes — matching how `NPC.harm` is a lighter model than `Character.harm` by design. It nets correctly against damage reported in the same batch, and never revives an NPC already taken out: recovering from a wound is not resurrection.
- **A duplicate, unsynced "debt" channel, now an alias for the real one (`#69`)** — `consequences_add` accepted a freeform `'debt'` type writing to a `Character.consequences.debts` string array, alongside the real `Debt` model. Same concept, two representations, only one carrying direction/counterparty/status or reaching the prompt later as leverage. The type was briefly removed from the schema, and that had a cost worth naming: a narrator that reaches for the consequence channel to report a debt — which they do, it's the obvious place — had the entry rejected at the Zod boundary and the fiction was simply lost. So `'debt'` is back as an **alias**, not a second representation: `debtChangeFromConsequence` translates it and `applyCharacterChanges` hands it to `applyDebtChanges` alongside `debt_changes`, so both routes write the same `Debt` rows. Nothing is ever written to `consequences.debts` again. An entry with no `counterparty_name` is logged and dropped rather than stored — a debt owed to nobody can never be called in, which is the entire point of the model — and direction defaults to `owed_by_character`, since a bare "this became a debt" means the party owes someone and guessing the other way would hand players leverage they never earned.
- **`consequences_remove` struck across all four arrays at once (`#69`, found while fixing the above)** — it filtered promises, debts, enemies *and* long-term threats by substring simultaneously, so resolving "owes Kessler a favor" could silently delete an unrelated promise, enemy and threat that merely shared the wording. Now removes exactly one entry per reported string via a new pure `findConsequenceToRemove`: an exact match wins outright, otherwise the shortest containing entry is taken as the most specific, and a miss is logged rather than silently doing nothing.

**P2 batch — misleading UI, dead schema, and lore reconciliation:**

- **The "Relationships" tab showed something else entirely (`#72`)** — the tab promised relationship data and rendered `Character.consequences` (promises/debts/enemies/threats) instead; the real trust/tension/respect/fear values that drive the roll modifier appear nowhere in the UI. Renamed to **"Ties & Consequences"** (and "Ties" in the snapshot modal) with copy describing what it actually contains, in both components that had the mislabel. Deliberately *not* fixed by surfacing the numbers: the schema comment and the prompt both mark relationships as hidden from players by design, so exposing them — even as qualitative bands, the way capability proficiency already is — is a product decision rather than a bug fix. That decision is tracked below as an open roadmap item instead of being made silently here.
- **A regex-derived NPC disposition badge could contradict the real mechanic (`#73`)** — `NPCRelationshipHints` inferred hostile/friendly by keyword-matching the AI's prose ("glare"/"scowl" → hostile), with no connection to the actual relationship values. A mechanically friendly NPC could render as a hostile badge in the same scene purely because that turn's narration used a hostile-sounding verb. Removed, along with both of its render sites — a decoy signal that can contradict the mechanic is worse than no signal, and it can't be wired to real data without first settling `#72`'s product question.
- **The capability "tree" had no hierarchy — it does now (`#82`)** — `CampaignCapability.parentId`/`children` implied a prerequisite tree with, confirmed, *zero* references anywhere in `src/`: never written, never read. It was briefly dropped; it's now built. World generation (and each hand-authored template) names each deeper art's prerequisite, and `resolvePrerequisiteLinks` turns those names into parent links under two rules — **same domain**, because a cross-domain prerequisite would make one branch silently un-unlockable until an unrelated one was trained, and **strictly lower tier**, which is what makes cycles *structurally* impossible rather than something to detect after the fact. Anything that fails to resolve is dropped, so a bad prerequisite costs the tree one edge and never the campaign its scaffold.
  
  The gate: unlocking a node whose parent the character hasn't UNLOCKED downgrades to a glimpse, the same shape as the shadow/corruption refusal, and the log line names the missing prerequisite so it reaches the narrator through the resolution summary instead of being re-proposed every scene. The bar is UNLOCKED rather than a proficiency threshold on purpose — a numeric bar would stall a branch for two full arcs behind the per-arc growth cap, for a number no player can see. Glimpsing stays ungated: anyone may learn a deeper art exists. Origin seeding follows, so NEWCOMER now means *roots of the tree*, not merely tier 1; a campaign generated before this has every node a root and behaves exactly as before.
- **Canon-lore reconciliation was exact-name-only (`#84`)** — a lore import naming an entity slightly differently from what the world generator invented was treated as unrelated, so a FRESH-mode reseed could retire the existing faction *and* create a near-duplicate under the canon spelling in one pass, orphaning everything linked to the old row. Now reuses `isConfidentFuzzyMatch`, the same tightly-gated matcher AI-reported entity names go through. Writing the test surfaced that this alone was insufficient: that matcher allows an edit distance of 2, which covers typos and punctuation but *not* "The Ashcrown Court" vs "Ashcrown Court" — a 4-character difference, and the single most common shape of this collision. Added leading-article normalization on top, deliberately narrower than loosening the distance budget would be: it can't collapse two genuinely different short names the way a bigger budget could.

**P2 batch — payouts, input bounds, and a stale flaky-test entry:**

- **Downtime completion rewards were generated and never applied (`#74`)** — `generateDynamicOutcomes` asked the AI for gold, items created, contacts made and faction reputation shifts, stored the payload verbatim on `DowntimeActivity.outcomes`, and applied none of it. The code said so outright ("Character experience/gold rewards removed as Character model doesn't have these fields") — true of an older schema, and long since not: `Character.resources` carries gold and contacts, `FactionStanding` is a real table. That note had quietly become a standing excuse for a dead pipe, and the asymmetry is what made it worth fixing rather than deleting: entry costs were always charged for real, so the engine took the fee and didn't pay out. New `lib/downtime/downtimeRewards.ts` parses the AI's loose payload strictly — anything not matching the documented shape is skipped and logged, never guessed at (`"Guild: 2 or maybe 3"` is rejected rather than read as 2) — and applies it through the same primitives quest payouts use (`mergeGrantedItems`, `clampGoldDelta`, `applyStandingChanges`), so both paths move gold/items/standing through identical, already-tested logic. Deliberately does *not* reuse `applyQuestRewardGrant` itself: its recipient resolution matches names with `contains`, the exact pattern removed elsewhere in this engine (`#3`/`#40`), and downtime already knows the one character by id. Items land as plain quantity-1 misc entries with no inferred `armorValue`/`damageBonus`/`effect` — guessing those from a name string would be the keyword heuristic this codebase rejects.
- **Player-text-controlled query amplification in cross-entity recall (`#80`)** — `generateEntityPairs` had no cap, and the entity list feeding it comes from substring-matching player-written action text against known entity names. Pairing is combinatorial, so a player could name-drop a dozen known NPCs in one action and turn a single scene resolution into ~66 parallel vector queries purely by typing. Capped at `MAX_ENTITY_PAIRS`; the cap widens its considered prefix one entity at a time, so it exhausts pairs among the most relevant few rather than taking an arbitrary slice of the full pair list. `capForPrompt` (`#37`) never covered this path.
- **Free-text AI fields had no length constraint (`#81`)** — equipment/inventory values, appearance/personality text, faction `current_plan`/`gm_notes_append`, NPC description/notes, location and quest text were all bare `z.string()` applied verbatim to durable state and then read back into the prompt. Added `SHORT_TEXT`/`MEDIUM_TEXT`/`LONG_TEXT` ceilings across the schema, set generously enough that a rejection means the response was pathological rather than merely wordy. Complements `#67`: that bounds what reaches the prompt, this bounds what reaches the DB in the first place.
- **The "5 chronically flaky tests" entry (`#48`) was stale** — the named tests (`sceneResolver.test.ts` ×3, `safety-service.test.ts` ×2) pass, and passed on five consecutive isolated runs of just those two files plus every full-suite run across this work. Whatever the mock-wiring timeouts were, they no longer reproduce; the entry is closed as no-longer-applicable rather than fixed. If they resurface, the right move is to capture an actual failing run before re-opening it.

**All six P1s from the two most recent audit passes, fixed:**

- **Permanent perk/ability grants had no code-side rate limit (`#65`)** — the only thing keeping AI-authored perks/Abilities rare was prompt text, and id-based dedup only stops the *same* perk being re-granted, not a stream of different ones. Every other lasting AI-reported effect already had a deterministic ceiling (stat growth once per arc per stat, capability proficiency via `MAX_GROWTH_PER_ARC`, corruption +1/scene, standing ±1/scene); these two didn't. Added `MAX_PERKS_PER_ARC`/`MAX_MOVES_PER_ARC` (1 each per `ARC_LENGTH_TURNS`), counted from the advancement log's existing `turnNumber` stamps — no new schema. Budgets are independent per kind; a legacy entry with no `turnNumber` is deliberately not counted against a character. Found alongside: the caller logged every *proposed* perk/move rather than the ones that actually landed, so a deduped re-report still wrote a "gained" entry and inflated `totalPerksGained` — and would have poisoned the new budget, which counts log entries. `applyOrganicGrowth` now returns granted/skipped lists explicitly.
- **The background world-turn AI call had zero output validation (`#66`)** — `callAIForWorldTurn` returned a bare `JSON.parse(content)`; its TypeScript return type was a compile-time fiction. That response feeds the same `applyWorldUpdates` writer scene resolution uses, so a malformed `npc_changes`/`faction_changes` entry reached the DB with none of the main contract's bounds. `#36`'s repair round-trip only ever covered `callAIGM`. Added `WorldTurnResponseSchema`, built by reusing the exact per-entity schemas the main path uses so the two can't drift. Degrades in two tiers rather than crashing: a failed parse keeps `offscreen_events`/`gm_notes` (pure narrative) while *dropping* `world_updates`/`ambition_picks` rather than passing them through unvalidated — the narrative tier reconstructs its payload explicitly instead of spreading the raw object, which is what guarantees that.
- **Unbounded append-only text growth (`#46`, `#70`)** — `NPC.gmNotes`, `Faction.gmNotes`, `Location.gmNotes`, `Quest.progressLog` and a character's `appearance`/`personality` all grew by plain concatenation with no ceiling, and are read straight back into the prompt, so an old campaign paid for its whole history on every call. New `lib/game/textAppend.ts`: `appendBounded` for separator-delimited entry fields, `appendBoundedProse` for the continuous prose ones (appearance/personality are space-joined, so the entry-based helper would have split them on words). Both keep the newest content and mark what they drop with a marker that never stacks. Deliberately drop-oldest rather than an AI-summarized rollup like `memoryConsolidation`'s era summaries — these fields are consulted for *current* state, so their oldest entries are the least relevant part, and a rollup would mean an extra AI call per entity per trim. Also caps `AdvancementLog.entries` at 50 in the three log writers; newest-kept is load-bearing there, since `countGrantsInArc` reads that same array for `#65`'s budget.
- **Prompt size was bounded by entity count, not payload (`#67`)** — `capForPrompt` (`#37`) caps *how many* entities reach the prompt and says nothing about how large each is, and none of the long free-text fields are length-bounded in the schema. So "15 NPCs" was a real ceiling on count and no ceiling at all on tokens. There is also no pre-send token budget anywhere: `estimateTokenCount` is only used for cost logging, after the request has gone out. Added `clampPromptStrings` alongside `capForPrompt`, applied to the assembled summary object rather than per-field at each mapping site — there are two near-identical builders and a dozen-plus long-text fields between them, so a per-field approach is something a future field can silently be added without. Only `worldSummary` is clamped; `entities` stays untouched because it feeds memory-retrieval entity matching, where a truncated name would silently change which memories get recalled.
- **`applyWorldUpdates` had no real test coverage (`#68`)** — the function that turns every AI-authored `world_updates` field into durable state had no dedicated tests, and the one file that imported it (`sceneResolver.test.ts`) mocked it away wholesale, so its real logic was exercised nowhere. The per-domain appliers are already covered individually, so they're mocked here on purpose; what's under test is the orchestrator's own behavior — conditional roster fetching (including the character roster shared by `npc_changes`/`pc_changes` being fetched exactly once), delegation and field routing, `sceneOrigin` threading through every applier that gates discovery on it, the offscreen/empty gates on bargain offers, the corruption-theme memoization shared across two appliers (including caching a `null` theme), involved-id propagation, error wrapping, and the invariant that `organic_advancement` is *not* applied here. Verified non-vacuous: four source mutations — dropping the `sceneOrigin` gate, breaking the memoization, making roster fetching unconditional, and swallowing applier errors — were each caught by the specific tests that should catch them, and by no others.
- **Map generation had no off switch and no cleanup path (`#9`, `#59`)** — a second AI call plus a fresh batch of zone/token writes on every qualifying scene, with a `Map`+`Zone`+`Token` set accumulating per distinct location forever. Added `Campaign.mapGenerationEnabled`, default **false** including for existing campaigns: a table that wants maps enables them once from the admin panel, which is a cheaper mistake than silently billing every campaign for something unused. Added `MapService.pruneOldMaps` (keeps the newest `MAX_MAPS_PER_CAMPAIGN`, never touches the active map, zones/tokens cascade). Implementing it surfaced a flaw in the first cut: the settings lookup sat *outside* the "map generation is non-critical" try/catch, so a failed lookup would have taken down an otherwise-successful scene resolution — the whole step is now inside it.

**Both P0s from the consolidated audit, fixed:**
- **AI response cache cross-tenant leak (`#8`, `#58`, `#62`)** — rather than re-key a cache whose entire premise (coarse-bucket matching two "similar" requests to the same cached narrative) turns out to be unsafe for any per-scene resolution call — even correctly scoped by `campaignId`+`sceneId`, a scene resolved across multiple exchanges would still replay an earlier exchange's cached text for the same scene — the cache was removed from `callAIGM`'s live call path entirely. `lib/ai/response-cache.ts` (the `AIResponseCache` class, its dead `sceneContext`/`PATTERN_TEMPLATES`/`matchPattern` code included) is deleted; `client.ts` no longer imports or consults it, and the now-meaningless `skipCache` option was removed from `callAIGM`'s signature. Every AI GM call is a real, uncached call.
- **Entity resolution via `contains`-mode name matching (`#3`, `#40`)** — replaced across all 5 sites in `stateUpdater.ts` (clocks, NPCs, the NPC-harm attacker lookup, player characters, factions) with a new `lib/game/entityResolution.ts`: exact id → exact name (case/whitespace-insensitive) → a single, tightly-gated fuzzy match (Levenshtein distance ≤2 *and* ≤20% of name length — enough to catch a genuine AI typo, never enough to conflate two different short names). A `contains` match's two failure modes are both gone: it could cross-match an unrelated entity whose name merely contained the search string ("Bob" matching "Bobby's Assistant"), and it could fail on a trivial typo and silently spawn a duplicate stub instead. Multiple equally-plausible fuzzy candidates now resolve to a logged "ambiguous, skipping" rather than a guess — the system never picks a side when it's genuinely unsure which entity is meant. Each entity type's full campaign roster is fetched once per batch and resolved in memory rather than one `contains` query per change; newly-created stubs are added to that in-memory roster so a later change in the same batch referencing the same new name doesn't spawn a second stub.

**`stateUpdater.ts` decomposed into per-domain appliers, each unit-tested (`#4`, `#41`)** — the 1,439-line monolith (zero direct tests, verified only indirectly through route tests) is now a ~450-line orchestrator in `lib/game/stateUpdater.ts` plus 8 domain appliers under `lib/game/worldUpdaters/`: `timelineEvents.ts`, `clocks.ts`, `npcs.ts`, `characters.ts` (the largest — harm/conditions/relationships/consequences/appearance/personality/equipment/inventory/resources, kept as one function since harm state genuinely threads through several sequential sub-steps, but now directly tested rather than split further), `factions.ts`, `locations.ts`, `quests.ts`, `bargainOffers.ts`, and `worldMetaNotes.ts` — matching the same `db: Prisma.TransactionClient`-parameter pattern `debts.ts`/`standing.ts`/`questRewards.ts` already used. Every applier is independently unit-tested against a mocked transaction client (80 new tests total), covering behavior that had never been directly exercised before: armor-mitigated harm damage, the Taken-Out recovery roll, death saves, heroic sacrifice, corruption marks, consumable heal-on-use, relationship/consequence deltas, and delegation to the debt/standing/capability writers. No behavior changed — this is a straight extraction, verified line-for-line against the original and confirmed against the full existing test suite (same pass/fail baseline, only the 5 pre-existing flakes).

**`Location` gets a real nullable FK alongside the free-text string (`#42`)** — `Character.locationId` / `NPC.locationId` sit next to the existing `currentLocation` string, which stays the field the AI/creation forms write directly. Every write path that sets `currentLocation` now also resolves/creates the matching `Location` row and links `locationId` through a new shared `resolveOrCreateLocationId` (`lib/game/worldUpdaters/locations.ts`, case/whitespace-insensitive match before falling back to create — a strict improvement over the exact-string upsert the old auto-register pass did, with no behavior change for any caller that already matched exactly): the AI write-back's `pc_changes.location` handling (folded the old separate "auto-register locations from movement" pass directly into `characters.ts`, since it needs the same id anyway), the world tick's NPC day/night commute (`npcTick.ts`), and character/NPC creation and admin-edit routes. The two consumers the bug named as actually decoupled by string drift were migrated to prefer the stable id: `resolution.ts`'s weather-modifier lookup (`weatherByLocationId`, falling back to the old name-string match only for a character whose `locationId` hasn't resolved yet) and `story/page.tsx`'s split-party location grouping (groups by `locationId` when resolved, falling back to the trimmed string, while still displaying the human-readable name). `worldState.ts`'s NPC-relevance filter was deliberately left alone — it turned out to already be a substring match against free-text NPC `description`/`gmNotes`, not a Location-table join at all, so an FK doesn't fix it, and changing that heuristic is a separate, riskier call about what the AI prompt should include.
  - **Deploy note (at the time):** the build command then ran `prisma db push`, not `prisma migrate deploy` (see the migration-strategy change below) — `db push` applies the schema change (the new columns/FK/indexes) straight from `schema.prisma`, but never executes anything in `prisma/migrations/`, so the one-time backfill that links *existing* rows to their matching `Location` didn't run automatically. `scripts/backfill-location-ids.sql` has the same backfill as a standalone script, run once by hand (`psql "$DATABASE_URL" -f scripts/backfill-location-ids.sql`) after this deployed. Wasn't required before traffic resumed: every consumer already fell back to the old string match for a row that hadn't backfilled yet, and a row self-populates the next time that character/NPC moves regardless.

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

**Map generation ran on every single action, and accumulated stale zones/tokens forever** — `AIVisualService.generateMapFromScene` fired once per exchange resolution unconditionally, same over-eager trigger point the Story Log duplicate bug had — burning an AI call and a batch of zone/token writes every time any single action resolved, not just when a scene actually started. Separately, when the AI classified a new scene as reusing the same location (`shouldReuseMap`), the map's name/description got updated but its zones and tokens were never cleared first — `generateZones`/`generateTokens` only ever `create`, never replace — so a location revisited across several scenes just kept accumulating duplicate/stale markers from every prior visit. Fixed both: map generation now only runs on a scene's first exchange (`isFirstSceneExchange`, pure and exported, gated the same way the Story Log fix works — `existingResolutions.length === 0`), and reusing a map now calls a new `MapService.clearMapContents` (deletes the map's zones/tokens via `deleteMany`) before regenerating them. New unit tests cover the first-exchange gate directly rather than through the full `resolveScene` integration path — that path already has known pre-existing timeout flakiness in this test file unrelated to this change (confirmed by reverting and reproducing the identical 3 failures independently), so the gate condition is tested as the small pure function it actually is.

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
