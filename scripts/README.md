# Database Setup Scripts

This directory contains scripts to help set up the PostgreSQL database with the required `pgvector` extension.

## Scripts

### `setup-pgvector.sh`

Automated installer for the pgvector PostgreSQL extension. This script:
- Detects your operating system (Ubuntu/Debian, macOS, RedHat/CentOS)
- Installs build dependencies
- Downloads and compiles pgvector from source
- Installs the extension into your PostgreSQL installation

**Usage:**
```bash
chmod +x scripts/setup-pgvector.sh
./scripts/setup-pgvector.sh
```

**Supported platforms:**
- Ubuntu/Debian (requires sudo)
- macOS (requires Homebrew)
- RedHat/CentOS (requires sudo)

### `init-db.sql`

Database initialization script that automatically enables the pgvector extension when using Docker. This script is automatically run when starting the PostgreSQL container via `docker-compose.yml`.

## Using Docker

The easiest way to get started with a properly configured database is using Docker:

```bash
# Start PostgreSQL with pgvector
docker-compose up -d

# Wait for database to be ready
docker-compose logs -f db

# Set your DATABASE_URL in .env
echo 'DATABASE_URL="postgresql://pguser:pgpassword@localhost:5432/interactive_stories"' >> .env

# Run migrations
npx prisma migrate dev
```

## Manual Installation

If you prefer to install pgvector manually:

1. **Ubuntu/Debian:**
   ```bash
   sudo apt install postgresql-server-dev-all build-essential git
   cd /tmp
   git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git
   cd pgvector
   make
   sudo make install
   sudo systemctl restart postgresql
   ```

2. **macOS:**
   ```bash
   brew install pgvector
   brew services restart postgresql
   ```

3. **Enable the extension in your database:**
   ```bash
   psql -U postgres -d your_database -c "CREATE EXTENSION IF NOT EXISTS vector;"
   ```

## Troubleshooting

### "ERROR: type 'vector' does not exist"
This means pgvector isn't installed. Run the `setup-pgvector.sh` script or follow the manual installation steps above.

### "permission denied" when running setup script
Make sure the script is executable:
```bash
chmod +x scripts/setup-pgvector.sh
```

### Docker container won't start
Check the logs:
```bash
docker-compose logs db
```

Make sure port 5432 isn't already in use:
```bash
lsof -i :5432
```

## Environment Variables for Docker

You can customize the Docker PostgreSQL setup by creating a `.env` file in the project root:

```env
POSTGRES_USER=myuser
POSTGRES_PASSWORD=mypassword
POSTGRES_DB=mydatabase
POSTGRES_PORT=5432
```

Then update your `DATABASE_URL` accordingly:
```env
DATABASE_URL="postgresql://myuser:mypassword@localhost:5432/mydatabase"
```
