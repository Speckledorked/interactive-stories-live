// Stub service for campaign maps

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

export async function getMaps(campaignId: string): Promise<MapData[]> {
  // Stub implementation - returns empty array
  return []
}

export async function getMapById(mapId: string): Promise<MapData | null> {
  // Stub implementation
  return null
}

export async function createMap(data: Partial<MapData>): Promise<MapData | null> {
  // Stub implementation
  return null
}

export async function updateMap(mapId: string, data: Partial<MapData>): Promise<MapData | null> {
  // Stub implementation
  return null
}

// MapService class for compatibility with existing imports
export const MapService = {
  getMaps,
  getMapById,
  createMap: async (campaignId: string, data: Partial<MapData>): Promise<MapData> => {
    // Stub implementation - returns a mock map
    return {
      id: 'mock-map-id',
      name: data.name || 'Unnamed Map',
      description: data.description,
      imageUrl: data.imageUrl,
      width: data.width || 800,
      height: data.height || 600,
      gridSize: data.gridSize || 40,
      tokens: [],
      zones: [],
      campaignId,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  },
  updateMap: async (mapId: string, data: Partial<MapData>): Promise<MapData> => {
    // Stub implementation - returns a mock updated map
    return {
      id: mapId,
      name: data.name || 'Updated Map',
      description: data.description,
      imageUrl: data.imageUrl,
      width: data.width || 800,
      height: data.height || 600,
      gridSize: data.gridSize || 40,
      tokens: [],
      zones: [],
      campaignId: 'mock-campaign-id',
      createdAt: new Date(),
      updatedAt: new Date()
    }
  },
  async getActiveMap(campaignId: string): Promise<MapData | null> {
    // Stub implementation
    return null
  },
  async setActiveMap(campaignId: string, mapId: string): Promise<void> {
    // Stub implementation
    return
  },
  async createZone(mapId: string, data: Partial<MapZone> & { triggerType?: string; triggerData?: any }): Promise<MapZone> {
    // Stub implementation - returns a mock zone
    return {
      id: `zone-${Date.now()}`,
      name: data.name || 'Unnamed Zone',
      x: data.x || 0,
      y: data.y || 0,
      width: data.width || 100,
      height: data.height || 100,
      color: data.color || '#3B82F6',
      description: data.description,
      isVisible: data.isVisible ?? true,
      triggerType: data.triggerType as any
    }
  },
  async createToken(mapId: string, data: Partial<MapToken>): Promise<MapToken> {
    // Stub implementation - returns a mock token
    return {
      id: `token-${Date.now()}`,
      name: data.name || 'Unnamed Token',
      x: data.x || 0,
      y: data.y || 0,
      size: data.size || 1,
      color: data.color || '#6B7280',
      imageUrl: data.imageUrl,
      isPC: data.isPC ?? false,
      isVisible: data.isVisible ?? true
    }
  },
  async moveToken(tokenId: string, x: number, y: number): Promise<void> {
    // Stub implementation
    return
  },
  async deleteToken(tokenId: string): Promise<void> {
    // Stub implementation
    return
  }
}
