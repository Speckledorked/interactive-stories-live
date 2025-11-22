'use client';

import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface TimelineEvent {
  id: string;
  turnNumber: number;
  title: string;
  summaryPublic: string;
  summaryGM: string;
  eventType: 'SCENE' | 'DOWNTIME' | 'TIMESKIP' | 'WORLD_EVENT';
  visibility: 'PUBLIC' | 'GM_ONLY' | 'MIXED';
  sessionDate: Date;
  isOffscreen: boolean;
}

interface TimelineViewerProps {
  campaignId: string;
  isGM?: boolean;
}

export function TimelineViewer({ campaignId, isGM = false }: TimelineViewerProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<TimelineEvent[]>([]);
  const [filterType, setFilterType] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTimeline();
  }, [campaignId]);

  useEffect(() => {
    applyFilter();
  }, [events, filterType]);

  const loadTimeline = async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/timeline`);
      if (response.ok) {
        const data = await response.json();
        setEvents(data);
      }
    } catch (error) {
      console.error('Error loading timeline:', error);
    } finally {
      setLoading(false);
    }
  };

  const applyFilter = () => {
    if (filterType === 'all') {
      setFilteredEvents(events);
    } else {
      setFilteredEvents(events.filter((e) => e.eventType === filterType));
    }
  };

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'SCENE':
        return '🎬';
      case 'DOWNTIME':
        return '⏸️';
      case 'TIMESKIP':
        return '⏭️';
      case 'WORLD_EVENT':
        return '🌍';
      default:
        return '📌';
    }
  };

  const getEventColor = (type: string) => {
    switch (type) {
      case 'SCENE':
        return 'border-blue-500';
      case 'DOWNTIME':
        return 'border-green-500';
      case 'TIMESKIP':
        return 'border-yellow-500';
      case 'WORLD_EVENT':
        return 'border-purple-500';
      default:
        return 'border-gray-500';
    }
  };

  if (loading) {
    return <div className="p-4">Loading timeline...</div>;
  }

  return (
    <div className="p-4">
      {/* Filter Controls */}
      <div className="mb-6 flex gap-2 flex-wrap">
        <Button
          variant={filterType === 'all' ? 'default' : 'outline'}
          onClick={() => setFilterType('all')}
          size="sm"
        >
          All Events
        </Button>
        <Button
          variant={filterType === 'SCENE' ? 'default' : 'outline'}
          onClick={() => setFilterType('SCENE')}
          size="sm"
        >
          🎬 Scenes
        </Button>
        <Button
          variant={filterType === 'DOWNTIME' ? 'default' : 'outline'}
          onClick={() => setFilterType('DOWNTIME')}
          size="sm"
        >
          ⏸️ Downtime
        </Button>
        <Button
          variant={filterType === 'WORLD_EVENT' ? 'default' : 'outline'}
          onClick={() => setFilterType('WORLD_EVENT')}
          size="sm"
        >
          🌍 World Events
        </Button>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gray-700" />

        {/* Events */}
        <div className="space-y-6">
          {filteredEvents.map((event, index) => (
            <div key={event.id} className="relative pl-20">
              {/* Turn number badge */}
              <div className="absolute left-0 top-0 w-16 h-16 rounded-full bg-gray-800 border-2 border-gray-700 flex items-center justify-center font-bold text-lg">
                {event.turnNumber}
              </div>

              {/* Event card */}
              <Card className={`p-4 border-l-4 ${getEventColor(event.eventType)}`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{getEventIcon(event.eventType)}</span>
                    <h3 className="text-lg font-semibold">{event.title}</h3>
                  </div>
                  <div className="flex gap-2 items-center">
                    <Badge variant="outline" className="text-xs">
                      {event.eventType.replace('_', ' ')}
                    </Badge>
                    {event.isOffscreen && (
                      <Badge variant="outline" className="text-xs bg-gray-700">
                        Off-screen
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Public summary */}
                {event.summaryPublic && event.visibility !== 'GM_ONLY' && (
                  <p className="text-gray-300 mb-2">{event.summaryPublic}</p>
                )}

                {/* GM summary (only visible to GM) */}
                {isGM && event.summaryGM && (
                  <div className="mt-3 p-3 bg-yellow-900/20 border border-yellow-500/50 rounded">
                    <p className="text-xs text-yellow-400 font-semibold mb-1">GM NOTES:</p>
                    <p className="text-yellow-200 text-sm">{event.summaryGM}</p>
                  </div>
                )}

                {/* Metadata */}
                <div className="mt-3 flex gap-4 text-xs text-gray-500">
                  <span>{new Date(event.sessionDate).toLocaleDateString()}</span>
                  {event.visibility === 'GM_ONLY' && isGM && (
                    <Badge variant="outline" className="text-xs bg-red-900/30 border-red-500">
                      GM Only
                    </Badge>
                  )}
                </div>
              </Card>
            </div>
          ))}

          {filteredEvents.length === 0 && (
            <Card className="p-8 text-center text-gray-400">
              <p>No timeline events yet. Start playing to build your story!</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
