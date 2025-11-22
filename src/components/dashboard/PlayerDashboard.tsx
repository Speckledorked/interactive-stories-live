'use client';

import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

interface PlayerDashboardProps {
  campaignId: string;
  characterId?: string;
}

interface CharacterStats {
  name: string;
  pronouns: string;
  harm: number;
  experience: number;
  conditions: any[];
  stats: any;
  perks: any[];
  recentActions: number;
  sessionsPlayed: number;
  scenesCompleted: number;
}

interface CampaignStats {
  totalScenes: number;
  activePlayers: number;
  currentTurn: number;
  lastSessionDate: Date | null;
  nextSessionDate: Date | null;
}

export function PlayerDashboard({ campaignId, characterId }: PlayerDashboardProps) {
  const [characterStats, setCharacterStats] = useState<CharacterStats | null>(null);
  const [campaignStats, setCampaignStats] = useState<CampaignStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, [campaignId, characterId]);

  const loadDashboardData = async () => {
    try {
      // Load character stats if characterId provided
      if (characterId) {
        const charResponse = await fetch(`/api/campaigns/${campaignId}/characters/${characterId}/stats`);
        if (charResponse.ok) {
          setCharacterStats(await charResponse.json());
        }
      }

      // Load campaign stats
      const campaignResponse = await fetch(`/api/campaigns/${campaignId}/stats`);
      if (campaignResponse.ok) {
        setCampaignStats(await campaignResponse.json());
      }
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-4">Loading dashboard...</div>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
      {/* Character Overview */}
      {characterStats && (
        <>
          <Card className="p-4">
            <h3 className="text-lg font-semibold mb-3">Character Status</h3>
            <div className="space-y-2">
              <div>
                <span className="font-semibold">{characterStats.name}</span>
                <span className="text-gray-400 ml-2">({characterStats.pronouns})</span>
              </div>

              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>Harm</span>
                  <span className="text-red-400">{characterStats.harm}/6</span>
                </div>
                <Progress value={(characterStats.harm / 6) * 100} className="bg-gray-700" />
              </div>

              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>Experience</span>
                  <span className="text-blue-400">{characterStats.experience} XP</span>
                </div>
                <Progress value={(characterStats.experience % 5) * 20} className="bg-gray-700" />
                <p className="text-xs text-gray-500 mt-1">
                  {5 - (characterStats.experience % 5)} XP to next advancement
                </p>
              </div>

              {characterStats.conditions.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">Active Conditions:</p>
                  <div className="flex flex-wrap gap-1">
                    {characterStats.conditions.map((condition: any, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {condition.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Stats */}
          <Card className="p-4">
            <h3 className="text-lg font-semibold mb-3">Stats</h3>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(characterStats.stats || {}).map(([stat, value]: [string, any]) => (
                <div key={stat} className="text-center p-2 bg-gray-800 rounded">
                  <div className="text-2xl font-bold text-blue-400">
                    {value >= 0 ? '+' : ''}{value}
                  </div>
                  <div className="text-xs text-gray-400 uppercase">{stat}</div>
                </div>
              ))}
            </div>

            {characterStats.perks.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium mb-2">Perks:</p>
                <div className="space-y-1">
                  {characterStats.perks.map((perk: any, i: number) => (
                    <div key={i} className="text-sm">
                      <span className="font-semibold text-green-400">{perk.name}</span>
                      <p className="text-xs text-gray-400">{perk.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* Activity Stats */}
          <Card className="p-4">
            <h3 className="text-lg font-semibold mb-3">Activity</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-400">Recent Actions:</span>
                <span className="font-semibold">{characterStats.recentActions}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Sessions Played:</span>
                <span className="font-semibold">{characterStats.sessionsPlayed}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Scenes Completed:</span>
                <span className="font-semibold">{characterStats.scenesCompleted}</span>
              </div>
            </div>
          </Card>
        </>
      )}

      {/* Campaign Stats */}
      {campaignStats && (
        <Card className="p-4 md:col-span-2 lg:col-span-3">
          <h3 className="text-lg font-semibold mb-3">Campaign Progress</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-3 bg-gray-800 rounded">
              <div className="text-3xl font-bold text-blue-400">{campaignStats.totalScenes}</div>
              <div className="text-sm text-gray-400">Total Scenes</div>
            </div>
            <div className="text-center p-3 bg-gray-800 rounded">
              <div className="text-3xl font-bold text-green-400">{campaignStats.activePlayers}</div>
              <div className="text-sm text-gray-400">Active Players</div>
            </div>
            <div className="text-center p-3 bg-gray-800 rounded">
              <div className="text-3xl font-bold text-purple-400">{campaignStats.currentTurn}</div>
              <div className="text-sm text-gray-400">Current Turn</div>
            </div>
            <div className="text-center p-3 bg-gray-800 rounded">
              <div className="text-xl font-bold text-orange-400">
                {campaignStats.nextSessionDate
                  ? new Date(campaignStats.nextSessionDate).toLocaleDateString()
                  : 'TBD'}
              </div>
              <div className="text-sm text-gray-400">Next Session</div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
