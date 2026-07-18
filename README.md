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
wrapper around a chatbot. A handful of systems that *look* equally systemic
currently aren't — most notably a confirmed dead-logic bug in memory
importance scoring, and a couple of places where real-looking deterministic
machinery is wired to nothing (see [Known Issues](#known-issues) and the
[Depth Hardening](#-now--depth-hardening-highest-roi) backlog). Nothing below
overstates what's shipped; where something is cosmetic, it's labeled that way.

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
| Capability / skill-tree progression | 4 | Glimpse→unlock→progress state machine, feeds roll modifiers directly. |
| Character harm/death state machine | 4 | Full model: auto-conditions, death saves, permanent injury, engine-arbitrated recovery. |
| Corruption track | 4 | Theme-gated, irreversible, force-applied backstop even if the AI forgets to narrate it. |
| Consequence engine (player action → faction/NPC state) | 4 | Deterministic per-action deltas, same rigor as faction tick. |
| Character progression (advancement) | 4 | Usage-gated growth with real PbtA constraint validation, not a level-up button. |
| Memory retrieval (RAG) | 4 | Genuine pgvector cosine search, cost-tracked, well-designed consolidation. |
| AI response validation | 4 | Real 4-level fallback — but degrades silently rather than repairing (see Known Issues). |
| Quest lifecycle | 3 | Real state transitions and progress log; completion doesn't code-enforce any reward/consequence. |
| Downtime activities | 3 | Costs (gold/items/favor/quest) are genuinely charged; day-by-day "events" are freeform AI prose with no state machine behind them. |
| NPC goal/movement simulation | 3 | Real location relevance and goal-completion cascades; the phase-cycle text itself is mostly decorative. |
| **Memory importance/tag classification** | **2 (confirmed bug)** | Reads AI-response field names that don't exist in the actual schema — silently dead on every call. See Known Issues #1. |
| Relationships (trust/tension/respect/fear) | 2 | Real, clamped, persisted numbers — never read by the resolution engine. Narrative-only. |
| Clock advancement (non-ambition clocks) | 2 | Weighted coin flip; the code's own comment says the intended faction-relation-driven design was never implemented. |
| Inventory / items | 2 | JSON-blob CRUD; one narrow real mechanic (armor damage reduction), no general item identity. |
| Weather | 2 (cosmetic) | Rigorously deterministic (stable-hash, not `Math.random`) — and confirmed to have zero mechanical consumers anywhere. Pure narration input. |
| Combat / complex exchange resolution | 2 | No dedicated combat system; conflict "detection" is keyword matching that hands off to an AI prompt instead of resolving anything. |
| DB `Move` table | 1 | Seeded and exported, never read by the live resolver (which uses a static file instead). Duplicated concept, no single source of truth. |
| `TurnOrder` model | 0 | Zero live references anywhere in the codebase. Fully dead schema. |
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

**Surface area** (architecturally dressed like the systems above; the
substance doesn't hold up on inspection — see Known Issues):
`lib/game/complex-exchange-resolver.ts` (a keyword classifier that hands
conflicts to a prompt, not a resolver) · `lib/ai/memoryCreation.ts` (real
embedding call, but the importance/tag classifier reads nonexistent field
names) · `lib/game/tick/weatherTick.ts` (a genuinely deterministic engine
wired to nothing that reads it mechanically).

## Known Issues

Confirmed by direct code inspection, not inferred. Ranked by how easy an
outside reader would be to fool by them, since that's also roughly the order
they're worth fixing.

1. **Memory importance/tagging is silently dead.** `lib/ai/memoryCreation.ts`'s
   `determineImportance()`/`extractTags()` branch on `updates.character_updates`,
   `updates.clock_updates`, `updates.faction_updates` — field names that appear
   nowhere else in the codebase. The real `AIGMResponse.world_updates` shape
   uses `pc_changes`/`clock_changes`/`faction_changes`. Every call silently
   falls through to `'NORMAL'` importance; several tag categories never fire.
   No test catches it because it fails soft, not with an error.
2. **No repair/retry on malformed AI JSON.** `lib/ai/validation.ts`'s 4-level
   fallback degrades gracefully (full schema → minimal → loose extraction →
   canned template) but never re-prompts. Below Level 1, `world_updates`
   becomes `{}` and a scene's mechanical consequences vanish with only a
   console warning as evidence.
3. **Clock advancement is a coin flip**, not faction-driven, despite the
   schema already having the fields (`Clock.sourceFactionId`/`relatedFactionId`)
   to do it properly — the code's own comment admits the intended design was
   never wired up.
4. **`ComplexExchangeResolver` doesn't resolve anything.** It classifies
   action text by keyword match and hands the AI a formatted instruction
   paragraph. There is no dedicated combat system in this codebase — combat
   uses the same PbtA resolution as any other action.
5. **Relationships are write-only.** `trust`/`tension`/`respect`/`fear` are
   real, clamped, persisted deltas — but nothing in the resolution engine
   reads them. Contrast with Debt/Standing, which are consumed identically in
   shape but actually feed roll modifiers.
6. **Quest completion doesn't propagate.** The lifecycle is real; nothing
   code-enforces `reward` when a quest closes — it depends entirely on the AI
   separately remembering to narrate a matching change the same turn.
7. **Inventory has almost no item identity** beyond one narrow, string-matched
   armor-reduction heuristic. There is no `Item` table (`itemRegistry.ts` is
   explicit about this — it aggregates per-character JSON blobs for wiki
   display, nothing more).
8. **`TurnOrder` and the DB `Move` table are dead/vestigial** and should be
   either wired up or removed — right now they imply features to anyone
   reading the schema that the live resolver doesn't use.
9. **Basic JSON mode, not strict structured outputs.** The AI GM call uses
   `response_format: json_object`, not OpenAI's `json_schema` strict mode —
   more room for shape violations to reach the fallback ladder in #2 than
   necessary.

## Roadmap

### 🔧 Now — Depth Hardening (highest ROI, from the audit)

Small, mostly mechanical fixes that close the gap between "looks systemic"
and "is systemic" — several are near-zero-cost because the surrounding
infrastructure already exists.

- [ ] **#28 Fix the memory-importance field-name bug** — point `determineImportance()`/`extractTags()` at the real `world_updates` field names (`pc_changes`/`clock_changes`/`faction_changes`/`new_timeline_events`). Restores an entire subsystem for the cost of a rename.
- [ ] **#29 Wire relationships into roll math** — add a small trust/fear-derived modifier to `computeMechanics()`, parallel to `standingMod`, so the data structure becomes a mechanic instead of narrative color.
- [ ] **#30 Faction-driven clock advancement** — replace the random-chance rate with logic keyed off `Clock.sourceFactionId`/`relatedFactionId`, finishing what the schema already implies.
- [ ] **#31 Deterministic quest-completion consequence hook** — auto-apply `reward` (parsed into gold/item/standing) on `status: COMPLETED`, the same way corruption surge is force-applied regardless of AI narration.
- [ ] **#32 Real conflict resolution for complex exchanges** — replace keyword-classify-and-punt with actual priority/roll-order rules; this is the single biggest gap between "PbtA-style freeform combat" as described and what the code does.
- [ ] **#33 Minimal item-type schema** — `damageBonus`/`armorValue`/`consumable` fields so inventory items carry mechanical identity beyond the one existing armor heuristic.
- [ ] **#34 Retire or activate dead schema** — `TurnOrder` and the DB `Move` table.
- [ ] **#35 Move to strict structured outputs** (`json_schema`) for the AI GM response, catching shape violations before they reach the fallback ladder.
- [ ] **#36 Add a repair/retry pass to `validation.ts`** — re-prompt with the validation error on Level 2/3 fallback instead of silently accepting world-update loss.
- [ ] **#37 Bound worst-case prompt/context size explicitly** — a hard cap/summarization pass on the *live* world-state payload (context filtering exists; nothing bounds the worst case for a maximally active long campaign).

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

**Honest caveat** (see Status at a Glance / Known Issues): weather is part of
this same deterministic tick and computed with the same rigor as everything
above, but currently has no mechanical consumer — it's narration input only,
not yet a gameplay variable.

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
