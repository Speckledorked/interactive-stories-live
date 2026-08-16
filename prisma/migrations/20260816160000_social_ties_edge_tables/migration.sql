-- #373: NPC.socialTies / Faction.relationships become real edge tables.
--
-- Both were id-keyed JSON blobs stored per node — genuinely graph data
-- (pairwise weighted edges) held in the wrong shape. "Who does this ONE
-- entity know" was cheap; everything else (social distance, alliance
-- chains, brokers) was unavailable. Rumour propagation was using PHYSICAL
-- distance as a stand-in for social distance because social distance was
-- not computable.
--
-- The blobs stored each tie TWICE, once per side. The edge tables store it
-- once, with the endpoints canonically ordered (aId < bId) and a CHECK
-- constraint enforcing that ordering, so asymmetry is unrepresentable
-- rather than merely detectable by an integrity check.

CREATE TYPE "TieType" AS ENUM ('RIVAL', 'ALLY');

CREATE TABLE "NpcTie" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "npcAId" TEXT NOT NULL,
    "npcBId" TEXT NOT NULL,
    "type" "TieType" NOT NULL,
    "since" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NpcTie_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FactionTie" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "factionAId" TEXT NOT NULL,
    "factionBId" TEXT NOT NULL,
    "type" "TieType" NOT NULL,
    "since" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactionTie_pkey" PRIMARY KEY ("id")
);

-- The invariant that makes "one row per pair" true. Without it the unique
-- index below is satisfied by BOTH (a,b) and (b,a) — i.e. it would permit
-- exactly the duplicated, potentially-contradictory pair of entries the
-- JSON blobs had.
ALTER TABLE "NpcTie" ADD CONSTRAINT "NpcTie_canonical_order" CHECK ("npcAId" < "npcBId");
ALTER TABLE "FactionTie" ADD CONSTRAINT "FactionTie_canonical_order" CHECK ("factionAId" < "factionBId");

CREATE UNIQUE INDEX "NpcTie_npcAId_npcBId_key" ON "NpcTie"("npcAId", "npcBId");
CREATE INDEX "NpcTie_campaignId_idx" ON "NpcTie"("campaignId");
CREATE INDEX "NpcTie_npcAId_idx" ON "NpcTie"("npcAId");
CREATE INDEX "NpcTie_npcBId_idx" ON "NpcTie"("npcBId");

CREATE UNIQUE INDEX "FactionTie_factionAId_factionBId_key" ON "FactionTie"("factionAId", "factionBId");
CREATE INDEX "FactionTie_campaignId_idx" ON "FactionTie"("campaignId");
CREATE INDEX "FactionTie_factionAId_idx" ON "FactionTie"("factionAId");
CREATE INDEX "FactionTie_factionBId_idx" ON "FactionTie"("factionBId");

ALTER TABLE "NpcTie" ADD CONSTRAINT "NpcTie_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NpcTie" ADD CONSTRAINT "NpcTie_npcAId_fkey"
    FOREIGN KEY ("npcAId") REFERENCES "NPC"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NpcTie" ADD CONSTRAINT "NpcTie_npcBId_fkey"
    FOREIGN KEY ("npcBId") REFERENCES "NPC"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FactionTie" ADD CONSTRAINT "FactionTie_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FactionTie" ADD CONSTRAINT "FactionTie_factionAId_fkey"
    FOREIGN KEY ("factionAId") REFERENCES "Faction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FactionTie" ADD CONSTRAINT "FactionTie_factionBId_fkey"
    FOREIGN KEY ("factionBId") REFERENCES "Faction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BACKFILL, before the columns are dropped.
--
-- Each blob entry becomes one canonical edge. A pair appears TWICE in the
-- source (once from each side) and DISTINCT ON collapses it to one row.
-- Where the two sides disagreed about the type — an asymmetry the old
-- shape permitted and `faction.relationships.symmetric` existed to detect
-- — the ORDER BY picks deterministically: the oldest `since` wins, then
-- RIVAL over ALLY, so a recorded grudge is never silently downgraded to an
-- alliance by row order.
--
-- The join to the target entity is what drops orphan keys pointing at
-- deleted NPCs/factions: they cannot become edges, because the foreign key
-- they were pretending to be is now real.
INSERT INTO "NpcTie" ("id", "campaignId", "npcAId", "npcBId", "type", "since", "createdAt", "updatedAt")
SELECT DISTINCT ON (LEAST(n."id", t."key"), GREATEST(n."id", t."key"))
       gen_random_uuid()::text,
       n."campaignId",
       LEAST(n."id", t."key"),
       GREATEST(n."id", t."key"),
       (t."value"->>'type')::"TieType",
       COALESCE((t."value"->>'since')::int, 0),
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM "NPC" n
CROSS JOIN LATERAL jsonb_each(n."socialTies") AS t("key", "value")
JOIN "NPC" o ON o."id" = t."key" AND o."campaignId" = n."campaignId"
WHERE n."socialTies" IS NOT NULL
  AND jsonb_typeof(n."socialTies") = 'object'
  AND jsonb_typeof(t."value") = 'object'
  AND t."value"->>'type' IN ('RIVAL', 'ALLY')
  AND n."id" <> t."key"
ORDER BY LEAST(n."id", t."key"),
         GREATEST(n."id", t."key"),
         COALESCE((t."value"->>'since')::int, 0) ASC,
         (t."value"->>'type') DESC;

-- The final tiebreak is `type DESC` — text ordering puts 'ALLY' before
-- 'RIVAL', so DESC means RIVAL wins. A same-`since` disagreement between
-- the two sides can only mean the data was corrupted by something outside
-- the writer (which always set both sides in one statement with one turn
-- number), and in that case keeping the recorded grudge is the safer read:
-- silently promoting a rivalry to an alliance would erase history the
-- simulation acts on, while the reverse merely keeps a tie the next tick
-- will recompute anyway.

INSERT INTO "FactionTie" ("id", "campaignId", "factionAId", "factionBId", "type", "since", "createdAt", "updatedAt")
SELECT DISTINCT ON (LEAST(f."id", t."key"), GREATEST(f."id", t."key"))
       gen_random_uuid()::text,
       f."campaignId",
       LEAST(f."id", t."key"),
       GREATEST(f."id", t."key"),
       (t."value"->>'type')::"TieType",
       COALESCE((t."value"->>'since')::int, 0),
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM "Faction" f
CROSS JOIN LATERAL jsonb_each(f."relationships") AS t("key", "value")
JOIN "Faction" o ON o."id" = t."key" AND o."campaignId" = f."campaignId"
WHERE f."relationships" IS NOT NULL
  AND jsonb_typeof(f."relationships") = 'object'
  AND jsonb_typeof(t."value") = 'object'
  AND t."value"->>'type' IN ('RIVAL', 'ALLY')
  AND f."id" <> t."key"
ORDER BY LEAST(f."id", t."key"),
         GREATEST(f."id", t."key"),
         COALESCE((t."value"->>'since')::int, 0) ASC,
         (t."value"->>'type') DESC;

-- Only now are the columns redundant. Keeping either would leave two
-- copies of the same fact, which is the thing #425 exists to warn about.
ALTER TABLE "NPC" DROP COLUMN "socialTies";
ALTER TABLE "Faction" DROP COLUMN "relationships";
