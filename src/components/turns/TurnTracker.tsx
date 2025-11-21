// src/components/turns/TurnTracker.tsx

'use client';

import { useState, useEffect } from 'react';
import { getPusherClient } from '@/lib/realtime/pusher-client';

interface TurnInfo {
  currentPlayer: {
    userId: string;
    name: string;
    characterId?: string;
  };
  turnIndex: number;
  totalPlayers: number;
  timeRemainingMs: number;
  timeRemainingMinutes: number;
  turnStartedAt: string;
  turnDeadline?: string;
  turnOrder: Array<{
    userId: string;
    characterId?: string;
    name: string;
    isNPC?: boolean;
  }>;
}

interface TurnTrackerProps {
  campaignId: string;
  sceneId: string;
  currentUserId: string;
  isGM?: boolean;
}

export default function TurnTracker({
  campaignId,
  sceneId,
  currentUserId,
  isGM = false
}: TurnTrackerProps) {
  const [turnInfo, setTurnInfo] = useState<TurnInfo | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isMyTurn, setIsMyTurn] = useState(false);
  const [showAdvanceButton, setShowAdvanceButton] = useState(false);

  useEffect(() => {
    fetchTurnInfo();
    setupRealtimeSubscription();

    // Update timer every second
    const timer = setInterval(updateTimeRemaining, 1000);

    return () => {
      clearInterval(timer);
      cleanup();
    };
  }, [campaignId, sceneId]);

  useEffect(() => {
    if (turnInfo) {
      setIsMyTurn(turnInfo.currentPlayer.userId === currentUserId);
      setShowAdvanceButton(turnInfo.currentPlayer.userId === currentUserId || isGM);
      setTimeRemaining(turnInfo.timeRemainingMs);
    }
  }, [turnInfo, currentUserId]);

  const fetchTurnInfo = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `/api/campaigns/${campaignId}/turns?sceneId=${sceneId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setTurnInfo(data.turnInfo);
      }
    } catch (error) {
      console.error('Error fetching turn info:', error);
    }
  };

  const setupRealtimeSubscription = () => {
    const pusher = getPusherClient();
    const channel = pusher.subscribe(`campaign-${campaignId}`);

    channel.bind('turn-update', (data: any) => {
      setTurnInfo(data);
    });

    channel.bind('turn-reminder', (data: any) => {
      if (data.userId === currentUserId) {
        // Handle turn reminder
        console.log('Turn reminder received:', data);
      }
    });
  };

  const cleanup = () => {
    const pusher = getPusherClient();
    pusher.unsubscribe(`campaign-${campaignId}`);
  };

  const updateTimeRemaining = () => {
    if (!turnInfo?.turnDeadline) return;

    const deadline = new Date(turnInfo.turnDeadline).getTime();
    const now = new Date().getTime();
    const remaining = Math.max(0, deadline - now);

    setTimeRemaining(remaining);
  };

  const advanceTurn = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/campaigns/${campaignId}/turns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'advance',
          sceneId
        }),
      });

      if (response.ok) {
        // Turn info will update via real-time subscription
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error advancing turn:', error);
      alert('Failed to advance turn');
    }
  };

  const skipTurn = async () => {
    if (!isGM) return;

    if (!confirm('Skip the current player\'s turn?')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/campaigns/${campaignId}/turns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'skip',
          sceneId
        }),
      });

      if (response.ok) {
        // Turn info will update via real-time subscription
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error skipping turn:', error);
      alert('Failed to skip turn');
    }
  };

  const formatTimeRemaining = (ms: number): string => {
    const minutes = Math.floor(ms / (1000 * 60));
    const seconds = Math.floor((ms % (1000 * 60)) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const getUrgencyColor = (ms: number): string => {
    const minutes = ms / (1000 * 60);
    if (minutes <= 1) return 'text-red-600 bg-red-50 border-red-200';
    if (minutes <= 5) return 'text-orange-600 bg-orange-50 border-orange-200';
    if (minutes <= 15) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    return 'text-green-600 bg-green-50 border-green-200';
  };

  const getProgressPercentage = (): number => {
    if (!turnInfo?.turnDeadline || !turnInfo?.turnStartedAt) return 100;

    const start = new Date(turnInfo.turnStartedAt).getTime();
    const end = new Date(turnInfo.turnDeadline).getTime();
    const now = new Date().getTime();
    const total = end - start;
    const elapsed = now - start;

    return Math.min(100, Math.max(0, (elapsed / total) * 100));
  };

  if (!turnInfo) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <div className="text-center text-gray-500">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400 mx-auto mb-2"></div>
          <p className="text-sm">Loading turn information...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Turn Tracker</h3>
          <div className="text-sm text-gray-500">
            Turn {turnInfo.turnIndex + 1} of {turnInfo.totalPlayers}
          </div>
        </div>
      </div>

      {/* Current Turn Info */}
      <div className="p-4">
        <div className={`border rounded-lg p-4 mb-4 ${
          isMyTurn ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-medium text-gray-900">
                {isMyTurn ? '🎯 Your Turn!' : `Waiting for ${turnInfo.currentPlayer.name}`}
              </div>
              <div className="text-sm text-gray-600">
                {turnInfo.currentPlayer.name}
              </div>
            </div>
            <div className={`text-right ${getUrgencyColor(timeRemaining)}`}>
              <div className="font-mono text-lg font-bold">
                {formatTimeRemaining(timeRemaining)}
              </div>
              <div className="text-xs">remaining</div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
            <div
              className={`h-2 rounded-full transition-all duration-1000 ${
                timeRemaining <= 60000 ? 'bg-red-500' :
                timeRemaining <= 300000 ? 'bg-orange-500' :
                timeRemaining <= 900000 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${100 - getProgressPercentage()}%` }}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            {showAdvanceButton && (
              <button
                onClick={advanceTurn}
                className={`px-4 py-2 rounded-md text-sm font-medium ${
                  isMyTurn
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-600 text-white hover:bg-gray-700'
                }`}
              >
                {isMyTurn ? 'End My Turn' : 'Advance Turn'}
              </button>
            )}

            {isGM && (
              <button
                onClick={skipTurn}
                className="px-4 py-2 bg-orange-600 text-white rounded-md text-sm font-medium hover:bg-orange-700"
              >
                Skip Turn
              </button>
            )}
          </div>
        </div>

        {/* Turn Order */}
        <div>
          <h4 className="font-medium text-gray-900 mb-2">Turn Order</h4>
          <div className="space-y-1">
            {turnInfo.turnOrder.map((player, index) => (
              <div
                key={`${player.userId}-${index}`}
                className={`flex items-center justify-between p-2 rounded ${
                  index === turnInfo.turnIndex
                    ? 'bg-blue-100 border border-blue-200'
                    : 'bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${
                    index === turnInfo.turnIndex ? 'bg-blue-500' : 'bg-gray-300'
                  }`} />
                  <span className="text-sm font-medium text-gray-900">
                    {player.name}
                  </span>
                  {player.isNPC && (
                    <span className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded">
                      NPC
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500">
                  {index < turnInfo.turnIndex ? '✓' :
                   index === turnInfo.turnIndex ? '⏳' : '⏸️'}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
