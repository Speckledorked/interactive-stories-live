// PLACE IN: src/lib/sessions/session-service.ts
//
// WARNING: This file is currently disabled due to Prisma schema mismatches.
// The schema doesn't have the required fields like Session.sessionNumber,
// Session.experienceAwarded, Session.goldAwarded, Session.itemsAwarded, Session.duration,
// Session.objectives, Scene.description, and others.
// All exports return mock data until the schema is updated.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export interface SessionData {
  id: string
  name: string
  description?: string
  sessionNumber: number
  status: string
  scheduledAt?: Date
  startedAt?: Date
  endedAt?: Date
  duration?: number
  objectives: string[]
  experienceAwarded: number
  goldAwarded: number
  itemsAwarded: string[]
  participants: Array<{
    character: { id: string; name: string }
    user: { id: string; name: string }
    attendanceStatus: string
    actionsCount: number
    messagesCount: number
  }>
  scenes: Array<{
    id: string
    orderIndex: number
    duration?: number
    summary?: string
    scene: { id: string; description: string }
  }>
  notes: Array<{
    id: string
    content: string
    noteType: string
    timestamp: Date
    author: { name: string }
    isPublic: boolean
  }>
}

export class SessionService {
  // Create a new session
  static async createSession(campaignId: string, data: {
    name: string
    description?: string
    objectives?: string[]
    scheduledAt?: Date
  }) {
    // DISABLED: Schema mismatch - Session model missing required fields
    console.warn('SessionService.createSession is disabled due to schema mismatches');
    return {
      id: 'mock-session-' + Math.random().toString(36).substr(2, 9),
      campaignId,
      name: data.name,
      description: data.description,
      status: 'SCHEDULED',
      scheduledAt: data.scheduledAt || new Date(),
      startedAt: null,
      endedAt: null,
      participants: [],
      scenes: [],
      notes: []
    };

    /* ORIGINAL CODE - DISABLED DUE TO SCHEMA MISMATCHES
    // Get next session number
    const lastSession = await prisma.session.findFirst({
      where: { campaignId },
      orderBy: { sessionNumber: 'desc' }
    })

    const sessionNumber = (lastSession?.sessionNumber || 0) + 1

    return await prisma.session.create({
      data: {
        campaignId,
        name: data.name,
        description: data.description,
        sessionNumber,
        objectives: data.objectives || [],
        scheduledAt: data.scheduledAt,
      },
      include: {
        participants: {
          include: {
            character: true,
            user: true
          }
        },
        scenes: {
          include: {
            scene: true
          }
        },
        notes: {
          include: {
            author: true
          }
        }
      }
    })
    */
  }

  // Get sessions for a campaign
  static async getCampaignSessions(
    campaignId: string,
    options: {
      status?: string
      limit?: number
      offset?: number
    } = {}
  ): Promise<SessionData[]> {
    // DISABLED: Schema mismatch - Session model missing required fields
    console.warn('SessionService.getCampaignSessions is disabled due to schema mismatches');
    return [];

    /* ORIGINAL CODE - DISABLED DUE TO SCHEMA MISMATCHES
    const where: any = { campaignId }

    if (options.status) {
      where.status = options.status
    }

    const sessions = await prisma.session.findMany({
      where,
      include: {
        participants: {
          include: {
            character: { select: { id: true, name: true } },
            user: { select: { id: true, name: true } }
          }
        },
        scenes: {
          include: {
            scene: { select: { id: true, description: true } }
          },
          orderBy: { orderIndex: 'asc' }
        },
        notes: {
          include: {
            author: { select: { name: true } }
          },
          orderBy: { timestamp: 'desc' }
        }
      },
      orderBy: { sessionNumber: 'desc' },
      take: options.limit || 50,
      skip: options.offset || 0
    })

    return sessions.map(session => ({
      id: session.id,
      name: session.name,
      description: session.description,
      sessionNumber: session.sessionNumber,
      status: session.status,
      scheduledAt: session.scheduledAt,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      duration: session.duration,
      objectives: session.objectives,
      experienceAwarded: session.experienceAwarded,
      goldAwarded: session.goldAwarded,
      itemsAwarded: session.itemsAwarded,
      participants: session.participants.map(p => ({
        character: p.character,
        user: p.user,
        attendanceStatus: p.attendanceStatus,
        actionsCount: p.actionsCount,
        messagesCount: p.messagesCount
      })),
      scenes: session.scenes.map(s => ({
        id: s.id,
        orderIndex: s.orderIndex,
        duration: s.duration,
        summary: s.summary,
        scene: s.scene
      })),
      notes: session.notes.map(n => ({
        id: n.id,
        content: n.content,
        noteType: n.noteType,
        timestamp: n.timestamp,
        author: n.author,
        isPublic: n.isPublic
      }))
    }))
    */
  }

