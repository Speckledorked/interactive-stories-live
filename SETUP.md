# Setup Instructions

## Quick Start (Recommended: Using Docker)

The fastest way to get started is using Docker, which includes PostgreSQL with pgvector pre-installed:

```bash
# 1. Start PostgreSQL with pgvector
docker-compose up -d

# 2. Create .env file and configure database
cp .env.example .env
# Edit .env and set: DATABASE_URL="postgresql://pguser:pgpassword@localhost:5432/interactive_stories"

# 3. Run migrations
npx prisma migrate dev

# 4. Start the application
npm run dev
```

See [docker-compose.yml](docker-compose.yml) and [scripts/README.md](scripts/README.md) for more details.

## Manual Setup

If you prefer not to use Docker, follow these steps:

## Environment Variables

The application requires several environment variables to function properly. Follow these steps:

1. **Copy the example file:**
   ```bash
   cp .env.example .env
   ```

2. **Configure DATABASE_URL:**
   - You need a PostgreSQL database
   - Update the `DATABASE_URL` in `.env` with your database connection string
   - Format: `postgresql://user:password@host:port/database`

3. **Set JWT_SECRET:**
   - Generate a secure random string for JWT tokens
   - Example: `openssl rand -base64 32`

4. **Configure OpenAI API (Required for AI features):**
   - Get an API key from https://platform.openai.com/api-keys
   - Set `OPENAI_API_KEY` in your `.env`

5. **Configure Pusher (Required for real-time features):**
   - Sign up at https://pusher.com
   - Create an app and get your credentials from the dashboard
   - Set the following variables in your `.env` or `.env.local`:
     - `PUSHER_APP_ID` - Your Pusher app ID
     - `PUSHER_KEY` - Your Pusher key (for server-side)
     - `PUSHER_SECRET` - Your Pusher secret (keep this secure!)
     - `PUSHER_CLUSTER` - Your Pusher cluster (e.g., "mt1", "us2", "eu")
     - `NEXT_PUBLIC_PUSHER_KEY` - Your Pusher key (for client-side)
     - `NEXT_PUBLIC_PUSHER_CLUSTER` - Your Pusher cluster (for client-side)
   - **Note:** After adding/updating `.env.local`, restart your dev server for changes to take effect
   - Without Pusher, features like chat, notifications, and live scene updates won't work

## Database Setup

### Prerequisites: Install pgvector Extension

**IMPORTANT:** This application requires the PostgreSQL `pgvector` extension for the Campaign Memory RAG system. You must install it before running migrations.

#### Automated Installation (Recommended)

We provide a script that automates the installation process:

```bash
chmod +x scripts/setup-pgvector.sh
./scripts/setup-pgvector.sh
```

This script will detect your OS and install pgvector automatically. After installation, follow the script's instructions to enable the extension and run migrations.

#### Manual Installation

##### On Ubuntu/Debian:
```bash
# Install build dependencies
sudo apt update
sudo apt install -y postgresql-server-dev-all build-essential git

# Clone and install pgvector
cd /tmp
git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git
cd pgvector
make
sudo make install

# Verify installation
psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

##### On macOS (with Homebrew):
```bash
brew install pgvector
```

##### On Docker:
Use the `pgvector/pgvector:pg16` image instead of the standard PostgreSQL image:
```yaml
# docker-compose.yml
services:
  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
      POSTGRES_DB: dbname
    ports:
      - "5432:5432"
```

##### Verifying pgvector Installation:
```bash
psql -U postgres -d your_database -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

If successful, you'll see: `CREATE EXTENSION` or `NOTICE: extension "vector" already exists`

### Running Migrations

After configuring your `.env` file and installing pgvector:

```bash
# Generate Prisma Client
npx prisma generate

# Run database migrations
npx prisma migrate dev

# (Optional) Seed the database
npx prisma db seed
```

## Running the Application

```bash
# Development mode
npm run dev

# Production build
npm run build
npm start
```

## Troubleshooting

### "ERROR: type 'vector' does not exist"
This error means the `pgvector` extension is not installed in your PostgreSQL database.

**Solution:**
1. Follow the [pgvector installation instructions](#prerequisites-install-pgvector-extension) above
2. Verify the extension is available: `psql -U postgres -c "SELECT * FROM pg_available_extensions WHERE name = 'vector';"`
3. Create the extension in your database: `psql -U postgres -d your_database -c "CREATE EXTENSION IF NOT EXISTS vector;"`
4. Re-run migrations: `npx prisma migrate dev`

If you're using a managed PostgreSQL service (like Heroku, Railway, Supabase):
- **Supabase:** pgvector is pre-installed, just enable it in the SQL editor: `CREATE EXTENSION IF NOT EXISTS vector;`
- **Railway/Heroku:** You may need to use a Docker deployment with the `pgvector/pgvector` image
- **AWS RDS:** pgvector is available in PostgreSQL 15.2+ - enable it via the AWS console or SQL

### "Environment variable not found: DATABASE_URL"
- Make sure you have created a `.env` file (not `.env.example`)
- Ensure DATABASE_URL is properly set in the `.env` file

### Campaign creation fails with internal server error
- Check that your DATABASE_URL is correct and the database is accessible
- Verify that migrations have been run: `npx prisma migrate dev`
- Check the console for specific error messages

### Build fails with Pusher errors
- This should be fixed with fallback values, but ensure your `.env` has the Pusher variables (or set them to placeholders)
