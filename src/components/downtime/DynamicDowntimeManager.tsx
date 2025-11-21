// PLACE IN: src/components/downtime/DynamicDowntimeManager.tsx

'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Plus,
  Clock,
  Coins,
  Calendar,
  CheckCircle,
  AlertCircle,
  Sparkles,
  MessageSquare,
  Lightbulb,
  Play,
  User,
  Brain,
  Zap
} from 'lucide-react'

interface DynamicActivity {
  id: string
  playerDescription: string
  aiInterpretation: {
    summary: string
    estimatedDuration: number
    costs: { gold?: number; resources?: string[] }
    requirements: string[]
    skillsInvolved: string[]
    riskLevel: 'low' | 'medium' | 'high'
    potentialOutcomes: string[]
  }
  progressDays: number
  status: 'active' | 'completed' | 'interrupted'
  events: Array<{
    id: string
    day: number
    title: string
    description: string
    choices?: Array<{
      option: string
      description: string
      consequences: string
    }>
    playerResponse?: string
    aiResponse?: string
    resolvedAt?: Date
  }>
  outcomes?: any
  createdAt: Date
  completedAt?: Date
}

interface DynamicDowntimeManagerProps {
  activities: DynamicActivity[]
  characterId: string
  characterGold: number
  characterName: string
  onCreateActivity?: (description: string) => void
  onAdvanceTime?: (characterId: string, days: number) => void
  onRespondToEvent?: (eventId: string, response: string) => void
  suggestions?: string[]
  className?: string
}

interface CreateActivityState {
  isOpen: boolean
  description: string
  interpretation?: DynamicActivity['aiInterpretation']
  isAnalyzing: boolean
}

interface EventResponseState {
  eventId: string
  isOpen: boolean
  response: string
  event?: DynamicActivity['events'][0]
}

