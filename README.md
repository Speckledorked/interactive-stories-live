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
- **Lore Import**: feed the AI GM reference material — pasted text, a single page URL, or an entire MediaWiki wiki (Fandom, wiki.gg, ...) crawled via its API — chunked, embedded, and retrieved per scene as canon for the narrator
- **Quest & Item Tracking**: the fiction's concrete undertakings get a real lifecycle (registered → progress beats → completed/failed/abandoned) fed back to the AI and synced to the wiki, and the party's inventories aggregate into a browsable item registry
- **Payment System**: Stripe integration for AI usage billing, with per-call cost tracking, balance gating, and per-user rate limiting on every AI-invoking route
- **Input Moderation**: player free-text is screened (OpenAI moderation endpoint) before it ever reaches the completion model — provider-ToS protection, separate from the in-fiction X-Card safety tool

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
- **Custom-universe world generation fixed** — template-less campaigns now persist their AI-generated factions (they were generated and silently discarded), and writing your own opening world seed no longer disables faction/capability/stat-label generation
- **Campaign memory unbroken** — the RAG memory raw SQL targeted snake_case columns that don't exist (Prisma created camelCase); every memory write/read/consolidation had been silently failing

### Phase 9 — True Autonomy (next)

Goal: the world moves even when nobody is playing, and imported lore shapes
the world's *structure*, not just its narration.

- [ ] **Real-time heartbeat**: a scheduled job advances in-game time for active campaigns at a configurable rate (e.g., one fictional day per real day), driving the same paced world turn — log in after a week away and the war is lost, the duke is dead. This is the last gap between "simulates between actions" and "simulates, period": today every tick is still *triggered* by player traffic, even though it's now *paced* by fiction time. Needs the project's first scheduled/cron infrastructure
- [ ] **Lore-aware world generation**: founding factions, the capability scaffold, and stat labels are generated at campaign creation — *before* lore can be imported — so a campaign's great houses can't come from the wiki you feed it a minute later. Allow lore import during creation and/or a "regenerate world from lore" pass that seeds factions and capabilities from imported material
- [ ] **Witnessing the living world**: the simulation generates more than players ever perceive. "While you were away" recaps when a world turn ran, and scene openings that surface off-screen fallout more aggressively — the machinery should be *felt*, not just logged
- [ ] **NPC society**: NPC↔NPC relationships, joint schemes, and independent movement between locations — faction-level politics is rich, individual-level society is thin

### Hardening backlog (known gaps from a full codebase audit)

- [ ] Tutorial completion triggers are never sent from the app — every new user's onboarding is permanently stuck at 0%
- [ ] X-Card safety dropdown offers 11 trigger reasons but the API's enum accepts 5 — 10 of 11 options fail with a 400 (safety-critical, cheap fix)
- [ ] Mention/whisper/note-share notifications have a fully built read side (panel, filters, sounds) and no writer
- [ ] Safety admin panel is a self-declared stub — content reporting, user blocking, and campaign banning exist as a service with no routes or UI
- [ ] Dead schema surface to clean or wire: `Session*` models + orphaned transcript-export route, `Campaign.mentionsEnabled`/`soundEffectsEnabled`, `Character.experience` (an XP counter nothing increments)

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
- [ ] **#9 Origin archetypes / playbook onboarding**: *(v1 shipped: origin familiarity + discovery seeding)* — still open: full creation presets per origin and signup-to-first-scene under 5 minutes
- [ ] **#10 Corruption track**: per-universe "power at a cost" — marking corruption grants power now, unlocks a shadow capability branch, and accumulates toward irreversible consequences
- [ ] **#12 Alpha instrumentation**: funnel/retention events, stuck-scene alerting, playtest cohort dashboard

### Phase 3 — Expansion: content and shareability

Goal: easy to start, worth showing off. Exit: 3–5 external groups complete
4+ week campaigns with defensible D28 retention.

- [ ] **#13 First-party campaign templates**: 3–5 templates tuned to the new ruleset — factions, starting Debts, front-style threats, capability scaffolds
- [ ] **#14 Scene illustration**: one generated image per resolved scene (deferred until mechanics landed; async resolution already keeps its cost/latency off the request path)
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
