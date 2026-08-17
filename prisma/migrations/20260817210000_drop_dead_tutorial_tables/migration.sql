-- #447: drop the three dead tutorial tables and the enum.
--
-- Step 3 of a deliberately staged retirement. #450 removed the code
-- (tutorial-service.ts, its four API routes, all nine of their test files, and
-- the one caller an import-graph check could not see — KeyboardShortcutsModal
-- POSTing /api/tutorial/trigger over HTTP on every `?` press). That
-- contraction has since shipped and sat through a production deploy, which
-- was the precondition for this migration.
--
-- The tables were never written by anything that worked. #436 established the
-- system was broken in three independent ways, the first of which is why these
-- are empty rather than merely stale: initializeTutorialSteps() had ZERO
-- callers repo-wide — no seed script, no prisma.seed key, no migration INSERT —
-- so tutorial_steps was never populated in production, nothing could reach
-- IN_PROGRESS, and user_tutorial_progress therefore had nothing to record.
--
-- Ordering matters: user_tutorial_progress carries a foreign key to
-- tutorial_steps (stepId, ON DELETE CASCADE), so it goes first. IF EXISTS
-- throughout, following 20260817080000, so a re-run or a database that
-- somehow never had them is not an error.
--
-- Landing alone, with nothing else in the pull request, on purpose. #434 moved
-- the build command to generate -> build -> migrate, so a failed build can no
-- longer leave production mid-schema, but the new deployment is promoted AFTER
-- the migration — a window remains where the new schema is live and the
-- previous deployment is still serving. For these three tables that window is
-- harmless, because the outgoing deployment has no code referencing them
-- either; #450 removed all of it. Alone anyway, so that if anything does go
-- wrong the cause is unambiguous.

-- DropTable
DROP TABLE IF EXISTS "user_tutorial_progress";

-- DropTable
DROP TABLE IF EXISTS "campaign_tutorial_mode";

-- DropTable
DROP TABLE IF EXISTS "tutorial_steps";

-- DropEnum
DROP TYPE IF EXISTS "TutorialStatus";
