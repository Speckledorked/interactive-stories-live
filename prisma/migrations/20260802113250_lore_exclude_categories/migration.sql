-- Admin-selected wiki category titles to skip during a WIKI crawl (see
-- mediaWikiClient.ts's fetchCategoryMembers) so a named-cast-heavy wiki
-- doesn't spend its page budget on characters the GM doesn't want.
ALTER TABLE "LoreImportJob" ADD COLUMN "excludeCategories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
