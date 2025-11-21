// src/components/settings/NotificationSettings.tsx

'use client';

import { useState, useEffect } from 'react';

interface NotificationSettings {
  // Email notifications
  emailEnabled: boolean;
  emailTurnReminders: boolean;
  emailSceneChanges: boolean;
  emailMentions: boolean;
  emailWhispers: boolean;
  emailCampaignInvites: boolean;
  emailWorldEvents: boolean;

  // Push notifications
  pushEnabled: boolean;
  pushTurnReminders: boolean;
  pushSceneChanges: boolean;
  pushMentions: boolean;
  pushWhispers: boolean;
  pushCampaignInvites: boolean;

  // Sound notifications
  soundEnabled: boolean;
  soundTurnReminders: boolean;
  soundSceneChanges: boolean;
  soundMentions: boolean;
  soundWhispers: boolean;
  soundCriticalMoments: boolean;
  soundWorldEvents: boolean;

  // Timing preferences
  quietHoursEnabled: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone?: string;

  // Digest preferences
  dailyDigestEnabled: boolean;
  weeklyDigestEnabled: boolean;
}

export default function NotificationSettings() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingSounds, setTestingSounds] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/notifications/settings', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setSettings(data);
      }
    } catch (error) {
      console.error('Error fetching notification settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateSettings = async (newSettings: Partial<NotificationSettings>) => {
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/notifications/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(newSettings),
      });

      if (response.ok) {
        const updatedSettings = await response.json();
        setSettings(updatedSettings);
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error updating settings:', error);
      alert('Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = (field: keyof NotificationSettings) => {
    if (!settings) return;
    
    const newValue = !settings[field];
    setSettings(prev => prev ? { ...prev, [field]: newValue } : null);
    updateSettings({ [field]: newValue });
  };

  const handleTimeChange = (field: 'quietHoursStart' | 'quietHoursEnd', value: string) => {
    setSettings(prev => prev ? { ...prev, [field]: value } : null);
    updateSettings({ [field]: value });
  };

  const testSound = async (soundId: string) => {
    setTestingSounds(soundId);
    
    try {
      // Import sound service dynamically
      const { SoundService } = await import('@/lib/notifications/sound-service');
      await SoundService.playSound({ soundId, volume: 0.5 });
    } catch (error) {
      console.error('Error testing sound:', error);
      alert('Failed to play sound. Make sure sound is enabled.');
    } finally {
      setTimeout(() => setTestingSounds(null), 1000);
    }
  };

  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) {
      alert('This browser does not support notifications');
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      updateSettings({ pushEnabled: true });
    } else {
      alert('Notification permission denied');
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <p className="text-red-600">Failed to load notification settings</p>
      </div>
    );
  }

  const ToggleSwitch = ({ 
    enabled, 
    onChange, 
    label, 
    description 
  }: { 
    enabled: boolean; 
    onChange: () => void; 
    label: string; 
    description?: string;
  }) => (
    <div className="flex items-center justify-between py-2">
      <div className="flex-1">
        <div className="font-medium text-gray-900">{label}</div>
        {description && (
          <div className="text-sm text-gray-500">{description}</div>
        )}
      </div>
      <button
        onClick={onChange}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          enabled ? 'bg-blue-600' : 'bg-gray-200'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Notification Settings</h1>
        <p className="text-gray-600">Customize how you receive notifications from your AI Game Master.</p>
      </div>

      {/* Email Notifications */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">📧 Email Notifications</h2>
        
        <ToggleSwitch
          enabled={settings.emailEnabled}
          onChange={() => handleToggle('emailEnabled')}
          label="Enable Email Notifications"
          description="Receive notifications via email"
        />

        {settings.emailEnabled && (
          <div className="ml-4 border-l-2 border-gray-200 pl-4 space-y-2">
            <ToggleSwitch
              enabled={settings.emailTurnReminders}
              onChange={() => handleToggle('emailTurnReminders')}
              label="Turn Reminders"
              description="When it's your turn to act"
            />
            <ToggleSwitch
              enabled={settings.emailSceneChanges}
              onChange={() => handleToggle('emailSceneChanges')}
              label="Scene Changes"
              description="When new scenes start"
            />
            <ToggleSwitch
              enabled={settings.emailMentions}
              onChange={() => handleToggle('emailMentions')}
              label="Mentions"
              description="When someone @mentions you"
            />
            <ToggleSwitch
              enabled={settings.emailWhispers}
              onChange={() => handleToggle('emailWhispers')}
              label="Private Messages"
              description="When you receive whispers"
            />
            <ToggleSwitch
              enabled={settings.emailCampaignInvites}
              onChange={() => handleToggle('emailCampaignInvites')}
              label="Campaign Invites"
              description="When invited to join campaigns"
            />
            <ToggleSwitch
              enabled={settings.emailWorldEvents}
              onChange={() => handleToggle('emailWorldEvents')}
              label="World Events"
              description="Major story developments"
            />
          </div>
        )}
      </div>

      {/* Push Notifications */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">🔔 Browser Notifications</h2>
        
        <ToggleSwitch
          enabled={settings.pushEnabled}
          onChange={() => settings.pushEnabled ? handleToggle('pushEnabled') : requestNotificationPermission()}
          label="Enable Browser Notifications"
          description="Show notifications in your browser"
        />

        {settings.pushEnabled && (
          <div className="ml-4 border-l-2 border-gray-200 pl-4 space-y-2">
            <ToggleSwitch
              enabled={settings.pushTurnReminders}
              onChange={() => handleToggle('pushTurnReminders')}
              label="Turn Reminders"
            />
            <ToggleSwitch
              enabled={settings.pushSceneChanges}
              onChange={() => handleToggle('pushSceneChanges')}
              label="Scene Changes"
            />
            <ToggleSwitch
              enabled={settings.pushMentions}
              onChange={() => handleToggle('pushMentions')}
              label="Mentions"
            />
            <ToggleSwitch
              enabled={settings.pushWhispers}
              onChange={() => handleToggle('pushWhispers')}
              label="Private Messages"
            />
            <ToggleSwitch
              enabled={settings.pushCampaignInvites}
              onChange={() => handleToggle('pushCampaignInvites')}
              label="Campaign Invites"
            />
          </div>
        )}
      </div>

      {/* Sound Notifications */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">🔊 Sound Effects</h2>
        
        <ToggleSwitch
          enabled={settings.soundEnabled}
          onChange={() => handleToggle('soundEnabled')}
          label="Enable Sound Effects"
          description="Play sounds for notifications and dramatic moments"
        />

        {settings.soundEnabled && (
          <div className="ml-4 border-l-2 border-gray-200 pl-4 space-y-2">
            <div className="flex items-center justify-between py-2">
              <div className="flex-1">
                <div className="font-medium text-gray-900">Turn Reminders</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => testSound('turn-reminder')}
                  disabled={testingSounds === 'turn-reminder'}
                  className="text-blue-600 hover:text-blue-800 text-sm"
                >
                  {testingSounds === 'turn-reminder' ? '♪' : 'Test'}
                </button>
                <button
                  onClick={() => handleToggle('soundTurnReminders')}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings.soundTurnReminders ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings.soundTurnReminders ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="flex-1">
                <div className="font-medium text-gray-900">Scene Changes</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => testSound('scene-change')}
                  disabled={testingSounds === 'scene-change'}
                  className="text-blue-600 hover:text-blue-800 text-sm"
                >
                  {testingSounds === 'scene-change' ? '♪' : 'Test'}
                </button>
                <button
                  onClick={() => handleToggle('soundSceneChanges')}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings.soundSceneChanges ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings.soundSceneChanges ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="flex-1">
                <div className="font-medium text-gray-900">Mentions</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => testSound('mention')}
                  disabled={testingSounds === 'mention'}
                  className="text-blue-600 hover:text-blue-800 text-sm"
                >
                  {testingSounds === 'mention' ? '♪' : 'Test'}
                </button>
                <button
                  onClick={() => handleToggle('soundMentions')}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings.soundMentions ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings.soundMentions ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            <ToggleSwitch
              enabled={settings.soundWhispers}
              onChange={() => handleToggle('soundWhispers')}
              label="Private Messages"
            />
            
            <ToggleSwitch
              enabled={settings.soundCriticalMoments}
              onChange={() => handleToggle('soundCriticalMoments')}
              label="Critical Moments"
              description="Dramatic events like critical hits, character deaths"
            />
            
            <ToggleSwitch
              enabled={settings.soundWorldEvents}
              onChange={() => handleToggle('soundWorldEvents')}
              label="World Events"
              description="Major story developments"
            />
          </div>
        )}
      </div>

      {/* Quiet Hours */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">🌙 Quiet Hours</h2>
        
        <ToggleSwitch
          enabled={settings.quietHoursEnabled}
          onChange={() => handleToggle('quietHoursEnabled')}
          label="Enable Quiet Hours"
          description="Reduce notifications during specified hours"
        />

        {settings.quietHoursEnabled && (
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start Time
              </label>
              <input
                type="time"
                value={settings.quietHoursStart || '22:00'}
                onChange={(e) => handleTimeChange('quietHoursStart', e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End Time
              </label>
              <input
                type="time"
                value={settings.quietHoursEnd || '08:00'}
                onChange={(e) => handleTimeChange('quietHoursEnd', e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md"
              />
            </div>
          </div>
        )}
      </div>

      {/* Digest Preferences */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">📊 Digest Emails</h2>
        
        <ToggleSwitch
          enabled={settings.dailyDigestEnabled}
          onChange={() => handleToggle('dailyDigestEnabled')}
          label="Daily Digest"
          description="Summary of activity sent daily"
        />
        
        <ToggleSwitch
          enabled={settings.weeklyDigestEnabled}
          onChange={() => handleToggle('weeklyDigestEnabled')}
          label="Weekly Digest"
          description="Summary of activity sent weekly"
        />
      </div>

      {/* Status */}
      {saving && (
        <div className="fixed bottom-4 right-4 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg">
          Saving settings...
        </div>
      )}
    </div>
  );
}
