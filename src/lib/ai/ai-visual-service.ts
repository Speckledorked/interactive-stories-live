// PLACE IN: src/lib/ai/ai-visual-service.ts

import { MapService } from '@/lib/maps/map-service'
import PusherServer from '@/lib/realtime/pusher-server'
import { NotificationService } from '@/lib/notifications/notification-service'

export interface SceneVisualData {
  mapId: string
  mapName: string
  description: string
  backgroundType: string
  zones: Array<{
    name: string
    description: string
    x: number
    y: number
    width: number
    height: number
    color: string
    interactable: boolean
  }>
  tokens: Array<{
    name: string
    type: 'character' | 'npc' | 'object' | 'enemy'
    x: number
    y: number
    size: number
    color: string
  }>
  atmosphere: {
    lighting: 'bright' | 'dim' | 'dark' | 'flickering'
    mood: 'peaceful' | 'tense' | 'dangerous' | 'mysterious'
    sounds: string[]
  }
}

export class AIVisualService {
  private static readonly BACKGROUND_TEMPLATES = {
    'tavern': { width: 800, height: 600, gridSize: 40, color: '#8B4513' },
    'forest': { width: 1200, height: 900, gridSize: 60, color: '#228B22' },
    'dungeon': { width: 1000, height: 800, gridSize: 50, color: '#2F2F2F' },
    'castle': { width: 1400, height: 1000, gridSize: 70, color: '#708090' },
    'cave': { width: 900, height: 700, gridSize: 45, color: '#4B4B4B' },
    'city': { width: 1600, height: 1200, gridSize: 80, color: '#CD853F' },
    'ship': { width: 600, height: 400, gridSize: 30, color: '#8B4513' },
    'plains': { width: 1500, height: 1000, gridSize: 100, color: '#9ACD32' }
  }

  // Generate map layout based on AI scene description
  static async generateMapFromScene(
    sceneDescription: string,
    campaignId: string,
    previousMapId?: string
  ): Promise<SceneVisualData> {
    try {
      // Analyze scene description to extract visual elements
      const visualAnalysis = await this.analyzeSceneDescription(sceneDescription)
      
      // Create or update map
      const mapData = await this.createOrUpdateMap(
        visualAnalysis,
        campaignId,
        previousMapId
      )

      // Generate zones based on scene elements
      const zones = await this.generateZones(visualAnalysis, mapData.id)
      
      // Place tokens for mentioned entities
      const tokens = await this.generateTokens(visualAnalysis, mapData.id)

      // Broadcast new map to players
      const pusher = PusherServer()
      if (pusher) {
        await pusher.trigger(`campaign-${campaignId}`, 'ai-map-generated', {
          mapId: mapData.id,
          mapName: mapData.name,
          sceneDescription,
          zones,
          tokens
        })
      }

      return {
        mapId: mapData.id,
        mapName: mapData.name,
        description: sceneDescription,
        backgroundType: visualAnalysis.backgroundType,
        zones: zones as any,
        tokens: tokens as any,
        atmosphere: visualAnalysis.atmosphere
      }
    } catch (error) {
      console.error('Error generating map from scene:', error)
      throw new Error('Failed to generate visual scene')
    }
  }

