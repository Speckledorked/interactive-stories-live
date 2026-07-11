# MythOS

*The world remembers.*

An AI-powered collaborative storytelling platform for running interactive narrative campaigns with an AI Game Master and a persistent, living world that keeps simulating itself even when nobody's looking.

## Features

- **AI Game Master**: Powered by OpenAI for dynamic story generation and scene resolution
- **Living World Simulation**: NPCs and factions pursue their own goals every turn, on and off screen — see [World Simulation](#world-simulation) below
- **Campaign Memory System**: Long-form continuity using RAG (Retrieval-Augmented Generation) with vector embeddings, so the AI can recall specific past events and consequences instead of improvising them fresh
- **Real-time Collaboration**: Live updates using Pusher for chat, notifications, and scene updates
- **PbtA-inspired Mechanics**: Powered by the Apocalypse game system integration, including a full harm/death-save system
- **Character Management**: Detailed character sheets with stats, moves, conditions, and progression
- **Scene Management**: Dynamic scenes with player actions and AI resolution
- **Payment System**: Stripe integration for AI usage billing

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

Set a faction's **Simulation Goal** and **Archetype** from the campaign
admin panel (Factions tab) to opt it into this system.

## Living World Roadmap

The long-term goal is a world that simulates itself autonomously — factions,
NPCs, and territory that tick forward on their own agendas whether or not
players are present — and remembers everything that happens well enough to
answer for it later, the way a human GM running a Crusader Kings-style
campaign would. This list tracks that effort phase by phase. Phases 1–2 are
live in production; everything below them is ordered, not scheduled — check
items off as they land and update this list in the same PR that does the
work.

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

### Phase 4 — NPCs and Territory in the Web
Without these links, "war" and "politics" have no map to redraw and no one for the outcome to happen to.
- [ ] NPC → Faction affiliation (leader / member / rival), and wiring it into tick logic and prompts
- [ ] Faction → Territory ownership on Location
- [ ] Contested / border territory state
- [ ] NPC defection — an NPC's faction allegiance can change based on events, not just their goal text
- [ ] Faction leadership continuity — when a leader NPC dies, a successor is chosen automatically instead of the faction going headless
- [ ] NPCs made notable through play (spared, betrayed, promoted) get their own independent goal-pursuit loop, the same way factions do today, not just a static memory of what happened to them

### Phase 5 — Sustained Conflict & War
- [ ] A real multi-turn conflict object (declared → escalating → resolving → resolved) instead of a single-shot Clock standing in for a war
- [ ] Attrition/momentum tracked per tick, drawing from and feeding back into the involved factions' military and resources
- [ ] Multi-faction alliances/coalitions inside one conflict
- [ ] War resolution mechanically changes territory ownership, faction relationships, and the losing side's goal/stats
- [ ] Offscreen war narration reads from and updates this conflict state, instead of improvising an isolated flavor event each time

### Phase 6 — Player-Faction Integration
- [ ] PC → Faction leadership binding, so "I am the president of X" is a role the engine understands, not just fiction
- [ ] Player decisions can directly set a led faction's goal/strategic posture
- [ ] Player-led factions still tick autonomously between sessions under the same rules as NPC-led ones, rather than freezing when the player isn't actively directing them
- [ ] Fog of war — players learn faction/war state through in-fiction discovery (rumors, informants, scouting) rather than the AI narrating from omniscient access to the full simulation state (stretch — overlaps prompt design as much as simulation)

### Phase 7 — Memory & Discovery at Scale
- [ ] Memory importance decay / summarization so campaign memory stays cheap and retrievable after hundreds of turns, not just dozens
- [ ] Cross-entity memory queries ("what happened between X and Y") in addition to today's per-entity and semantic search
- [ ] Player-facing world-state views — faction standings, territory, known rumors — surfaced in the UI instead of only through in-fiction discovery

### Phase 8 — Tooling & Scale (stretch)
- [ ] Parameterize the per-tick faction/NPC caps (`FACTION_CAP = 10`, `NPC_CAP = 20`) as campaigns grow beyond current defaults
- [ ] Admin visualization of faction relationships and territory (a simple map or graph view)
- [ ] Simulation debug tooling — replay a tick, inspect why a given decision was made

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