  // Get current active session
  static async getCurrentSession(campaignId: string): Promise<SessionData | null> {
    // DISABLED: Schema mismatch - Session model missing required fields
    console.warn('SessionService.getCurrentSession is disabled due to schema mismatches');
    return null;

    /* ORIGINAL CODE - DISABLED DUE TO SCHEMA MISMATCHES
    const session = await prisma.session.findFirst({
      where: {
        campaignId,
        status: 'IN_PROGRESS'
      },
      include: {
        participants: {
          include: {
            character: { select: { id: true, name: true } },
            user: { select: { id: true, name: true } }
          }
        },
        scenes: {
          include: {
            scene: { select: { id: true, description: true } }
          },
          orderBy: { orderIndex: 'asc' }
        },
        notes: {
          include: {
            author: { select: { name: true } }
          },
          orderBy: { timestamp: 'desc' }
        }
      }
    })

    if (!session) return null

    return {
      id: session.id,
      name: session.name,
      description: session.description,
      sessionNumber: session.sessionNumber,
      status: session.status,
      scheduledAt: session.scheduledAt,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      duration: session.duration,
      objectives: session.objectives,
      experienceAwarded: session.experienceAwarded,
      goldAwarded: session.goldAwarded,
      itemsAwarded: session.itemsAwarded,
      participants: session.participants.map(p => ({
        character: p.character,
        user: p.user,
        attendanceStatus: p.attendanceStatus,
        actionsCount: p.actionsCount,
        messagesCount: p.messagesCount
      })),
      scenes: session.scenes.map(s => ({
        id: s.id,
        orderIndex: s.orderIndex,
        duration: s.duration,
        summary: s.summary,
        scene: s.scene
      })),
      notes: session.notes.map(n => ({
        id: n.id,
        content: n.content,
        noteType: n.noteType,
        timestamp: n.timestamp,
        author: n.author,
        isPublic: n.isPublic
      }))
    }
    */
  }

  // Start a session
  static async startSession(sessionId: string, characterIds: string[]) {
    // DISABLED: Schema mismatch
    console.warn('SessionService.startSession is disabled due to schema mismatches');
    return {
      id: sessionId,
      status: 'IN_PROGRESS',
      startedAt: new Date()
    };

    /* ORIGINAL CODE - DISABLED DUE TO SCHEMA MISMATCHES
    // Update session status
    const session = await prisma.session.update({
      where: { id: sessionId },
      data: {
        status: 'IN_PROGRESS',
        startedAt: new Date()
      }
    })

    // Add participants
    for (const characterId of characterIds) {
      const character = await prisma.character.findUnique({
        where: { id: characterId },
        include: { user: true }
      })

      if (character) {
        await prisma.sessionParticipant.create({
          data: {
            sessionId,
            characterId,
            userId: character.userId,
            attendanceStatus: 'PRESENT',
            joinedAt: new Date()
          }
        })
      }
    }

    return session
    */
  }

  // End a session
  static async endSession(sessionId: string, summary?: {
    experienceAwarded?: number
    goldAwarded?: number
    itemsAwarded?: string[]
    notes?: string
  }) {
    // DISABLED: Schema mismatch
    console.warn('SessionService.endSession is disabled due to schema mismatches');
    return {
      id: sessionId,
      status: 'COMPLETED',
      endedAt: new Date()
    };

    /* ORIGINAL CODE - DISABLED DUE TO SCHEMA MISMATCHES
    const startedAt = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { startedAt: true }
    })

    const now = new Date()
    const duration = startedAt?.startedAt
      ? Math.round((now.getTime() - startedAt.startedAt.getTime()) / 60000)
      : null

    const session = await prisma.session.update({
      where: { id: sessionId },
      data: {
        status: 'COMPLETED',
        endedAt: now,
        duration,
        experienceAwarded: summary?.experienceAwarded || 0,
        goldAwarded: summary?.goldAwarded || 0,
        itemsAwarded: summary?.itemsAwarded || []
      }
    })

    // Add summary note if provided
    if (summary?.notes) {
      await this.addSessionNote(sessionId, 'AI_GM', summary.notes, 'GENERAL', true)
    }

    // Update participant attendance
    await prisma.sessionParticipant.updateMany({
      where: {
        sessionId,
        leftAt: null
      },
      data: {
        leftAt: now
      }
    })

    return session
    */
  }

  // Add a scene to a session
  static async addSceneToSession(sessionId: string, sceneId: string, orderIndex?: number) {
    // DISABLED: Schema mismatch
    console.warn('SessionService.addSceneToSession is disabled due to schema mismatches');
    return {
      id: 'mock-scene-' + Math.random().toString(36).substr(2, 9),
      sessionId,
      sceneId,
      orderIndex: orderIndex || 0,
      scene: { id: sceneId }
    };

    /* ORIGINAL CODE - DISABLED DUE TO SCHEMA MISMATCHES
    // Get current max order index if not provided
    if (orderIndex === undefined) {
      const lastScene = await prisma.sessionScene.findFirst({
        where: { sessionId },
        orderBy: { orderIndex: 'desc' }
      })
      orderIndex = (lastScene?.orderIndex || 0) + 1
    }

    return await prisma.sessionScene.create({
      data: {
        sessionId,
        sceneId,
        orderIndex
      },
      include: {
        scene: true
      }
    })
    */
  }

