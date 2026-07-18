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
- **Lore Import**: feed the AI GM reference material — pasted text, a single page URL, or an entire MediaWiki wiki (Fandom, wiki.gg, ...) crawled via its API — chunked, embedded, and retrieved per scene as canon for the narrator. Give the creation form a canon URL and the world's *structure* (factions, learnable systems, archetypes, corruption theme) automatically rebuilds itself from that canon when the import finishes
- **Quest & Item Tracking**: the fiction's concrete undertakings get a real lifecycle (registered → progress beats → completed/failed/abandoned) fed back to the AI and synced to the wiki, and the party's inventories aggregate into a browsable item registry
- **Payment System**: Stripe integration for AI usage billing, with per-call cost tracking, balance gating, and per-user rate limiting on every AI-invoking route
- **Input Moderation**: player free-text is screened (OpenAI moderation endpoint) before it ever reaches the completion model — provider-ToS protection, separate from the in-fiction X-Card safety tool
- **Ask the GM**: an always-available, out-of-character channel for clarifying questions ("what can I see on the allomancer?") that's architecturally kept out of the action-resolution pipeline entirely — no dice, no world state changes, no exchange consumed, not even a `PlayerAction` row. The GM answers from the same fog-of-war-safe knowledge the narrator has (so it can't leak what the character wouldn't know) and says "you don't know" rather than invent. Answers are shared with the whole party in real time, the way a question asked aloud at the table would be

## World Simulation

MythOS runs a deterministic "world tick" paced by **in-game time**: each
resolution banks the fiction's time passage, and the tick fires once a full
in-game day (per-campaign configurable) has actually passed in the story —
so a rapid combat exchange doesn't move the world, and a three-day journey
does. The tick itself is a pure, AI-free simulation step that decides what
changes in the background (NPC movement and goal progress, faction
resource/stability/military drift, weather) and writes every change to a
durable event log. Only *narrating* those changes into prose is delegated
to the AI, via a separate offscreen event generation pass; the underlying
simulation state never depends on the AI being available or consistent.

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

Every active faction is simulated automatically — no opt-in. Each starts
with a default goal and archetype, and the tick reassesses its goal every
turn from its actual circumstances, so a well-resourced faction drifts
toward expansion and starts committing to ambitions on its own. The
campaign admin panel's **Simulation Goal** and **Archetype** controls
(Factions tab) are a steering wheel, not an ignition switch: use them to
seed or override a faction's direction and flavor its ambitions (guild vs.
secret society vs. political machine) — the simulation will steer the goal
back toward whatever the faction's stats justify, except for player-led
factions, whose chosen goal is deliberately preserved. The admin panel also
has a Map tab (faction relationships and territory), a Debug tab (why the
tick made a given decision, plus a dry-run preview of the next tick), and a
Simulation section for tuning per-campaign tick caps and how much in-game
time passes between world turns.

## Living World Roadmap

The long-term goal is a world that simulates itself autonomously — factions,
NPCs, and territory that tick forward on their own agendas whether or not
players are present — and remembers everything that happens well enough to
answer for it later, the way a human GM running a Crusader Kings-style
campaign would. Phases 1–8 are complete and live in production; the detailed
per-phase build notes that used to live here are preserved in this file's
git history.

### Built (Phases 1–8) ✅

- **Deterministic world tick** — AI-free simulation step (NPC goals and movement, faction stat drift, weather), every change written to a durable `world_events` log; the AI only narrates, never decides
- **Autonomous faction ambitions** — resourced factions commit to archetype-flavored ventures (tournaments, coups, trade wars) with real costs, deterministic outcomes, and real stat consequences on completion
- **Faction feedback & evolution** — automatic goal reassessment each tick, rival/ally relationships the tick reads and writes, collapse (absorption by a rival or remnant succession), and event-driven founding
- **NPCs & territory in the web** — NPC↔faction affiliation and defection, leadership continuity, and faction-owned/contested territory that ambitions and wars actually redraw
- **Sustained wars & coalitions** — multi-turn attrition/momentum conflicts that allies can join; resolution changes territory ownership and hits the losing side's stats coalition-wide
- **Player-faction integration** — a PC can lead a faction outright and set its strategy in-fiction; the simulation keeps ticking underneath under the same rules as NPC-led factions
- **Fog of war** — discovery flags on NPCs/factions/locations, GM notes stripped at the API layer, qualitative stats (never raw numbers) in AI prompts, discovery-gated wiki on both write and read sides
- **Memory & discovery at scale** — RAG memory with consolidation/decay, cross-entity recall ("what happened between X and Y"), a rumors feed of off-screen events, and a player-facing world wiki
- **Tooling & scale** — per-campaign simulation caps, an admin relationship/territory map, a tick-log debugger with per-decision reasoning, and a dry-run next-tick preview

### Recently shipped

