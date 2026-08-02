-- #104: closed 4-axis belief vector on Faction, parsed via parseBeliefVector.
ALTER TABLE "Faction" ADD COLUMN "beliefVector" JSONB;

-- #104: multi-stage ambitions — a plain grouping key, not a self-relation FK.
ALTER TABLE "Clock" ADD COLUMN "agendaId" TEXT;
CREATE INDEX "Clock_agendaId_idx" ON "Clock"("agendaId");
