// PLACE IN: src/lib/ai/ai-scene-visual-integration.ts

import { AIVisualService } from './ai-visual-service'
import { SoundService } from '@/lib/notifications/sound-service'
import { NotificationService } from '@/lib/notifications/notification-service'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export class AISceneVisualIntegration {
  // Enhanced scene resolution that automatically generates visuals
  static async resolveSceneWithVisuals(
    sceneId: string,
    playerActions: Array<{ playerId: string; action: string }>,
    campaignId: string
  ) {
    try {
      // 1. First, resolve the scene normally (your existing AI logic)
      const sceneResolution = await this.resolveSceneNormally(sceneId, playerActions, campaignId)
      
      // 2. Generate visuals based on the AI's response
      const visualData = await AIVisualService.generateMapFromScene(
        sceneResolution.description,
        campaignId,
        sceneResolution.previousMapId
      )

      // 3. Update character positions based on their actions
      await this.updateCharacterPositions(playerActions, visualData.mapId, campaignId)

      // 4. Add any new NPCs or objects mentioned in the resolution
      await this.addNewSceneElements(sceneResolution, visualData.mapId, campaignId)

      // 5. Play appropriate sound effects
      await this.triggerSceneSounds(visualData.atmosphere, campaignId)

      // 6. Send comprehensive update to all players
      await this.broadcastSceneUpdate(sceneResolution, visualData, campaignId)

      return {
        ...sceneResolution,
        visualData,
        mapId: visualData.mapId
      }
    } catch (error) {
      console.error('Error resolving scene with visuals:', error)
      throw error
    }
  }

  // Your existing scene resolution logic (placeholder - replace with your actual implementation)
  private static async resolveSceneNormally(
    sceneId: string,
    playerActions: Array<{ playerId: string; action: string }>,
    campaignId: string
  ) {
    // This should be your existing scene resolution logic
    // For now, this is a placeholder that shows the integration pattern
    
    const scene = await prisma.scene.findUnique({
      where: { id: sceneId },
      include: { campaign: true }
    })

    if (!scene) throw new Error('Scene not found')

    // Build prompt for OpenAI including player actions
    const actionsText = playerActions
      .map(pa => `Player ${pa.playerId}: ${pa.action}`)
      .join('\n')

    const prompt = `
Current Scene: ${scene.description}
Current State: ${scene.currentState}

Player Actions:
${actionsText}

As the AI Game Master, describe what happens next. Include:
1. Immediate consequences of player actions
2. Any new NPCs, enemies, or objects that appear
3. Environmental changes or new locations
4. What players can see and interact with now

Respond in a narrative style that creates immersion.`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 600
      })
    })

    const data = await response.json()
    const aiDescription = data.choices[0].message.content

    // Update scene in database
    await prisma.scene.update({
      where: { id: sceneId },
      data: {
        description: aiDescription,
        currentState: JSON.stringify({
          lastActions: playerActions,
          timestamp: new Date(),
          resolved: true
        })
      }
    })

    return {
      sceneId,
      description: aiDescription,
      previousMapId: scene.currentState?.mapId,
      newElements: this.extractNewElements(aiDescription),
      characterMentions: this.extractCharacterMentions(aiDescription, playerActions)
    }
  }

  // Update character positions based on their actions
  private static async updateCharacterPositions(
    playerActions: Array<{ playerId: string; action: string }>,
    mapId: string,
    campaignId: string
  ) {
    for (const playerAction of playerActions) {
      // Get character name from player ID
      const character = await prisma.character.findFirst({
        where: { 
          userId: playerAction.playerId,
          campaign: { id: campaignId }
        }
      })

      if (character) {
        await AIVisualService.updateCharacterPosition(
          character.name,
          playerAction.action,
          mapId,
          campaignId
        )
      }
    }
  }

  // Add new elements mentioned in the AI's scene resolution
  private static async addNewSceneElements(
    sceneResolution: any,
    mapId: string,
    campaignId: string
  ) {
    for (const element of sceneResolution.newElements) {
      await AIVisualService.addSceneElement(
        element.name,
        element.type,
        element.description,
        mapId,
        campaignId
      )
    }
  }

  // Trigger sound effects based on scene atmosphere
  private static async triggerSceneSounds(atmosphere: any, campaignId: string) {
    try {
      // Play ambient sound based on atmosphere
      if (atmosphere.sounds && atmosphere.sounds.length > 0) {
        const soundName = this.mapAtmosphereToSound(atmosphere)
        if (soundName) {
          await SoundService.playAmbientSound(soundName, campaignId)
        }
      }

      // Play mood-based sound effects
      if (atmosphere.mood === 'dangerous') {
        await SoundService.playDramaticSound('tension', campaignId)
      } else if (atmosphere.mood === 'mysterious') {
        await SoundService.playDramaticSound('mystery', campaignId)
      }
    } catch (error) {
      console.error('Error triggering scene sounds:', error)
    }
  }

  // Send comprehensive update to all players
  private static async broadcastSceneUpdate(
    sceneResolution: any,
    visualData: any,
    campaignId: string
  ) {
    try {
      // Create notification for scene update
      await NotificationService.createNotification({
        type: 'SCENE_CHANGE',
        campaignId,
        title: 'New Scene',
        message: 'The AI GM has updated the scene with new visuals',
        data: {
          sceneId: sceneResolution.sceneId,
          mapId: visualData.mapId,
          hasNewMap: true
        }
      })

      // Real-time broadcast via Pusher
      await PusherServer.trigger(`campaign-${campaignId}`, 'scene-updated-with-visuals', {
        sceneResolution,
        visualData,
        timestamp: new Date()
      })
    } catch (error) {
      console.error('Error broadcasting scene update:', error)
    }
  }

  // Helper methods for content analysis
  private static extractNewElements(description: string) {
    const elements = []
    
    // Look for new NPCs
    const npcPattern = /(?:appears|enters|you see) (?:a|an|the) ([^.]*?)(?:guard|merchant|wizard|knight|creature)/gi
    let match
    while ((match = npcPattern.exec(description)) !== null) {
      elements.push({
        name: match[1].trim() + ' ' + match[0].split(' ').pop(),
        type: 'npc',
        description: `A ${match[1].trim()} that has appeared in the scene`
      })
    }

    // Look for new objects
    const objectPattern = /(?:appears|you see|there is) (?:a|an|the) ([^.]*?)(?:chest|door|altar|statue|table)/gi
    while ((match = objectPattern.exec(description)) !== null) {
      elements.push({
        name: match[1].trim() + ' ' + match[0].split(' ').pop(),
        type: 'object', 
        description: `A ${match[1].trim()} object in the scene`
      })
    }

    return elements
  }

  private static extractCharacterMentions(
    description: string,
    playerActions: Array<{ playerId: string; action: string }>
  ) {
    // Extract mentions of player characters for position updates
    const mentions = []
    
    for (const action of playerActions) {
      if (description.toLowerCase().includes('moves') || 
          description.toLowerCase().includes('walks') ||
          description.toLowerCase().includes('approaches')) {
        mentions.push({
          playerId: action.playerId,
          actionType: 'movement',
          context: description
        })
      }
    }

    return mentions
  }

  private static mapAtmosphereToSound(atmosphere: any): string | null {
    const soundMappings = {
      'tavern': 'tavern_ambient',
      'forest': 'forest_ambient', 
      'dungeon': 'dungeon_ambient',
      'castle': 'castle_ambient',
      'cave': 'cave_ambient',
      'city': 'city_ambient',
      'combat': 'battle_music',
      'peaceful': 'peaceful_ambient'
    }

    // Check atmosphere sounds
    if (atmosphere.sounds) {
      for (const sound of atmosphere.sounds) {
        const mapping = soundMappings[sound.toLowerCase()]
        if (mapping) return mapping
      }
    }

    // Check mood
    if (atmosphere.mood === 'dangerous') {
      return 'tension_ambient'
    } else if (atmosphere.mood === 'peaceful') {
      return 'peaceful_ambient'
    }

    return null
  }

  // Public method to manually update visuals (for special GM commands)
  static async updateSceneVisuals(
    campaignId: string,
    visualCommand: {
      type: 'add_character' | 'remove_character' | 'move_character' | 'change_scene'
      target?: string
      description?: string
      position?: { x: number; y: number }
    }
  ) {
    try {
      const activeMap = await prisma.map.findFirst({
        where: { 
          campaignId,
          isActive: true 
        }
      })

      if (!activeMap) return

      switch (visualCommand.type) {
        case 'add_character':
          if (visualCommand.target && visualCommand.description) {
            await AIVisualService.addSceneElement(
              visualCommand.target,
              'npc',
              visualCommand.description,
              activeMap.id,
              campaignId
            )
          }
          break

        case 'remove_character':
          if (visualCommand.target) {
            await AIVisualService.removeSceneElement(
              visualCommand.target,
              activeMap.id,
              campaignId
            )
          }
          break

        case 'move_character':
          if (visualCommand.target && visualCommand.description) {
            await AIVisualService.updateCharacterPosition(
              visualCommand.target,
              visualCommand.description,
              activeMap.id,
              campaignId
            )
          }
          break

        case 'change_scene':
          if (visualCommand.description) {
            await AIVisualService.generateMapFromScene(
              visualCommand.description,
              campaignId,
              activeMap.id
            )
          }
          break
      }
    } catch (error) {
      console.error('Error updating scene visuals:', error)
    }
  }
}