- **World turn paced by in-game time** — the simulation banks the fiction's `time_passage` and advances once a full in-game day (per-campaign tunable, admin panel → Simulation) has passed, instead of once per player action
- **Quest tracking** — first-class quest lifecycle (registered → progress beats → completed/failed/abandoned) driven by the fiction, fed back to the AI so it advances rather than forgets undertakings, synced to the wiki
- **Item registry** — the party's per-character inventories aggregated into browsable wiki entries (who carries what, in what quantity)
- **Lore import** — paste text, a page URL, or an entire MediaWiki wiki, chunked + embedded, semantically retrieved per scene and injected as canon for the narrator
- **Organic advancement actually fires** — server rolls now stamp each action with its result, so stat growth from consistent successful use works (it was silently dead: the growth system read a field nothing wrote), counted once per exchange even in long scenes
- **Advancement made consistent** — three fixes to `lib/game/advancement.ts`: (1) stat growth was an unbounded ratchet — once a stat crossed the 10-use/60%-success threshold its cumulative counter kept re-proposing +1 on every future resolution forever, throttled only by the PbtA sum/cap constraints silently rejecting it; now gated to once per `ARC_LENGTH_TURNS`, the same arc cadence capabilities already use. (2) `stateUpdater.ts` had its own second, weaker copy of this same stat/perk/move-applying logic that ran earlier in the same resolution, double-applying anything the AI put in `organic_advancement`; removed so `applyOrganicCharacterGrowth` is the single writer. (3) moves — the only channel that can grant a "special move" — were a functionally dead bare-string field with almost no AI prompt guidance; moves are now structured (`{id, name, trigger, description}`, id derived server-side so re-phrased reports of the same move still dedupe) with an explicit prompt section distinguishing them from perks: rare, one-time, narrative-turning-point rewards, not routine competence
- **Custom-universe world generation fixed** — template-less campaigns now persist their AI-generated factions (they were generated and silently discarded), and writing your own opening world seed no longer disables faction/capability/stat-label generation
- **Campaign memory unbroken** — the RAG memory raw SQL targeted snake_case columns that don't exist (Prisma created camelCase); every memory write/read/consolidation had been silently failing
- **First scene no longer drops you mid-fight** — the campaign opener shared the same "start already in progress" instructions as every later scene, which reads fine after a resolution but is jarring with no story behind it yet. The opener now gets its own prompt: a brief establishing beat (place, arrival, a real moment to stand in) before the hook lands; scene 2+ keeps starting on the action

### Phase 9 — True Autonomy (next)

Goal: the world moves even when nobody is playing, and imported lore shapes
the world's *structure*, not just its narration.

