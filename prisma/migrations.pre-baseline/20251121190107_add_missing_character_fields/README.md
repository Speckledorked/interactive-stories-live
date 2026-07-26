# Migration: Add Missing Character Fields

## Issue
The production database is missing the `statUsage` column on the `Character` table, causing P2022 errors:
```
Invalid `prisma.campaign.findUnique()` invocation:
The column `Character.statUsage` does not exist in the current database.
```

## Solution
This migration adds the missing `statUsage` JSONB column to the Character table.

## How to Apply

### Option 1: Using Prisma Migrate (Recommended)
```bash
npx prisma migrate deploy
```

### Option 2: Using Prisma DB Push
```bash
npx prisma db push
```

### Option 3: Manual SQL
If you need to apply this manually, run the SQL in `migration.sql` against your database.

## Verification
After applying, verify the column exists:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'Character' AND column_name = 'statUsage';
```

## Related
- Commit: 4d8271d "Implement organic character advancement and inventory systems"
- Schema file: prisma/schema.prisma:189