export function DynamicDowntimeManager({
  activities,
  characterId,
  characterGold,
  characterName,
  onCreateActivity,
  onAdvanceTime,
  onRespondToEvent,
  suggestions = [],
  className = ''
}: DynamicDowntimeManagerProps) {
  const [createModal, setCreateModal] = useState<CreateActivityState>({
    isOpen: false,
    description: '',
    isAnalyzing: false
  })

  const [eventResponse, setEventResponse] = useState<EventResponseState>({
    eventId: '',
    isOpen: false,
    response: ''
  })

  const [advanceDays, setAdvanceDays] = useState('1')

  // Handle activity creation with AI interpretation
  const handleCreateActivity = async () => {
    if (!onCreateActivity || !createModal.description.trim()) return

    onCreateActivity(createModal.description)

    setCreateModal({
      isOpen: false,
      description: '',
      isAnalyzing: false
    })
  }

  // Use suggested activity
  const useSuggestion = (suggestion: string) => {
    setCreateModal({
      isOpen: true,
      description: suggestion,
      isAnalyzing: false
    })
  }

  // Handle event response
  const handleEventResponse = () => {
    if (!onRespondToEvent || !eventResponse.response.trim()) return

    onRespondToEvent(eventResponse.eventId, eventResponse.response)
    
    setEventResponse({
      eventId: '',
      isOpen: false,
      response: ''
    })
  }

  // Open event response dialog
  const openEventResponse = (eventId: string, event: DynamicActivity['events'][0]) => {
    setEventResponse({
      eventId,
      isOpen: true,
      response: '',
      event
    })
  }

  // Handle time advancement
  const handleAdvanceTime = () => {
    if (!onAdvanceTime) return
    
    const days = parseInt(advanceDays) || 1
    onAdvanceTime(characterId, days)
  }

  // Get risk level color
  const getRiskColor = (riskLevel: string) => {
    switch (riskLevel) {
      case 'low': return 'text-green-600 bg-green-100'
      case 'medium': return 'text-yellow-600 bg-yellow-100'
      case 'high': return 'text-red-600 bg-red-100'
      default: return 'text-gray-600 bg-gray-100'
    }
  }

  // Get event type icon
  const getEventIcon = (eventType: string) => {
    const icons = {
      'progress': CheckCircle,
      'complication': AlertCircle,
      'opportunity': Sparkles,
      'encounter': User,
      'discovery': Lightbulb,
      'setback': AlertCircle
    }

    const IconComponent = icons[eventType.toLowerCase() as keyof typeof icons] || CheckCircle
    return <IconComponent className="w-4 h-4" />
  }

  const activeActivities = activities.filter(a => a.status === 'active')
  const completedActivities = activities.filter(a => a.status === 'completed')
  const pendingEvents = activities.flatMap(a => 
    a.events.filter(e => e.choices && e.choices.length > 0 && !e.resolvedAt)
  )

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="w-7 h-7 text-purple-600" />
            AI-Powered Downtime
          </h2>
          <p className="text-gray-600">
            Describe any downtime activity - the AI will make it happen!
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-yellow-600" />
            <span className="font-medium">{characterGold} gold</span>
          </div>

          <Dialog open={createModal.isOpen} onOpenChange={(open) => 
            setCreateModal(prev => ({ ...prev, isOpen: open }))
          }>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Start Activity
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-600" />
                  What do you want to do?
                </DialogTitle>
              </DialogHeader>
              
              <div className="space-y-4">
                <Alert>
                  <Brain className="w-4 h-4" />
                  <AlertDescription>
                    Describe any downtime activity in natural language. The AI will interpret your goals, 
                    estimate time and costs, and create engaging events throughout the process.
                  </AlertDescription>
                </Alert>

                <div>
                  <Label htmlFor="activity-description">Activity Description</Label>
                  <Textarea
                    id="activity-description"
                    value={createModal.description}
                    onChange={(e) => setCreateModal(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Examples:
• I want to learn blacksmithing from the dwarf we met
• Start investigating the mysterious symbol from the tomb
• Open a tavern in the market district
• Research ancient magic in the library
• Build relationships with the local thieves guild
• Train with the city guard to improve my combat skills"
                    rows={6}
                    className="resize-none"
                  />
                </div>

                {createModal.interpretation && (
                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                    <h4 className="font-semibold mb-2 flex items-center gap-2">
                      <Brain className="w-4 h-4 text-blue-600" />
                      AI Interpretation
                    </h4>
                    <div className="space-y-2 text-sm">
                      <p><strong>Activity:</strong> {createModal.interpretation.summary}</p>
                      <p><strong>Duration:</strong> ~{createModal.interpretation.estimatedDuration} days</p>
                      {createModal.interpretation.costs?.gold && createModal.interpretation.costs.gold > 0 && (
                        <p><strong>Cost:</strong> {createModal.interpretation.costs.gold} gold</p>
                      )}
                      <p><strong>Risk Level:</strong>
                        <Badge className={`ml-2 ${getRiskColor(createModal.interpretation.riskLevel)}`}>
                          {createModal.interpretation.riskLevel}
                        </Badge>
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex justify-end space-x-2">
                  <Button
                    variant="outline"
                    onClick={() => setCreateModal(prev => ({ ...prev, isOpen: false }))}
                  >
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleCreateActivity}
                    disabled={!createModal.description.trim() || createModal.isAnalyzing}
                  >
                    {createModal.isAnalyzing ? (
                      <>
                        <Sparkles className="w-4 h-4 mr-2 animate-spin" />
                        AI Analyzing...
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4 mr-2" />
                        Start Activity
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Time Advancement */}
      {activeActivities.length > 0 && (
        <Card className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-600" />
                Advance Time
              </h3>
              <p className="text-sm text-gray-600">
                Progress your activities and see what happens next
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={advanceDays}
                onChange={(e) => setAdvanceDays(e.target.value)}
                className="px-3 py-2 border rounded-md"
              >
                <option value="1">1 day</option>
                <option value="3">3 days</option>
                <option value="7">1 week</option>
                <option value="14">2 weeks</option>
                <option value="30">1 month</option>
              </select>
              <Button onClick={handleAdvanceTime}>
                <Play className="w-4 h-4 mr-2" />
                Advance Time
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Pending Events */}
      {pendingEvents.length > 0 && (
        <Card className="p-4 border-amber-200 bg-amber-50">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-amber-600" />
            Events Requiring Your Response ({pendingEvents.length})
          </h3>
          <div className="space-y-3">
            {pendingEvents.map(event => (
              <div key={event.id} className="bg-white p-4 rounded border">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      {getEventIcon('opportunity')}
                      <span className="font-medium">{event.title}</span>
                      <Badge variant="outline" className="text-xs">
                        Day {event.day}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-700 mb-3">{event.description}</p>
                    
                    {event.choices && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Your options:</p>
                        {event.choices.map((choice, index) => (
                          <div key={index} className="bg-gray-50 p-2 rounded text-sm">
                            <p className="font-medium">{choice.option}</p>
                            <p className="text-gray-600">{choice.description}</p>
                            {choice.consequences && (
                              <p className="text-xs text-blue-600 mt-1">→ {choice.consequences}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button 
                    size="sm"
                    onClick={() => openEventResponse(event.id, event)}
                  >
                    <MessageSquare className="w-4 h-4 mr-1" />
                    Respond
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* AI Suggestions */}
      {suggestions.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-yellow-600" />
            AI Suggestions for {characterName}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {suggestions.map((suggestion, index) => (
              <div 
                key={index}
                className="p-3 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors group"
                onClick={() => useSuggestion(suggestion)}
              >
                <div className="flex items-start justify-between">
                  <p className="text-sm flex-1">{suggestion}</p>
                  <Button size="sm" variant="ghost" className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Active Activities */}
      {activeActivities.length > 0 && (
        <div>
          <h3 className="font-semibold mb-4">Active Activities</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeActivities.map(activity => (
              <Card key={activity.id} className="p-4">
                <div className="space-y-4">
                  {/* Header */}
                  <div>
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="font-semibold text-sm">What you're doing:</h4>
                      <Badge className={getRiskColor(activity.aiInterpretation.riskLevel)}>
                        {activity.aiInterpretation.riskLevel} risk
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-700 italic mb-2">
                      "{activity.playerDescription}"
                    </p>
                    <p className="text-sm font-medium">
                      {activity.aiInterpretation.summary}
                    </p>
                  </div>

                  {/* Progress */}
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Progress</span>
                      <span>{activity.progressDays} / {activity.aiInterpretation.estimatedDuration} days</span>
                    </div>
                    <Progress 
                      value={(activity.progressDays / activity.aiInterpretation.estimatedDuration) * 100}
                      className="h-2"
                    />
                  </div>

                  {/* Costs & Requirements */}
                  {((activity.aiInterpretation.costs?.gold && activity.aiInterpretation.costs.gold > 0) || activity.aiInterpretation.requirements.length > 0) && (
                    <div className="text-xs space-y-1">
                      {activity.aiInterpretation.costs?.gold && activity.aiInterpretation.costs.gold > 0 && (
                        <div className="flex items-center gap-1">
                          <Coins className="w-3 h-3 text-yellow-600" />
                          <span>Cost: {activity.aiInterpretation.costs.gold} gold</span>
                        </div>
                      )}
                      {activity.aiInterpretation.skillsInvolved.length > 0 && (
                        <div>
                          <span className="font-medium">Skills: </span>
                          {activity.aiInterpretation.skillsInvolved.join(', ')}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Recent Events */}
                  {activity.events.length > 0 && (
                    <div>
                      <h5 className="text-sm font-medium mb-2">Recent Events:</h5>
                      <div className="space-y-2 max-h-32 overflow-y-auto">
                        {activity.events.slice(-2).map(event => (
                          <div key={event.id} className="text-xs bg-gray-50 p-2 rounded">
                            <div className="flex items-center gap-1 mb-1">
                              {getEventIcon('progress')}
                              <span className="font-medium">{event.title}</span>
                              <span className="text-gray-500">Day {event.day}</span>
                            </div>
                            <p className="text-gray-600">{event.description}</p>
                            {event.choices && !event.resolvedAt && (
                              <Badge variant="secondary" className="text-xs mt-1">
                                Awaiting Your Response
                              </Badge>
                            )}
                            {event.aiResponse && (
                              <p className="text-blue-600 mt-1 italic">{event.aiResponse}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Completed Activities */}
      {completedActivities.length > 0 && (
        <div>
          <h3 className="font-semibold mb-4">Recently Completed</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {completedActivities.slice(0, 6).map(activity => (
              <Card key={activity.id} className="p-3">
                <div className="space-y-2">
                  <div>
                    <p className="text-xs text-gray-500 italic">
                      "{activity.playerDescription}"
                    </p>
                    <h4 className="font-medium text-sm">{activity.aiInterpretation.summary}</h4>
                    <p className="text-xs text-gray-500">
                      Completed {activity.completedAt ? new Date(activity.completedAt).toLocaleDateString() : 'recently'}
                    </p>
                  </div>
                  
                  {activity.outcomes && (
                    <div className="text-xs text-gray-600 bg-green-50 p-2 rounded">
                      <p className="font-medium">Results:</p>
                      <p>{activity.outcomes.primaryOutcome}</p>
                      {activity.outcomes.skillProgress?.experienceGained > 0 && (
                        <p className="text-green-600">+{activity.outcomes.skillProgress.experienceGained} XP</p>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {activities.length === 0 && (
        <Card className="p-8 text-center">
          <Brain className="w-16 h-16 mx-auto text-purple-400 mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Activities Yet</h3>
          <p className="text-gray-600 mb-6">
            Describe any downtime activity you can imagine - the AI will make it happen! 
            Whether it's learning new skills, starting a business, or investigating mysteries.
          </p>
          <Button onClick={() => setCreateModal(prev => ({ ...prev, isOpen: true }))}>
            <Sparkles className="w-4 h-4 mr-2" />
            Start Your First Activity
          </Button>
        </Card>
      )}

      {/* Event Response Dialog */}
      <Dialog open={eventResponse.isOpen} onOpenChange={(open) => 
        setEventResponse(prev => ({ ...prev, isOpen: open }))
      }>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Respond to Event</DialogTitle>
          </DialogHeader>
          
          {eventResponse.event && (
            <div className="space-y-4">
              <div className="bg-gray-50 p-3 rounded">
                <h4 className="font-medium mb-1">{eventResponse.event.title}</h4>
                <p className="text-sm text-gray-600">{eventResponse.event.description}</p>
              </div>

              <div>
                <Label htmlFor="event-response">Your Response</Label>
                <Textarea
                  id="event-response"
                  value={eventResponse.response}
                  onChange={(e) => setEventResponse(prev => ({ ...prev, response: e.target.value }))}
                  placeholder="Describe what you want to do or choose from the options above..."
                  rows={4}
                />
              </div>

              <div className="flex justify-end space-x-2">
                <Button
                  variant="outline"
                  onClick={() => setEventResponse(prev => ({ ...prev, isOpen: false }))}
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleEventResponse}
                  disabled={!eventResponse.response.trim()}
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Submit Response
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
