-- #111: faction-to-faction economic obligations.
CREATE TYPE "FactionDebtStatus" AS ENUM ('OUTSTANDING', 'DEFAULTED', 'PAID');

CREATE TABLE "FactionDebt" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creditorFactionId" TEXT NOT NULL,
    "debtorFactionId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "FactionDebtStatus" NOT NULL DEFAULT 'OUTSTANDING',
    "turnCreated" INTEGER NOT NULL,
    "turnResolved" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "FactionDebt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FactionDebt_campaignId_idx" ON "FactionDebt"("campaignId");
CREATE INDEX "FactionDebt_creditorFactionId_idx" ON "FactionDebt"("creditorFactionId");
CREATE INDEX "FactionDebt_debtorFactionId_status_idx" ON "FactionDebt"("debtorFactionId", "status");

ALTER TABLE "FactionDebt" ADD CONSTRAINT "FactionDebt_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FactionDebt" ADD CONSTRAINT "FactionDebt_creditorFactionId_fkey" FOREIGN KEY ("creditorFactionId") REFERENCES "Faction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FactionDebt" ADD CONSTRAINT "FactionDebt_debtorFactionId_fkey" FOREIGN KEY ("debtorFactionId") REFERENCES "Faction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
