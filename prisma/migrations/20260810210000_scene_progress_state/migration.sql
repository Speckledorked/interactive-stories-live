-- Scene progress ledger: what's already been established/resolved in a
-- scene, so the narrator stops re-deriving continuity from raw prose alone.
ALTER TABLE "Scene" ADD COLUMN "progressState" JSONB;
