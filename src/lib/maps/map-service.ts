// Map service for campaign maps
import { prisma } from '@/lib/prisma'

export interface MapToken {
  id: string
  name: string
  x: number
  y: number
  size: number
  color: string
  imageUrl?: string
  isPC: boolean
  isVisible: boolean
  character?: {
    id: string
    name: string
  }
}

export interface MapZone {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  color: string
  description?: string
  isVisible: boolean
  triggerType?: 'combat' | 'interaction' | 'trap' | 'discovery'
}

export interface MapData {
  id: string
  name: string
  description?: string
  imageUrl?: string
  width: number
  height: number
  gridSize: number
  tokens: MapToken[]
  zones: MapZone[]
  campaignId: string
  sessionId?: string
  createdAt: Date
  updatedAt: Date
}

// Helper function to convert database map to MapData
function mapToMapData(dbMap: any): MapData {
  return {
    id: dbMap.id,
    name: dbMap.name,
    description: dbMap.description || undefined,
    imageUrl: dbMap.background || undefined,
    width: dbMap.width,
    height: dbMap.height,
    gridSize: dbMap.gridSize,
    tokens: (dbMap.tokens || []).map((token: any) => ({
      id: token.id,
      name: token.name,
      x: token.x,
      y: token.y,
      size: token.size,
      color: token.color,
      imageUrl: token.metadata?.imageUrl,
      isPC: token.isPlayer,
      isVisible: token.isVisible,
      character: token.metadata?.character
    })),
    zones: (dbMap.zones || []).map((zone: any) => ({
      id: zone.id,
      name: zone.name,
      x: zone.x,
      y: zone.y,
      width: zone.width,
      height: zone.height,
      color: zone.color || '#3B82F6',
      description: zone.description || undefined,
      isVisible: zone.isActive,
      triggerType: zone.metadata?.triggerType
    })),
    campaignId: dbMap.campaignId,
    sessionId: dbMap.sceneId || undefined,
    createdAt: dbMap.createdAt,
    updatedAt: dbMap.updatedAt
  }
}

export async function getMaps(campaignId: string): Promise<MapData[]> {
  const maps = await prisma.map.findMany({
    where: { campaignId },
    include: {
      tokens: true,
      zones: true
    },
    orderBy: { createdAt: 'desc' }
  })

  return maps.map(mapToMapData)
}

export async function getMapById(mapId: string): Promise<MapData | null> {
  const map = await prisma.map.findUnique({
    where: { id: mapId },
    include: {
      tokens: true,
      zones: true
    }
  })

  return map ? mapToMapData(map) : null
}

export async function createMap(data: Partial<MapData>): Promise<MapData | null> {
  if (!data.campaignId) {
    return null
  }

  const map = await prisma.map.create({
    data: {
      campaignId: data.campaignId,
      sceneId: data.sessionId,
      name: data.name || 'Unnamed Map',
      description: data.description,
      width: data.width || 800,
      height: data.height || 600,
      gridSize: data.gridSize || 40,
      background: data.imageUrl,
      isActive: true
    },
    include: {
      tokens: true,
      zones: true
    }
  })

  return mapToMapData(map)
}

export async function updateMap(mapId: string, data: Partial<MapData>): Promise<MapData | null> {
  const map = await prisma.map.update({
    where: { id: mapId },
    data: {
      name: data.name,
      description: data.description,
      width: data.width,
      height: data.height,
      gridSize: data.gridSize,
      background: data.imageUrl,
      sceneId: data.sessionId
    },
    include: {
      tokens: true,
      zones: true
    }
  })

  return mapToMapData(map)
}

