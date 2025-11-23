// PLACE IN: src/components/maps/PlayerMapViewer.tsx

'use client'

import React, { useState, useRef, useCallback, useEffect } from 'react'
import { MapData } from '@/lib/maps/map-service'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ZoomIn,
  ZoomOut,
  Eye,
  Users,
  MapPin,
  Volume2,
  VolumeX
} from 'lucide-react'

export interface PlayerMapViewerProps {
  map: MapData | null
  characterName: string
  onZoneInteract?: (zone: MapData['zones'][0]) => void
  className?: string
}

export interface ViewState {
  zoom: number
  panX: number
  panY: number
  isDragging: boolean
  dragStart: { x: number; y: number }
  soundEnabled: boolean
}

export function PlayerMapViewer({
  map,
  characterName,
  onZoneInteract,
  className = ''
}: PlayerMapViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  
  const [viewState, setViewState] = useState<ViewState>({
    zoom: 1,
    panX: 0,
    panY: 0,
    isDragging: false,
    dragStart: { x: 0, y: 0 },
    soundEnabled: true
  })
  
  const [hoveredElement, setHoveredElement] = useState<{
    type: 'token' | 'zone'
    id: string
    data: MapData['tokens'][0] | MapData['zones'][0]
  } | null>(null)

  // Draw the map for players (read-only view)
  const drawMap = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !map) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Save context for transformations
    ctx.save()

    // Apply zoom and pan
    ctx.scale(viewState.zoom, viewState.zoom)
    ctx.translate(viewState.panX, viewState.panY)

    // Draw background
    if (map.imageUrl) {
      const img = new Image()
      img.onload = () => {
        ctx.drawImage(img, 0, 0, map.width, map.height)
        drawVisibleElements(ctx)
      }
      img.src = map.imageUrl
    } else {
      // Draw plain background with atmospheric color
      ctx.fillStyle = getAtmosphericColor(map.description)
      ctx.fillRect(0, 0, map.width, map.height)
      drawVisibleElements(ctx)
    }

    ctx.restore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, viewState, hoveredElement, characterName])

  // Draw only elements that players should see
  const drawVisibleElements = (ctx: CanvasRenderingContext2D) => {
    if (!map) return

    // Draw visible zones
    map.zones.forEach(zone => {
      if (!zone.isVisible) return

      ctx.fillStyle = zone.color + '30' // Subtle transparency
      ctx.strokeStyle = zone.color
      ctx.lineWidth = 2
      ctx.setLineDash([])

      ctx.fillRect(zone.x, zone.y, zone.width, zone.height)
      ctx.strokeRect(zone.x, zone.y, zone.width, zone.height)

      // Draw zone name if it's interactable
      if (zone.triggerType) {
        ctx.fillStyle = zone.color
        ctx.font = '12px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(
          '⚡ ' + zone.name,
          zone.x + zone.width / 2,
          zone.y + zone.height / 2
        )
      }

      // Highlight if hovered
      if (hoveredElement?.type === 'zone' && hoveredElement.id === zone.id) {
        ctx.strokeStyle = '#fbbf24'
        ctx.lineWidth = 3
        ctx.strokeRect(zone.x, zone.y, zone.width, zone.height)
      }
    })

    // Draw visible tokens
    map.tokens.forEach(token => {
      if (!token.isVisible) return

      const tokenSize = token.size * map.gridSize
      const centerX = token.x + tokenSize / 2
      const centerY = token.y + tokenSize / 2

      // Draw token
      if (token.imageUrl) {
        // Draw image token
        const img = new Image()
        img.onload = () => {
          ctx.drawImage(img, token.x, token.y, tokenSize, tokenSize)
        }
        img.src = token.imageUrl
      } else {
        // Draw simple colored circle
        ctx.fillStyle = token.color
        ctx.beginPath()
        ctx.arc(centerX, centerY, tokenSize / 2 - 2, 0, 2 * Math.PI)
        ctx.fill()
      }

      // Draw border - highlight if it's the player's character
      const isMyCharacter = token.character?.name === characterName
      ctx.strokeStyle = isMyCharacter ? '#fbbf24' : token.color
      ctx.lineWidth = isMyCharacter ? 3 : 2
      ctx.beginPath()
      ctx.arc(centerX, centerY, tokenSize / 2, 0, 2 * Math.PI)
      ctx.stroke()

      // Draw name
      ctx.fillStyle = isMyCharacter ? '#fbbf24' : '#000'
      ctx.font = isMyCharacter ? 'bold 10px sans-serif' : '10px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(
        token.name,
        centerX,
        token.y + tokenSize + 12
      )

      // Draw PC indicator
      if (token.isPC) {
        ctx.fillStyle = '#10b981'
        ctx.beginPath()
        ctx.arc(token.x + tokenSize - 5, token.y + 5, 3, 0, 2 * Math.PI)
        ctx.fill()
      }

      // Highlight if hovered
      if (hoveredElement?.type === 'token' && hoveredElement.id === token.id) {
        ctx.strokeStyle = '#fbbf24'
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.arc(centerX, centerY, tokenSize / 2 + 2, 0, 2 * Math.PI)
        ctx.stroke()
      }
    })
  }

  // Get atmospheric color based on scene description
  const getAtmosphericColor = (description?: string) => {
    if (!description) return '#1e293b' // Dark theme default

    const lower = description.toLowerCase()
    if (lower.includes('dark') || lower.includes('dungeon')) return '#0f172a'
    if (lower.includes('forest') || lower.includes('nature')) return '#064e3b'
    if (lower.includes('tavern') || lower.includes('warm')) return '#78350f'
    if (lower.includes('castle') || lower.includes('stone')) return '#334155'
    if (lower.includes('water') || lower.includes('ocean')) return '#0c4a6e'
    if (lower.includes('bright') || lower.includes('light') || lower.includes('outdoors')) return '#cbd5e1'

    return '#1e293b' // Dark theme default
  }

  // Convert screen coordinates to map coordinates
  const screenToMap = (screenX: number, screenY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }

    const x = (screenX - rect.left - viewState.panX * viewState.zoom) / viewState.zoom
    const y = (screenY - rect.top - viewState.panY * viewState.zoom) / viewState.zoom

    return { x, y }
  }

  // Find element at coordinates
  const findElementAt = (x: number, y: number) => {
    if (!map) return null

    // Check tokens first
    for (const token of map.tokens) {
      if (!token.isVisible) continue
      
      const tokenSize = token.size * map.gridSize
      if (x >= token.x && x <= token.x + tokenSize &&
          y >= token.y && y <= token.y + tokenSize) {
        return { type: 'token' as const, id: token.id, data: token }
      }
    }

    // Check interactive zones only
    for (const zone of map.zones) {
      if (!zone.isVisible || !zone.triggerType) continue
      
      if (x >= zone.x && x <= zone.x + zone.width &&
          y >= zone.y && y <= zone.y + zone.height) {
        return { type: 'zone' as const, id: zone.id, data: zone }
      }
    }

    return null
  }

  // Handle mouse events
  const handleMouseDown = (e: React.MouseEvent) => {
    const { x, y } = screenToMap(e.clientX, e.clientY)
    const element = findElementAt(x, y)

    if (element?.type === 'zone' && element.data.triggerType) {
      // Interact with zone
      if (onZoneInteract) {
        onZoneInteract(element.data)
      }
    } else {
      // Start panning
      setViewState(prev => ({
        ...prev,
        isDragging: true,
        dragStart: { x: e.clientX, y: e.clientY }
      }))
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const { x, y } = screenToMap(e.clientX, e.clientY)
    
    // Update hover state
    const element = findElementAt(x, y)
    setHoveredElement(element)

    // Handle panning
    if (viewState.isDragging) {
      const deltaX = (e.clientX - viewState.dragStart.x) / viewState.zoom
      const deltaY = (e.clientY - viewState.dragStart.y) / viewState.zoom
      
      setViewState(prev => ({
        ...prev,
        panX: prev.panX + deltaX,
        panY: prev.panY + deltaY,
        dragStart: { x: e.clientX, y: e.clientY }
      }))
    }
  }

  const handleMouseUp = () => {
    setViewState(prev => ({
      ...prev,
      isDragging: false
    }))
  }

  // Zoom functions
  const zoomIn = () => {
    setViewState(prev => ({
      ...prev,
      zoom: Math.min(prev.zoom * 1.2, 3)
    }))
  }

  const zoomOut = () => {
    setViewState(prev => ({
      ...prev,
      zoom: Math.max(prev.zoom / 1.2, 0.3)
    }))
  }

  const resetView = () => {
    setViewState(prev => ({
      ...prev,
      zoom: 1,
      panX: 0,
      panY: 0
    }))
  }

  // Focus on player's character
  const focusOnMyCharacter = () => {
    if (!map) return
    
    const myToken = map.tokens.find(token => 
      token.character?.name === characterName
    )
    
    if (myToken && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect()
      const centerX = rect.width / 2
      const centerY = rect.height / 2
      
      setViewState(prev => ({
        ...prev,
        panX: centerX / prev.zoom - myToken.x - (myToken.size * map.gridSize) / 2,
        panY: centerY / prev.zoom - myToken.y - (myToken.size * map.gridSize) / 2
      }))
    }
  }

  // Redraw when map or view state changes
  useEffect(() => {
    drawMap()
  }, [drawMap])

  // Auto-focus on character when map changes
  useEffect(() => {
    if (map) {
      setTimeout(focusOnMyCharacter, 100)
    }
  }, [map?.id])

  if (!map) {
    return (
      <Card className={`p-8 text-center ${className}`}>
        <MapPin className="w-16 h-16 mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-semibold mb-2">No Map Available</h3>
        <p className="text-gray-600">
          The AI GM will generate a map when the scene begins.
        </p>
      </Card>
    )
  }

  return (
    <div className={`relative bg-gray-100 rounded-lg overflow-hidden ${className}`} ref={containerRef}>
      {/* Map Canvas */}
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        className="w-full h-full cursor-pointer"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          setHoveredElement(null)
          setViewState(prev => ({ ...prev, isDragging: false }))
        }}
      />

      {/* Controls */}
      <div className="absolute top-4 left-4 space-y-2">
        <Card className="p-2">
          <div className="flex space-x-1">
            <Button size="sm" variant="outline" onClick={zoomIn}>
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={zoomOut}>
              <ZoomOut className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={resetView}>
              Reset
            </Button>
          </div>
        </Card>

        <Card className="p-2">
          <Button size="sm" variant="outline" onClick={focusOnMyCharacter}>
            <Users className="w-4 h-4 mr-1" />
            Find Me
          </Button>
        </Card>
      </div>

      {/* Map Info */}
      <div className="absolute top-4 right-4">
        <Card className="p-3 max-w-xs">
          <h3 className="font-semibold text-sm mb-2">{map.name}</h3>
          {map.description && (
            <p className="text-xs text-gray-600 mb-2 line-clamp-3">{map.description}</p>
          )}
          <div className="space-y-1 text-xs">
            <div>Players: {map.tokens.filter(t => t.isPC).length}</div>
            <div>NPCs: {map.tokens.filter(t => !t.isPC).length}</div>
            <div>Interactive Areas: {map.zones.filter(z => z.triggerType).length}</div>
          </div>
        </Card>
      </div>

      {/* Hover Tooltip */}
      {hoveredElement && (
        <div className="absolute bottom-4 left-4">
          <Card className="p-3 max-w-sm">
            <div className="text-sm">
              <div className="font-semibold flex items-center gap-2 mb-1">
                {hoveredElement.type === 'token' ? (
                  <Badge variant="secondary">
                    {'isPC' in hoveredElement.data && hoveredElement.data.isPC ? 'Player' : 'Character'}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-blue-50">
                    {'triggerType' in hoveredElement.data && hoveredElement.data.triggerType ? 'Interactive' : 'Area'}
                  </Badge>
                )}
                {hoveredElement.data.name}
              </div>
              {'description' in hoveredElement.data && hoveredElement.data.description && (
                <div className="text-xs text-gray-600 mb-1">
                  {hoveredElement.data.description}
                </div>
              )}
              {hoveredElement.type === 'zone' && 'triggerType' in hoveredElement.data && hoveredElement.data.triggerType && (
                <div className="text-xs text-blue-600 font-medium">
                  Click to interact
                </div>
              )}
              {hoveredElement.type === 'token' && 'character' in hoveredElement.data && hoveredElement.data.character?.name === characterName && (
                <div className="text-xs text-amber-600 font-medium">
                  This is your character
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Status Indicator */}
      <div className="absolute bottom-4 right-4 flex space-x-2">
        <Badge variant="secondary">
          AI Generated
        </Badge>
        <Badge variant="outline">
          Zoom: {Math.round(viewState.zoom * 100)}%
        </Badge>
      </div>
    </div>
  )
}
