-- Drop Scene.title, Scene.framing and Scene.location: three columns with no
-- writer anywhere in the codebase, found by the column-wiring engine on its
-- first run and confirmed against production (zero non-null values across
-- every Scene row, so nothing is lost).
--
-- They were not harmless. buildScenePrompt preferred `framing` as the image
-- prompt's fallback narrative and prefixed a `Setting:` note from `location`
-- — dead code wearing the shape of a feature, exactly the null-is-legitimate
-- disguise the wiring check exists to strip. The reads were removed with the
-- columns rather than left pointing at nothing.
ALTER TABLE "Scene" DROP COLUMN IF EXISTS "title";
ALTER TABLE "Scene" DROP COLUMN IF EXISTS "framing";
ALTER TABLE "Scene" DROP COLUMN IF EXISTS "location";

-- Message.triggerSound / Message.soundVolume: the "Phase 9: Sound triggers"
-- half that never shipped. The message-create site never writes them and
-- nothing reads them from a Message row (the notifications route field of
-- the same name is a push-payload input, not this column). Zero rows carry
-- a value in production.
ALTER TABLE "messages" DROP COLUMN IF EXISTS "triggerSound";
ALTER TABLE "messages" DROP COLUMN IF EXISTS "soundVolume";
