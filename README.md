# MythOS

*The world remembers.*

An AI-powered collaborative storytelling platform for running interactive narrative campaigns with an AI Game Master and a persistent, living world that keeps simulating itself even when nobody's looking.

## Features

- **AI Game Master**: Powered by OpenAI for dynamic story generation and scene resolution
- **Living World Simulation**: NPCs and factions pursue their own goals every turn, on and off screen — territory changes hands, wars break out (and can grow into multi-faction coalitions), factions rise and collapse — see [World Simulation](#world-simulation) below and the full [Living World Roadmap](#living-world-roadmap)
- **Player-Faction Integration**: a player character can lead a faction outright — set its strategic goal in-fiction, watch it keep ticking autonomously between sessions
- **Fog of War**: the AI only narrates what's actually been discovered in play — hidden factions/NPCs/locations, GM-only notes, and exact simulation numbers never leak into player-facing text, even though the simulation itself always sees everything
- **Campaign Memory System**: Long-form continuity using RAG (Retrieval-Augmented Generation) with vector embeddings, so the AI can recall specific past events and consequences instead of improvising them fresh — including cross-entity queries ("what happened between X and Y") and automatic decay/consolidation of old low-importance memories so a long campaign's memory table stays bounded
- **Admin Tooling**: a campaign-management panel with a faction relationship/territory map, a tick-log viewer with the reasoning behind every simulated change, and a dry-run "preview next tick" mode
- **Real-time Collaboration**: Live updates using Pusher for chat, notifications, and scene updates
- **Server-Rolled Move Resolution**: every risky player action is classified to a PbtA basic move and rolled 2d6+modifiers *on the server* before the AI narrates — the outcome band (strong hit / weak hit / miss) is a binding constraint on the narration, so results are decided by dice, not vibes. Modifiers blend PbtA stats with capability skill bands (Urban Shadows-style: what you've learned matters) and the harm Impaired rule. Mechanics stay out of the prose by design; per-roll receipts (move, dice, modifiers, band) are persisted and viewable in the opt-in transparency panel
- **PbtA-inspired Mechanics**: Powered by the Apocalypse game system integration, including a full harm/death-save system
- **Character Management**: Detailed character sheets with stats, moves, conditions, and progression
- **Knowledge-Relative Character Sheets**: the sheet shows what the *character* knows, not what the database knows — an outsider to the universe starts nearly blank and their sheet fills in organically as the story reveals systems (glimpsed abilities render as "???" hints, unlocked ones grow through use and downtime training with deterministic, arc-capped gains). Origin familiarity (native / newcomer / outsider) seeds what a new character already knows exists, and the AI narrator is knowledge-gated per character: it never explains systems a character hasn't encountered
- **Scene Management**: Dynamic scenes with player actions and AI resolution
- **Payment System**: Stripe integration for AI usage billing, with per-call cost tracking, balance gating, and per-user rate limiting on every AI-invoking route
- **Input Moderation**: player free-text is screened (OpenAI moderation endpoint) before it ever reaches the completion model — provider-ToS protection, separate from the in-fiction X-Card safety tool

## World Simulation

MythOS runs a deterministic "world tick" after every player action — a pure,
AI-free simulation step that decides what changes in the background (NPC
movement and goal progress, faction resource/stability/military drift,
weather) and writes every change to a durable event log. Only *narrating*
those changes into prose is delegated to the AI, via a separate offscreen
event generation pass; the underlying simulation state never depends on the
AI being available or consistent.

On top of that tick, factions can autonomously commit to major ambitions —
tournaments, trade wars, coups, heists, crusades — once their resources and
goals justify it. The tick decides **whether** a faction commits to
something big; an offscreen AI call decides **what**, chosen from a bounded,
archetype-specific option list (a guild throws a trade fair, a secret
society runs a black-market venture, a political faction stages a coup) so
the result stays flavorful without the AI going off-script. If the AI call
fails, a deterministic fallback name is used instead, so an ambition never
silently disappears.

Every offscreen event and consequence is embedded into the campaign's RAG
memory, so a player can ask "who won the tournament?" turns or sessions
later and get a real, previously-generated answer instead of the AI
inventing one on the spot.

Territory is real state, not flavor text: factions can contest and conquer
each other's land, and sustained conflicts escalate into full **wars** —
multi-turn, attrition-driven, momentum-tracked — that can grow into
multi-faction **coalitions** as allies join a side. A player character can
lead a faction outright, setting its strategic goal in-fiction while the
rest of the simulation (stat drift, ambitions, wars, collapse/succession)
keeps running underneath them exactly like an NPC-led faction would.

None of this is narrated to players ahead of what they've actually
discovered: hidden factions/NPCs/locations, GM-only notes, and the
simulation's exact internal numbers (resources, military, momentum, ...)
never reach the AI's player-facing prompt — the AI narrates from the same
qualitative impressions a character in the world would have, while the
tick itself always operates on real numbers underneath.

Set a faction's **Simulation Goal** and **Archetype** from the campaign
admin panel (Factions tab) to opt it into this system. The admin panel also
has a Map tab (faction relationships and territory), a Debug tab (why the
tick made a given decision, plus a dry-run preview of the next tick), and a
Simulation Caps section for tuning how many factions/NPCs the tick
considers per campaign.

## Living World Roadmap

The long-term goal is a world that simulates itself autonomously — factions,
NPCs, and territory that tick forward on their own agendas whether or not
players are present — and remembers everything that happens well enough to
answer for it later, the way a human GM running a Crusader Kings-style
campaign would. This list tracks that effort phase by phase, in the order it
was actually built. **All 8 phases below are complete and live in
production**, including every item that was deferred out of an earlier
phase's initial scope — check the phase notes for what's still explicitly
out of scope going forward (mostly: true point-in-time tick *replay*, as
opposed to the dry-run preview of the *next* tick that does exist).

### Phase 1 — Deterministic World Tick ✅
- [x] Single AI-free tick runs after every player action (NPCs, factions, weather)
- [x] Every change is written to a durable event log (`world_events`), independent of whether it's narrated
- [x] Significant changes are logged to campaign history and synced to the Wiki
- [x] NPCs move on independently-varying schedules and make deterministic progress toward their stated goal

### Phase 2 — Autonomous Faction Ambitions ✅
- [x] Factions with an outward-looking goal (EXPAND/ENRICH) autonomously commit to a major ambition once resourced enough
- [x] Ambition *flavor* (tournament, coup, black-market venture, ...) is chosen by an offscreen AI call from a bounded, faction-archetype-specific list, with a deterministic fallback if the AI is unavailable
- [x] Ambition outcomes get embedded into RAG memory so they're recallable indefinitely, not just for the next few turns
- [x] Major NPCs get new goals automatically when their current one completes, instead of going idle

### Phase 3 — Faction Feedback & Evolution ✅
The biggest gap identified: ambitions and goals didn't actually respond to what happens. Winning a tournament used to be a nice sentence with zero mechanical effect — fixed below.
- [x] Ambition outcomes apply real stat deltas (resources/stability/military/threatLevel) on completion, not flavor text only — deterministic success/fail, weighted by whichever stat the goal leans on (military for EXPAND, resources for ENRICH), never guaranteed
- [x] Attempting an ambition costs resources, instead of only being gated by a resource threshold
- [x] Automatic goal reassessment each tick, based on current stats — the admin-panel manual goal setting still works as a seed/override, but the simulation will steer it back toward whatever the faction's circumstances justify
- [x] Faction-to-faction relationship state (rival / ally) that the tick actually reads and writes — replaces the `Faction.relationships` field, which used to be dead (write-only, used only by campaign export). Two factions chasing the same goal (both EXPAND or both ENRICH) become rivals; two stable, inward-looking factions become allies. This is also what makes `DESTABILIZE_RIVAL` reachable automatically — a faction only picks it once it actually has a rival on record. `AT_WAR` was intentionally left out: a real declared war needs the sustained multi-turn conflict object that's Phase 5's job, not a label on a relationship
- [x] Faction collapse — a faction whose stability bottoms out (≤10) stops existing as an independent actor: absorbed by a rival if it has one (which gains a share of its resources/military), or succeeded by a smaller remnant faction otherwise
- [x] Faction founding — the collapse-with-no-rival path spawns a "Remnant" successor faction (reduced resources/military, fresh starting stability so it isn't stillborn) instead of the faction simply vanishing — a real, event-driven founding mechanism rather than a separate system bolted on
- [x] `DESTABILIZE_RIVAL` ambitions actually damage the named rival, not just the acting faction — the ambition/Clock now carries a `targetFactionId`, and a successful sabotage/smear/shadow-war attempt applies a real stability/resources hit to that specific faction. A failed attempt never reaches the target at all.

### Phase 4 — NPCs and Territory in the Web ✅
Without these links, "war" and "politics" have no map to redraw and no one for the outcome to happen to.
- [x] NPC → Faction affiliation (leader / member), wired into tick logic (an affiliated NPC's plan text reflects their faction's current goal) and into the AI world-state prompt. (Scoped down from the original "leader / member / rival" — an NPC personally rivaling a faction without belonging to any is a distinct, smaller feature, not folded into this one)
- [x] Faction → Territory ownership on Location (`ownerFactionId`) — a successful EXPAND ambition redraws the actual map, collapse hands a faction's territory to its absorber or successor, and the AI world summary narrates from real ownership instead of inventing it
- [x] Contested / border territory state — taking a rival's land takes two successful moves, not one: first contest it (via EXPAND against owned land, or a successful DESTABILIZE_RIVAL scheme destabilizing a holding), then conquer it. Unowned land can be settled in one
- [x] NPC defection — when a faction collapses, its members defect to the absorbing rival (demoted to MEMBER) or carry over to a founded successor faction (keeping their role) — reuses Phase 3's collapse mechanic rather than being a separate trigger
- [x] Faction leadership continuity — a tick handler enforces "a faction with living members has a living leader" every turn; the most important living member is automatically promoted if it doesn't. (There's no single structured "NPC died" event to hook into yet, so this checks the invariant continuously rather than reacting to a death)
- [x] NPCs made notable through play get their own independent goal-pursuit loop — this was already true via the consequence system: a relationship-defining player action (killed/betrayed/recruited always, anything else the AI judges "major") escalates a minor NPC to importance 4, which is exactly the threshold the NPC tick simulates, so they immediately start pursuing goals like any major NPC. Verified rather than rebuilt; the one real gap found (a consequence-updated goal kept the old goal's progress) is fixed

### Phase 5 — Sustained Conflict & War ✅
- [x] A real multi-turn conflict object (`War`: ESCALATING → RESOLVED) instead of a single-shot Clock standing in for a war. Declaration is the escalation of an existing contest, not a standalone trigger: two rivals both need HIGH military *and* one already has to be contesting the other's territory (via a prior EXPAND or DESTABILIZE_RIVAL) before a war over it can ignite
- [x] Attrition/momentum tracked per tick — momentum trends toward whichever side has more military (plus small deterministic variance), both sides lose resources/military every turn regardless of who's winning, and it resolves once momentum is decisive or the war has dragged on long enough to call a stalemate. Verified with an isolated 15-turn simulation: resolved in the stronger side's favor after 8 turns of real attrition on both sides
- [x] Multi-faction alliances/coalitions inside one conflict: a war still *declares* strictly 1v1, but each side can grow — a new `WarParticipant` join model tracks every faction actually fighting on a side, and each tick a side can pull in one of its members' existing `ALLY` factions (if strong enough and not already committed to another war), giving the `ALLY` relationship type real mechanical weight for the first time (Phase 3 built it but it was narrative flavor only until now). Momentum/attrition operate on the whole side (sum of every living participant's military; attrition paid by everyone on both sides); the contested-territory prize still goes only to the original attacker — an ally fighting alongside doesn't inherit land it never personally claimed. Covered by both pure-function tests (`decideWarJoiner`) and mocked DB-wrapper tests exercising aggregation, attrition-across-a-coalition, partial-side-collapse (a coalition partner collapsing doesn't end the war if the primary is still standing), and prize-goes-to-primary-only
- [x] War resolution mechanically changes territory ownership (the winner takes the contested location) and the loser's stats (an extra stability hit on top of the attrition already paid, now applied to every faction on the losing side); a side with zero living participants ends the war as an immediate stalemate rather than fighting on with nothing
- [x] The AI world-state summary carries active wars (attacker, defender, ally counts per side, momentum, turns elapsed) so "how's the war going" is answered from real state — deliberately read-only for the AI, consistent with the rest of the sim: the tick decides, the AI only narrates. Ally counts are fog-of-war gated the same as everything else — an undiscovered faction joining a known war doesn't get outed by it

### Phase 6 — Player-Faction Integration ✅
- [x] PC → Faction leadership binding (`Faction.leaderCharacterId`), set from the admin panel — "I am the president of X" is now a role the engine understands. At most one leader either way: assigning a PC leader demotes any existing NPC LEADER to MEMBER, and `leadershipTick.ts` never auto-promotes an NPC over a player
- [x] Player decisions can directly set a led faction's goal/strategic posture — scene resolution's `world_updates.faction_changes` now accepts a `goal` field, which the AI GM sets when a player roleplays a genuine strategic decision as a faction leader ("As Duke, I commit our forces to retaking the border fort"). Enforced server-side, not just by prompt instruction: `stateUpdater.ts` only applies it when the target faction actually has that player as `leaderCharacterId`
- [x] Player-led factions still tick autonomously between sessions under the same rules as NPC-led ones — verified this is true by construction: the only change is that `factionTick.ts` skips *automatic goal reassessment* for a player-led faction, so their chosen goal survives. Stat drift, ambitions, wars, and collapse/founding all still apply unmodified. A collapsed player-led faction's founded remnant stays under the same player's leadership
- [x] Fog of war — see below; deferred out of Phase 6 proper since it's an information-asymmetry / prompt-design problem more than a simulation one

### Phase 6.5 — Fog of War ✅
- [x] Structural secrecy: `gmNotes` is now stripped from every player-facing API response (campaign, factions, npcs, locations, clocks) via a shared `redactGmNotesList()` helper — enforced at the API layer regardless of what the AI does with its prompt. Admins still see it
- [x] Real discovery flags: `NPC.isDiscovered` / `Faction.isDiscovered` / `Location.isDiscovered` (all default `true`, so nothing existing changes behavior). `applyWorldUpdates()` takes a `sceneOrigin` flag — a live scene the players witnessed flips an entity to discovered on mention, but an offscreen background tick event never does, so the simulation can move a hidden faction, NPC, or location around without the party learning about it for free. Manual toggles added to the admin panel for all three, plus new `locations/route.ts` + `locations/[locationId]/route.ts` API routes (Location previously had none — it only ever existed nested read-only inside the campaign GET)
- [x] Both AI world-summary builders (`buildWorldSummaryForAI` and the token-optimized `buildOptimizedWorldSummary`) already filtered locations at the query level (`isDiscovered: true`) from an earlier pass; they now also filter factions/NPCs the same way, null out a location's `owner_faction_id` if the owner is undiscovered, and drop wars where either side is undiscovered
- [x] Exact numbers replaced with qualitative descriptors in AI-facing prompts: resources/influence/threat level become weak/moderate/strong-style bands (`qualitativeStats.ts`, reusing `factionTick.ts`'s existing LOW/MEDIUM/HIGH thresholds) and war momentum becomes a prose descriptor ("favors the attacker") instead of a raw number — the AI narrates from the same impressions a character in the world would have, not simulation internals. The `entities` block each builder returns for RAG memory retrieval is deliberately left unfiltered, so existing NPC-recall guarantees are untouched
- [x] Closed a latent `TimelineEvent.visibility` gap in `contextManager.ts`'s scene-summarization paths (now filtered to PUBLIC/MIXED) — defense-in-depth, not a fix for an active leak, since neither path currently reads GM_ONLY text directly
- [x] Offscreen background ticks can now introduce a new hidden location the same way they already could for NPCs/factions — `callAIForWorldTurn`'s response type and prompt now include `location_changes`, forwarded through `worldTurn.ts` with `sceneOrigin: false`, so a villain's hideout mentioned in an offscreen event registers as a real `Location` row without revealing it to the party

### Phase 7 — Memory & Discovery at Scale ✅
- [x] Memory importance decay / summarization: `campaign_memories` was uncapped and write-only — nearly every scene, tick change, and offscreen event got its own embedded row forever, so a 100+ scene campaign was really generating several hundred to low thousands of rows, not ~100. `memoryConsolidation.ts` now periodically (every 10 turns, piggybacking on the existing world-turn cadence rather than a new cron) rolls up old `MINOR`/`NORMAL` memories into one per-era summary per 10-turn window and deletes the originals, tagged `era-summary` so a consolidated row is never re-consolidated. `MAJOR`/`CRITICAL` memories are permanently exempt — those are exactly the moments long-term recall exists for. Added baseline test coverage for `createCampaignMemory`/`retrieveRelevantHistory`'s ranking logic, since neither had any tests before this pass
- [x] Cross-entity memory queries ("what happened between X and Y"): `retrieveCrossEntityHistory()` finds memories where two specific entities (any mix of NPC/faction/character) both appear, an intersection the existing per-entity functions (`retrieveNpcHistory`, `retrieveFactionHistory`) can't produce on their own. Wired into scene resolution's existing named-entity guaranteed-recall mechanism (`worldState.ts`) — when a player action names two or more NPCs/factions at once, their shared history is pulled directly instead of hoping semantic search surfaces it. `campaign_memories` had no frontend-facing API before this pass (confirmed by research — every existing retrieval function is server-internal, feeding the AI prompt only), so this stayed backend-only rather than adding a new API route or UI with no other feature depending on it yet
- [x] Player-facing world-state views: the campaign wiki (`/campaigns/[id]/wiki`) already was this — readable by every campaign member, showing NPC/Faction/Location detail — but scoping this item surfaced that it had **no fog-of-war gating at all**, completely bypassing all the Phase 6.5 work: `sceneResolver.ts`'s `updateWikiEntries` fetched *every* NPC and Faction in the campaign (no `isDiscovered` filter, unlike its own Location query three lines below, which already had one) on every scene resolution, and faction wiki entries embedded exact `resources`/`stability`/`military` numbers in plain text. Fixed on both the write side (`sceneResolver.ts`, `wikiSync.ts` — both now skip undiscovered NPCs/factions and use `qualitativeStats.ts` instead of raw numbers) and the read side (`wiki/route.ts` now cross-references discovered NPC/Faction/Location names as defense in depth, since `WikiEntry` matches its source by name, not a real FK, so an entity re-hidden after its wiki entry already exists needs a read-time check too). Also added territory to faction/location wiki entries ("Controls: ...", "Controlled by: ...", both discovery-gated) — the "faction standings, territory" half of this item
- [x] Known-rumors feed: new `/api/campaigns/[id]/rumors` route + a "Rumors" tab on the wiki page — a dedicated feed of offscreen events (`isOffscreen: true`) with PUBLIC/MIXED visibility, distinct from the story/log (what players actually witnessed): this is what's circulating in the world around them, never `summaryGM`
- [x] Reconciled the importance-heuristic duplication: `contextManager.ts`'s `extractImportantMoments` used to independently re-derive a scene's importance via keyword-matching over resolution text. It now reuses the importance `memoryCreation.ts`'s `determineImportance()` already computed and stored on the scene's `CampaignMemory` row (richer signals — structured character harm, clock/faction updates, scene type — not just text keywords) via the new `classifySceneImportance()`, falling back to the old keyword/timeline heuristic only when no memory row exists for a scene (memory writes are best-effort and can fail without blocking gameplay)

### Phase 8 — Tooling & Scale (stretch) ✅
- [x] Parameterized the per-tick faction/NPC caps: `FACTION_CAP`/`NPC_CAP` were hardcoded as a duplicated local `const` in 6 different tick files. Replaced with `WorldMeta.factionCap`/`npcCap` (nullable — `null` means "use the default," so nothing existing changes behavior), resolved once per tick in `worldTick.ts` via `resolveTickCaps()` (`tick/caps.ts`) and threaded through `TickContext` so every handler sees the same value for a turn instead of each independently querying `WorldMeta`. New `/api/campaigns/[id]/settings/simulation` route (GET/PATCH, admin-only) and an admin-panel "Simulation Caps" section (in AI Settings) to set them per campaign
- [x] Admin visualization of faction relationships and territory: new "Map" tab — a dependency-free SVG relationship graph (factions arranged in a circle, red dashed lines for rivals, green solid for allies, read straight from `Faction.relationships`) plus a territory panel grouping discovered locations by owning faction (with an "Unclaimed" bucket). Deliberately simple per the roadmap's own framing ("a simple map or graph view") — no new charting/graph library added
- [x] Simulation debug tooling — "inspect why a given decision was made" half: new "Debug" tab + `/api/campaigns/[id]/world-events` route (admin-only — reason strings can reference GM-only state) browsing the already-durable `WorldEvent` log by turn: every tick change and consequence, with its `previousValue`/`newValue`/`reason`. No new capture mechanism needed — `WorldEvent` already recorded all of this every turn, it just had no viewer
- [x] Tick dry-run / preview: every write call site across all 7 tick handlers is now gated on `TickContext.dryRun`, and `runWorldTick(campaignId, turnNumber, { dryRun: true })` skips the writes plus the normal post-tick persistence (history log, wiki sync, event log) while still returning the exact `WorldChange` list the tick would produce. New admin-only `/api/campaigns/[id]/world-tick/preview` route + a "Preview Next Tick" button in the Debug tab. Deliberately scoped as a preview of the *next* tick against live current state, not a replay of a *past* one — there's no snapshot system to replay historical state against, and building one was out of scope. Also deliberately not implemented via a Prisma transaction rollback: the handlers write through the shared `prisma` singleton, not a transaction-scoped client, so wrapping the whole tick in `prisma.$transaction` wouldn't actually make those writes roll back — skipping them outright is simpler and equally safe

## Product Roadmap (PbtA × Urban Shadows fusion)

**Thesis:** the first AI GM that actually *runs a game* instead of improvising
prose — server-rolled moves the narrator must obey, Urban Shadows-style
Debt/standing/corruption economies bridging player characters to the living
faction simulation, with a deliberately *ungamified* surface: mechanics stay
invisible in the prose, sheets show only what the character knows, and
receipts live in the opt-in transparency panel.

**The north-star exit test (Phase 2):** a player owes a Debt to a faction,
that faction loses a war in the offscreen tick, the player learns it from the
rumor digest, and their next roll is mechanically different because of it.
When that chain works, this is the product.

### Foundation — the mechanical spine ✅

Shipped ahead of the original plan: the knowledge-relative sheet system that
Phase 2's economies build on.

- [x] Knowledge-relative character sheets: the universe has a latent capability tree (`CampaignCapability`); a character's sheet shows only what the fiction has revealed to them (`CharacterCapability`: absent → GLIMPSED "???" → UNLOCKED with a qualitative band). Raw proficiency numbers never leave the server
- [x] Origin familiarity seeding (native / newcomer / outsider): what a new character already knows *exists*, never what they can do — nothing seeds unlocked
- [x] Organic capability growth: the AI signals glimpse/unlock/progress from the fiction; deterministic server math decides gains (diminishing returns, per-arc caps). Downtime training is the fast lane and can only sharpen what you already have
- [x] Per-character narration knowledge-gating: the AI never explains systems a character hasn't encountered — fog of war applied inward
- [x] Capability scaffold generation at campaign creation (domains, tiers, secret branches), plus organic node creation mid-story for newly revealed systems
- [x] Server-rolled move resolution: every risky action is classified to a PbtA basic move (or no_roll), rolled 2d6 + stat + capability band + harm on the server, and the outcome band is a **binding** constraint on the narration (weak hits always cost; misses trigger a hard GM move)
- [x] Capability bands as roll modifiers: attempting an unknown system −1, novice 0, competent/skilled +1, masterful +2
- [x] Roll receipts: every roll persisted to `DiceRoll` and shown in a collapsed-by-default 🎲 section of the transparency panel — prose never mentions dice
- [x] Harm keyed to resolution: 4+ harm applies the Impaired −1 to every roll; misses are where harm comes from

### Phase 0 — Clarity and floor

Goal: stop building on sand. Exit: CI green, Sentry live, migrations real,
secrets fixed, email verification on, dead code gone, ruleset documented.

- [x] **#1 Ops floor**: GitHub Actions CI (tsc + vitest on every push/PR); deploys no longer pass `--accept-data-loss` — destructive schema changes now fail the build loudly, with the full migrate-baseline procedure documented in `docs/MIGRATIONS.md` (needs one prod-DB session to complete); error monitoring via `lib/monitoring.ts` (`ERROR_WEBHOOK_URL` → Discord/Slack, wired into resolution failures; drop-in Sentry swap later); JWT fallback secret killed (production refuses to boot without `JWT_SECRET`); email verification on signup (soft-gate) + full password reset flow (request → email → `/auth/reset-password`)
- [x] **#2 Dead-code purge + ruleset doc**: `sessions/session-service.ts` deleted (was never imported); the PbtA×US ruleset is implemented and documented in code + this README rather than as an upfront ADR

### Phase 1 — MVP foundation: the mechanical spine

Goal: the core loop becomes a game. Exit: a full multi-scene session where
every action resolves through a server-rolled move, no resolution is lost to
timeouts, and the AI respects the outcome band.

- [x] **#3 Resolution engine v1**: server-side move classification (EFFICIENT model, fail-open), 2d6 + stat + capability band + harm rolled server-side, persisted to `DiceRoll`, outcome band passed to the narrator as a binding constraint, hard GM move required on a miss
- [x] **#4 Roll visibility**: *(deliberately redesigned from "visible dice UI" to hidden-with-receipts per the ungamified-surface decision)* — rolls surface as a collapsed-by-default 🎲 section in the transparency panel; prose never mentions dice
- [x] **#5 Async scene resolution**: action submission and manual resolve now enqueue a `ResolutionJob` and return immediately; the AI-GM-plus-world-turn pipeline runs in `/api/internal/resolve-job` (secret-gated, `maxDuration 300`) via HTTP self-invocation with an inline fallback. Atomic PENDING→RUNNING claims dedupe racing submits; failures retry up to 3 attempts; stuck jobs are recovered opportunistically by scene GET traffic (no cron needed). UI needed no changes — it already followed the `scene:resolving`/`scene:resolved`/`scene:resolution-failed` Pusher events

### Phase 2 — Product differentiation: the Urban Shadows fusion

Goal: mechanics and the living world become one system. Exit: the north-star
chain above works in a real playtest.

- [x] **#6 Debt economy**: first-class `Debt` records between PCs and NPCs/factions, both directions — incurred/resolved by the AI via `debt_changes` (earned in fiction, idempotent, oldest-first resolution matching), open debts fed to the narrator as leverage with call-in guidance, rendered diegetically on the sheet as "Obligations & Favors" ("Lord Kessler considers you in their debt"), never a ledger counter
- [x] **#7 Faction standing**: per-character `FactionStanding` (-3 hunted … +3 honored), shifted by scene outcomes via `standing_changes` (server-clamped to ±1/scene). Social/political rolls take an *effective* standing modifier computed against **live simulation state** at roll time: a collapsed faction's regard is worth 0, a war-weakened (LOW-influence) faction's caps at ±1, a healthy one at ±2 — so the offscreen tick literally changes what a player can roll, with zero new tick writes. Rendered qualitatively ("trusted by the Thieves Guild") on the sheet and in prompts; receipts show the standing term
- [x] **#8 World-visibility digest**: after every world turn, the tick's MAJOR changes involving *discovered* entities become one "Word on the street…" notification per campaign member (capped at 3 rumor lines, fog-safe templates — GM-grade tick reasons never leak), linking to the story log's rumor feed. The living world now reaches players instead of running silently
- [ ] **#9 Origin archetypes / playbook onboarding**: *(v1 shipped: origin familiarity selector + capability discovery seeding)* — still open: full creation presets per origin (starting ties, obligations, glimpse packages) and signup-to-first-scene under 5 minutes
- [ ] **#10 Corruption track**: per-universe "power at a cost" (the dark-essence pattern) — marking corruption grants power now, unlocks a shadow branch of the capability tree, and accumulates toward consequences the character can't take back
- [x] **#11 Harm/death keyed to resolution**: 4+ harm applies the Impaired −1 to every roll; misses are where harm comes from (folded into the resolution engine's binding miss rule)
- [ ] **#12 Alpha instrumentation**: funnel/retention events, stuck-scene alerting, playtest cohort dashboard — D7/D28 retention measurable per cohort

### Phase 3 — Expansion: content and shareability

Goal: easy to start, worth showing off. Exit: 3–5 external groups complete
4+ week campaigns with defensible D28 retention.

- [ ] **#13 First-party campaign templates**: 3–5 templates tuned to the new ruleset — factions, starting Debts, front-style threats, capability scaffolds
- [ ] **#14 Scene illustration**: one generated image per resolved scene (deferred until mechanics landed; requires #5 so cost/latency live off the request path)
- [ ] **#15 Chronicle share link**: read-only public link to a campaign's story log — cheap virality from prose the game already generates
- [ ] Closed alpha with 3–5 external groups

### Phase 4 — Monetization and scale

Goal: prove people pay. Exit: sustainable unit economics on real cohorts.

- [ ] **#16 Free starter allowance + pricing validation**: credits vs. subscription test; conversion + margin data from ≥50 paying users
- [ ] Cost-per-session optimization and queue scaling (as data demands)

### Explicitly deferred (identity conflicts / wrong stage)

Mobile app, voice/TTS, creator marketplace/UGC, VTT-style grid combat,
5e-style crunch, deeper world-sim features before players can *feel* the
sim through standing/Debts/rumors — per the roadmap's tradeoff analysis.

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