  // Analyze scene description using OpenAI to extract visual elements
  private static async analyzeSceneDescription(description: string) {
    const prompt = `Analyze this D&D scene description and extract visual layout information:

"${description}"

Return a JSON object with:
{
  "backgroundType": "tavern|forest|dungeon|castle|cave|city|ship|plains",
  "mapName": "descriptive name for this location",
  "keyElements": ["list of important objects/areas mentioned"],
  "characters": ["list of NPCs or enemies mentioned"],
  "interactableAreas": ["areas players can interact with"],
  "atmosphere": {
    "lighting": "bright|dim|dark|flickering",
    "mood": "peaceful|tense|dangerous|mysterious",
    "sounds": ["ambient sounds for this location"]
  },
  "layoutHints": {
    "roomShape": "rectangular|circular|irregular|long|wide",
    "importantDirections": ["north", "east", "south", "west"],
    "centralFeature": "what's in the center of this space"
  }
}`

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini', // Cost optimization: mini model for map generation
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 800
        })
      })

      const data = await response.json()
      const analysis = JSON.parse(data.choices[0].message.content)
      
      return {
        backgroundType: analysis.backgroundType || 'dungeon',
        mapName: analysis.mapName || 'Unknown Location',
        keyElements: analysis.keyElements || [],
        characters: analysis.characters || [],
        interactableAreas: analysis.interactableAreas || [],
        atmosphere: analysis.atmosphere || { lighting: 'dim', mood: 'mysterious', sounds: [] },
        layoutHints: analysis.layoutHints || {}
      }
    } catch (error) {
      console.error('Error analyzing scene:', error)
      // Fallback to basic analysis
      return this.fallbackAnalysis(description)
    }
  }

  // Create or update map based on visual analysis
  private static async createOrUpdateMap(
    analysis: any,
    campaignId: string,
    previousMapId?: string
  ) {
    const backgroundType = analysis.backgroundType as keyof typeof this.BACKGROUND_TEMPLATES
    const template = this.BACKGROUND_TEMPLATES[backgroundType] || this.BACKGROUND_TEMPLATES['dungeon']
    
    // Check if we should update existing map or create new one
    if (previousMapId && this.shouldReuseMap(analysis)) {
      // Update existing map name/description
      return await MapService.updateMap(previousMapId, {
        name: analysis.mapName,
        description: `AI-generated map for: ${analysis.mapName}`
      })
    } else {
      // Create new map
      const mapData = await MapService.createMap(campaignId, {
        name: analysis.mapName,
        description: `AI-generated map for: ${analysis.mapName}`,
        width: template.width,
        height: template.height,
        gridSize: template.gridSize
      })

      // Set as active map
      await MapService.setActiveMap(campaignId, mapData.id)
      return mapData
    }
  }

  // Generate zones based on scene analysis
  private static async generateZones(analysis: any, mapId: string) {
    const backgroundType = analysis.backgroundType as keyof typeof this.BACKGROUND_TEMPLATES
    const template = this.BACKGROUND_TEMPLATES[backgroundType] || this.BACKGROUND_TEMPLATES['dungeon']
    const zones = []

    // Use grid-based placement to prevent overlap
    const grid = this.createPlacementGrid(template.width, template.height, 200, 150)
    let gridIndex = 0

    // Create zones for interactable areas
    for (let i = 0; i < analysis.interactableAreas.length; i++) {
      if (gridIndex >= grid.length) break

      const area = analysis.interactableAreas[i]
      const position = grid[gridIndex++]

      const zone = await MapService.createZone(mapId, {
        name: area,
        description: `Interactive area: ${area}`,
        x: position.x,
        y: position.y,
        width: 150,
        height: 100,
        color: this.getZoneColor(area),
        isVisible: true, // Ensure zone is visible
        triggerType: 'interaction',
        triggerData: {
          areaName: area,
          description: `You approach the ${area.toLowerCase()}`
        }
      })
      zones.push(zone)
    }

    // Create zones for key elements
    for (let i = 0; i < Math.min(analysis.keyElements.length, 3); i++) {
      if (gridIndex >= grid.length) break

      const element = analysis.keyElements[i]
      const position = grid[gridIndex++]

      const zone = await MapService.createZone(mapId, {
        name: element,
        description: `Important area: ${element}`,
        x: position.x,
        y: position.y,
        width: 120,
        height: 90,
        color: '#3B82F6',
        isVisible: true, // Ensure zone is visible
        triggerType: 'discovery',
        triggerData: {
          elementName: element,
          description: `You notice the ${element.toLowerCase()}`
        }
      })
      zones.push(zone)
    }

    // Fallback: Create at least one visible zone if none were created
    if (zones.length === 0 && gridIndex < grid.length) {
      const position = grid[gridIndex++]
      const zone = await MapService.createZone(mapId, {
        name: 'Center Area',
        description: 'The main area of interest',
        x: position.x,
        y: position.y,
        width: 150,
        height: 120,
        color: '#10B981',
        isVisible: true,
        triggerType: 'interaction',
        triggerData: {
          areaName: 'Center Area',
          description: 'You examine the area'
        }
      })
      zones.push(zone)
    }

    return zones
  }

  // Generate tokens for characters and objects
  private static async generateTokens(analysis: any, mapId: string) {
    const backgroundType = analysis.backgroundType as keyof typeof this.BACKGROUND_TEMPLATES
    const template = this.BACKGROUND_TEMPLATES[backgroundType] || this.BACKGROUND_TEMPLATES['dungeon']
    const tokens = []

    // Use grid-based placement for tokens (smaller grid)
    const grid = this.createPlacementGrid(template.width, template.height, 80, 80)
    let gridIndex = 0

    // Create tokens for NPCs and enemies
    for (let i = 0; i < analysis.characters.length; i++) {
      if (gridIndex >= grid.length) break

      const character = analysis.characters[i]
      const position = grid[gridIndex++]

      const token = await MapService.createToken(mapId, {
        name: character,
        x: position.x,
        y: position.y,
        size: 1,
        color: this.getCharacterTokenColor(character),
        isPC: false,
        isVisible: true // Ensure token is visible
      })
      tokens.push(token)
    }

    // Create tokens for important objects
    for (let i = 0; i < Math.min(analysis.keyElements.length, 2); i++) {
      if (gridIndex >= grid.length) break

      const element = analysis.keyElements[i]
      if (this.shouldCreateTokenForElement(element)) {
        const position = grid[gridIndex++]

        const token = await MapService.createToken(mapId, {
          name: element,
          x: position.x,
          y: position.y,
          size: 1,
          color: '#8B4513',
          isPC: false,
          isVisible: true // Ensure token is visible
        })
        tokens.push(token)
      }
    }

    // Fallback: Create at least one visible marker if no tokens were created
    if (tokens.length === 0 && gridIndex < grid.length) {
      const position = grid[gridIndex++]
      const token = await MapService.createToken(mapId, {
        name: 'Point of Interest',
        x: position.x,
        y: position.y,
        size: 1,
        color: '#F59E0B',
        isPC: false,
        isVisible: true
      })
      tokens.push(token)
    }

    return tokens
  }

  // Update character positions based on AI narrative
  static async updateCharacterPosition(
    characterName: string,
    actionDescription: string,
    mapId: string,
    campaignId: string
  ) {
    try {
      // Find character token
      const mapData = await MapService.getActiveMap(campaignId)
      if (!mapData) return

      const characterToken = mapData.tokens.find(
        token => token.name.toLowerCase().includes(characterName.toLowerCase())
      )

      if (!characterToken) return

      // Analyze movement from action description
      const newPosition = await this.analyzeMovement(
        actionDescription,
        characterToken,
        mapData
      )

      if (newPosition) {
        await MapService.moveToken(characterToken.id, newPosition.x, newPosition.y)

        // Broadcast movement
        const pusher = PusherServer()
        if (pusher) {
          await pusher.trigger(`campaign-${campaignId}`, 'ai-character-moved', {
            characterName,
            tokenId: characterToken.id,
            newPosition,
            actionDescription
          })
        }
      }
    } catch (error) {
      console.error('Error updating character position:', error)
    }
  }

  // Analyze movement description to determine new position
  private static async analyzeMovement(description: string, currentToken: any, mapData: any) {
    // Simple movement analysis - could be enhanced with AI
    const movementKeywords = {
      'north': { x: 0, y: -100 },
      'south': { x: 0, y: 100 },
      'east': { x: 100, y: 0 },
      'west': { x: -100, y: 0 },
      'center': { x: mapData.width / 2, y: mapData.height / 2 },
      'corner': { x: mapData.width - 100, y: mapData.height - 100 },
      'entrance': { x: 100, y: mapData.height - 100 },
      'bar': { x: mapData.width / 2, y: 100 },
      'door': { x: mapData.width - 50, y: mapData.height / 2 }
    }

    const lowerDesc = description.toLowerCase()
    for (const [keyword, offset] of Object.entries(movementKeywords)) {
      if (lowerDesc.includes(keyword)) {
        if (keyword === 'center' || keyword === 'corner' || keyword === 'entrance' || keyword === 'bar' || keyword === 'door') {
          return offset
        } else {
          return {
            x: Math.max(50, Math.min(mapData.width - 50, currentToken.x + offset.x)),
            y: Math.max(50, Math.min(mapData.height - 50, currentToken.y + offset.y))
          }
        }
      }
    }

    return null
  }

  // Add new NPCs or objects during gameplay
  static async addSceneElement(
    elementName: string,
    elementType: 'npc' | 'object' | 'enemy',
    description: string,
    mapId: string,
    campaignId: string
  ) {
    try {
      const mapData = await MapService.getActiveMap(campaignId)
      if (!mapData) return

      // Create token for new element
      const token = await MapService.createToken(mapId, {
        name: elementName,
        x: Math.random() * (mapData.width - 100) + 50,
        y: Math.random() * (mapData.height - 100) + 50,
        size: elementType === 'object' ? 1 : 1,
        color: this.getElementColor(elementType),
        isPC: false
      })

      // Broadcast new element
      const pusher = PusherServer()
      if (pusher) {
        await pusher.trigger(`campaign-${campaignId}`, 'ai-element-added', {
          elementName,
          elementType,
          description,
          token
        })
      }

      return token
    } catch (error) {
      console.error('Error adding scene element:', error)
    }
  }

  // Remove elements when they leave the scene
  static async removeSceneElement(
    elementName: string,
    mapId: string,
    campaignId: string
  ) {
    try {
      const mapData = await MapService.getActiveMap(campaignId)
      if (!mapData) return

      const token = mapData.tokens.find(
        t => t.name.toLowerCase().includes(elementName.toLowerCase())
      )

      if (token) {
        await MapService.deleteToken(token.id)

        const pusher = PusherServer()
        if (pusher) {
          await pusher.trigger(`campaign-${campaignId}`, 'ai-element-removed', {
            elementName,
            tokenId: token.id
          })
        }
      }
    } catch (error) {
      console.error('Error removing scene element:', error)
    }
  }

  // Helper methods
  private static shouldReuseMap(analysis: any): boolean {
    // Reuse map for similar locations or scene transitions
    return analysis.layoutHints?.reuseLocation === true
  }

  private static getZoneColor(areaName: string): string {
    const colorMap = {
      'treasure': '#FFD700',
      'door': '#8B4513',
      'stairs': '#708090',
      'altar': '#9370DB',
      'fire': '#FF4500',
      'water': '#1E90FF'
    }
    
    const lowerName = areaName.toLowerCase()
    for (const [key, color] of Object.entries(colorMap)) {
      if (lowerName.includes(key)) return color
    }
    
    return '#3B82F6'
  }

  private static getCharacterTokenColor(character: string): string {
    const lowerChar = character.toLowerCase()
    if (lowerChar.includes('enemy') || lowerChar.includes('goblin') || lowerChar.includes('orc')) {
      return '#DC2626' // Red for enemies
    }
    if (lowerChar.includes('npc') || lowerChar.includes('villager') || lowerChar.includes('merchant')) {
      return '#059669' // Green for friendly NPCs
    }
    return '#F59E0B' // Amber for neutral characters
  }

  private static shouldCreateTokenForElement(element: string): boolean {
    const tokenWorthy = ['chest', 'door', 'statue', 'altar', 'throne', 'fountain']
    const lowerElement = element.toLowerCase()
    return tokenWorthy.some(word => lowerElement.includes(word))
  }

  private static getElementColor(type: string): string {
    switch (type) {
      case 'npc': return '#059669'
      case 'enemy': return '#DC2626'
      case 'object': return '#8B4513'
      default: return '#6B7280'
    }
  }

  private static fallbackAnalysis(description: string) {
    // Basic keyword-based analysis as fallback
    const backgroundType = this.detectBackgroundType(description)
    return {
      backgroundType,
      mapName: 'Current Location',
      keyElements: this.extractKeyElements(description),
      characters: [],
      interactableAreas: [],
      atmosphere: { lighting: 'dim', mood: 'mysterious', sounds: [] },
      layoutHints: {}
    }
  }

  private static detectBackgroundType(description: string): string {
    const keywords = {
      'tavern': ['tavern', 'inn', 'bar', 'ale', 'drink'],
      'forest': ['forest', 'tree', 'woods', 'nature'],
      'dungeon': ['dungeon', 'underground', 'stone', 'corridor'],
      'castle': ['castle', 'palace', 'throne', 'royal'],
      'cave': ['cave', 'cavern', 'underground'],
      'city': ['city', 'street', 'buildings', 'town'],
      'ship': ['ship', 'boat', 'deck', 'sail'],
      'plains': ['plains', 'field', 'grassland', 'open']
    }

    const lowerDesc = description.toLowerCase()
    for (const [type, words] of Object.entries(keywords)) {
      if (words.some(word => lowerDesc.includes(word))) {
        return type
      }
    }
    
    return 'dungeon' // default
  }

  private static extractKeyElements(description: string): string[] {
    const elementKeywords = [
      'door', 'chest', 'table', 'chair', 'stairs', 'altar',
      'fountain', 'statue', 'throne', 'fireplace', 'window'
    ]

    const lowerDesc = description.toLowerCase()
    return elementKeywords.filter(element => lowerDesc.includes(element))
  }

  /**
   * Create a grid of positions to prevent overlap
   * Returns array of {x, y} positions distributed evenly across the map
   */
  private static createPlacementGrid(
    width: number,
    height: number,
    cellWidth: number,
    cellHeight: number
  ): Array<{ x: number; y: number }> {
    const positions: Array<{ x: number; y: number }> = []
    const margin = 50 // Margin from edges

    // Calculate number of cells that fit
    const cols = Math.floor((width - margin * 2) / cellWidth)
    const rows = Math.floor((height - margin * 2) / cellHeight)

    // Generate grid positions
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        positions.push({
          x: margin + col * cellWidth + cellWidth / 4,
          y: margin + row * cellHeight + cellHeight / 4
        })
      }
    }

    // Shuffle positions to add variety while maintaining no overlap
    return positions.sort(() => Math.random() - 0.5)
  }
}