- [x] **Real-time heartbeat**: the project's first scheduled infrastructure — a daily Vercel Cron (`vercel.json`'s `crons`, secured via `CRON_SECRET`) hits `/api/internal/cron/world-tick-sweep`, which for every active campaign tops up `WorldMeta.hoursSinceWorldTurn` toward real elapsed time (`lib/game/cronHeartbeat.ts`) *before* checking whether that crosses the world-turn threshold. This is the missing piece the pacing work above didn't cover: banking only ever happened from the AI's reported `time_passage` during play, so a campaign nobody visited had nothing advancing its accumulator — the tick could never become due no matter how often it was checked. It's a pure idle backstop, not an add-on to active play: `WorldMeta.hoursBankedSinceLastHeartbeat` tracks what play itself banked since the last sweep, and the heartbeat only banks the *gap* between that and real hours elapsed — an actively-played campaign that's already kept pace with (or outrun) the real clock gets nothing extra, a quiet one gets real time banked outright. Now log in after a week away and the war really is lost, the duke really is dead — without a heavily-played campaign racing through world turns faster than its once-a-day pacing intends. Capped at 25 real world-turns per sweep (each makes AI calls) so one invocation can't run past its duration limit; anything deferred is still correctly banked for tomorrow's sweep. The same cron backstops the stuck-resolution-job sweep, previously also purely traffic-piggybacked
- [x] **Lore-aware world generation**: the creation form takes an optional canon URL (a wiki to crawl or a single page) — the campaign is created instantly on a provisional generated world, the import runs in the background, and on completion the world automatically reseeds itself from canon: a bounded digest sampled evenly across the whole imported corpus grounds a regeneration pass where canon is the highest authority, so factions and learnable systems come from the lore *by their canonical names*. Two merge modes decided by whether anyone has committed to the world: **fresh** (no characters yet — the usual creation-time case) *replaces* the provisional world (non-canon factions retired, scaffold rebuilt, stat labels/corruption theme/archetypes regenerated from canon); **live** (characters exist) is strictly additive/fill-only, touching nothing in play. While a creation-time import is in flight the campaign is **locked** (no characters, no scenes — banner + polling on the campaign page) so a mid-import character can't strand the provisional world; the lock self-heals if the import dies, so a campaign can never be stuck. The same pass is re-runnable from Admin → Lore after adding more sources
- [x] **Witnessing the living world**: the simulation generates more than players ever perceive, so this makes the machinery *felt*, not just logged. **"While you were away"**: `CampaignMembership.lastViewedAt` is the checkpoint (a dedicated `/away-recap` endpoint the lobby page alone calls, so the story page's constant Pusher-triggered reloads through the shared campaign GET can't reset it before a returning player sees it) — a dismissible banner diffs offscreen, fog-safe `TimelineEvent`s against that checkpoint and surfaces up to 5 in chronological order, gated behind a 1-hour minimum gap so it never fires on a quick refresh. **Scene openings**: `generateNewSceneIntro` now fetches offscreen events since the prior scene resolved and is told to let one color the new scene's atmosphere — a rumor, a changed mood, smoke that wasn't there before — without stating it as fact the characters don't yet know
- [x] **NPC society**: major NPCs now carry a piece of their faction's politics personally, not just in the abstract. `NPC.socialTies` (mirrors `Faction.relationships`' shape) is derived deterministically each tick: colleagues in the same faction are allies; members of rival/allied factions inherit that stance individually — "Lord Kessler and Captain Vane serve the same crown" reads differently from "Lord Kessler despises Captain Vane, whose faction is his own's bitter rival." When two allied NPCs' independently-paced schedules (see `#41`'s day/night commute + plan-phase cycle) converge on "acting" the same turn, they start a **joint scheme** — a real Clock tagged with both their ids, riding the existing generic clock advance/completion machinery for free (no new narration pipeline needed). Both ties and schemes are fog-of-war-safe (undiscovered NPCs never get named) and reach the AI GM's prompt and each NPC's wiki entry. Independent movement between locations already existed (the day/night commute, `#41`) — this piece specifically closes the "NPC↔NPC relationships and joint schemes" gap. **Unaffiliated NPCs** (no faction) get a second, independent signal derived from a deterministic "home turf" (the same stableHash formula the day/night commute already uses): sharing turf reads as community (ALLY) between ordinary NPCs, or rivalry (RIVAL) between two PbtA-style "threats" competing for the same ground — grounded in the fiction, not an arbitrary pairing. Still open: no admin visualization yet (the faction relationship map exists; an NPC one doesn't)

### Hardening backlog (known gaps from a full codebase audit)

- [ ] Tutorial completion triggers are never sent from the app — every new user's onboarding is permanently stuck at 0%
- [x] **X-Card safety dropdown/enum mismatch fixed**: `XCardTrigger` was a 5-value "where" taxonomy (`SCENE_CONTENT`/`MESSAGE`/...) while the UI offered 11 "what kind of content" options — 10 of 11 silently 400'd. The enum now matches the UI exactly (`GENERAL`/`VIOLENCE`/`GORE`/`TRAUMA`/`ABUSE`/`DEATH`/`PHOBIA`/`SEXUAL`/`SUBSTANCE`/`MENTAL_HEALTH`/`OTHER`) — the more useful axis for a GM to actually act on, and no UI changes were needed
- [x] **Safety admin wired up** (was a self-declared stub — full service, zero routes/UI): content reporting (`POST/GET .../reports`, resolve/dismiss), campaign bans (`POST/DELETE .../members/[userId]/ban`, `GET .../bans`, enforced on invite-link rejoin), and self-service per-campaign blocking (`POST/DELETE/GET .../block`, filters the blocked user's messages out of `GET .../messages`). New admin **Safety tab** (reports queue, X-Card history — previously fetched by nothing, banned users), a **Ban** button next to Remove in Members, a **Report** button next to the X-Card in-scene, and a **Block**/Unblock toggle per player in the campaign lobby's roster
- [x] **Notification writers wired up** (was: fully built read side, no writer): `@mention` detection (`lib/notifications/mentions.ts`, matches `@name` against campaign members, case-insensitive) now actually populates `Message.hasMentions`/`mentionsUserIds` and fires `MENTION`; whispers fire `WHISPER_RECEIVED`; a note created or edited into `SHARED` visibility fires `NOTE_SHARED` to the rest of the party. Along the way, two mislabeled types got real ones: `CAMPAIGN_INVITE` had been hijacked for friend-request notifications ("no `FRIEND_REQUEST` yet") so a real invite-link join notified nobody — friend requests now use a proper `FRIEND_REQUEST` type, freeing `CAMPAIGN_INVITE` to notify admins when someone actually joins via their link. `SCENE_CHANGE` had likewise been hijacked as the "closest existing type" for X-Card alerts; those now use a dedicated `SAFETY_ALERT` type
- [x] **X-Card pause was a lie, and nobody could configure any of it** — three compounding gaps in `lib/safety/safety-service.ts`. (1) `pauseOnXCard` defaulted to `true` for every campaign, but `pauseScene()` was a literal no-op (`prisma.scene.update({data: {}})` — a comment admitted "In a full implementation, add a PAUSED status"); play never actually stopped. Now `Scene.isPaused`/`pausedAt`/`pausedReason` are real, checked by both the action-submission route and `resolveScene` itself (defense in depth against its multiple entry points), with a player-visible paused banner and an admin **Resume Scene** action (`POST .../scenes/[sceneId]/resume`). (2) `CampaignSafetySettings` (X-Card toggles, lines, veils) had no admin UI and no API route at all — `updateSafetySettings` was never called from anywhere, so every campaign ran on hardcoded defaults forever. New **Safety Settings** panel in the admin Safety tab, backed by `GET/PATCH .../safety-settings`. (3) Lines and veils — the standard hard/soft content-boundary tool — were stored but never read by anything, not even the AI prompt. Now fed into a new `<safety>` prompt section (`lib/ai/client.ts`) on every scene resolution and into the scene-intro prompt (`generateNewSceneIntro`), as an override instruction above genre convention. Removed alongside: a fully dead `moderateContent` keyword-matcher (superseded by the real OpenAI-backed moderation pipeline), dead Session Zero fields, and a duplicate `moderationLevel`/`autoModeration` pair shadowing the real, wired `Campaign.contentModerationLevel`
- [x] **Downtime activity costs were cosmetic — now dynamic and multi-typed, not just gold**: `ai-downtime-service.ts` computed a gold cost and the UI showed "Cost: X gold" as a real charge, but nothing ever deducted it. Fixed, then generalized — the AI now picks whichever of four cost shapes actually fit the described activity, any subset or none: **gold** (charged from `Character.resources`), **items** (materials consumed from `Character.inventory`, matched case-insensitively, rejected if short), **favor** (a political/social cost — incurs a real Debt owed *by* the character via the existing single-writer `applyDebtChanges`, never an affordability gate since a favor is a forward-looking obligation, not a resource that runs out), and **requiresQuest** (activities that can't resolve through downtime narration alone spawn a real, tracked `Quest` row, linked via `DowntimeActivity.linkedQuestId`). All four reuse existing mechanical systems rather than inventing new ones; checked all-or-nothing before anything is charged so a shortfall on one never leaves a partial charge behind. The create-activity modal and activity cards now render every cost type present, not just gold
- [x] **requiresQuest now actually gates completion** — `advanceDynamicDowntime` checks the linked quest's status every time it advances a quest-gated activity: `ACTIVE` still lets days (and their events) pass but caps progress just short of the finish line so the activity can never complete out from under the mission; `COMPLETED` releases it to finish normally; `FAILED`/`ABANDONED` fails the activity outright with an explanatory outcome rather than leaving it stalled forever with no way to close it
- [x] **Lore-reseed archetypes could silently vanish forever**: `reseedWorldFromLore`'s archetype refresh was a `deleteMany` immediately followed by a separate `createMany` — a timeout or thrown error between the two calls (well within reach of the synchronous 60s-budget reseed route, which also makes two sequential AI calls) left a campaign with **zero** archetypes, permanently. Nothing surfaced the failure: `loreQueue.ts` deliberately treats a reseed failure as non-fatal to the lore import itself and clears the play-lock regardless, so the campaign unlocked into a broken state with no error visible to the GM, and `EnhancedCreateCharacterForm` simply renders no archetype section when the list is empty — the origin cards just never appeared. Compounding it, there was no way to recover once any character existed: `wantArchetypes` was `fresh`-only, so even the manual admin "Reseed from lore" re-run explicitly skipped archetypes in live mode by design. Fixed both: the delete+recreate now runs inside a single `prisma.$transaction` so the bad state can no longer be created, and `wantArchetypes` is now `fresh || existingArchetypeCount === 0`, so a campaign already stuck at zero gets them regenerated on the next reseed even in live mode — the admin button is a real recovery path, not just a fresh-mode escape hatch
- [x] **World generation never produced NPCs or Locations — the wiki looked empty even after a full lore import**: `generateWorldFromTemplate` (and the reseed pass built on it) only ever generated factions, the capability scaffold, and fronts; NPC/Location rows were created *only* by actual play narrating someone/somewhere into existence via the AI stateUpdater. So a freshly created (or freshly lore-reseeded) campaign had nothing but faction/front stubs in its wiki — no characters, no places — no matter how much canon was imported, since a lore crawl only ever fed the RAG retrieval index (`LoreEntry`), never NPC/Location rows. Added `npcs`/`locations` (3-6 and 2-4 respectively, drawn from canon by name when lore is present, invented to fill gaps otherwise; each can optionally name a faction for affiliation/ownership) and `createNPCsForCampaign`/`createLocationsForCampaign` (resolve that faction name to a real id, same pattern `sourceFactionName` already used for fronts) — purely additive in both fresh and live mode, name-deduped like fronts, since neither has a clean provisional-vs-canon identity to retire by
- [x] **The NPC/location fix above initially made a worse bug**: the first cut added `npcs`/`locations` straight into `generateWorldFromTemplate`'s single JSON response — the same call that already generates factions/capabilities/stat labels/fronts and, per its own prior doc comment, was "already at its token budget." A content-rich lore digest (e.g. a full wiki import) gives the model enough to write that the response can get cut off mid-JSON; `JSON.parse` then throws and the WHOLE call returns null — zeroing out factions and everything else too, not just NPCs/locations, exactly the "no factions were made either" failure this produced. Fixed by moving NPCs/locations to the separate second-stage `generateWorldExtras` call (already used for archetypes/corruption theme, on its own token budget) instead — a truncated or failed response there only loses NPCs/locations/archetypes/theme, never the load-bearing factions/capabilities/fronts from the first call. That second-stage call now also always runs on every reseed (previously skipped entirely once archetypes and the corruption theme were both already satisfied), so NPCs/locations keep getting attempted from newly added lore even when nothing else needs regenerating
- [x] **A third NPC/location bug: a repeated name in one AI response could crash the whole reseed (or campaign creation)**: `Location` has a real DB unique constraint on `(campaignId, name)`, but `generateWorldExtras` only deduped `npcs`/`locations` against what already existed in the database — never against duplicates *within the same response*. A rich lore digest (a full wiki import) makes the model likely to name the same notable place twice across different sampled entries (e.g. "Whiterun" mentioned in several chunks); the second `location.create()` for that name threw an uncaught unique-constraint violation, which crashed `reseedWorldFromLore` outright — read by the admin as "world gen keeps failing." Worse, since NPCs/locations are seeded inside the same transaction as campaign creation itself, the identical crash could take down campaign creation entirely if it hit on the very first generation. Fixed at the source: `generateWorldExtras` now dedupes `npcs`/`locations` case-insensitively within its own response (keeping the first mention) before returning, so a repeated name can never reach either call site
- [x] **World reseed made async — a fourth failure mode, and the real explanation for the recurring "reseed keeps failing"**: `reseedWorldFromLore` makes up to two sequential AI calls plus a run of DB writes, all inside the interactive `POST .../reseed-from-lore` request, capped at 60s (and hard-capped there regardless of `maxDuration` on a Vercel Hobby plan). For a large lore corpus this genuinely runs past the limit — the platform kills the function mid-request, which surfaces to the browser as an opaque `502` with no error message, not a clean failure the route's own try/catch could report. The exact same risk existed, less visibly, in the creation-time auto-reseed path (`loreQueue.ts`), which ran the same two AI calls inline inside the lore-import worker's own invocation, on top of whatever budget crawling the source had already spent — a very plausible root cause for the *original* "wiki was empty" report much earlier in this file. Fixed by moving reseeding off the request path entirely, mirroring how lore import itself already works: a new `ReseedJob` model tracks one attempt; `POST .../reseed-from-lore` creates one and kicks its own invocation of a new internal worker route (`/api/internal/process-reseed`), returning immediately; the admin panel polls `GET .../reseed-from-lore` for status and renders the same rich summary once it lands. Creation-time auto-reseed now goes through the identical path (`releasesPlayLock: true` on that job — its completion, not the import job's, takes `Campaign.pendingWorldSeed` off). Because `reseedWorldFromLore`'s writes are incremental against current DB state (factions/NPCs/locations dedupe by name, archetypes only regenerate if still zero), a job whose invocation gets killed mid-run and is retried by the existing traffic-driven stale-job recovery doesn't redo finished work — each attempt keeps making forward progress until the world is fully caught up, without ever surfacing a raw `502` again
- [x] **The async reseed job above still ran inline on its first real-world test**: production logs showed two OpenAI calls completing *inside* the interactive `reseed-from-lore` request itself, 17s in, then a 502 — `kickReseedJob`'s self-invocation fetch to `/api/internal/process-reseed` was failing (plausibly a cold-start/propagation quirk right after a fresh deploy of a brand-new route), and its catch block — copied from `kickLoreImportJob`, where an inline fallback is the right call — fell back to running `processReseedJob` (and therefore both AI calls) synchronously in the same request that was supposed to only ever kick a background job. `kickReseedJob` no longer falls back to inline processing at all: a failed kick just leaves the job `PENDING` for the next traffic-driven recovery sweep to re-kick, guaranteeing the interactive route can never run the AI work itself, which is the entire point of this job existing. Logs also surfaced a second, independent bug on the same request: `generateWorldFromTemplate`'s JSON response failed to parse (`SyntaxError` at position 8341) against this campaign's real, content-rich digest even at 1900 `max_tokens` — bumped to 3200 for real headroom, and a `generation_failed` outcome (a probabilistic AI hiccup, unlike the genuinely terminal `no_lore`/`not_found`) is now retried up to the job's normal attempt limit instead of failing on the first bad response
- [x] Dead schema surface cleaned: `Character.experience` (an XP counter nothing incremented, removed along with its always-empty progress bar in the character sheet and its `character.xp` sibling — a *second*, entirely separate dead field the same UI block also referenced) and `Character.holds` (declared, never read or written anywhere)
- [x] **Remaining dead schema surface cleaned up**: `Session`/`SessionParticipant`/`SessionScene`/`SessionNote` — nothing anywhere ever called `.create()` on any of the four, so the "group scenes into a session" concept had no write path at all, not just a missing UI; the one reader, `CampaignExporter.exportSessionTranscript`, would always see an empty table. Removed the models, `exportSessions`/`exportSessionTranscript`/`generateTranscript` from `campaign-exporter.ts`, and the orphaned `GET /api/campaigns/[id]/export/session/[sessionId]` route it served — nothing in the UI ever linked to it (the help page advertised "readable text transcripts" that nothing delivered; copy fixed to describe the JSON export that actually works). `Campaign.mentionsEnabled`/`soundEffectsEnabled` — dead fields with zero reads or writes anywhere, not even a settings checkbox; the real mention/sound-notification system already exists and works per-user (`UserNotificationSettings`, `lib/notifications/notification-service.ts`), so these campaign-level duplicates were pure noise. Also fixed: `lib/downtime/ai-downtime-service.ts` instantiated its own `PrismaClient()` instead of importing the shared singleton from `lib/prisma` — every other file in the codebase uses the shared client, which matters in dev where the singleton is reused across hot-reloads to avoid exhausting connections
- [x] **Billing switched from a flat per-scene guess to metered real cost**: the old $0.25/$0.50/$0.75 tiers were disconnected from actual AI spend and could over- or under-charge by a wide margin. A new `AICostEntry` row is written per AI call (durable and scene-indexed, unlike `WorldMeta.aiMetrics.requestHistory`'s rolling 50-entry cap shared across the whole campaign) — the action classifier now records its cost too, previously untracked entirely. `resolutionBilling.ts` sums every entry for a scene and charges the real total × a margin multiplier (floor 5¢) when the scene ends, split across participants. Since the exact cost of the scene's *final* resolution call isn't known until after it runs, billing is two-phase: a conservative preflight estimate blocks an unaffordable attempt before that last call is made, and the real metered charge follows once it's done — best-effort at that point, since the AI spend already happened either way

## Competitive Position & Go-Forward Roadmap (July 2026)

A July 2026 competitive-intelligence report benchmarked MythOS against the
AI-GM market (Friends & Fables, AI Dungeon, NovelAI, Hidden Door, Inworld AI,
Character.AI, Fable/Showrunner, KoboldAI/SillyTavern, Convai, and a handful of
2026 newcomers). It was written without deep codebase access, so several of
its "designed / not yet built" calls and "missing feature" recommendations
are stale — this section is the corrected scorecard, checked directly against
the code, plus the roadmap that follows from it. It supersedes the report as
the source of truth; the report itself is not reproduced here.

### The report undersold what's already shipped

The report marks most of the simulation stack "✅ (designed)" — i.e. planned,
not built. In production reality, **Phases 1–8 of the Living World roadmap
above are complete and live**: the deterministic world tick, autonomous
faction ambitions, wars and coalitions, NPC social ties, fog-of-war-safe RAG
memory with decay/consolidation, quest and item tracking, and player-faction
leadership are all shipped. So is the Debt/faction-standing economy that
bridges player choices to that simulation (Phase 2 of the Product Roadmap
below) — the report has no visibility into this at all, and it's arguably
MythOS's single strongest differentiator versus every platform it compared
against, including Inworld (which does agent-driven NPCs but has no
player-facing consumer product) and Friends & Fables (which has no world
simulation of any kind — its world only moves when a GM narrates it).

Two of the report's specific recommendations are flatly wrong today:

| Report claim | Reality |
|---|---|
| "Build a Visible Character Sheet" (Recommendation #3, rated "Very High" ROI) | Already shipped: `CharacterSheetDisplay`, live stats, harm tracker, inventory, conditions, moves, advancement log, knowledge-relative capability tree |
| "Implement Dice Roll UI" (Recommendation #4) | Already shipped, but *deliberately* not the default view: every risky action is server-rolled 2d6 + modifiers, and the receipt (move, dice, modifiers, band) is available in an opt-in `AITransparencyPanel` rather than always inline. This is a considered design choice (mechanics-invisible-by-default), not a gap — worth revisiting only if playtesting shows players don't trust GM rulings without seeing the math |
| "Map Generation" listed as missing | A real token/zone-based map system already exists (`PlayerMapViewer`, admin map creation, faction territory map) — what's actually missing is *auto-generated map art*, a narrower gap than the report implies |
| Report lists MythOS "Multiplayer" as Partial, Friends & Fables as the multiplayer leader at "up to 6" | MythOS already has no hard player cap, real-time chat/notifications, a turn/exchange tracker (`TurnTracker`, `waitingOnUsers`), and per-player blocking/reporting — this needs UX polish, not a from-scratch build |

### Confirmed real gaps (report is right)

- **No image generation** — zero scene illustration anywhere in the codebase. Already tracked as `#14 Scene illustration` in the Product Roadmap below, explicitly deferred until the mechanical engine landed.
- **No native mobile app** — web-responsive only, confirmed no React Native/Expo/Capacitor. Already an explicit, deliberate deferral (see "Explicitly deferred" below) — the report treating this as an oversight rather than a decision is itself informative: it means the deferral isn't visible to an outside observer, which is a real risk if outside observers include reviewers, investors, or App Store search traffic.
- **No voice/TTS** — confirmed absent, also an explicit deferral.
- **No public API / developer SDK** — confirmed absent. This is the one report recommendation (its "B2B/SDK layer" item) that isn't already covered by an existing decision either way — genuinely open.
- **No custom rule-system import** (Pathfinder/OSR/homebrew stat blocks) — confirmed absent, covered by the existing "5e-style crunch" deferral.
- **Context/cost management at scale** is a real, unverified risk the report is correct to flag — this codebase has metered per-call billing (`AICostEntry`) and tiered context injection is *partially* addressed (fog-of-war stripping, qualitative-not-numeric prompts) but there's no dedicated summarization/compression pass for very long campaigns yet. Worth a real audit before claiming this is solved.

### Confirmed differentiators no comparator in the report has

1. **Autonomous world simulation** (faction ambitions, wars, coalitions, NPC social ties, weather) that runs whether or not a player is present, backstopped by a real cron heartbeat — not "designed," shipped and running in production.
2. **Mechanically-binding Debt/standing economy** wired to the live simulation — a faction losing a war *actually* changes what a player can roll next session. No competitor in the report does this.
3. **Fog-of-war-safe by construction** — GM notes, undiscovered entities, and raw simulation numbers are stripped at the API layer, not just prompted away. This is an architectural guarantee, not a narrative convention.
4. **Full safety tooling** (X-Card with real scene-pause, content reporting, campaign bans, per-player blocking, lines/veils fed into the AI prompt) — not mentioned once in the competitive report's feature matrix for *any* platform, MythOS included, which suggests nobody benchmarked this. It's a real trust-and-safety advantage for a category that skews toward mature/dark content.
5. **Knowledge-relative character sheets** — a sheet shows only what the character has actually discovered in play, with per-character AI narration knowledge-gating. Distinct from every competitor's "GM knows everything, player sees everything" model.

### Player-facing terminology: PbtA/Urban Shadows leakage (flagged for cleanup)

The mechanical engine is genuinely PbtA/Urban-Shadows-*inspired* under the
hood, and that's fine as an internal architecture reference. The problem is
that this lineage leaks into **player-facing copy** as literal jargon a
tabletop-curious but PbtA-unfamiliar player won't recognize — confirmed
directly in the code, not assumed:

- Campaign creation template literally named **"PbtA Fantasy"** (`src/app/campaigns/page.tsx`)
- Help page copy: *"The system uses Powered by the Apocalypse (PbtA) rules for freeform storytelling"* (`src/app/help/page.tsx`)
- Character creation tab labeled **"Debts & Enemies"**, with **"Promises & Oaths"** and **"Debts"** sub-sections (`EnhancedCreateCharacterForm.tsx`)
- Character sheet sections labeled **"Harm"**, **"Obligations & Favors"**, **"Promises"**, **"Debts"**, and **"Moves"** / **"Moves Learned"** (`CharacterSheetDisplay.tsx`)

Contrast this with **stats**, which are *already* done right: stat names are
dynamically relabeled per campaign/universe (`Campaign.statLabels` — "Tonguefire,"
"Iron Nerve," "The Spark" instead of Apocalypse World's "Hot/Cold/Hard/Sharp/Weird").
The same treatment needs to extend to the mechanic *categories* themselves, not
just their values — a player in a hard-sci-fi universe shouldn't see a tab
called "Promises & Oaths," and nobody outside the PbtA hobby should hit "PbtA
Fantasy" as their first-ever template choice. This is now `#22` in the roadmap
below.

### Merged go-forward roadmap

Priorities below are the report's recommendations, filtered against what's
already shipped, cross-checked against the existing deliberate deferrals, and
merged with the in-flight Product Roadmap phases so there's one list instead
of two competing ones.

**Do first (small, high-leverage, unblocks everything else):**

- [ ] **#22 De-jargon player-facing mechanical language** — rename "PbtA Fantasy" template (e.g. "Fantasy Adventure"), rewrite the help-page PbtA callout in plain language, retitle "Debts & Enemies" / "Promises & Oaths" / "Obligations & Favors" / "Moves" to generic terms (e.g. "Ties & Rivals," "Vows," "Owed & Owing," "Techniques/Abilities") that read correctly regardless of universe. Keep the PbtA/Urban Shadows references as internal engineering docs (this README, code comments) — they're accurate and useful there. Do not rename underlying fields/APIs, only display strings, to avoid a schema migration for a copy change
- [ ] **#23 Surface the multiplayer story MythOS already tells** — the mechanics (no player cap, turn tracker, real-time chat, per-player block/report) already beat the report's read of "Partial." This is a marketing/onboarding gap, not an engineering one: make party play visible in the campaign creation flow and marketing copy
- [ ] **#24 Decide, on purpose, whether dice stay opt-in** — re-run the "mechanics invisible by default" decision against real playtest feedback now that #6–#11 (Debt/standing/harm) are live. If new players distrust GM rulings without seeing the roll, surface a lightweight always-visible roll indicator (not the full transparency panel) rather than reversing the design philosophy outright

**Near-term (report-informed, not yet in a phase below):**

- [ ] **#25 Scene illustration** — already tracked as `#14` in the Product Roadmap; the report independently flags this as High ROI for social sharing. Re-prioritize above Phase 4 monetization work if a cheap (Replicate/SDXL) integration is feasible before the next external cohort
- [ ] **#26 Shareable session recaps** — the chronicle-share link (`#15`, shipped) is the raw material; package a single resolved scene or short arc as a social-media-sized image/text card. Low engineering lift on top of what's already there
- [ ] **#27 Public API / developer access** — the one report recommendation with no existing decision on record. Needs an explicit yes/no before Phase 4 monetization work locks in pricing tiers, since a metered API would need its own cost model

**Reaffirmed as deliberately deferred** (the report treats these as gaps; the
team already made this call — listed here so the decision is visible instead
of silently absent from an outside audit):

- Native mobile app, voice/TTS, creator marketplace/UGC, VTT-style grid combat, 5e-style crunch/custom rule import — see "Explicitly deferred" at the end of the Product Roadmap below for the original rationale. Worth a fresh look only if a specific cohort's feedback contradicts the original "wrong stage" call, not on the report's say-so alone

**Explicitly not recommended:** chasing feature parity on things every
competitor already has cheaply (Lorebook-style canon injection, relationship
tracking, persistent memory) — MythOS already has all three, at a deeper
level than most of the report's comparators. The report's own conclusion is
correct: differentiation lives in the simulation depth and the Debt/standing
bridge, not in matching table-stakes features one-for-one.

## Product Roadmap (mechanical engine — internal codename: PbtA × Urban Shadows fusion)

*The section below documents the underlying mechanical engine's design
lineage for engineering reference. "PbtA" and "Urban Shadows" are internal
architecture terms, not the product's player-facing identity — see `#22`
above for the cleanup this implies for anything a player actually sees.*

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

### Foundation + Phases 0–1 — the mechanical spine ✅

All complete (detailed build notes preserved in this file's git history):

- **Knowledge-relative sheets & capabilities**: latent per-universe capability tree; sheets show only what the fiction has revealed (absent → GLIMPSED "???" → UNLOCKED with a qualitative band); origin-familiarity seeding; deterministic arc-capped growth from use and downtime training; per-character narration knowledge-gating
- **Server-rolled move resolution**: every risky action classified to a PbtA move and rolled 2d6 + stat + capability band + harm *on the server*; the outcome band binds the narration (weak hits cost, misses trigger a hard GM move); persisted receipts in the opt-in transparency panel — prose never mentions dice
- **Ops floor**: CI (tsc + vitest on every push), no more `--accept-data-loss` deploys, error monitoring webhook, JWT fallback secret killed, email verification + password reset
- **Async scene resolution**: submissions enqueue a `ResolutionJob` and return immediately; the AI-GM-plus-world-turn pipeline runs in a secret-gated internal route with atomic claims, retries, and traffic-driven recovery of stuck jobs — no cron needed

### Phase 2 — Product differentiation: the Urban Shadows fusion

Goal: mechanics and the living world become one system. Exit: the north-star
chain above works in a real playtest.

- [x] **#6 Debt economy**: first-class `Debt` records between PCs and NPCs/factions, incurred/resolved from the fiction, fed to the narrator as leverage, rendered diegetically ("Lord Kessler considers you in their debt")
- [x] **#7 Faction standing**: per-character standing (-3 hunted … +3 honored) shifted by scene outcomes; the roll modifier is computed against **live simulation state** — a collapsed faction's regard is worth 0, a war-weakened one caps at ±1 — so the offscreen tick literally changes what a player can roll
- [x] **#8 World-visibility digest**: MAJOR discovered-entity tick changes become a fog-safe "Word on the street…" notification per member after each world turn
- [x] **#11 Harm/death keyed to resolution**: 4+ harm applies Impaired −1 to every roll; misses are where harm comes from
- [x] **#9 Origin archetypes / playbook onboarding**: 4 per-universe archetype cards generated at campaign creation (grounded in the real generated factions/capabilities/stat labels); picking a card pre-fills the wizard (familiarity, a validated legal stat array, gear, inventory) and seeds a starting tie into the living world server-side (a Debt or faction standing with a *real* faction — invented ones are filtered out) plus extra capability glimpses; backstory questions appear as writing prompts. "Start from scratch" always remains. Still open: measuring signup-to-first-scene time
- [x] **#10 Corruption track (v1)**: per-universe "power at a cost", generated at creation and defined by what *this universe's fiction* treats as a devil's bargain — never by aesthetics (the generation prompt explicitly forbids equating dark-affinity power with corruption), and optional: a universe with no such concept generates `null` and the whole track stays invisible. Marks are AI-reported from the fiction (`corruption_change`), server-clamped to one per scene, irreversible, capped at 5; the AI is instructed to offer bargains sparingly at moments of desperation and sees each character's qualitative stage; reaching the cap applies the Consumed condition; the sheet renders the track diegetically (staged prose + marks, never "3/5") and only once it's been touched. **Bargains are mechanically binding (v2)**: a narrated offer is persisted (`bargain_offers` → `Character.pendingBargain`), and if the character's *next* action reaches for it (detected by the action classifier), the roll gets an engine-enforced +2 corruption surge, the receipt shows it, and the mark lands deterministically even if the narrator forgets to report it — refusing or ignoring the offer closes the window. **Shadow capability branches**: in a universe with a corruption theme, the capability scaffold's secret nodes become forbidden arts (`isShadow`) — anyone can glimpse that they exist, but unlocking one requires corruption marks ≥ the node's tier; the engine downgrades premature unlocks to glimpses ("it resists you — it wants more of you first") and the narrator is told which arts are forbidden so it can play the refusal. Mid-story discovered capabilities stay ordinary secrets, never accidentally forbidden
- [x] **#12 Alpha instrumentation**: a loose-coupled `AnalyticsEvent` log (no FK relations, so recording never fails on a constraint) fires at the five stages of the activation funnel — signup, campaign created, character created, scene started, action submitted (the last one doubles as the retention/DAU signal). **Stuck-scene alerting**: per-campaign recovery is traffic-driven (only runs when someone's looking at that campaign), so a global sweep piggybacked on the internal worker routes — which fire on any real usage across the whole app — scans every campaign for jobs stuck past a generous threshold and fires one alert each via the existing error webhook, deduped so a dead job is never re-alerted. **Playtest cohort dashboard** (`/admin/analytics`, gated by a `PLATFORM_ADMIN_EMAILS` allowlist — no schema-backed role needed for an operator-only page): funnel conversion, a 30-day signup chart, and D1/D7/D28 retention by weekly signup cohort (a fresh cohort shows "pending" rather than a misleading 0% until enough time has actually passed to measure it), plus a feed of recently stuck jobs

### Phase 3 — Expansion: content and shareability

Goal: easy to start, worth showing off. Exit: 3–5 external groups complete
4+ week campaigns with defensible D28 retention.

- [x] **#13 First-party campaign templates**: the 3 existing templates (PbtA Fantasy, MHA: UA Arc, Monster of the Week) are deepened to actually use the new economy instead of predating it. Each ships **front-style threats** (Apocalypse World-style danger clocks with a stated consequence, informationally linked to a real faction via `Clock.relatedFactionId` when it names one — e.g. "The Iron Company Tightens Its Grip"; deliberately not `sourceFactionId`, which is reserved for a faction's own tracked ambitions and would otherwise misroute the front's completion into the ambition resolver instead of a normal flavor-text event — this was a real bug in the first cut, now fixed), a **capability scaffold** (a fallback baseline seeded only when AI world generation didn't already produce a bespoke one — offline/no-API-key campaigns still get a working tree), and a **starting Debt** every character in that world begins already entangled in (seeded at character creation, since a Debt needs a real characterId that doesn't exist yet at campaign creation — `Campaign.templateId` persists which template to apply it from). Faction-name references degrade gracefully to unlinked-but-present when AI-generated factions replace the template's own. **Front-style threats are now universal**, not template-only: the same AI call that generates factions/capabilities/stat labels for EVERY campaign also generates 1-3 fronts, canon-grounded via the lore digest when imported lore exists — a custom-universe or lore-seeded campaign opens with a real ticking danger, not just factions and powers. `reseedWorldFromLore` adds newly-canon fronts too (name-deduped, purely additive in both fresh and live mode — fronts have no clean "provisional vs canon" identity to retire by, unlike factions)
- [ ] **#14 Scene illustration**: one generated image per resolved scene (deferred until mechanics landed; async resolution already keeps its cost/latency off the request path)
- [x] **#15 Chronicle share link**: a GM-toggled, off-by-default public link (`Campaign.chronicleShareEnabled`/`chronicleShareToken`, admin Settings tab) to an unauthenticated, read-only page (`/chronicle/[token]`) listing every resolved scene's narration in order — no login, no character sheets, no admin data, nothing not already fully resolved. Disabling clears the token rather than just flipping a flag, so re-enabling later can't resurrect an old, possibly-already-shared link
- [ ] Closed alpha with 3–5 external groups

### Phase 4 — Monetization and scale

Goal: prove people pay. Exit: sustainable unit economics on real cohorts.

- [ ] **#16 Free starter allowance + pricing validation**: the allowance half is done — signup grants a $1.00 one-time welcome credit (`addFunds` in `api/auth/signup`, best-effort/non-blocking) so a new user can actually play a scene without funding a balance first, closing the activation-funnel dead-end where every signup previously landed at `balance: 0`. Pricing validation itself (credits vs. subscription test; conversion + margin data from ≥50 paying users) still needs real cohort data this alone doesn't produce
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
