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
- **Living world simulation** — a deterministic "world tick," zero AI calls,
  advances NPCs, factions, weather, and territory once real in-game time has
  passed, independent of whether players are present. Factions pursue
  goals, contest and conquer territory, and sustained conflicts escalate
  into multi-turn wars that can grow into coalitions. A player character can
  lead a faction outright — set its strategic goal in-fiction and watch it
  keep ticking autonomously between sessions.
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
  answers.

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

- API route test coverage is targeted, not broad — 101 routes, 22
  dedicated test files, aimed at fog-of-war reads and money/state/
  access-mutating writes (bans, member role changes, campaign deletion,
  account deletion, the character anti-cheat field allowlist, Stripe
  checkout, stuck-scene recovery, campaign-scoped user blocking). Most of
  the surface remains untested.
- Admin tooling was mostly thin CRUD; the faction and NPC tabs now extend
  the tick dry-run preview's "show your reasoning" pattern (a per-entity
  `/reasoning` route backed by the same pure decide/explain functions the
  real tick uses). Locations and clocks are still plain CRUD, and there's
  no standalone war tab — war reasoning surfaces through whichever faction
  is fighting it.
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
| Server-rolled dice/outcome engine | 5 | Pure, RNG-injected, unit-tested (`computeMechanics`, `resolveActionMechanics`, `src/lib/game/resolution.ts`). The roll is unconditional, not gated by any setting. |
| Faction simulation (goals/collapse/succession/territory) | 5 | Goal-driven stat deltas (`decideFactionTick`), banded reassessment (`decideFactionGoalReassessment`, now also overridable by a drifted `beliefVector` — see the Cultural drift row), collapse (`decideFactionCollapse`) → absorption or remnant succession, territory claims. `decideSuccession` is a standalone, tested, pure function with deterministic tie-breaking (`compareCandidates`); its `successionRoughness` output scales both the absorption transfer rate and the successor's inheritance rate (`ABSORPTION_TRANSFER_RATE`/`SUCCESSOR_INHERITANCE_RATE` in `factionTick.ts`) instead of using them as flat constants — a collapse that barely tipped over the threshold hands off more cleanly than one that cratered to zero stability. |
| War & coalition system | 4 | Multi-turn momentum/attrition, allies join sides, decisive/stalemate resolution. The pure deciders (`decideWarDeclaration`, `decideWarProgress`, `decideWarResolution`, `decideWarJoiner`) and the tick-side functions that apply them (`declareNewWars`, `resolveWarProgress`, `growWarCoalitions`) are all unit-tested, including the losing side's stability hit, now directly tested rather than only incidentally covered. |
| World tick orchestration | 5 | 18 deterministic handlers (`runWorldTick`/`TICK_HANDLERS`), sequenced same-tick dependencies, zero AI calls, all inside one `prisma.$transaction` — a failed turn rolls back cleanly instead of committing partial state. Handler *order* is asserted by a pairwise test (`orchestration.test.ts`), not just per-handler correctness — the suite has already caught a silent handler reorder once. |
| Debt economy | 4 | Directional, persisted, and consumed as a real roll modifier (`debtModifier`), not a label. |
| Faction standing | 4 | Same pattern — feeds `computeMechanics()` directly. |
| Relationships (trust/tension/respect/fear) | 4 | Feeds `computeMechanics()` via a banded `relationshipModifier`. Deliberately never rendered to players as raw numbers. |
| Capability / skill-tree progression | 4 | Glimpse → unlock → progress state machine, real branching prerequisites (`resolvePrerequisiteLinks`, enforced via `applyCapabilityChanges`/`prerequisiteUnlockBlocked`), cycle-proof by construction, feeds roll modifiers directly. |
| Character harm/death state machine | 4 | Full model: auto-conditions (`applyHarm`), death saves (`makeDeathSave`), permanent injury (`performRecoveryRoll`), a `canAct()` gate, one parse boundary for the harm blob (`parseHarmState`). Three recovery speeds — medical attention (`applyMedicalAttention`), in-game time (`accrueNaturalRecovery`), and rest (`applyRest`) — all blocked by recurring-harm conditions (`blocksNaturalRecovery`). |
| Corruption track | 4 | Irreversible, capped at +1/scene (`applyCorruptionMarks`), force-applied even if the AI forgets to narrate it. |
| Consequence engine (player action → faction/NPC state) | 4 | Deterministic per-action deltas (`extractAndApplyConsequences`/`applyConsequences`). Entity lookup now goes through the same roster-based `resolveEntityByNameOrId` every other AI write-back applier uses (fetched once per batch, not once per name) — see Known Bugs, now fixed. |
| Character progression (advancement) | 4 | Usage-gated growth with real PbtA constraint validation. AI-authored perks/Abilities carry a real per-arc grant budget (`countGrantsInArc`, applied in `applyOrganicGrowth`), not a level-up button. |
| Memory retrieval (RAG) | 4 | Genuine pgvector cosine search, cost-tracked, with era-based consolidation bounding table growth. |
| Memory importance/tag classification | 4 | The historical field-name mismatch is fixed and regression-tested; `determineImportance`/`extractTags` read the AI response's real field names. |
| AI response validation | 4 | One bounded repair round-trip (`validateAIResponseWithRepair`), then a degradation ladder (`extractValidWorldUpdates`) that salvages `world_updates` through the real schemas section-by-section and element-by-element rather than zeroing the whole thing. The background world-turn call is validated too (`callAIForWorldTurn` → `validateWorldTurnResponse`), not a bare parse. Basic JSON mode, not strict structured outputs — a deliberate decision (2026-08-02) to keep this contract rather than switch. |
| Clock advancement (non-ambition clocks) | 4 | Deterministic, faction/relation-driven pacing (`decideClockAdvancement`), not a random coin flip. |
| Quest lifecycle | 4 | A structured reward grant is applied deterministically the first time a quest completes. FAILED/ABANDONED are not inert — walking away costs trust and standing, failing honestly costs respect (`applyQuestFailureCost`). An unresolved quest-giver (`resolveQuestGiver` returning unresolved, guarded by `hasQuestGiver`) costs nothing rather than guessing. |
| Combat / complex exchange resolution | 4 | Conflicting actions on the same target are ranked by actual roll outcome (`rankActionsByOutcome`/`compareActionsByOutcome`, surfaced via `detectConflicts`), not left to an AI punt. No dedicated combat subsystem beyond PbtA resolution — by design. |
| Inventory / items | 4 | Structured `armorValue`/`damageBonus`/`effect`, with `'heal'` enforced deterministically (`resolveConsumableHeal`); `value`/`rarity` under a per-arc budget. NPCs have a lighter mirrored harm model (`healHarm`). Still JSON-blob CRUD, not a relational Item table; no merchant/trading layer by design. |
| Downtime activities | 4 | A deterministic, risk-weighted outcome category (`decideDowntimeDayEvent`) is rolled before the AI narrates, replacing a random coin flip. Completion rewards are genuinely applied (`applyDowntimeRewards`), not generated and discarded. |
| NPC goal/movement simulation | 4 | Goal progress is phase-weighted (acting fastest, observing/resting slowest) rather than a flat rate. |
| Weather | 4 | A deterministic `weatherPenalty` (-1) shifts rolls in severe non-benign conditions at the acting character's location — a real mechanical consumer, not just narration input. |
| DB `Move` table | 5 | The 7 fixed basic moves stay the mechanical source of truth; each campaign gets AI-generated flavor text looked up at roll time by a stable key, with a safe fallback to generic text if generation fails. |
| `TurnOrder` model | — (removed) | Confirmed: zero references anywhere in the schema or code. |
| Multi-scene / split-party handling | 4 | Character context (`scopeCharactersToParticipants`) is scoped to a scene's real participants, enforced server-side on action submission, not just hidden client-side. |
| Quest identity/gating | 4 | `givenBy` resolves to a real NPC/faction FK; quests carry a stable `objectiveKey`; corruption gates acquisition; FAILED/ABANDONED carry real, contextual costs. Not a 5: the whole party is charged collectively since there's no quest-participant model. |
| Downtime completion rewards | 4 | Parsed strictly (unparseable entries skipped and logged, never guessed) and applied through the same primitives quest payouts use — the entry-cost/payout asymmetry is closed. |
| Relationships — player-facing visibility | — (decided) | Decided: they stay hidden. A relationship a player could see is a number they'd optimize instead of a private opinion someone has earned. Recorded beside the schema column. |
| NPC harm/recovery | 4 | NPCs have a real, if deliberately thinner, recovery path through the same `healHarm` PCs use — no conditions or death saves, by design. |
| World history as a decision input | 5 | Crisis targeting (`pickMostThreateningFaction`) and faction goal-commitment both read back structured `WorldEvent` history to avoid repeat-targeting and goal-thrash. War declarations are gated by recent war outcomes (`factionIdsAtWar`), with the losing side waiting roughly twice as long as the victor. |
| Capability tree (branching prerequisites) | 4 | A real tree gates unlocks: same-domain, strictly-lower-tier links (`resolvePrerequisiteLinks`) make cycles structurally impossible, not just detected. Not a 5 — prerequisites are single-parent and depth is whatever generation produces. |
| Corruption as a content gate | 4 | Gates location entry, quest acquisition, and NPC leverage (`checkCorruptionGate`) — three real enforcement points at boundaries, never retroactive. Not a 5 — gates are authored by the fiction, not seeded at world generation. |
| Cross-system economy (faction wealth ↔ items ↔ downtime ↔ quests) | 4 | Quest/downtime payouts are real transfers out of a faction's resources (`assessPayout`); a broke faction pays partially and defaults on the rest. Debt moves the dice in both directions. Any AI-reported gold change is bounds-checked (`clampGoldDelta`) and granted items merge through one shared path (`mergeGrantedItems`). Items carry value/rarity under a budget. No merchant/trading layer — a separate product question, not a gap. |
| Outcome-band adherence (does the narration obey the roll?) | 5 | The narrator self-reports which band its prose depicts (`outcome_echo`); mismatches are logged (`checkOutcomeAdherence`), feed a consistency metric, and are now persisted per-exchange and surfaced in the transparency panel (`AITransparencyPanel`) that already shows dice receipts. Deliberately still only observed, never enforced — rewriting prose to match a roll would be a worse product than an occasional, visible drift. |
| Fog-of-war enforcement mechanism | 5 | One shared `visibleTo(model, role)` gate, correctly handling the polarity difference (clocks gate on hidden state, everything else on discovered state). An unknown role fails closed. A structural test fails if a new route bypasses the gate without an explicit, restricted exemption. |
| API route test coverage | 4 | 101 routes, 36 dedicated test files. Targeted at risk — every fog-of-war-gated read, and writes that spend money, mutate scene state, or hand out access. #93 extended the set outward past the original ~9 files to cover the highest-blast-radius previously-untested mutations: campaign bans, member removal/role changes (including the "last admin" guard on both paths), campaign PATCH/DELETE, account deletion, the character `PLAYER_EDITABLE_FIELDS` anti-cheat allowlist, Stripe checkout session creation, stuck-scene admin recovery, and campaign-scoped user blocking. #134 further extended it to individual NPC/faction/location PATCH/DELETE, friend-request accept/reject, and the turn-order route (GET/POST/DELETE, including the host-only skip-turn gate and the best-effort Pusher broadcast). #135 covered the auth/session/password family: login (no-enumeration + OAuth-only-account guard), logout-all (session revocation + rate limiting), the request/reset password-reset pair (no-enumeration, expired-token, best-effort email send), email verification's redirect-not-error-page degradation, and changing your own password while authenticated. Not a 5 — still targeted, not exhaustive; ~60 lower-risk routes (health checks, admin reads, tutorial/lore/wiki CRUD, internal cron/job endpoints) remain untested. |
| Auth / session | 4 | Real revocation: `requireAuth`/`verifyAuth`/`getUser` all check `isTokenRevoked`, and a token-version bump (`revokeAllSessions`, stamped by `createToken`) invalidates every existing session at once. Deliberately fails open for pre-revocation tokens and for an unreadable database, both to avoid a mass logout from a blip. Not a 5 — no refresh-token rotation, still 30-day JWTs. |
| Rate limiting / abuse | 4 | Postgres-backed (`checkRateLimit`, correct for serverless, where in-memory wouldn't actually limit anything), applied at 17 route call sites, unit-tested. |
| Admin tooling as simulation design (beyond CRUD) | 3 | Faction and NPC tabs now show real reasoning, not just fields: a faction card's "Why?" button previews its next goal reassessment (`explainFactionGoalReassessment`) plus any active war's momentum trajectory (`explainWarMomentum`) — new pure functions the real tick's `decideFactionGoalReassessment`/`decideWarProgress`/`decideWarResolution` now delegate to or share, run read-only via new per-entity `/reasoning` API routes. An NPC card's "Why?" preview surfaces its real next-tick decision (`decideNpcTick`) directly. Not higher than a 3 — `handleUpdateLocation`/`handleTickClock` are still thin PATCH wrappers, and there's no standalone war tab at all (war reasoning is folded into the faction fighting it, since no war admin surface exists to extend). |
| Integrity Engine — structural/semantic data repair | 4 | Deterministic, per-tick checks (`runIntegrityPass`) detect and repair broken references, duplicate names, and (for one registered universe-scoped semantic family, `faction.leaderOptional`) AI-generated verdicts gated by confidence and a probation window (`isRuleActive`). Every repair is blast-radius-capped (`MAX_REPAIRS_PER_PASS`/`MAX_REPAIRS_PER_ENTITY`) and idempotent by construction; verified live against real Postgres, not just mocked. Not a 5 — only one semantic family exists, and Phase 4's planned oscillation-based rule retirement was never built (no repair-enabling family exists yet for it to fire against). |
| Autonomous code-fix pipeline (`integrity-autofix.yml`) | 2 | Fully autonomous by design — no human review tier at all, every oracle tier (including `suite-only`) merges itself. Since nothing else catches a bad merge first, the pipeline watches its own history instead: `regressionDetection.ts` reverts a merged fix automatically if its checkKey escalates again, `verifyOracleTechnique.ts` mechanically forbids a diff from registering a *weaker* oracle for its own checkKey than it had before (an agent can strengthen its own bar — see the growth step in the prompt — but never lower it), and scope is closed in advance (`escalationSourceMap.ts`) rather than judged per fix. The shell-injection vulnerability and the stale-escalation replay an earlier audit found are both fixed. Not higher than a 2 — it has still never run against a real bug (ships `workflow_dispatch`-only), and the revert mechanism's own correctness is unproven outside unit tests until that first real run happens. |
| Institutional memory (wake ripples on death/collapse) | 4 | A major NPC's death or a faction's collapse leaves a real, decaying mark: `decideWakeStabilityPenalty` hits the affected faction's stability immediately (leader deaths and collapse ripples weighted higher than an ordinary member loss), then `decideWakeDecayStep` restores it gradually over a fixed window rather than snapping back — `tickWake`'s own three-phase ordering (decay existing wakes, then detect new NPC deaths, then new faction collapses) exists specifically so a wake created this same tick is never also decayed the same tick it was born. Feeds `Faction.stability`, a real roll input, not a cosmetic log line. Not a 5 — only stability is affected; no mechanical consumer reads *how many* wakes a faction is currently carrying. |
| Cultural drift, belief evolution & multi-stage ambitions | 4 | `Faction.beliefVector` (`aggression`/`isolationism`/`mercantilism`/`zealotry`, 0-100) drifts from the faction's own recent history (`decideBeliefDrift` reading `WAR_WON`/`WAR_LOST`/`COLLAPSE_RIPPLE_SURVIVED`/`AMBITION_SUCCEEDED`/`AMBITION_FAILED` events) and can override the stat-band-driven goal reassessment once an axis drifts far enough past neutral (see the Faction simulation row). A completed ambition can also spawn a continuation clock (`decideAgendaContinuation`, capped at `MAX_AGENDA_STAGES`) instead of just resolving cleanly, so a faction's trajectory compounds across multiple stages rather than resetting to nothing. Not a 5 — belief axes are a fixed, closed set, not something new fiction can add to. |
| Resource infrastructure & logistics | 3 | A location with `resourceSlots` only pays out to its owning faction while at least one `SupplyRoute` touching it is unblockaded (`decideExtraction`); an ESCALATING war over a contested location automatically blockades routes through it and lifts the blockade the same turn the war resolves. Routes are flat/arbitrary rows (`SupplyRoute.fromLocationId`/`toLocationId`), not yet validated against real spatial adjacency — a deliberate, decided-in-advance scope, not an oversight. Not higher than a 3 until routes are generated from (or checked against) `WorldGraph` adjacency. |
| WorldGraph (location adjacency) | 3 | A real, if flat, adjacency graph (`LocationAdjacency`, undirected, distance-weighted) backs `directNeighborsOf`/`shortestPath`/`nearestLocation` (`worldGraph.ts`), and two real consumers already use it instead of a blind pick: `decideTerritoryClaim`'s candidate selection and `decideNpcTick`'s "work" location both prefer a genuine graph neighbor of "home" when adjacency data covers it, falling back to their exact pre-adjacency behavior (alphabetical-first / hash-rotation) otherwise. AI-authored backfill (`worldGraphGenerator.ts`) infers a plausible graph from existing lore for campaigns with none. Not a 4 — shortest-path uses simple O(V²) node selection, fine at the real scale (tens of locations) but not built for more. |
| Environmental state & location aging | 3 | `Location.conditionScore` (0-100, DB-range-checked) drifts from war/contested-territory presence (`decideConditionDrift`) and derives a closed condition-tag vocabulary on read (`deriveConditionTags`: `RUINED`/`DAMAGED`/`STABLE`/`PROSPEROUS`/`CONTESTED`/`ABANDONED`) rather than a free-form label. Feeds migration's own distress signal directly (see the next row). Not a 4 — nothing yet gates quest/roll access on condition the way corruption or fog-of-war do. |
| Migration & population flows | 3 | `decideMigration` moves NPCs out of locations whose `conditionScore` has crossed a distress threshold toward the nearest condition-viable destination, plus a background population-flight fraction for the location's own `population` count — reads this same turn's post-commute NPC positions, not last turn's, so an NPC that already fled isn't double-counted. Not a 4 — population is currently a single number with no per-NPC identity tracked once it moves in the aggregate. |
| Economic contagion & cascading collapse | 3 | A real faction-to-faction `FactionDebt` (directional, distinct from the Character-centric `Debt` model): a broke or newly-active ally can be extended a loan (`decideLoanExtension`, reusing `factionPayout.ts`'s existing capacity math as the lender's affordability check), and a debtor that collapses or stays broke defaults, cascading a real stability hit to the creditor through the same wake mechanism deaths use (`decideDefaultCascade`, tagged `sourceType: 'FACTION_DEFAULT'`). Not a 4 — at most one outstanding debt per debtor pair is tracked at a time, and origination is loan-only (no other path currently creates faction-to-faction debt). |
| Signed push / contested value model (Arc) | 4 | `War.momentum`'s existing tug-of-war math (military edge + deterministic per-tick variance, clamped, resolved decisively past a threshold or by timeout) is now a real, shared, reusable primitive (`decideArcDelta`/`applyArcDelta`/`decideArcResolution` in `arc.ts`), proven genuinely reusable rather than a one-off: `decideWarProgress`/`decideWarResolution` (`warTick.ts`) delegate to it directly (verified byte-identical against the full pre-existing war test suite), and a second, independent consumer — contested territory loyalty (`tickTerritoryLoyalty`) — pushes a location's ownership between its owner and on-record rival each turn, resolving to cement the hold, flip the location outright, or settle as a stalemate, instead of sitting `isContested` forever unless a war was separately declared over it. Not a 5 — only two consumers exist, and `War.momentum`'s own column deliberately stays untouched (see `Arc`'s schema comment for why). |
| Seasonal pressure + calendar mechanics | 3 | The in-fiction calendar (`Campaign.calendarConfig`, previously display-only) now drives two closed mechanical knobs (`SEASON_MODIFIERS` in `seasonTick.ts`, decided 2026-08-02 as the fixed set): faction resource regen (autumn boosts, winter slows) and unattached-GM-clock speed (passed into `decideClockAdvancement` as a multiplier, since clock advancement runs outside `TICK_HANDLERS`). `calendarGenerator.ts`'s old "mechanics never come from here" doc comment is updated to match, not left silently stale. Not a 4 — exactly two knobs by design; no other system reads season yet. |
| Multi-model fallback chain | 4 | `callAIGM` (`client.ts`) tries `AI_MODELS.FLAGSHIP` first and falls back to `AI_MODELS.EFFICIENT` exactly once — either on a hard failure of the primary attempt, or up front when the campaign's circuit breaker is already open (skipping a call already known to be failing) — never chained further, so a fallback failure surfaces to the caller the same way a primary failure without a fallback chain always did. Not a 5 — the chain is fixed at two OpenAI tiers, no second vendor. |
| Token-budget message pruning | 3 | A real token-budget pass (`applyTokenBudget`, `tokenBudget.ts`) sits on top of the existing fixed entity-count caps and per-string character clamps — not a replacement for them — trimming whole prompt *sections* in a decided priority order (world-summary macro detail first, recent-scene text second, character sheets protected longest and only trimmed down to the scene's actual participants) until the assembled request is back under a configured ceiling. Not a 4 — the token estimate is the same rough ~4-chars-per-token heuristic used for cost logging, not a real tokenizer count. |
| Outcome-band → narration routing | 4 | The scene prompt's tone/pacing instructions are now derived from the actual worst roll outcome this exchange landed on (`selectPrimaryOutcomeBand` feeding `buildOutcomeBandSection` in `scenePrompt.ts`) rather than left for the model to infer from context alone — a mechanical signal routed into narration guidance, not a new AI judgment call. Not a 5 — only the single worst band across all rolled actions this exchange is used, not a per-character breakdown. |
| Campaign lobby "World Chronicle" | 3 | The lobby overview tab's old stat-tile grid (`WorldSummaryPanel`, bare labeled counts) is replaced by a few sentences of generated in-world prose (`generateChronicleNarration`, `AI_MODELS.EFFICIENT`) synthesizing weather/faction posture/active conflicts/recent happenings — the design principle behind it: "a dashboard shows you data, a chronicle tells you a story about the same data." Regenerated once per world turn (`WorldMeta.chronicleNarration`/`chronicleNarrationTurn`) inside `runWorldTurn`, never live per page view. Fog-of-war-safe: undiscovered factions/wars are filtered out of the input (`chronicleContext.ts`) before the prompt is ever built. Also adds a one-shot generated campaign hero banner image (`generateCampaignHeroImage`, reusing #96's OpenAI image-gen call shape but not its job-queue machinery — a one-time cosmetic generation doesn't need retry/recovery). Not a 4 — same as #96, the real OpenAI/Vercel Blob calls are only unit-tested with mocks in this sandbox; needs a real credential check before relying on it in production (see Known Bugs/Priority List). |

## Known Bugs

Confirmed and reproducible, verified against the current code — not
speculation, not stale carryover.

Severity follows Critical > Major > Minor. Critical is reserved for
findings with a real exploit path, not just a functional gap.

| Bug | Subsystem | Severity | Status |
|---|---|---|---|
| `.github/workflows/integrity-autofix.yml`'s PR-body heredoc (`` `$(cat <<EOF ... EOF)` ``) used an unquoted delimiter, so bash performed command/variable substitution on its contents — including the `evidence` output, built from violation `entityName`/`description` text that ultimately traces back to AI-generated or player-influenced NPC/faction names — before `gh pr create` ever saw it. Fixed: PR bodies are now built with `echo`/`printf '%s'` into a file and passed via `--body-file`, which never re-parses a variable's runtime value as shell source. | Integrity Engine / CI | Critical | Fixed |
| The auto-fix pipeline's dedup check only looked for an *open* PR per checkKey. A closed/rejected PR had no cooldown, so an unfixable escalation could reopen a PR (and bill a new agent run) on every scheduled invocation, forever. Superseded by a stronger design, not just a cooldown: the pipeline no longer has a "closed without merging" case to worry about at all — every oracle tier now merges itself (see the Scorecard), and a merge that turns out wrong is caught by `regressionDetection.ts` and reverted automatically instead. | Integrity Engine / CI | Major | Fixed |
| `escalationAggregation.ts` aggregated every `IntegrityReport` in a campaign's 14-day `integrityReportHistory`, not just the most recent one. An already-merged fix's original escalation could still be reported as actionable from an older, pre-fix report still inside the lookback window. Fixed: only the latest report per campaign is read now; live-verified against real Postgres. | Integrity Engine | Major | Fixed |
| checkKeys were bare string literals duplicated across `checkRegistry.ts`, `escalationSourceMap.ts`, `oracleTechnique.ts`, and `LINT_GUARD_FILE_FOR`, with no shared enum/const tying them together — a rename in one place could desync the others silently. Fixed: `game/integrity/checkKeys.ts` now exports a real `CheckKey` union, consumed by all the downstream registries; verified directly against current code. | Integrity Engine | Minor | Fixed |
| Two competing Pusher server modules (`src/lib/pusher.ts` vs. `src/lib/realtime/pusher-server.ts`) used to read different env var names, with an ungated server-side singleton that could hang a request in an unconfigured deploy. Fixed: `src/lib/pusher.ts` is now genuinely client-only (its own header comment documents the removal); every server-side trigger goes through `lib/realtime/pusher-server.ts`'s `getPusherServer()`, which returns `null` instead of attempting a network call when unconfigured. Verified directly against current code. | Real-time / API routes | Major | Fixed |
| `campaigns/[id]/health` is a fully built, correctly gated route; the admin panel's `health` state is declared and rendered. Fixed: `fetchData` now calls `/api/campaigns/[id]/health` and `setHealth`, so the panel actually renders. | Admin tooling | Minor | Fixed |
| `consequences.ts`'s entity lookup used `findFirst({equals}) ?? findFirst({contains})` — two real bugs, not one: two un-awaited promises combined with `??` always evaluate to the first one, since a Promise object is never nullish, so the `contains` fallback was dead code the whole time, and had it run, `contains` is exactly the unsafe match that can cross-match an entity whose name is a substring of another's (e.g. "Bob" matching "Bobby's Assistant"). Fixed: now resolves via the same roster-based `resolveEntityByNameOrId` (exact → confidence-gated fuzzy match, ambiguous → skip) every other AI write-back applier already uses, fetched once per batch. | Consequence engine | Minor | Fixed |
| The identical "not a member of this campaign" check returns 403 at ~37 call sites but 404 at 2 (`members/[userId]/route.ts`, `.../ban/route.ts`), with different wording. Fixed: both now return 403 with matching wording. | API routes | Minor | Fixed |
| Four `substring`/`slice` truncation call sites append `'...'` unconditionally, regardless of whether the text actually exceeds the length limit, producing a spurious ellipsis on short strings. Fixed: all four (`sceneResolver.ts`, `sceneIntro.ts`, `story/page.tsx`, `NotesPanel.tsx`) now route through `truncateWithEllipsis`, which only appends the ellipsis when the text is actually cut. | UI / shared utilities | Minor | Fixed |
| `formatDigestLine`'s leadership-change case checked `field === 'leader' \| 'leadership'`, but the real leadership-succession tick writes `field: 'factionRole'` — every real leadership-change notification silently fell through to the generic "there's talk of upheaval" line instead of the intended, more specific one. Found live via a production database check. Fixed: `factionRole` now maps to the same specific line. | Notifications / world tick | Minor | Fixed |
| `kickJob` (`resolutionQueue.ts`) only treated a *thrown* fetch error as a lost delivery. A response that arrives before the 3s delivery-timeout abort fires is necessarily fast — the real resolution pipeline takes ~150s+ — so a non-OK status there (403 from a misconfigured/rotated `INTERNAL_JOB_SECRET`) meant the job was silently never handed to `processResolutionJob` at all: its `attempts` counter never increments, so it would loop through stale-job recovery forever instead of ever reaching `MAX_ATTEMPTS`. Fixed: a non-OK response now falls back to inline processing, same as a thrown error already did. | Async scene resolution | Major | Fixed |
| `processResolutionJob`'s read-back of the job row it had just claimed (`PENDING`→`RUNNING`) had no error handling. A transient DB failure there left the claimed row stuck `RUNNING`, with no recorded error, for a full `RUNNING_STALE_MS` (6 minutes) before recovery even noticed. Fixed: a read-back failure now reverts the stranded claim to `PENDING` immediately. | Async scene resolution | Minor | Fixed |

## Priority List

Ordered by what most closes the gap between current state and the vision
above. Items that block later ones are flagged.

1. **Fire `integrity-autofix.yml` once, manually, against a real, deliberately
   seeded bug** before ever enabling its `schedule` trigger. The pipeline's
   individual pieces (aggregation, dedup, regression detection, oracle
   verification) are all unit-tested; the agent step and the revert path
   have never executed even once. This is the single highest-leverage item
   on this list — everything else about the pipeline is design confidence,
   not proven confidence, until this happens.
2. **Keep broadening API route test coverage.** #93, #134, and #135 have
   now covered every route this list ever named specifically (see the
   Scorecard row); ~60 routes remain untested — health checks, admin
   reads, tutorial/lore/wiki CRUD, and internal cron/job endpoints, none
   individually high-stakes enough yet to name out ahead of the rest.

*(The Pusher module split, `consequences.ts`'s entity-matching bug, giving
checkKeys a shared type, the war stability-hit write path's missing direct
test coverage, making outcome-band adherence visible to players, the
strict-structured-outputs and dice-opt-in-only decisions, extending the
tick dry-run preview's reasoning pattern to the faction/NPC tabs, checking
whether `computeTension` should weight Environmental aging/Economic
Contagion, and the individual NPC/faction/location PATCH/DELETE +
friend-request + turn-order test-coverage gap — that used to be items 2,
6, 7, 4, 3, 2, 5, 3, 3, and part of 2 here — are all resolved (the
admin-tooling and API-route-coverage items only partially — see their
Scorecard rows for exactly what's still missing; the `computeTension` item
resolved to a decided "no," recorded in `tension.ts` itself — see #122).
See Known Bugs and the Scorecard's War & coalition system, Admin tooling,
and API route test coverage rows.)*

## Features & Roadmap

### Planned but not started

No code exists yet for any of these.

- **Shareable session recaps** — package a resolved scene or short arc as a
  social-media-sized card. Builds on the existing chronicle share link
  (which is real and shipped); the card-generation feature itself has no
  code yet.
- **Platform admin dashboard** — a site-owner-only, metadata-only listing
  of users and the campaigns they've created. The design is decided
  (an env-var-gated allowlist, mirroring the existing cron-secret pattern,
  rather than a new schema field) but nothing is built; there is currently
  no platform-level admin concept in the data model at all.
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
  a creator marketplace/UGC, VTT-style grid combat, 5e-style crunch/custom
  rule import, and public API/developer access (decided against for now,
  2026-08-02 — blocks monetization tiering until real demand justifies
  revisiting it). Explicit calls to prioritize deeper world-simulation
  work first — worth revisiting only if real cohort feedback contradicts
  that call.

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
  constraint) was exercised end-to-end against `camp_uitest`. **Not
  verified**: this sandbox has no `OPENAI_API_KEY` or
  `BLOB_READ_WRITE_TOKEN`, so the actual image-generation call and Blob
  upload have only ever been unit-tested with mocks, never run for real —
  confirm both work against a real account before enabling the toggle in
  production. `gpt-image-1`'s flat per-image cost also needs re-verifying
  against OpenAI's live pricing page (`cost-tracker.ts`'s `AI_PRICING`
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
  `FAILED` gracefully with no API key). **Not verified**: same gap as
  scene illustration above — no real `OPENAI_API_KEY`/
  `BLOB_READ_WRITE_TOKEN` in this sandbox, so the actual narration/image
  API calls have only ever been unit-tested with mocks.
- **Admin tooling as simulation design** — the faction and NPC tabs now
  extend "let the host see why the simulation decided something" past the
  tick dry-run preview via new per-entity `/reasoning` routes. Locations
  and clocks are still thin CRUD, and there's no standalone war tab
  (war reasoning rides along with the faction fighting it) — extending
  further is the remaining work.
- **API route test coverage** — targeted coverage exists for the
  highest-risk reads and writes; #93 broadened it to cover the
  highest-blast-radius previously-untested mutations, #134 covered
  individual NPC/faction/location PATCH/DELETE, friend-request accept/
  reject, and the turn-order route, and #135 covered the auth/session/
  password family (see the Scorecard) — but ~60 lower-risk routes remain
  untested — ongoing, not finished.

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
