-- Debt repairs (game/integrity/) need their own target type: a Debt's
-- counterpartyId doesn't map to a Character row, so reusing CHARACTER for
-- it would be misleading in the WorldEvent log.
ALTER TYPE "WorldEventTargetType" ADD VALUE 'DEBT';
