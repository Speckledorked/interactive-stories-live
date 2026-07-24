// src/components/settings/NotificationSettings.tsx

'use client';

import { useState, useEffect } from 'react';
import { getToken } from '@/lib/clientAuth';

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

  // Sound notifications

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

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const token = getToken();
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
      const token = getToken();
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

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ember-400 mx-auto"></div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <p className="text-wine-400">Failed to load notification settings</p>
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
        <div className="font-medium text-ember-100">{label}</div>
        {description && (
          <div className="text-sm text-ember-300/60">{description}</div>
        )}
      </div>
      <button
        onClick={onChange}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          enabled ? 'bg-wine-600' : 'bg-black/30'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-ember-100 transition-transform ${
            enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-ember-100 mb-2">Notification Settings</h1>
        <p className="text-ember-300/60">Customize how you receive notifications from your AI Game Master.</p>
      </div>

      {/* Email Notifications */}
      <div className="bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 rounded-lg border border-ember-900/30 p-6">
        <h2 className="text-lg font-semibold text-ember-100 mb-4">📧 Email Notifications</h2>
        
        <ToggleSwitch
          enabled={settings.emailEnabled}
          onChange={() => handleToggle('emailEnabled')}
          label="Enable Email Notifications"
          description="Receive notifications via email"
        />

        {settings.emailEnabled && (
          <div className="ml-4 border-l-2 border-ember-900/30 pl-4 space-y-2">
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

      {/* Quiet Hours */}
      <div className="bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 rounded-lg border border-ember-900/30 p-6">
        <h2 className="text-lg font-semibold text-ember-100 mb-4">🌙 Quiet Hours</h2>
        
        <ToggleSwitch
          enabled={settings.quietHoursEnabled}
          onChange={() => handleToggle('quietHoursEnabled')}
          label="Enable Quiet Hours"
          description="Reduce notifications during specified hours"
        />

        {settings.quietHoursEnabled && (
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ember-200/80 mb-1">
                Start Time
              </label>
              <input
                type="time"
                value={settings.quietHoursStart || '22:00'}
                onChange={(e) => handleTimeChange('quietHoursStart', e.target.value)}
                className="w-full p-2 bg-black/30 border border-ember-900/40 rounded-md text-ember-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ember-200/80 mb-1">
                End Time
              </label>
              <input
                type="time"
                value={settings.quietHoursEnd || '08:00'}
                onChange={(e) => handleTimeChange('quietHoursEnd', e.target.value)}
                className="w-full p-2 bg-black/30 border border-ember-900/40 rounded-md text-ember-100"
              />
            </div>
          </div>
        )}
      </div>

      {/* Digest Preferences */}
      <div className="bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 rounded-lg border border-ember-900/30 p-6">
        <h2 className="text-lg font-semibold text-ember-100 mb-4">📊 Digest Emails</h2>
        
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
        <div className="fixed bottom-4 right-4 bg-wine-600 text-ember-100 px-4 py-2 rounded-lg shadow-lg">
          Saving settings...
        </div>
      )}
    </div>
  );
}
