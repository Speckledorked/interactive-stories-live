// src/app/campaigns/[id]/page.tsx (UPDATED WITH COMMUNICATION)

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Campaign, Character, NPC, Faction, Scene } from '@prisma/client';
import ChatPanel from '@/components/chat/ChatPanel';
import NotesPanel from '@/components/notes/NotesPanel';

interface CampaignData extends Campaign {
  characters: Character[];
  npcs: NPC[];
  factions: Faction[];
  scenes: Scene[];
  memberships: Array<{
    user: { id: string; email: string; name?: string; };
    role: string;
  }>;
}

export default function CampaignPage({ params }: { params: { id: string } }) {
  const [campaign, setCampaign] = useState<CampaignData | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string; name?: string; } | null>(null);
  const [userCharacters, setUserCharacters] = useState<Character[]>([]);
  const [currentScene, setCurrentScene] = useState<Scene | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'chat' | 'notes'>('overview');
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetchCampaign();
    fetchCurrentUser();
  }, [params.id]);

  useEffect(() => {
    if (campaign && currentUser) {
      setUserCharacters(campaign.characters.filter(c => c.userId === currentUser.id));
      // Get the most recent scene
      const latestScene = campaign.scenes.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0];
      setCurrentScene(latestScene || null);
    }
  }, [campaign, currentUser]);

  const fetchCurrentUser = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const userData = await response.json();
        setCurrentUser(userData.user);
      } else {
        router.push('/auth/login');
      }
    } catch (error) {
      console.error('Error fetching user:', error);
      router.push('/auth/login');
    }
  };

  const fetchCampaign = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/campaigns/${params.id}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setCampaign(data);
      } else if (response.status === 403) {
        alert('You do not have access to this campaign');
        router.push('/campaigns');
      } else {
        throw new Error('Failed to fetch campaign');
      }
    } catch (error) {
      console.error('Error fetching campaign:', error);
      router.push('/campaigns');
    } finally {
      setLoading(false);
    }
  };

  const startNewScene = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/campaigns/${params.id}/start-scene`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        // Refresh campaign data to get the new scene
        fetchCampaign();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error starting scene:', error);
      alert('Failed to start new scene');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading campaign...</p>
        </div>
      </div>
    );
  }

  if (!campaign || !currentUser) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-red-600">Campaign not found or access denied</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{campaign.title}</h1>
              <p className="text-gray-600">{campaign.description}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => router.push('/campaigns')}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
              >
                Back to Campaigns
              </button>
              {currentScene && (
                <button
                  onClick={startNewScene}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                >
                  New Scene
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8">
            {[
              { key: 'overview', label: 'Overview' },
              { key: 'chat', label: 'Chat' },
              { key: 'notes', label: 'Notes' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`py-3 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.key
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Current Scene */}
            {currentScene && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-semibold mb-4">Current Scene</h3>
                <div className="space-y-3">
                  <p className="text-gray-700">{currentScene.description}</p>
                  <div className="text-sm text-gray-500">
                    Status: <span className="font-medium">{currentScene.status}</span>
                  </div>
                  <div className="text-sm text-gray-500">
                    Created: {new Date(currentScene.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
            )}

            {/* Your Characters */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold mb-4">Your Characters</h3>
              {userCharacters.length === 0 ? (
                <p className="text-gray-500">No characters created yet.</p>
              ) : (
                <div className="space-y-3">
                  {userCharacters.map(character => (
                    <div key={character.id} className="p-3 border border-gray-200 rounded-md">
                      <h4 className="font-medium">{character.name}</h4>
                      <p className="text-sm text-gray-600 mt-1">{character.concept}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Campaign Members */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold mb-4">Campaign Members</h3>
              <div className="space-y-2">
                {campaign.memberships.map((membership, index) => (
                  <div key={index} className="flex justify-between items-center p-2 border border-gray-200 rounded-md">
                    <span className="font-medium">{membership.user.name || membership.user.email}</span>
                    <span className="text-sm text-gray-600 bg-gray-100 px-2 py-1 rounded">
                      {membership.role}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Stats */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold mb-4">Campaign Stats</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-3 bg-blue-50 rounded-md">
                  <div className="text-2xl font-bold text-blue-600">{campaign.characters.length}</div>
                  <div className="text-sm text-gray-600">Characters</div>
                </div>
                <div className="text-center p-3 bg-green-50 rounded-md">
                  <div className="text-2xl font-bold text-green-600">{campaign.npcs.length}</div>
                  <div className="text-sm text-gray-600">NPCs</div>
                </div>
                <div className="text-center p-3 bg-purple-50 rounded-md">
                  <div className="text-2xl font-bold text-purple-600">{campaign.factions.length}</div>
                  <div className="text-sm text-gray-600">Factions</div>
                </div>
                <div className="text-center p-3 bg-orange-50 rounded-md">
                  <div className="text-2xl font-bold text-orange-600">{campaign.scenes.length}</div>
                  <div className="text-sm text-gray-600">Scenes</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Chat Tab */}
        {activeTab === 'chat' && (
          <div className="max-w-4xl mx-auto">
            <ChatPanel
              campaignId={campaign.id}
              currentUserId={currentUser.id}
              currentUserName={currentUser.name || currentUser.email}
              userCharacters={userCharacters}
              sceneId={currentScene?.id}
            />
          </div>
        )}

        {/* Notes Tab */}
        {activeTab === 'notes' && (
          <div className="max-w-4xl mx-auto">
            <NotesPanel
              campaignId={campaign.id}
              currentUserId={currentUser.id}
              characters={campaign.characters}
              npcs={campaign.npcs}
              factions={campaign.factions}
              scenes={campaign.scenes}
            />
          </div>
        )}
      </div>
    </div>
  );
}
