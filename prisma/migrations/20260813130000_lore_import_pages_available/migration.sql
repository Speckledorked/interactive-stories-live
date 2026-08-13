-- #243 (adversarial audit): tracks the real candidate-page count found on
-- a wiki before loreImportService.ts's hard WIKI_MAX_PAGES cut truncated
-- it down to pagesFound, so the admin UI can surface "Imported 400 of 612
-- pages" instead of silently dropping the rest with no signal at all.
ALTER TABLE "LoreImportJob" ADD COLUMN "pagesAvailable" INTEGER NOT NULL DEFAULT 0;
