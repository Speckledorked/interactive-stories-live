// PLACE IN: src/lib/ai/scene-resolution-hook.ts

import { AISceneVisualIntegration } from './ai-scene-visual-integration'
import { AIVisualService } from './ai-visual-service'

// Hook to integrate AI visual generation into your existing scene resolution
export class SceneResolutionHook {
  
  // Replace your existing scene resolution API call with this
  static async resolveSceneWithAIVisuals(
    sceneId: string,
    playerActions: Array<{ playerId: string; action: string }>,
    campaignId: string,
    options: {
      generateVisuals?: boolean
      updateCharacterPositions?: boolean
      autoSoundEffects?: boolean
    } = {}
  ) {
    // Default options
    const {
      generateVisuals = true,
      updateCharacterPositions = true,
      autoSoundEffects = true
    } = options

    try {
      if (generateVisuals && process.env.AI_VISUAL_ENABLED === 'true') {
        // Use AI-enhanced scene resolution with automatic visuals
        return await AISceneVisualIntegration.resolveSceneWithVisuals(
          sceneId,
          playerActions,
          campaignId
        )
      } else {
        // Fall back to your existing scene resolution without visuals
        return await this.resolveSceneTraditional(sceneId, playerActions, campaignId)
      }
    } catch (error) {
      console.error('Error in AI visual scene resolution:', error)
      
      // Fallback to traditional resolution if AI visuals fail
      console.log('Falling back to traditional scene resolution...')
      return await this.resolveSceneTraditional(sceneId, playerActions, campaignId)
    }
  }

  // Your existing scene resolution logic (placeholder - replace with your actual code)
  private static async resolveSceneTraditional(
    sceneId: string,
    playerActions: Array<{ playerId: string; action: string }>,
    campaignId: string
  ) {
    // This should be your existing scene resolution logic
    // Just return the text-based scene resolution without visuals
    
    console.log('Resolving scene traditionally without AI visuals')
    
    // Example placeholder - replace with your actual implementation
    return {
      sceneId,
      description: "Scene resolved traditionally without visual generation",
      success: true
    }
  }

  // Manual visual update for specific scenarios
  static async updateVisualsManually(
    campaignId: string,
    sceneDescription: string,
    characterUpdates?: Array<{ name: string; action: string }>
  ) {
    try {
      // Generate new map from description
      const visualData = await AIVisualService.generateMapFromScene(
        sceneDescription,
        campaignId
      )

      // Update character positions if provided
      if (characterUpdates && characterUpdates.length > 0) {
        for (const update of characterUpdates) {
          await AIVisualService.updateCharacterPosition(
            update.name,
            update.action,
            visualData.mapId,
            campaignId
          )
        }
      }

      return visualData
    } catch (error) {
      console.error('Error updating visuals manually:', error)
      throw error
    }
  }

  // Add or remove scene elements during gameplay
  static async updateSceneElements(
    campaignId: string,
    updates: Array<{
      action: 'add' | 'remove' | 'move'
      elementName: string
      elementType?: 'npc' | 'object' | 'enemy'
      description?: string
      position?: string
    }>
  ) {
    try {
      const activeMap = await this.getActiveMap(campaignId)
      if (!activeMap) {
        console.warn('No active map found for visual updates')
        return
      }

      for (const update of updates) {
        switch (update.action) {
          case 'add':
            if (update.elementType && update.description) {
              await AIVisualService.addSceneElement(
                update.elementName,
                update.elementType,
                update.description,
                activeMap.id,
                campaignId
              )
            }
            break

          case 'remove':
            await AIVisualService.removeSceneElement(
              update.elementName,
              activeMap.id,
              campaignId
            )
            break

          case 'move':
            if (update.position) {
              await AIVisualService.updateCharacterPosition(
                update.elementName,
                update.position,
                activeMap.id,
                campaignId
              )
            }
            break
        }
      }
    } catch (error) {
      console.error('Error updating scene elements:', error)
      throw error
    }
  }

  // Helper method to get active map
  private static async getActiveMap(campaignId: string) {
    try {
      const { MapService } = await import('@/lib/maps/map-service')
      return await MapService.getActiveMap(campaignId)
    } catch (error) {
      console.error('Error getting active map:', error)
      return null
    }
  }

  // Integration with your existing API routes
  static createVisualSceneEndpoint() {
    return {
      // Use this in your API route handlers
      handler: async (req: any, res: any) => {
        try {
          const { sceneId, playerActions, campaignId } = req.body
          
          const result = await this.resolveSceneWithAIVisuals(
            sceneId,
            playerActions,
            campaignId
          )
          
          return res.json({
            success: true,
            ...result
          })
        } catch (error) {
          console.error('Scene resolution error:', error)
          return res.status(500).json({
            success: false,
            error: 'Failed to resolve scene with visuals'
          })
        }
      }
    }
  }

  // Utility to check if AI visuals are enabled
  static isAIVisualsEnabled(): boolean {
    return process.env.AI_VISUAL_ENABLED === 'true' && 
           !!process.env.OPENAI_API_KEY
  }

  // Get AI visual generation status
  static getVisualsStatus() {
    return {
      enabled: this.isAIVisualsEnabled(),
      autoGeneration: process.env.AUTO_MAP_GENERATION === 'true',
      autoTokens: process.env.AUTO_TOKEN_PLACEMENT === 'true',
      autoZones: process.env.AUTO_ZONE_CREATION === 'true',
      model: process.env.AI_VISUAL_MODEL || 'gpt-4'
    }
  }
}

// Export for easy integration
export const useAIVisuals = SceneResolutionHook.resolveSceneWithAIVisuals
export const updateVisuals = SceneResolutionHook.updateVisualsManually
export const updateElements = SceneResolutionHook.updateSceneElements
