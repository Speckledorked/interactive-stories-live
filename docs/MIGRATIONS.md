# Database migration strategy

## Current state

Deploys run `prisma db push` (see `vercel.json`). **The `--accept-data-loss`
flag has been removed**: a schema change that would destroy data (dropping a
column/table, narrowing a type) now **fails the deploy loudly** instead of
silently deleting production data. Additive changes — which is everything
this project has shipped — apply exactly as before.

If a deploy fails with a data-loss warning, that is the guardrail working.
Decide explicitly: either rework the schema change to be additive, or run the
destructive push once by hand with full knowledge of what it deletes:

```bash
DATABASE_URL="<prod url>" npx prisma db push --accept-data-loss
```

## Migrating to real migrations (recommended before public users)

`prisma/migrations/` contains 8 early migrations that have drifted from the
schema — many later models were only ever applied via `db push`. To adopt
`prisma migrate deploy` (versioned, reviewable, reversible-by-plan
migrations), the production database must be *baselined* once. This requires
access to the production `DATABASE_URL` and ~10 minutes:

1. **Archive the stale history** (it no longer matches reality):
   ```bash
   mv prisma/migrations prisma/migrations.pre-baseline
   ```
2. **Generate a single baseline migration from the current schema:**
   ```bash
   mkdir -p prisma/migrations/0_baseline
   npx prisma migrate diff --from-empty \
     --to-schema-datamodel prisma/schema.prisma \
     --script > prisma/migrations/0_baseline/migration.sql
   ```
3. **Mark it as already applied in production** (the tables all exist):
   ```bash
   DATABASE_URL="<prod url>" npx prisma migrate resolve --applied 0_baseline
   ```
4. **Switch the deploy command** in `vercel.json`:
   ```
   prisma migrate deploy && prisma generate && next build
   ```
5. From then on, every schema change is `npx prisma migrate dev --name <what-changed>`
   locally, committed alongside the code that needs it.

Until step 3 can be run against the real database, `db push`
(without `--accept-data-loss`) is the safer interim: additive-only by
default, loud on anything destructive.
