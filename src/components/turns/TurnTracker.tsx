// src/components/turns/TurnTracker.tsx
// Advisory turn-order queue for a scene — an opt-in layer any player can
// enable, alongside the campaign's real action-collection mechanism
// (ExchangeManager, which tracks who has/hasn't submitted via
// Scene.waitingOnUsers). This never gates or blocks action submission:
// anyone can still act anytime, exactly as before. It only shows whose
// turn the table agreed it is, with a timer and an advance queue — see
// lib/notifications/turn-tracker.ts's doc comments for why it
// deliberately never touches Scene.waitingOnUsers. isHost (the campaign
// admin) only gates skipping ANOTHER player's turn — moderation, not
// GM-ing; there is no human GM in this product.

'use client';

import { useState, useEffect } from 'react';
import { getPusherClient } from '@/lib/realtime/pusher-client';
import { getToken } from '@/lib/clientAuth';
import { Button } from '@/components/ui/button';
import { Check, Hourglass, Pause } from 'lucide-react'

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
  isHost?: boolean;
}

export default function TurnTracker({
  campaignId,
  sceneId,
  currentUserId,
  isHost = false
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
      setShowAdvanceButton(turnInfo.currentPlayer.userId === currentUserId || isHost);
      setTimeRemaining(turnInfo.timeRemainingMs);
    }
  }, [turnInfo, currentUserId]);

  const fetchTurnInfo = async () => {
    try {
      const token = getToken();
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
    if (!pusher) {
      console.warn('Pusher is not configured. Real-time turn updates will be disabled.');
      return;
    }

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
    if (!pusher) return;
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
      const token = getToken();
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
    if (!isHost) return;

    if (!confirm('Skip the current player\'s turn?')) {
      return;
    }

    try {
      const token = getToken();
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
    if (minutes <= 1) return 'text-myth-danger';
    if (minutes <= 15) return 'text-myth-warn';
    return 'text-myth-good';
  };

  const getProgressBarColor = (ms: number): string => {
    const minutes = ms / (1000 * 60);
    if (minutes <= 1) return 'bg-myth-danger';
    if (minutes <= 15) return 'bg-myth-warn';
    return 'bg-myth-good';
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
      <div className="rounded-lg border border-myth-border bg-myth-surface p-5">
        <div className="text-center text-myth-ink-faint">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-myth-accent mx-auto mb-2"></div>
          <p className="text-sm">Loading turn order…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-myth-border bg-myth-surface">
      {/* Header */}
      <div className="p-5 border-b border-myth-border">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-myth-ink-faint uppercase tracking-wide">Turn Order</h3>
          <div className="font-mono text-xs text-myth-ink-faint">
            Turn {turnInfo.turnIndex + 1} of {turnInfo.totalPlayers}
          </div>
        </div>
      </div>

      {/* Current Turn Info */}
      <div className="p-5">
        <div className={`border rounded-lg p-4 mb-4 ${
          isMyTurn ? 'bg-myth-accent/10 border-myth-accent/40' : 'bg-myth-surface-sunken border-myth-border'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-medium text-myth-ink">
                {isMyTurn ? 'Your Turn!' : `Waiting for ${turnInfo.currentPlayer.name}`}
              </div>
              <div className="text-sm text-myth-ink-muted">
                {turnInfo.currentPlayer.name}
              </div>
            </div>
            <div className={`text-right ${getUrgencyColor(timeRemaining)}`}>
              <div className="font-mono text-lg font-bold">
                {formatTimeRemaining(timeRemaining)}
              </div>
              <div className="text-xs opacity-70">remaining</div>
            </div>
          </div>

          {/* The queue is advisory and never gates submission (see this
              file's header comment) — but nothing on screen said so. A
              player who isn't "up" sees a name they're waiting on, a
              countdown labelled "remaining", and a draining bar: three
              signals that all read as a lock. The one true statement about
              it lived only in a source comment, so say it where the person
              acting on it can read it. */}
          {!isMyTurn && (
            <p className="mb-3 text-xs text-myth-ink-muted">
              You can still act at any time — this queue is a suggestion, not a lock.
            </p>
          )}

          {/* Progress Bar */}
          <div className="w-full bg-myth-surface-sunken rounded-full h-2 mb-3">
            <div
              className={`h-2 rounded-full transition-all duration-1000 ${getProgressBarColor(timeRemaining)}`}
              style={{ width: `${100 - getProgressPercentage()}%` }}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            {showAdvanceButton && (
              <Button
                onClick={advanceTurn}
              >
                {isMyTurn ? 'End My Turn' : 'Advance Turn'}
              </Button>
            )}

            {isHost && (
              <Button
                variant="secondary"
                onClick={skipTurn}
              >
                Skip Turn
              </Button>
            )}
          </div>
        </div>

        {/* Turn Order */}
        <div>
          <h4 className="text-xs font-medium text-myth-ink-faint uppercase tracking-wide mb-2">Order</h4>
          <div className="space-y-1">
            {turnInfo.turnOrder.map((player, index) => (
              <div
                key={`${player.userId}-${index}`}
                className={`flex items-center justify-between p-2 rounded ${
                  index === turnInfo.turnIndex
                    ? 'bg-myth-accent/10 border border-myth-accent/30'
                    : 'hover:bg-myth-surface-sunken'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${
                    index === turnInfo.turnIndex ? 'bg-myth-accent' : 'bg-myth-border-strong'
                  }`} />
                  <span className="text-sm font-medium text-myth-ink">
                    {player.name}
                  </span>
                  {player.isNPC && (
                    <span className="text-xs bg-myth-surface-sunken text-myth-ink-faint px-2 py-0.5 rounded">
                      NPC
                    </span>
                  )}
                </div>
                <div className="text-xs text-myth-ink-faint">
                  {index < turnInfo.turnIndex ? <Check className="h-3 w-3" /> :
                   index === turnInfo.turnIndex ? <Hourglass className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
