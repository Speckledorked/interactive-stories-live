-- #310: a real discriminator for origin: "wake" WorldEvent rows, so
-- npcDispositionTick.ts/beliefTick.ts can tell a genuine NPC-death or
-- faction-collapse institutional-memory-loss wake apart from an allied
-- faction merely defaulting on a bailout loan (economyTick.ts's
-- FACTION_DEFAULT cascade) — all three previously wrote the identical
-- (targetType FACTION, field "stability", origin "wake") shape.
ALTER TABLE "world_events" ADD COLUMN "wakeSourceType" TEXT;
