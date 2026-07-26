# Database migration strategy

## Current state

Deploys run `prisma migrate deploy` (see `vercel.json`). Production was
baselined once (`prisma/migrations/0_baseline`, generated from the schema as
it stood when several `db push`-only deploys in a row were failing on real
column drops — see the Known Bugs entry this replaced) and every migration
since applies in order on top of that.

`prisma/migrations.pre-baseline/` is the old, drifted history kept for
reference only — it no longer matches reality (see below) and is not
applied by anything.

**Every schema change from here on is a real migration**, generated
locally and committed alongside the code that needs it:

```bash
npx prisma migrate dev --name <what-changed>
```

Do not hand-edit `schema.prisma` and rely on the deploy to reconcile it —
`migrate deploy` only ever runs the SQL files already in
`prisma/migrations/`; it does not diff `schema.prisma` against the database
the way `db push` did. A schema change with no matching migration file
deploys as if it never happened.

## Why this replaced `db push`

The previous setup ran `prisma db push` (without `--accept-data-loss`) as
the first step of the build command. That was a deliberate guardrail —
`db push` diffs `schema.prisma` against the live database directly, and
without the flag it fails loudly rather than silently deleting data on a
destructive change (dropping a column/table, narrowing a type). It did its
job: four dead-field removals in the same week (`drop_capability_parent`,
`drop_character_zone`, `drop_dead_notification_prefs`, `drop_dead_fields`)
each dropped a real column, so every deploy after the first of them failed
outright — correctly, but with no way to distinguish "the guardrail caught
something real" from "something is broken" short of reading the build log.

`migrate deploy` doesn't have that failure mode at all: nothing gets
diffed or confirmed at deploy time. The safety moved earlier, to migration
generation (`prisma migrate dev` shows you the SQL — including any
data-loss warning — before it's committed), which is where a human
actually reviewing a destructive change belongs, rather than a build log
nobody's watching at 2am.

## How the baseline was done (for reference — already applied)

`prisma/migrations/` had drifted from the schema — later models were only
ever applied via `db push`, never recorded in `_prisma_migrations`. Adopting
`migrate deploy` required baselining production once:

1. Archived the stale history: `prisma/migrations/` → `prisma/migrations.pre-baseline/`.
2. Generated a single baseline migration from the schema as it stood at the
   time:
   ```bash
   mkdir -p prisma/migrations/0_baseline
   npx prisma migrate diff --from-empty \
     --to-schema-datamodel prisma/schema.prisma \
     --script > prisma/migrations/0_baseline/migration.sql
   ```
3. Marked it as already applied in production (the tables all already
   existed — this step only writes to `_prisma_migrations`, it runs no
   schema SQL):
   ```bash
   DATABASE_URL="<prod url>" npx prisma migrate resolve --applied 0_baseline
   ```
4. Switched `vercel.json`'s `buildCommand` to
   `prisma migrate deploy && prisma generate && next build`.

Verified locally before doing this against the real database: pushed the
current schema onto a throwaway Postgres via `db push` (standing in for
what production already looked like), ran steps 2-3 against it, then
`migrate deploy` — confirms clean with nothing pending. Ran the same
throwaway setup *without* step 3 as a control: `migrate deploy` fails
immediately with `P3005` ("database schema is not empty"), which is what
skipping the resolve step against the real database would have done.

**Step 3 needs real production `DATABASE_URL` access and must run before
`vercel.json`'s new `buildCommand` reaches `main`** — `deploymentEnabled.main`
is `true` in `vercel.json`, so a merge triggers a deploy immediately, and an
unresolved baseline means that deploy hits the same `P3005` the control run
did.
