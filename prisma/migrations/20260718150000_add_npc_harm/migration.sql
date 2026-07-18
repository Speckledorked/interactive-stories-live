-- NPC.harm: minimal harm tracking so a PC's weapon damage bonus has an
-- honest target (see the field's doc comment in schema.prisma).
ALTER TABLE "NPC" ADD COLUMN IF NOT EXISTS "harm" INTEGER NOT NULL DEFAULT 0;
