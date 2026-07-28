-- Extends WorldEventTargetType for the Integrity Engine (game/integrity/),
-- which reports repairs on Clock/Quest/War/Character rows in addition to
-- the NPC/Faction/Location entities the world tick already covers.
ALTER TYPE "WorldEventTargetType" ADD VALUE 'CLOCK';
ALTER TYPE "WorldEventTargetType" ADD VALUE 'QUEST';
ALTER TYPE "WorldEventTargetType" ADD VALUE 'WAR';
ALTER TYPE "WorldEventTargetType" ADD VALUE 'CHARACTER';