  // Add a note to a session
  static async addSessionNote(
    sessionId: string,
    authorId: string,
    content: string,
    noteType: string = 'GENERAL',
    isPublic: boolean = true
  ) {
    // DISABLED: Schema mismatch
    console.warn('SessionService.addSessionNote is disabled due to schema mismatches');
    return {
      id: 'mock-note-' + Math.random().toString(36).substr(2, 9),
      sessionId,
      authorId,
      content,
      noteType,
      isPublic,
      timestamp: new Date(),
      author: { name: 'Mock Author' }
    };

    /* ORIGINAL CODE - DISABLED DUE TO SCHEMA MISMATCHES
    return await prisma.sessionNote.create({
      data: {
        sessionId,
        authorId,
        content,
        noteType,
        isPublic
      },
      include: {
        author: { select: { name: true } }
      }
    })
    */
  }

  // Update participant activity
  static async updateParticipantActivity(
    sessionId: string,
    characterId: string,
    activityType: 'action' | 'message'
  ) {
    // DISABLED: Schema mismatch
    console.warn('SessionService.updateParticipantActivity is disabled due to schema mismatches');
    return {
      sessionId,
      characterId,
      actionsCount: activityType === 'action' ? 1 : 0,
      messagesCount: activityType === 'message' ? 1 : 0
    };

    /* ORIGINAL CODE - DISABLED DUE TO SCHEMA MISMATCHES
    const updateData = activityType === 'action'
      ? { actionsCount: { increment: 1 } }
      : { messagesCount: { increment: 1 } }

    return await prisma.sessionParticipant.update({
      where: {
        sessionId_characterId: {
          sessionId,
          characterId
        }
      },
      data: updateData
    })
    */
  }

  // Get session statistics
  static async getSessionStatistics(sessionId: string) {
    // DISABLED: Schema mismatch
    console.warn('SessionService.getSessionStatistics is disabled due to schema mismatches');
    return {
      sessionId,
      participantCount: 0,
      sceneCount: 0,
      noteCount: 0,
      totalActions: 0,
      totalMessages: 0,
      duration: null,
      experienceAwarded: 0,
      goldAwarded: 0,
      itemsAwarded: 0
    };

    /* ORIGINAL CODE - DISABLED DUE TO SCHEMA MISMATCHES
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        participants: true,
        scenes: true,
        notes: true
      }
    })

    if (!session) return null

    const totalActions = session.participants.reduce(
      (sum, p) => sum + p.actionsCount,
      0
    )
    const totalMessages = session.participants.reduce(
      (sum, p) => sum + p.messagesCount,
      0
    )

    return {
      sessionId,
      participantCount: session.participants.length,
      sceneCount: session.scenes.length,
      noteCount: session.notes.length,
      totalActions,
      totalMessages,
      duration: session.duration,
      experienceAwarded: session.experienceAwarded,
      goldAwarded: session.goldAwarded,
      itemsAwarded: session.itemsAwarded.length
    }
    */
  }

  // Archive old sessions
  static async archiveOldSessions(campaignId: string, daysOld: number = 90) {
    // DISABLED: Schema mismatch
    console.warn('SessionService.archiveOldSessions is disabled due to schema mismatches');
    return {
      count: 0
    };

    /* ORIGINAL CODE - DISABLED DUE TO SCHEMA MISMATCHES
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysOld)

    return await prisma.session.updateMany({
      where: {
        campaignId,
        endedAt: {
          lt: cutoffDate
        },
        status: 'COMPLETED'
      },
      data: {
        // Could add an 'archived' status if you create one
        // status: 'ARCHIVED'
      }
    })
    */
  }

  // Get session analytics for campaign
  static async getCampaignSessionAnalytics(campaignId: string) {
    // DISABLED: Schema mismatch
    console.warn('SessionService.getCampaignSessionAnalytics is disabled due to schema mismatches');
    return {
      totalSessions: 0,
      completedSessions: 0,
      averageDuration: 0,
      averageParticipants: 0,
      totalExperienceAwarded: 0,
      totalGoldAwarded: 0
    };

    /* ORIGINAL CODE - DISABLED DUE TO SCHEMA MISMATCHES
    const sessions = await prisma.session.findMany({
      where: { campaignId },
      include: {
        participants: true,
        scenes: true
      }
    })

    const completed = sessions.filter(s => s.status === 'COMPLETED')
    const totalDuration = completed.reduce((sum, s) => sum + (s.duration || 0), 0)
    const averageDuration = completed.length ? totalDuration / completed.length : 0

    const totalParticipants = sessions.reduce(
      (sum, s) => sum + s.participants.length,
      0
    )
    const averageParticipants = sessions.length ? totalParticipants / sessions.length : 0

    return {
      totalSessions: sessions.length,
      completedSessions: completed.length,
      averageDuration: Math.round(averageDuration),
      averageParticipants: Math.round(averageParticipants * 10) / 10,
      totalExperienceAwarded: sessions.reduce((sum, s) => sum + s.experienceAwarded, 0),
      totalGoldAwarded: sessions.reduce((sum, s) => sum + s.goldAwarded, 0)
    }
    */
  }
}
