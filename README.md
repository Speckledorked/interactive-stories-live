# MythOS

*The world doesn't wait for you.*

Leave a city mid-crisis and come back a month later — it may have fallen,
been saved by someone else, or quietly changed hands while you were gone.
MythOS is built on top of a real simulation that keeps
running whether or not anyone's at the table: NPCs pursue their own goals,
factions rise, fight, and collapse, seasons turn, and every consequence of
what you did — a debt owed, a wound taken, a promise broken — is written
into durable, structured state that keeps compounding long after the scene
ends. The AI's job is to narrate what that simulation already decided. It
never invents an outcome from scratch.

## What that actually means

- **The world moves without you.** A deterministic "world tick" advances
  NPCs, factions, weather, and territory once real in-game time has
  passed — independent of whether players are present. Wars start and end
  offscreen. Leadership changes. None of it waits for your next session.
- **Consequences are mechanical, not just narrated.** A debt, a faction's
  standing, a wound, a broken promise — these are real, persisted numbers
  that change what you can roll next time, not flavor text the AI might
  happen to remember.
- **The AI narrates. It doesn't decide.** Every risky action is resolved by
  a real, server-side 2d6 roll before the AI ever writes a word about it —
  the model classifies what you're attempting and describes what happened;
  it does not get to choose whether you succeed.
- **Rolls are real and auditable.** Every roll is persisted as a receipt you
  can inspect, and the game tracks whether the narration actually matched
  what the dice said.

MythOS is not a chatbot improvising a story with you. It's not a
choose-your-own-adventure with an LLM stapled on. It's a living simulation,
and the AI is the voice that tells you what it already decided.

Curious how any of this actually works — what's built, what's tested,
what's still rough, and what's next? The full technical audit lives in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Prerequisites

- **Node.js** 18+ and npm
- **PostgreSQL** 15+ with **pgvector extension** — required
- **OpenAI API** key
- **Pusher** account for real-time features
- **Stripe** account for payment processing (optional for development)

### pgvector

This application uses PostgreSQL's `pgvector` extension for the campaign
memory RAG system. It must be installed before running the application.

**Easiest option:** Docker (pgvector pre-installed):
```bash
docker-compose up -d
```

**Alternative:** install manually:
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

See [SETUP.md](SETUP.md) for detailed manual setup instructions including
installing PostgreSQL and pgvector, configuring environment variables,
setting up Pusher and OpenAI, and troubleshooting common issues.

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
├── docs/
│   ├── ARCHITECTURE.md   # Full technical audit: what's built, tested, and next
│   ├── design-system.md  # UI conventions: tokens, type scale, primitives, chrome
│   └── MIGRATIONS.md     # How to write and apply schema migrations
├── docker-compose.yml    # Docker setup with pgvector
└── SETUP.md             # Detailed setup guide
```

## Key Technologies

- **Framework**: Next.js 14 (App Router)
- **Database**: PostgreSQL 15+ with Prisma ORM
- **Vector Search**: pgvector for semantic similarity
- **AI**: OpenAI (configurable model tiers — see `src/lib/ai/models.ts`) for
  story generation, with a multi-model fallback chain and an opt-in
  per-scene image-generation model
- **Real-time**: Pusher for live updates
- **Styling**: Tailwind CSS over the `myth` design token system (light/dark
  with a manual toggle) — conventions in `docs/design-system.md`. Every
  interactive control comes from `src/components/ui/`; don't hand-style a
  raw `<button>` or `<input>`.
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