// MapService class for compatibility with existing imports
export const MapService = {
  getMaps,
  getMapById,

  async createMap(campaignId: string, data: Partial<MapData>): Promise<MapData> {
    const result = await createMap({ ...data, campaignId })
    if (!result) {
      throw new Error('Failed to create map')
    }
    return result
  },

  async updateMap(mapId: string, data: Partial<MapData>): Promise<MapData> {
    const result = await updateMap(mapId, data)
    if (!result) {
      throw new Error('Failed to update map')
    }
    return result
  },

  async getActiveMap(campaignId: string): Promise<MapData | null> {
    const maps = await prisma.map.findMany({
      where: {
        campaignId,
        isActive: true
      },
      include: {
        tokens: true,
        zones: true
      },
      orderBy: { createdAt: 'desc' },
      take: 1
    })

    return maps.length > 0 ? mapToMapData(maps[0]) : null
  },

  async setActiveMap(campaignId: string, mapId: string): Promise<void> {
    // Set all maps in campaign to inactive
    await prisma.map.updateMany({
      where: { campaignId },
      data: { isActive: false }
    })

    // Set the specified map to active
    await prisma.map.update({
      where: { id: mapId },
      data: { isActive: true }
    })
  },

  async createZone(mapId: string, data: Partial<MapZone> & { triggerType?: string; triggerData?: any }): Promise<MapZone> {
    const zone = await prisma.zone.create({
      data: {
        mapId,
        name: data.name || 'Unnamed Zone',
        description: data.description,
        x: data.x || 0,
        y: data.y || 0,
        width: data.width || 100,
        height: data.height || 100,
        color: data.color || '#3B82F6',
        isActive: data.isVisible ?? true,
        metadata: data.triggerType || data.triggerData ? {
          triggerType: data.triggerType,
          triggerData: data.triggerData
        } : undefined
      }
    })

    return {
      id: zone.id,
      name: zone.name,
      x: zone.x,
      y: zone.y,
      width: zone.width,
      height: zone.height,
      color: zone.color || '#3B82F6',
      description: zone.description || undefined,
      isVisible: zone.isActive,
      triggerType: (zone.metadata as any)?.triggerType
    }
  },

  async createToken(mapId: string, data: Partial<MapToken>): Promise<MapToken> {
    const token = await prisma.token.create({
      data: {
        mapId,
        name: data.name || 'Unnamed Token',
        x: data.x || 0,
        y: data.y || 0,
        size: data.size || 30,
        color: data.color || '#6B7280',
        isPlayer: data.isPC ?? false,
        isVisible: data.isVisible ?? true,
        metadata: data.imageUrl || data.character ? {
          imageUrl: data.imageUrl,
          character: data.character
        } : undefined
      }
    })

    return {
      id: token.id,
      name: token.name,
      x: token.x,
      y: token.y,
      size: token.size,
      color: token.color,
      imageUrl: (token.metadata as any)?.imageUrl,
      isPC: token.isPlayer,
      isVisible: token.isVisible,
      character: (token.metadata as any)?.character
    }
  },

  // NOTE (#412): there is deliberately no single-token move/delete API
  // here. Maps in MythOS are ILLUSTRATIVE — generated per scene, read-only
  // for players (PlayerMapViewer), and replaced wholesale by
  // clearMapContents when a scene reuses a location. Per-token mutation
  // only ever existed to serve AIVisualService's token-movement methods,
  // which had no callers of their own and were removed with them. Grid
  // combat is parked, not in progress; if it is ever picked up, this is
  // where its mutation surface goes, alongside the authorization and
  // realtime-broadcast story a player-driven token needs and these
  // functions never had.

  // Wipes a map's zones/tokens before regenerating them for a new scene
  // that's reusing the same location — without this, generateZones/
  // generateTokens (which only ever create, never replace) leave every
  // prior scene's zones/tokens sitting on the map indefinitely, piling up
  // stale/duplicate markers instead of reflecting the current scene.
  async clearMapContents(mapId: string): Promise<void> {
    await prisma.zone.deleteMany({ where: { mapId } })
    await prisma.token.deleteMany({ where: { mapId } })
  },

  async deleteMap(mapId: string): Promise<void> {
    await prisma.map.delete({
      where: { id: mapId }
    })
  },

  /**
   * Keep a campaign's map count bounded (README Known Bugs #9/#59 — "no
   * cleanup path").
   *
   * Map generation creates a new Map+Zone+Token set whenever the AI decides
   * a scene isn't reusing an existing location, and nothing ever removed
   * old ones — a long campaign accumulates a map per distinct location
   * forever, each with its own zone/token rows. This prunes the oldest maps
   * once a campaign exceeds MAX_MAPS_PER_CAMPAIGN, newest kept.
   *
   * The currently-active map is never pruned regardless of age: it's the
   * one a live scene may be rendering right now, and deleting it mid-scene
   * would blank the player's view. Zones/tokens cascade on Map delete (see
   * schema.prisma), so removing the Map row is sufficient.
   *
   * Returns how many maps were deleted, for logging.
   */
  async pruneOldMaps(campaignId: string, maxMaps: number = MAX_MAPS_PER_CAMPAIGN): Promise<number> {
    const maps = await prisma.map.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, isActive: true }
    })

    if (maps.length <= maxMaps) return 0

    const prunable = maps.slice(maxMaps).filter(m => !m.isActive)
    if (prunable.length === 0) return 0

    const { count } = await prisma.map.deleteMany({
      where: { id: { in: prunable.map(m => m.id) } }
    })
    return count
  }
}

/**
 * How many maps a single campaign retains. Generous relative to how many
 * distinct locations a campaign actually revisits — this is a backstop
 * against unbounded accumulation, not a curation policy.
 */
export const MAX_MAPS_PER_CAMPAIGN = 20
