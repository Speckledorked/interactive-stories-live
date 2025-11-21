// PLACE IN: src/components/sessions/SessionManager.tsx

'use client'

import React, { useState } from 'react'
import { SessionData } from '@/lib/sessions/session-service'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Play,
  Square,
  Plus,
  Clock,
  Users,
  Target,
  Calendar,
  Trophy,
  Coins,
  BookOpen,
  BarChart3
} from 'lucide-react'

interface SessionManagerProps {
  sessions: SessionData[]
  currentSession?: SessionData | null
  campaignId: string
  onCreateSession?: (data: {
    name: string
    description?: string
    objectives?: string[]
    scheduledAt?: Date
  }) => void
  onStartSession?: (sessionId: string, characterIds: string[]) => void
  onEndSession?: (sessionId: string, summary?: {
    experienceAwarded?: number
    goldAwarded?: number
    itemsAwarded?: string[]
    notes?: string
  }) => void
  onAddNote?: (sessionId: string, content: string, noteType?: string) => void
  availableCharacters?: Array<{ id: string; name: string; userId: string; user: { name: string } }>
  className?: string
}

interface CreateSessionState {
  isOpen: boolean
  name: string
  description: string
  objectives: string[]
  currentObjective: string
  scheduledAt: string
}

interface EndSessionState {
  isOpen: boolean
  experienceAwarded: string
  goldAwarded: string
  itemsAwarded: string
  notes: string
}

