-- Drop DiceRoll.moveId (depth audit follow-up, July 2026): a real roll's
-- move always comes from BASIC_MOVES (lib/pbta-moves.ts), which has no row
-- in the Move table at all — Move is per-template flavor-move storage for
-- campaign export/import, a different concept entirely (see the Move
-- model's doc comment in schema.prisma). This FK could never be populated
-- with a semantically correct value; confirmed zero application-code
-- references before removal.
--
-- IF EXISTS throughout: like TurnOrder before it, no migration ever
-- tracked this column's original creation, so this is safe whether or not
-- a given database actually has it.

-- DropForeignKey
ALTER TABLE "DiceRoll" DROP CONSTRAINT IF EXISTS "DiceRoll_moveId_fkey";

-- DropColumn
ALTER TABLE "DiceRoll" DROP COLUMN IF EXISTS "moveId";
