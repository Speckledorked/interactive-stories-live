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
| Inventory / items | 3 | Improved (`#33`): a structured `armorValue` is now honored exactly when present, falling back to the keyword heuristic otherwise. Still JSON-blob CRUD with no general item identity beyond armor. |
| Downtime activities | 4 | Fixed: day-by-day events now roll a deterministic, riskLevel-weighted outcome category (`decideDowntimeDayEvent`) before the AI narrates, replacing a bare `Math.random()` coin flip and fully-freeform event nature. Entry costs (gold/items/favor/quest) were already genuinely enforced. |
| NPC goal/movement simulation | 4 | Fixed: goal progress is now phase-weighted (`acting` 2x, `preparing` 1x, `observing`/`resting` 0.5x baseline) — all four plan phases carry real mechanical weight now, not just `acting`'s joint-scheme gating. Overall completion pace unchanged (weights average to the prior flat rate). |
| Weather | 4 | Fixed: a deterministic `weatherPenalty` now shifts rolls (-1) in severe non-benign conditions (severity 4+, excluding CLEAR/CLOUDY) at the acting character's location — the first real mechanical consumer of the tick's weather state. |
| DB `Move` table | 5 | Fixed (`#38`): the fixed 7 `BASIC_MOVES` stay the single mechanical source of truth, but each campaign now gets its own AI-generated flavor text (name/trigger/outcome prose) for them, the same relationship `statLabels` has to the 5 fixed stat keys — and unlike the old per-template `defaultMoves` it replaced, it's genuinely read at roll time: `computeMechanics()` looks flavor up by `Move.baseMoveKey` and the result feeds both the transparency-panel receipt and the AI narrator's `move_name`/`outcome_text`. No flavor generated (no API key, generation failed) just falls back to `BASIC_MOVES`' own generic text — never a broken roll. |
| `TurnOrder` model | — (removed) | Fixed (`#34`): zero live references anywhere, so the model was dropped from the schema entirely rather than left to imply a feature that doesn't exist. |
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
July 2026 audit's Depth Hardening pass and its follow-up round (see
Roadmap) — most of what that audit found has since been fixed; this is
what's still actually true today.

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

## Roadmap

### 🔧 Now — Depth Hardening (highest ROI, from the audit)

Small, mostly mechanical fixes that close the gap between "looks systemic"
and "is systemic." Nine of ten shipped in one pass (see Shipped below) —
several were near-zero-cost because the surrounding infrastructure already
existed. One remains, deliberately not attempted blind:

- [ ] **#35 Move to strict structured outputs** (`json_schema`) for the AI GM response, catching shape violations before they reach the fallback ladder. Blocked on live-API verification — see Known Issues #1 for why this specifically wasn't attempted without it.

### 🎯 Next — Product & Market

Carried over from a July 2026 competitive-intelligence pass (benchmarked
against Friends & Fables, AI Dungeon, NovelAI, Hidden Door, Inworld AI,
Character.AI, Fable/Showrunner, KoboldAI/SillyTavern, Convai). That report was
written without codebase access and undersold what's shipped — the confirmed
differentiators are the Debt/standing bridge to a live simulation (no
comparator in the report does this), fog-of-war enforced at the API layer
(not just prompted away), and full safety tooling (not benchmarked for any
platform in the report, MythOS included). Its two genuinely correct findings
are folded in below.

- [ ] **#22 De-jargon player-facing mechanical language** — rename the "PbtA Fantasy" template, rewrite the help-page PbtA callout in plain language, retitle "Debts & Enemies" / "Promises & Oaths" / "Obligations & Favors" / "Moves" to generic terms that read correctly regardless of universe. Internal code/docs keep the PbtA/Urban Shadows references — they're accurate there. Display strings only, no schema migration.
- [ ] **#23 Surface the multiplayer story MythOS already tells** — no player cap, a real turn tracker, live chat, per-player block/report already beat the report's read of "Partial." Marketing/onboarding gap, not an engineering one.
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