export function SessionManager({
  sessions,
  currentSession,
  campaignId,
  onCreateSession,
  onStartSession,
  onEndSession,
  onAddNote,
  availableCharacters = [],
  className = ''
}: SessionManagerProps) {
  const [createModal, setCreateModal] = useState<CreateSessionState>({
    isOpen: false,
    name: '',
    description: '',
    objectives: [],
    currentObjective: '',
    scheduledAt: ''
  })

  const [endModal, setEndModal] = useState<EndSessionState>({
    isOpen: false,
    experienceAwarded: '0',
    goldAwarded: '0',
    itemsAwarded: '',
    notes: ''
  })

  const [selectedCharacters, setSelectedCharacters] = useState<string[]>([])
  const [newNote, setNewNote] = useState('')
  const [selectedNoteType, setSelectedNoteType] = useState('GENERAL')

  // Handle session creation
  const handleCreateSession = () => {
    if (!onCreateSession || !createModal.name.trim()) return

    onCreateSession({
      name: createModal.name,
      description: createModal.description || undefined,
      objectives: createModal.objectives,
      scheduledAt: createModal.scheduledAt ? new Date(createModal.scheduledAt) : undefined
    })

    setCreateModal({
      isOpen: false,
      name: '',
      description: '',
      objectives: [],
      currentObjective: '',
      scheduledAt: ''
    })
  }

  // Add objective to list
  const addObjective = () => {
    if (!createModal.currentObjective.trim()) return

    setCreateModal(prev => ({
      ...prev,
      objectives: [...prev.objectives, prev.currentObjective],
      currentObjective: ''
    }))
  }

  // Remove objective from list
  const removeObjective = (index: number) => {
    setCreateModal(prev => ({
      ...prev,
      objectives: prev.objectives.filter((_, i) => i !== index)
    }))
  }

  // Handle session start
  const handleStartSession = (sessionId: string) => {
    if (!onStartSession || selectedCharacters.length === 0) return
    onStartSession(sessionId, selectedCharacters)
    setSelectedCharacters([])
  }

  // Handle session end
  const handleEndSession = () => {
    if (!onEndSession || !currentSession) return

    const summary = {
      experienceAwarded: parseInt(endModal.experienceAwarded) || 0,
      goldAwarded: parseInt(endModal.goldAwarded) || 0,
      itemsAwarded: endModal.itemsAwarded 
        ? endModal.itemsAwarded.split(',').map(item => item.trim()).filter(Boolean)
        : [],
      notes: endModal.notes || undefined
    }

    onEndSession(currentSession.id, summary)

    setEndModal({
      isOpen: false,
      experienceAwarded: '0',
      goldAwarded: '0',
      itemsAwarded: '',
      notes: ''
    })
  }

  // Add session note
  const handleAddNote = () => {
    if (!onAddNote || !currentSession || !newNote.trim()) return

    onAddNote(currentSession.id, newNote, selectedNoteType)
    setNewNote('')
  }

  // Get status badge
  const getStatusBadge = (status: string) => {
    const variants = {
      'PLANNED': 'secondary',
      'IN_PROGRESS': 'default',
      'COMPLETED': 'outline',
      'CANCELLED': 'destructive'
    } as const

    return (
      <Badge variant={variants[status as keyof typeof variants] || 'secondary'}>
        {status.replace('_', ' ')}
      </Badge>
    )
  }

  // Format duration
  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Calendar className="w-7 h-7" />
            Session Management
          </h2>
          <p className="text-gray-600">
            {sessions.length} sessions • {sessions.filter(s => s.status === 'COMPLETED').length} completed
          </p>
        </div>

        <Dialog open={createModal.isOpen} onOpenChange={(open) => 
          setCreateModal(prev => ({ ...prev, isOpen: open }))
        }>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Plan Session
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Plan New Session</DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4">
              <div>
                <Label htmlFor="session-name">Session Name</Label>
                <Input
                  id="session-name"
                  value={createModal.name}
                  onChange={(e) => setCreateModal(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Enter session name..."
                />
              </div>

              <div>
                <Label htmlFor="session-description">Description (optional)</Label>
                <Textarea
                  id="session-description"
                  value={createModal.description}
                  onChange={(e) => setCreateModal(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="What will happen in this session?"
                />
              </div>

              <div>
                <Label>Session Objectives</Label>
                <div className="flex space-x-2 mt-1">
                  <Input
                    value={createModal.currentObjective}
                    onChange={(e) => setCreateModal(prev => ({ ...prev, currentObjective: e.target.value }))}
                    placeholder="Add an objective..."
                    onKeyPress={(e) => e.key === 'Enter' && addObjective()}
                  />
                  <Button type="button" onClick={addObjective}>
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                {createModal.objectives.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {createModal.objectives.map((objective, index) => (
                      <Badge
                        key={index}
                        variant="secondary"
                        className="cursor-pointer"
                        onClick={() => removeObjective(index)}
                      >
                        {objective} ✕
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <Label htmlFor="session-scheduled">Scheduled Time (optional)</Label>
                <Input
                  id="session-scheduled"
                  type="datetime-local"
                  value={createModal.scheduledAt}
                  onChange={(e) => setCreateModal(prev => ({ ...prev, scheduledAt: e.target.value }))}
                />
              </div>

              <div className="flex justify-end space-x-2">
                <Button
                  variant="outline"
                  onClick={() => setCreateModal(prev => ({ ...prev, isOpen: false }))}
                >
                  Cancel
                </Button>
                <Button onClick={handleCreateSession}>
                  Plan Session
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Current Session */}
      {currentSession && (
        <Card className="p-6 border-2 border-blue-200 bg-blue-50">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-xl font-semibold flex items-center gap-2">
                <Play className="w-5 h-5 text-blue-600" />
                {currentSession.name}
                {getStatusBadge(currentSession.status)}
              </h3>
              {currentSession.description && (
                <p className="text-gray-600 mt-1">{currentSession.description}</p>
              )}
            </div>

            <div className="flex space-x-2">
              <Dialog open={endModal.isOpen} onOpenChange={(open) => 
                setEndModal(prev => ({ ...prev, isOpen: open }))
              }>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Square className="w-4 h-4 mr-2" />
                    End Session
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>End Session: {currentSession.name}</DialogTitle>
                  </DialogHeader>
                  
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="exp-awarded">Experience Awarded</Label>
                        <Input
                          id="exp-awarded"
                          type="number"
                          value={endModal.experienceAwarded}
                          onChange={(e) => setEndModal(prev => ({ ...prev, experienceAwarded: e.target.value }))}
                          min="0"
                        />
                      </div>
                      <div>
                        <Label htmlFor="gold-awarded">Gold Awarded</Label>
                        <Input
                          id="gold-awarded"
                          type="number"
                          value={endModal.goldAwarded}
                          onChange={(e) => setEndModal(prev => ({ ...prev, goldAwarded: e.target.value }))}
                          min="0"
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="items-awarded">Items Awarded (comma-separated)</Label>
                      <Input
                        id="items-awarded"
                        value={endModal.itemsAwarded}
                        onChange={(e) => setEndModal(prev => ({ ...prev, itemsAwarded: e.target.value }))}
                        placeholder="Healing Potion, Magic Sword, etc."
                      />
                    </div>

                    <div>
                      <Label htmlFor="session-summary">Session Summary</Label>
                      <Textarea
                        id="session-summary"
                        value={endModal.notes}
                        onChange={(e) => setEndModal(prev => ({ ...prev, notes: e.target.value }))}
                        placeholder="Summarize what happened this session..."
                      />
                    </div>

                    <div className="flex justify-end space-x-2">
                      <Button
                        variant="outline"
                        onClick={() => setEndModal(prev => ({ ...prev, isOpen: false }))}
                      >
                        Cancel
                      </Button>
                      <Button onClick={handleEndSession}>
                        End Session
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Session Info */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="text-center">
              <Clock className="w-5 h-5 mx-auto text-gray-500 mb-1" />
              <div className="text-sm text-gray-600">Started</div>
              <div className="font-medium">
                {currentSession.startedAt 
                  ? new Date(currentSession.startedAt).toLocaleTimeString()
                  : 'Not started'
                }
              </div>
            </div>
            <div className="text-center">
              <Users className="w-5 h-5 mx-auto text-gray-500 mb-1" />
              <div className="text-sm text-gray-600">Participants</div>
              <div className="font-medium">{currentSession.participants.length}</div>
            </div>
            <div className="text-center">
              <BookOpen className="w-5 h-5 mx-auto text-gray-500 mb-1" />
              <div className="text-sm text-gray-600">Scenes</div>
              <div className="font-medium">{currentSession.scenes.length}</div>
            </div>
            <div className="text-center">
              <Target className="w-5 h-5 mx-auto text-gray-500 mb-1" />
              <div className="text-sm text-gray-600">Objectives</div>
              <div className="font-medium">{currentSession.objectives.length}</div>
            </div>
          </div>

          {/* Objectives */}
          {currentSession.objectives.length > 0 && (
            <div className="mb-4">
              <h4 className="font-medium mb-2">Session Objectives:</h4>
              <div className="flex flex-wrap gap-2">
                {currentSession.objectives.map((objective, index) => (
                  <Badge key={index} variant="outline">
                    <Target className="w-3 h-3 mr-1" />
                    {objective}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Quick Note Add */}
          <div className="border-t pt-4">
            <h4 className="font-medium mb-2">Add Session Note:</h4>
            <div className="flex space-x-2">
              <select 
                value={selectedNoteType}
                onChange={(e) => setSelectedNoteType(e.target.value)}
                className="px-3 py-2 border rounded-md text-sm"
              >
                <option value="GENERAL">General</option>
                <option value="COMBAT">Combat</option>
                <option value="ROLEPLAY">Roleplay</option>
                <option value="DISCOVERY">Discovery</option>
                <option value="PLOT">Plot</option>
              </select>
              <Input
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Add a note about what's happening..."
                className="flex-1"
                onKeyPress={(e) => e.key === 'Enter' && handleAddNote()}
              />
              <Button onClick={handleAddNote}>
                Add Note
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Session List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sessions.map(session => (
          <Card key={session.id} className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold flex items-center gap-2">
                  Session {session.sessionNumber}: {session.name}
                  {getStatusBadge(session.status)}
                </h3>
                {session.description && (
                  <p className="text-sm text-gray-600 mt-1">{session.description}</p>
                )}
              </div>

              {session.status === 'PLANNED' && (
                <div>
                  <select
                    multiple
                    value={selectedCharacters}
                    onChange={(e) => setSelectedCharacters(Array.from(e.target.selectedOptions, option => option.value))}
                    className="text-xs border rounded p-1 mb-2"
                    size={Math.min(availableCharacters.length, 3)}
                  >
                    {availableCharacters.map(char => (
                      <option key={char.id} value={char.id}>
                        {char.name} ({char.user.name})
                      </option>
                    ))}
                  </select>
                  <Button 
                    size="sm"
                    onClick={() => handleStartSession(session.id)}
                    disabled={selectedCharacters.length === 0}
                  >
                    <Play className="w-4 h-4 mr-1" />
                    Start
                  </Button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="text-center">
                <Clock className="w-4 h-4 mx-auto text-gray-500 mb-1" />
                <div className="text-xs text-gray-600">Duration</div>
                <div className="font-medium">
                  {session.duration ? formatDuration(session.duration) : '--'}
                </div>
              </div>
              <div className="text-center">
                <Trophy className="w-4 h-4 mx-auto text-gray-500 mb-1" />
                <div className="text-xs text-gray-600">Experience</div>
                <div className="font-medium">{session.experienceAwarded || 0}</div>
              </div>
              <div className="text-center">
                <Coins className="w-4 h-4 mx-auto text-gray-500 mb-1" />
                <div className="text-xs text-gray-600">Gold</div>
                <div className="font-medium">{session.goldAwarded || 0}</div>
              </div>
            </div>

            {session.scheduledAt && (
              <div className="mt-3 text-xs text-gray-600">
                Scheduled: {new Date(session.scheduledAt).toLocaleString()}
              </div>
            )}

            {session.objectives.length > 0 && (
              <div className="mt-3">
                <div className="text-xs text-gray-600 mb-1">Objectives:</div>
                <div className="flex flex-wrap gap-1">
                  {session.objectives.slice(0, 2).map((objective, index) => (
                    <Badge key={index} variant="outline" className="text-xs">
                      {objective}
                    </Badge>
                  ))}
                  {session.objectives.length > 2 && (
                    <Badge variant="outline" className="text-xs">
                      +{session.objectives.length - 2} more
                    </Badge>
                  )}
                </div>
              </div>
            )}
          </Card>
        ))}

        {sessions.length === 0 && (
          <div className="col-span-full text-center py-8">
            <Calendar className="w-16 h-16 mx-auto text-gray-400 mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Sessions Yet</h3>
            <p className="text-gray-600 mb-4">
              Plan your first session to get started with structured gameplay.
            </p>
            <Button onClick={() => setCreateModal(prev => ({ ...prev, isOpen: true }))}>
              <Plus className="w-4 h-4 mr-2" />
              Plan First Session
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
