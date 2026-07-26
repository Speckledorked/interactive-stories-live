-- CreateEnum
CREATE TYPE "SceneStatus" AS ENUM ('AWAITING_ACTIONS', 'RESOLVING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "EventVisibility" AS ENUM ('PUBLIC', 'GM_ONLY', 'MIXED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('SCENE', 'DOWNTIME', 'TIMESKIP', 'WORLD_EVENT');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'PLAYER');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('IN_CHARACTER', 'OUT_OF_CHARACTER', 'WHISPER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NoteVisibility" AS ENUM ('PRIVATE', 'GM', 'SHARED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('TURN_REMINDER', 'SCENE_CHANGE', 'MENTION', 'WHISPER_RECEIVED', 'NOTE_SHARED', 'CAMPAIGN_INVITE', 'SCENE_RESOLVED', 'AI_RESPONSE_READY', 'WORLD_EVENT', 'FRIEND_REQUEST', 'SAFETY_ALERT', 'CAMPAIGN_MILESTONE');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('UNREAD', 'READ', 'DISMISSED');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "FactionGoal" AS ENUM ('EXPAND', 'DEFEND', 'ENRICH', 'DESTABILIZE_RIVAL', 'CONSOLIDATE');

-- CreateEnum
CREATE TYPE "FactionArchetype" AS ENUM ('GENERIC', 'SECRET_SOCIETY', 'CRIMINAL', 'RELIGIOUS', 'MILITARY', 'CORPORATION', 'POLITICAL');

-- CreateEnum
CREATE TYPE "FactionRole" AS ENUM ('LEADER', 'MEMBER');

-- CreateEnum
CREATE TYPE "WarStatus" AS ENUM ('ESCALATING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "WeatherCondition" AS ENUM ('CLEAR', 'CLOUDY', 'RAIN', 'STORM', 'SNOW', 'FOG');

-- CreateEnum
CREATE TYPE "WorldEventActorType" AS ENUM ('SYSTEM', 'PLAYER');

-- CreateEnum
CREATE TYPE "WorldEventTargetType" AS ENUM ('NPC', 'FACTION', 'LOCATION_WEATHER');

-- CreateEnum
CREATE TYPE "QuestStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "CapabilityState" AS ENUM ('GLIMPSED', 'UNLOCKED');

-- CreateEnum
CREATE TYPE "OriginFamiliarity" AS ENUM ('NATIVE', 'NEWCOMER', 'OUTSIDER');

-- CreateEnum
CREATE TYPE "DebtDirection" AS ENUM ('OWED_BY_CHARACTER', 'OWED_TO_CHARACTER');

-- CreateEnum
CREATE TYPE "DebtStatus" AS ENUM ('OUTSTANDING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "WarSide" AS ENUM ('ATTACKER', 'DEFENDER');

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TutorialStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "XCardTrigger" AS ENUM ('GENERAL', 'VIOLENCE', 'GORE', 'TRAUMA', 'ABUSE', 'DEATH', 'PHOBIA', 'SEXUAL', 'SUBSTANCE', 'MENTAL_HEALTH', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ReportSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('CREDIT', 'DEBIT', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "WikiEntryType" AS ENUM ('NPC', 'FACTION', 'LOCATION', 'CLOCK', 'ITEM', 'QUEST', 'LORE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MemoryType" AS ENUM ('SCENE', 'NPC_INTERACTION', 'FACTION_EVENT', 'LOCATION_EVENT', 'CHARACTER_MOMENT', 'CLOCK_COMPLETION', 'WORLD_EVENT');

-- CreateEnum
CREATE TYPE "MemoryImportance" AS ENUM ('MINOR', 'NORMAL', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "LoreSourceType" AS ENUM ('PASTE', 'URL', 'WIKI');

-- CreateEnum
CREATE TYPE "LoreImportJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReseedJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "FriendRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ResolutionJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AnalyticsEventType" AS ENUM ('SIGNUP', 'CAMPAIGN_CREATED', 'CHARACTER_CREATED', 'SCENE_STARTED', 'ACTION_SUBMITTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifyToken" TEXT,
    "resetToken" TEXT,
    "resetTokenExpires" TIMESTAMP(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "isOnline" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'PLAYER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastViewedAt" TIMESTAMP(3),

    CONSTRAINT "CampaignMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "universe" TEXT,
    "aiSystemPrompt" TEXT NOT NULL,
    "initialWorldSeed" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "chronicleShareEnabled" BOOLEAN NOT NULL DEFAULT false,
    "chronicleShareToken" TEXT,
    "contentModerationLevel" TEXT NOT NULL DEFAULT 'standard',
    "statLabels" JSONB,
    "corruptionTheme" JSONB,
    "pendingWorldSeed" BOOLEAN NOT NULL DEFAULT false,
    "mapGenerationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "templateId" TEXT,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignArchetype" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "originFamiliarity" "OriginFamiliarity" NOT NULL DEFAULT 'NATIVE',
    "suggestedStats" JSONB,
    "startingGear" JSONB,
    "startingTie" JSONB,
    "backstoryPrompts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "glimpseCapabilityKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignArchetype_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quest" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "objective" TEXT,
    "objectiveKey" TEXT,
    "givenBy" TEXT,
    "givenByNpcId" TEXT,
    "givenByFactionId" TEXT,
    "reward" TEXT,
    "minCorruption" INTEGER,
    "maxCorruption" INTEGER,
    "status" "QuestStatus" NOT NULL DEFAULT 'ACTIVE',
    "progressLog" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Quest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignCapability" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "domain" TEXT NOT NULL,
    "tier" INTEGER NOT NULL DEFAULT 1,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "isShadow" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Debt" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "direction" "DebtDirection" NOT NULL,
    "counterpartyType" TEXT NOT NULL,
    "counterpartyId" TEXT,
    "counterpartyName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "DebtStatus" NOT NULL DEFAULT 'OUTSTANDING',
    "resolution" TEXT,
    "turnCreated" INTEGER NOT NULL DEFAULT 0,
    "turnResolved" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Debt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactionStanding" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "factionId" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactionStanding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterCapability" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "state" "CapabilityState" NOT NULL DEFAULT 'GLIMPSED',
    "proficiency" INTEGER NOT NULL DEFAULT 0,
    "framedLabel" TEXT,
    "hint" TEXT,
    "source" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "growthInArc" INTEGER NOT NULL DEFAULT 0,
    "arcStartTurn" INTEGER NOT NULL DEFAULT 0,
    "unlockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pronouns" TEXT,
    "description" TEXT,
    "appearance" TEXT,
    "personality" TEXT,
    "stats" JSONB,
    "backstory" TEXT,
    "goals" TEXT,
    "isAlive" BOOLEAN NOT NULL DEFAULT true,
    "currentLocation" TEXT,
    "locationId" TEXT,
    "gmNotes" TEXT,
    "originFamiliarity" "OriginFamiliarity" NOT NULL DEFAULT 'NATIVE',
    "harm" INTEGER NOT NULL DEFAULT 0,
    "corruption" INTEGER NOT NULL DEFAULT 0,
    "pendingBargain" JSONB,
    "conditions" JSONB,
    "moves" JSONB,
    "statUsage" JSONB,
    "perks" JSONB,
    "advancementLog" JSONB,
    "inventory" JSONB,
    "equipment" JSONB,
    "resources" JSONB,
    "relationships" JSONB,
    "consequences" JSONB,
    "currentZone" TEXT,
    "zoneMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NPC" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pronouns" TEXT,
    "description" TEXT,
    "currentLocation" TEXT,
    "locationId" TEXT,
    "goals" TEXT,
    "relationship" TEXT,
    "isAlive" BOOLEAN NOT NULL DEFAULT true,
    "importance" INTEGER NOT NULL DEFAULT 1,
    "gmNotes" TEXT,
    "harm" INTEGER NOT NULL DEFAULT 0,
    "isDiscovered" BOOLEAN NOT NULL DEFAULT true,
    "currentPlan" TEXT,
    "goalProgress" INTEGER NOT NULL DEFAULT 0,
    "threat" TEXT,
    "impulses" TEXT[],
    "moves" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "factionId" TEXT,
    "factionRole" "FactionRole",
    "socialTies" JSONB,
    "minCorruption" INTEGER,
    "maxCorruption" INTEGER,

    CONSTRAINT "NPC_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Faction" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "goals" TEXT,
    "resources" INTEGER NOT NULL DEFAULT 50,
    "influence" INTEGER NOT NULL DEFAULT 50,
    "currentPlan" TEXT,
    "threatLevel" INTEGER NOT NULL DEFAULT 1,
    "relationships" JSONB,
    "gmNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "stability" INTEGER NOT NULL DEFAULT 50,
    "military" INTEGER NOT NULL DEFAULT 50,
    "goal" "FactionGoal" NOT NULL DEFAULT 'CONSOLIDATE',
    "archetype" "FactionArchetype" NOT NULL DEFAULT 'GENERIC',
    "isDiscovered" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "leaderCharacterId" TEXT,

    CONSTRAINT "Faction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "locationType" TEXT,
    "isDiscovered" BOOLEAN NOT NULL DEFAULT true,
    "gmNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "weather" "WeatherCondition" NOT NULL DEFAULT 'CLEAR',
    "weatherSeverity" INTEGER NOT NULL DEFAULT 1,
    "weatherUpdatedAt" TIMESTAMP(3),
    "ownerFactionId" TEXT,
    "isContested" BOOLEAN NOT NULL DEFAULT false,
    "minCorruption" INTEGER,
    "maxCorruption" INTEGER,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "War" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "attackerFactionId" TEXT NOT NULL,
    "defenderFactionId" TEXT NOT NULL,
    "contestedLocationId" TEXT,
    "momentum" INTEGER NOT NULL DEFAULT 0,
    "status" "WarStatus" NOT NULL DEFAULT 'ESCALATING',
    "outcome" TEXT,
    "startedTurn" INTEGER NOT NULL,
    "resolvedTurn" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "War_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarParticipant" (
    "id" TEXT NOT NULL,
    "warId" TEXT NOT NULL,
    "factionId" TEXT NOT NULL,
    "side" "WarSide" NOT NULL,
    "joinedTurn" INTEGER NOT NULL,

    CONSTRAINT "WarParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clock" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "currentTicks" INTEGER NOT NULL DEFAULT 0,
    "maxTicks" INTEGER NOT NULL DEFAULT 4,
    "category" TEXT,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "consequence" TEXT,
    "gmNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "sourceFactionId" TEXT,
    "targetFactionId" TEXT,
    "participantNpcIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relatedFactionId" TEXT,

    CONSTRAINT "Clock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scene" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sceneNumber" INTEGER NOT NULL,
    "title" TEXT,
    "sceneIntroText" TEXT NOT NULL,
    "framing" TEXT,
    "location" TEXT,
    "participants" JSONB,
    "status" "SceneStatus" NOT NULL DEFAULT 'AWAITING_ACTIONS',
    "sceneResolutionText" TEXT,
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "pausedAt" TIMESTAMP(3),
    "pausedReason" TEXT,
    "sceneType" TEXT DEFAULT 'dramatic',
    "stakes" TEXT,
    "combatMode" TEXT DEFAULT 'freeform',
    "exchangeState" JSONB,
    "currentExchange" INTEGER NOT NULL DEFAULT 0,
    "consequences" JSONB,
    "waitingOnUsers" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerAction" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionText" TEXT NOT NULL,
    "intentOutcome" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolution" TEXT,
    "rollResult" JSONB,
    "moveUsed" TEXT,
    "rollRequired" BOOLEAN NOT NULL DEFAULT false,
    "rollMade" TEXT,
    "exchangeNumber" INTEGER,
    "actionPriority" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmClarification" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmClarification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineEvent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "turnNumber" INTEGER,
    "title" TEXT NOT NULL,
    "summaryPublic" TEXT,
    "summaryGM" TEXT,
    "isOffscreen" BOOLEAN DEFAULT false,
    "eventType" "EventType",
    "visibility" "EventVisibility" NOT NULL DEFAULT 'PUBLIC',
    "sessionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gmNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldMeta" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "currentTurnNumber" INTEGER NOT NULL DEFAULT 1,
    "currentInGameDate" TEXT,
    "currentLocation" TEXT,
    "tension" INTEGER NOT NULL DEFAULT 50,
    "phase" TEXT,
    "otherMeta" JSONB,
    "gmNotes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "hoursSinceWorldTurn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "worldTurnHours" INTEGER,
    "lastRealTimeTickAt" TIMESTAMP(3),
    "hoursBankedSinceLastHeartbeat" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "factionCap" INTEGER,
    "npcCap" INTEGER,
    "aiHealth" JSONB,
    "aiMetrics" JSONB,
    "campaignHealthHistory" JSONB,
    "lastHealthCheck" TIMESTAMP(3),
    "currentHealthScore" INTEGER,

    CONSTRAINT "WorldMeta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignInvite" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 0,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Move" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "baseMoveKey" TEXT,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rollType" TEXT,
    "outcomes" JSONB NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'basic',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Move_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiceRoll" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sceneId" TEXT,
    "characterId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rollType" TEXT NOT NULL,
    "dice" INTEGER[],
    "modifier" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "description" TEXT,
    "forward" INTEGER DEFAULT 0,
    "ongoing" INTEGER DEFAULT 0,
    "hold" INTEGER DEFAULT 0,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiceRoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'OUT_OF_CHARACTER',
    "authorId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sceneId" TEXT,
    "targetUserId" TEXT,
    "characterId" TEXT,
    "mentionsUserIds" JSONB DEFAULT '[]',
    "hasMentions" BOOLEAN NOT NULL DEFAULT false,
    "triggerSound" TEXT,
    "soundVolume" DOUBLE PRECISION DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_notes" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "visibility" "NoteVisibility" NOT NULL DEFAULT 'PRIVATE',
    "authorId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "characterId" TEXT,
    "npcId" TEXT,
    "factionId" TEXT,
    "sceneId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'UNREAD',
    "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
    "userId" TEXT NOT NULL,
    "campaignId" TEXT,
    "sceneId" TEXT,
    "actionUrl" TEXT,
    "metadata" JSONB,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "pushSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notification_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailTurnReminders" BOOLEAN NOT NULL DEFAULT true,
    "emailSceneChanges" BOOLEAN NOT NULL DEFAULT true,
    "emailMentions" BOOLEAN NOT NULL DEFAULT true,
    "emailWhispers" BOOLEAN NOT NULL DEFAULT true,
    "emailCampaignInvites" BOOLEAN NOT NULL DEFAULT true,
    "emailWorldEvents" BOOLEAN NOT NULL DEFAULT false,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pushTurnReminders" BOOLEAN NOT NULL DEFAULT true,
    "pushSceneChanges" BOOLEAN NOT NULL DEFAULT true,
    "pushMentions" BOOLEAN NOT NULL DEFAULT true,
    "pushWhispers" BOOLEAN NOT NULL DEFAULT true,
    "pushCampaignInvites" BOOLEAN NOT NULL DEFAULT true,
    "soundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "soundTurnReminders" BOOLEAN NOT NULL DEFAULT true,
    "soundSceneChanges" BOOLEAN NOT NULL DEFAULT true,
    "soundMentions" BOOLEAN NOT NULL DEFAULT true,
    "soundWhispers" BOOLEAN NOT NULL DEFAULT true,
    "soundCriticalMoments" BOOLEAN NOT NULL DEFAULT true,
    "soundWorldEvents" BOOLEAN NOT NULL DEFAULT true,
    "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
    "quietHoursStart" TEXT,
    "quietHoursEnd" TEXT,
    "timezone" TEXT,
    "dailyDigestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "weeklyDigestEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turn_trackers" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sceneId" TEXT,
    "currentTurn" INTEGER NOT NULL DEFAULT 0,
    "turnOrder" JSONB NOT NULL,
    "turnStartedAt" TIMESTAMP(3),
    "turnDeadline" TIMESTAMP(3),
    "autoAdvanceTurn" BOOLEAN NOT NULL DEFAULT false,
    "turnTimeoutMinutes" INTEGER NOT NULL DEFAULT 60,
    "remindersSent" JSONB NOT NULL DEFAULT '[]',
    "lastReminderSent" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "turn_trackers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maps" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sceneId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "width" INTEGER NOT NULL DEFAULT 800,
    "height" INTEGER NOT NULL DEFAULT 600,
    "gridSize" INTEGER NOT NULL DEFAULT 40,
    "background" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "color" TEXT DEFAULT '#3b82f6',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#ef4444',
    "size" INTEGER NOT NULL DEFAULT 30,
    "isPlayer" BOOLEAN NOT NULL DEFAULT false,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,

    CONSTRAINT "tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "downtime_activities" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "ActivityStatus" NOT NULL DEFAULT 'ACTIVE',
    "estimatedDays" INTEGER NOT NULL,
    "currentDay" INTEGER NOT NULL DEFAULT 0,
    "costs" JSONB,
    "requirements" TEXT[],
    "skillsInvolved" TEXT[],
    "riskLevel" TEXT,
    "linkedQuestId" TEXT,
    "outcomes" JSONB,
    "finalOutcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "downtime_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "downtime_events" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "eventText" TEXT NOT NULL,
    "choices" JSONB,
    "response" TEXT,
    "outcome" TEXT,
    "outcomeCategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "downtime_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tutorial_steps" (
    "id" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "prerequisites" TEXT[],
    "contentBlocks" JSONB,
    "targetElement" TEXT,
    "tooltipPosition" TEXT DEFAULT 'bottom',
    "completionTrigger" TEXT,
    "validationRules" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tutorial_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tutorial_progress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "status" "TutorialStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "attemptsCount" INTEGER NOT NULL DEFAULT 0,
    "hintsViewed" INTEGER NOT NULL DEFAULT 0,
    "timeSpent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_tutorial_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_tutorial_mode" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "useGuidedScenes" BOOLEAN NOT NULL DEFAULT true,
    "showTooltips" BOOLEAN NOT NULL DEFAULT true,
    "provideHints" BOOLEAN NOT NULL DEFAULT true,
    "allowSkip" BOOLEAN NOT NULL DEFAULT true,
    "currentStepKey" TEXT,
    "completedSteps" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_tutorial_mode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_safety_settings" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "xCardEnabled" BOOLEAN NOT NULL DEFAULT true,
    "anonymousXCard" BOOLEAN NOT NULL DEFAULT true,
    "pauseOnXCard" BOOLEAN NOT NULL DEFAULT true,
    "xCardNotifyGMOnly" BOOLEAN NOT NULL DEFAULT false,
    "lines" TEXT[],
    "veils" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_safety_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "x_card_uses" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sceneId" TEXT,
    "userId" TEXT NOT NULL,
    "trigger" "XCardTrigger" NOT NULL,
    "targetId" TEXT,
    "reason" TEXT,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT true,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "x_card_uses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_reports" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "contentId" TEXT,
    "contentText" TEXT,
    "reason" TEXT NOT NULL,
    "category" TEXT,
    "severity" "ReportSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "actionTaken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_blocks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "blockedUserId" TEXT NOT NULL,
    "campaignId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_bans" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bannedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "isPermanent" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_bans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AICostEntry" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sceneId" TEXT,
    "requestType" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costMicros" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AICostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_logs" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sceneId" TEXT,
    "turnNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "highlights" TEXT[],
    "entryType" TEXT NOT NULL DEFAULT 'scene',
    "inGameDate" TEXT,
    "duration" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki_entries" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "entryType" "WikiEntryType" NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tags" TEXT[],
    "aliases" TEXT[],
    "imageUrl" TEXT,
    "relatedEntries" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenTurn" INTEGER,
    "importance" TEXT NOT NULL DEFAULT 'normal',
    "changelog" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'ai',

    CONSTRAINT "wiki_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_memories" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "memoryType" "MemoryType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "turnNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "fullContext" TEXT NOT NULL,
    "embedding" vector(1536),
    "involvedCharacterIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "involvedNpcIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "involvedFactionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "locationTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "importance" "MemoryImportance" NOT NULL DEFAULT 'NORMAL',
    "emotionalTone" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoreImportJob" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sourceType" "LoreSourceType" NOT NULL,
    "sourceUrl" TEXT,
    "sourceTitle" TEXT,
    "rawText" TEXT,
    "status" "LoreImportJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "alertedStuckAt" TIMESTAMP(3),
    "autoReseedOnComplete" BOOLEAN NOT NULL DEFAULT false,
    "pagesFound" INTEGER NOT NULL DEFAULT 0,
    "pagesDone" INTEGER NOT NULL DEFAULT 0,
    "entriesCreated" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "LoreImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lore_entries" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lore_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReseedJob" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "status" "ReseedJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "alertedStuckAt" TIMESTAMP(3),
    "releasesPlayLock" BOOLEAN NOT NULL DEFAULT false,
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ReseedJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world_events" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "turnNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "actorType" "WorldEventActorType" NOT NULL DEFAULT 'SYSTEM',
    "actorId" TEXT,
    "targetType" "WorldEventTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT NOT NULL,
    "significant" BOOLEAN NOT NULL DEFAULT false,
    "importance" TEXT NOT NULL DEFAULT 'NORMAL',

    CONSTRAINT "world_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitCounter" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "friend_requests" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "status" "FriendRequestStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "friend_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "friendships" (
    "id" TEXT NOT NULL,
    "user1Id" TEXT NOT NULL,
    "user2Id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "friendships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResolutionJob" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "status" "ResolutionJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "alertedStuckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ResolutionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_validation_failures" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sceneId" TEXT,
    "errorSummary" TEXT NOT NULL,
    "rawResponse" JSONB,
    "zodErrors" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_validation_failures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" TEXT NOT NULL,
    "type" "AnalyticsEventType" NOT NULL,
    "userId" TEXT,
    "campaignId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_emailVerifyToken_idx" ON "User"("emailVerifyToken");

-- CreateIndex
CREATE INDEX "User_resetToken_idx" ON "User"("resetToken");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMembership_userId_campaignId_key" ON "CampaignMembership"("userId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_chronicleShareToken_key" ON "Campaign"("chronicleShareToken");

-- CreateIndex
CREATE INDEX "CampaignArchetype_campaignId_idx" ON "CampaignArchetype"("campaignId");

-- CreateIndex
CREATE INDEX "Quest_campaignId_objectiveKey_idx" ON "Quest"("campaignId", "objectiveKey");

-- CreateIndex
CREATE INDEX "Quest_campaignId_status_idx" ON "Quest"("campaignId", "status");

-- CreateIndex
CREATE INDEX "Quest_givenByNpcId_idx" ON "Quest"("givenByNpcId");

-- CreateIndex
CREATE INDEX "Quest_givenByFactionId_idx" ON "Quest"("givenByFactionId");

-- CreateIndex
CREATE INDEX "CampaignCapability_campaignId_idx" ON "CampaignCapability"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignCapability_parentId_idx" ON "CampaignCapability"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignCapability_campaignId_key_key" ON "CampaignCapability"("campaignId", "key");

-- CreateIndex
CREATE INDEX "Debt_campaignId_idx" ON "Debt"("campaignId");

-- CreateIndex
CREATE INDEX "Debt_characterId_status_idx" ON "Debt"("characterId", "status");

-- CreateIndex
CREATE INDEX "FactionStanding_campaignId_idx" ON "FactionStanding"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "FactionStanding_characterId_factionId_key" ON "FactionStanding"("characterId", "factionId");

-- CreateIndex
CREATE INDEX "CharacterCapability_characterId_idx" ON "CharacterCapability"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterCapability_characterId_capabilityId_key" ON "CharacterCapability"("characterId", "capabilityId");

-- CreateIndex
CREATE INDEX "Character_campaignId_idx" ON "Character"("campaignId");

-- CreateIndex
CREATE INDEX "Character_userId_idx" ON "Character"("userId");

-- CreateIndex
CREATE INDEX "Character_locationId_idx" ON "Character"("locationId");

-- CreateIndex
CREATE INDEX "NPC_campaignId_idx" ON "NPC"("campaignId");

-- CreateIndex
CREATE INDEX "NPC_factionId_idx" ON "NPC"("factionId");

-- CreateIndex
CREATE INDEX "NPC_locationId_idx" ON "NPC"("locationId");

-- CreateIndex
CREATE INDEX "Faction_campaignId_idx" ON "Faction"("campaignId");

-- CreateIndex
CREATE INDEX "Location_campaignId_idx" ON "Location"("campaignId");

-- CreateIndex
CREATE INDEX "Location_ownerFactionId_idx" ON "Location"("ownerFactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_campaignId_name_key" ON "Location"("campaignId", "name");

-- CreateIndex
CREATE INDEX "War_campaignId_idx" ON "War"("campaignId");

-- CreateIndex
CREATE INDEX "War_attackerFactionId_idx" ON "War"("attackerFactionId");

-- CreateIndex
CREATE INDEX "War_defenderFactionId_idx" ON "War"("defenderFactionId");

-- CreateIndex
CREATE INDEX "WarParticipant_warId_idx" ON "WarParticipant"("warId");

-- CreateIndex
CREATE INDEX "WarParticipant_factionId_idx" ON "WarParticipant"("factionId");

-- CreateIndex
CREATE UNIQUE INDEX "WarParticipant_warId_factionId_key" ON "WarParticipant"("warId", "factionId");

-- CreateIndex
CREATE INDEX "Clock_campaignId_idx" ON "Clock"("campaignId");

-- CreateIndex
CREATE INDEX "Clock_targetFactionId_idx" ON "Clock"("targetFactionId");

-- CreateIndex
CREATE INDEX "Clock_sourceFactionId_idx" ON "Clock"("sourceFactionId");

-- CreateIndex
CREATE INDEX "Scene_campaignId_idx" ON "Scene"("campaignId");

-- CreateIndex
CREATE INDEX "Scene_status_idx" ON "Scene"("status");

-- CreateIndex
CREATE INDEX "PlayerAction_sceneId_idx" ON "PlayerAction"("sceneId");

-- CreateIndex
CREATE INDEX "PlayerAction_characterId_idx" ON "PlayerAction"("characterId");

-- CreateIndex
CREATE INDEX "GmClarification_campaignId_idx" ON "GmClarification"("campaignId");

-- CreateIndex
CREATE INDEX "GmClarification_sceneId_idx" ON "GmClarification"("sceneId");

-- CreateIndex
CREATE INDEX "TimelineEvent_campaignId_idx" ON "TimelineEvent"("campaignId");

-- CreateIndex
CREATE INDEX "TimelineEvent_turnNumber_idx" ON "TimelineEvent"("turnNumber");

-- CreateIndex
CREATE UNIQUE INDEX "WorldMeta_campaignId_key" ON "WorldMeta"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignInvite_token_key" ON "CampaignInvite"("token");

-- CreateIndex
CREATE INDEX "CampaignInvite_token_idx" ON "CampaignInvite"("token");

-- CreateIndex
CREATE INDEX "CampaignInvite_campaignId_idx" ON "CampaignInvite"("campaignId");

-- CreateIndex
CREATE INDEX "Move_campaignId_idx" ON "Move"("campaignId");

-- CreateIndex
CREATE INDEX "Move_campaignId_baseMoveKey_idx" ON "Move"("campaignId", "baseMoveKey");

-- CreateIndex
CREATE INDEX "DiceRoll_campaignId_idx" ON "DiceRoll"("campaignId");

-- CreateIndex
CREATE INDEX "DiceRoll_sceneId_idx" ON "DiceRoll"("sceneId");

-- CreateIndex
CREATE INDEX "DiceRoll_characterId_idx" ON "DiceRoll"("characterId");

-- CreateIndex
CREATE INDEX "messages_campaignId_createdAt_idx" ON "messages"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_campaignId_sceneId_idx" ON "messages"("campaignId", "sceneId");

-- CreateIndex
CREATE INDEX "player_notes_campaignId_authorId_idx" ON "player_notes"("campaignId", "authorId");

-- CreateIndex
CREATE INDEX "player_notes_campaignId_visibility_idx" ON "player_notes"("campaignId", "visibility");

-- CreateIndex
CREATE INDEX "notifications_userId_status_idx" ON "notifications"("userId", "status");

-- CreateIndex
CREATE INDEX "notifications_campaignId_type_idx" ON "notifications"("campaignId", "type");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_notification_settings_userId_key" ON "user_notification_settings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "turn_trackers_campaignId_sceneId_key" ON "turn_trackers"("campaignId", "sceneId");

-- CreateIndex
CREATE INDEX "maps_campaignId_idx" ON "maps"("campaignId");

-- CreateIndex
CREATE INDEX "maps_sceneId_idx" ON "maps"("sceneId");

-- CreateIndex
CREATE INDEX "zones_mapId_idx" ON "zones"("mapId");

-- CreateIndex
CREATE INDEX "tokens_mapId_idx" ON "tokens"("mapId");

-- CreateIndex
CREATE INDEX "downtime_activities_characterId_idx" ON "downtime_activities"("characterId");

-- CreateIndex
CREATE INDEX "downtime_activities_status_idx" ON "downtime_activities"("status");

-- CreateIndex
CREATE INDEX "downtime_events_activityId_idx" ON "downtime_events"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "tutorial_steps_stepKey_key" ON "tutorial_steps"("stepKey");

-- CreateIndex
CREATE INDEX "tutorial_steps_category_orderIndex_idx" ON "tutorial_steps"("category", "orderIndex");

-- CreateIndex
CREATE INDEX "user_tutorial_progress_userId_status_idx" ON "user_tutorial_progress"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "user_tutorial_progress_userId_stepId_key" ON "user_tutorial_progress"("userId", "stepId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_tutorial_mode_campaignId_key" ON "campaign_tutorial_mode"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_safety_settings_campaignId_key" ON "campaign_safety_settings"("campaignId");

-- CreateIndex
CREATE INDEX "x_card_uses_campaignId_createdAt_idx" ON "x_card_uses"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "x_card_uses_sceneId_idx" ON "x_card_uses"("sceneId");

-- CreateIndex
CREATE INDEX "content_reports_campaignId_status_idx" ON "content_reports"("campaignId", "status");

-- CreateIndex
CREATE INDEX "content_reports_reporterId_idx" ON "content_reports"("reporterId");

-- CreateIndex
CREATE INDEX "content_reports_status_severity_idx" ON "content_reports"("status", "severity");

-- CreateIndex
CREATE INDEX "user_blocks_userId_idx" ON "user_blocks"("userId");

-- CreateIndex
CREATE INDEX "user_blocks_blockedUserId_idx" ON "user_blocks"("blockedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "user_blocks_userId_blockedUserId_campaignId_key" ON "user_blocks"("userId", "blockedUserId", "campaignId");

-- CreateIndex
CREATE INDEX "campaign_bans_userId_idx" ON "campaign_bans"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_bans_campaignId_userId_key" ON "campaign_bans"("campaignId", "userId");

-- CreateIndex
CREATE INDEX "transactions_userId_createdAt_idx" ON "transactions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AICostEntry_campaignId_idx" ON "AICostEntry"("campaignId");

-- CreateIndex
CREATE INDEX "AICostEntry_sceneId_idx" ON "AICostEntry"("sceneId");

-- CreateIndex
CREATE INDEX "campaign_logs_campaignId_turnNumber_idx" ON "campaign_logs"("campaignId", "turnNumber");

-- CreateIndex
CREATE INDEX "campaign_logs_sceneId_idx" ON "campaign_logs"("sceneId");

-- CreateIndex
CREATE INDEX "wiki_entries_campaignId_entryType_idx" ON "wiki_entries"("campaignId", "entryType");

-- CreateIndex
CREATE INDEX "wiki_entries_campaignId_name_idx" ON "wiki_entries"("campaignId", "name");

-- CreateIndex
CREATE INDEX "wiki_entries_campaignId_isActive_idx" ON "wiki_entries"("campaignId", "isActive");

-- CreateIndex
CREATE INDEX "campaign_memories_campaignId_turnNumber_idx" ON "campaign_memories"("campaignId", "turnNumber");

-- CreateIndex
CREATE INDEX "campaign_memories_campaignId_memoryType_idx" ON "campaign_memories"("campaignId", "memoryType");

-- CreateIndex
CREATE INDEX "campaign_memories_campaignId_importance_idx" ON "campaign_memories"("campaignId", "importance");

-- CreateIndex
CREATE INDEX "LoreImportJob_campaignId_status_idx" ON "LoreImportJob"("campaignId", "status");

-- CreateIndex
CREATE INDEX "lore_entries_campaignId_idx" ON "lore_entries"("campaignId");

-- CreateIndex
CREATE INDEX "lore_entries_jobId_idx" ON "lore_entries"("jobId");

-- CreateIndex
CREATE INDEX "ReseedJob_campaignId_status_idx" ON "ReseedJob"("campaignId", "status");

-- CreateIndex
CREATE INDEX "world_events_campaignId_turnNumber_idx" ON "world_events"("campaignId", "turnNumber");

-- CreateIndex
CREATE INDEX "world_events_campaignId_targetType_targetId_idx" ON "world_events"("campaignId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "world_events_campaignId_type_idx" ON "world_events"("campaignId", "type");

-- CreateIndex
CREATE INDEX "RateLimitCounter_windowStart_idx" ON "RateLimitCounter"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitCounter_key_windowStart_key" ON "RateLimitCounter"("key", "windowStart");

-- CreateIndex
CREATE INDEX "friend_requests_receiverId_status_idx" ON "friend_requests"("receiverId", "status");

-- CreateIndex
CREATE INDEX "friend_requests_senderId_idx" ON "friend_requests"("senderId");

-- CreateIndex
CREATE UNIQUE INDEX "friend_requests_senderId_receiverId_key" ON "friend_requests"("senderId", "receiverId");

-- CreateIndex
CREATE INDEX "friendships_user1Id_idx" ON "friendships"("user1Id");

-- CreateIndex
CREATE INDEX "friendships_user2Id_idx" ON "friendships"("user2Id");

-- CreateIndex
CREATE UNIQUE INDEX "friendships_user1Id_user2Id_key" ON "friendships"("user1Id", "user2Id");

-- CreateIndex
CREATE INDEX "ResolutionJob_sceneId_status_idx" ON "ResolutionJob"("sceneId", "status");

-- CreateIndex
CREATE INDEX "ResolutionJob_campaignId_status_idx" ON "ResolutionJob"("campaignId", "status");

-- CreateIndex
CREATE INDEX "ai_validation_failures_campaignId_idx" ON "ai_validation_failures"("campaignId");

-- CreateIndex
CREATE INDEX "ai_validation_failures_createdAt_idx" ON "ai_validation_failures"("createdAt");

-- CreateIndex
CREATE INDEX "analytics_events_type_createdAt_idx" ON "analytics_events"("type", "createdAt");

-- CreateIndex
CREATE INDEX "analytics_events_userId_createdAt_idx" ON "analytics_events"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CampaignMembership" ADD CONSTRAINT "CampaignMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMembership" ADD CONSTRAINT "CampaignMembership_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignArchetype" ADD CONSTRAINT "CampaignArchetype_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quest" ADD CONSTRAINT "Quest_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quest" ADD CONSTRAINT "Quest_givenByNpcId_fkey" FOREIGN KEY ("givenByNpcId") REFERENCES "NPC"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quest" ADD CONSTRAINT "Quest_givenByFactionId_fkey" FOREIGN KEY ("givenByFactionId") REFERENCES "Faction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignCapability" ADD CONSTRAINT "CampaignCapability_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignCapability" ADD CONSTRAINT "CampaignCapability_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CampaignCapability"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactionStanding" ADD CONSTRAINT "FactionStanding_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactionStanding" ADD CONSTRAINT "FactionStanding_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactionStanding" ADD CONSTRAINT "FactionStanding_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterCapability" ADD CONSTRAINT "CharacterCapability_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterCapability" ADD CONSTRAINT "CharacterCapability_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "CampaignCapability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NPC" ADD CONSTRAINT "NPC_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NPC" ADD CONSTRAINT "NPC_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NPC" ADD CONSTRAINT "NPC_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Faction" ADD CONSTRAINT "Faction_leaderCharacterId_fkey" FOREIGN KEY ("leaderCharacterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Faction" ADD CONSTRAINT "Faction_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_ownerFactionId_fkey" FOREIGN KEY ("ownerFactionId") REFERENCES "Faction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "War" ADD CONSTRAINT "War_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "War" ADD CONSTRAINT "War_attackerFactionId_fkey" FOREIGN KEY ("attackerFactionId") REFERENCES "Faction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "War" ADD CONSTRAINT "War_defenderFactionId_fkey" FOREIGN KEY ("defenderFactionId") REFERENCES "Faction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarParticipant" ADD CONSTRAINT "WarParticipant_warId_fkey" FOREIGN KEY ("warId") REFERENCES "War"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarParticipant" ADD CONSTRAINT "WarParticipant_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clock" ADD CONSTRAINT "Clock_sourceFactionId_fkey" FOREIGN KEY ("sourceFactionId") REFERENCES "Faction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clock" ADD CONSTRAINT "Clock_targetFactionId_fkey" FOREIGN KEY ("targetFactionId") REFERENCES "Faction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clock" ADD CONSTRAINT "Clock_relatedFactionId_fkey" FOREIGN KEY ("relatedFactionId") REFERENCES "Faction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clock" ADD CONSTRAINT "Clock_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerAction" ADD CONSTRAINT "PlayerAction_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerAction" ADD CONSTRAINT "PlayerAction_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerAction" ADD CONSTRAINT "PlayerAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmClarification" ADD CONSTRAINT "GmClarification_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmClarification" ADD CONSTRAINT "GmClarification_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmClarification" ADD CONSTRAINT "GmClarification_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmClarification" ADD CONSTRAINT "GmClarification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldMeta" ADD CONSTRAINT "WorldMeta_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignInvite" ADD CONSTRAINT "CampaignInvite_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignInvite" ADD CONSTRAINT "CampaignInvite_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Move" ADD CONSTRAINT "Move_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiceRoll" ADD CONSTRAINT "DiceRoll_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiceRoll" ADD CONSTRAINT "DiceRoll_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiceRoll" ADD CONSTRAINT "DiceRoll_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiceRoll" ADD CONSTRAINT "DiceRoll_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_notes" ADD CONSTRAINT "player_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_notes" ADD CONSTRAINT "player_notes_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_notes" ADD CONSTRAINT "player_notes_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_notes" ADD CONSTRAINT "player_notes_npcId_fkey" FOREIGN KEY ("npcId") REFERENCES "NPC"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_notes" ADD CONSTRAINT "player_notes_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_notes" ADD CONSTRAINT "player_notes_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_settings" ADD CONSTRAINT "user_notification_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turn_trackers" ADD CONSTRAINT "turn_trackers_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turn_trackers" ADD CONSTRAINT "turn_trackers_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "maps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "maps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downtime_events" ADD CONSTRAINT "downtime_events_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "downtime_activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tutorial_progress" ADD CONSTRAINT "user_tutorial_progress_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "tutorial_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AICostEntry" ADD CONSTRAINT "AICostEntry_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_memories" ADD CONSTRAINT "campaign_memories_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoreImportJob" ADD CONSTRAINT "LoreImportJob_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lore_entries" ADD CONSTRAINT "lore_entries_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lore_entries" ADD CONSTRAINT "lore_entries_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "LoreImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReseedJob" ADD CONSTRAINT "ReseedJob_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world_events" ADD CONSTRAINT "world_events_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

